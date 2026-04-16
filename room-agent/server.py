from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi import BackgroundTasks
from pydantic import BaseModel
import uvicorn
import logging
import asyncio
import time
import uuid
import json
import numpy as np
from typing import Dict, Any, List, Optional
import os
from concurrent.futures import ThreadPoolExecutor
import requests

from asr_engine import ASREngine, DEVICE

# Configure Logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger("RoomAgent")
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8080")


def _save_progress_to_backend(
    visit_id: str,
    transcript: str,
    dialogue: list,
    auth_token: Optional[str] = None,
    status: str = None,
) -> None:
    """Fire-and-forget: persist transcript + dialogue to the EMR backend.
    Called after the ASR pipeline finishes so data survives browser crashes."""
    token = auth_token or os.environ.get("ROOM_TOKEN", "")
    if not visit_id:
        return
    try:
        payload = {"transcript": transcript, "dialogue": dialogue}
        if status:
            payload["status"] = status
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        resp = requests.patch(
            f"{BACKEND_URL}/api/visits/{visit_id}/progress",
            json=payload,
            headers=headers,
            timeout=10,
        )
        if resp.status_code not in (200, 409):
            logger.warning(f"Progress save returned {resp.status_code}: {resp.text[:200]}")
        else:
            logger.info(f"Saved progress for visit {visit_id}: {len(dialogue)} turns")
    except Exception as e:
        logger.warning(f"Could not save progress to backend: {e}")


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    prefix = "bearer "
    if authorization.lower().startswith(prefix):
        return authorization[len(prefix):].strip() or None
    return None


def _validate_room_agent_token(token: Optional[str]) -> None:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Room agent authentication required")

    try:
        resp = requests.get(
            f"{BACKEND_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=5,
        )
    except Exception as exc:
        logger.warning("Room agent auth check failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to validate room agent session",
        ) from exc

    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid room agent session")


app = FastAPI(title="Local Room Agent")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Constants
SAMPLE_RATE = 16000
EMIT_INTERVAL_SECONDS = 1.0

# Active WebSocket sessions
active_sessions: Dict[str, Any] = {}

# Session audio buffer for post-processing
# Stores session_id -> np.ndarray OR session_id -> filepath (string)
pending_sessions: Dict[str, Any] = {}
completed_sessions: Dict[str, Any] = {}
session_transcripts: Dict[str, str] = {}
session_metadata: Dict[str, Any] = {}
session_stages: Dict[str, str] = {}
engine = None
preview_executor = ThreadPoolExecutor(max_workers=1)

# Persistent recording config
RECORDINGS_DIR = os.path.join(os.path.dirname(__file__), "recordings")
os.makedirs(RECORDINGS_DIR, exist_ok=True)

@app.on_event("startup")
def startup_event():
    global engine
    logger.info("Starting up Local Room Agent with unified WhisperX pipeline...")
    engine = ASREngine()

    # Recovery: Scan recordings dir for stranded sessions
    for filename in os.listdir(RECORDINGS_DIR):
        if filename.endswith(".raw") and filename.startswith("alvyto_audio_"):
            session_id = filename.replace("alvyto_audio_", "").replace(".raw", "")
            if session_id not in pending_sessions:
                path = os.path.join(RECORDINGS_DIR, filename)
                pending_sessions[session_id] = path
                logger.info(f"Recovered stranded session from disk: {session_id}")

@app.get("/health")
def health(authorization: Optional[str] = Header(default=None)):
    _validate_room_agent_token(_extract_bearer_token(authorization))
    status = "ok" if engine else "loading"
    return {
        "status": status,
        "service": "RoomAgent"
    }

class DialogueTurn(BaseModel):
    speaker: str
    text: str
    start: float = 0.0
    end: float = 0.0

class SummarizeRequest(BaseModel):
    dialogue: List[DialogueTurn]
    medical_history: Optional[dict] = None

class ExpandRequest(BaseModel):
    clinical_snapshot: List[dict]
    doctor_actions: List[str]
    transcript: str

@app.post("/summarize")
async def summarize_dialogue(req: SummarizeRequest, authorization: Optional[str] = Header(default=None)):
    """Generate summary from a confirmed, speaker-labelled dialogue.
    Called by the frontend AFTER the user has confirmed speaker assignments."""
    _validate_room_agent_token(_extract_bearer_token(authorization))
    if not engine or not engine.summarizer:
        return JSONResponse({"error": "Summarizer not ready"}, status_code=503)
    try:
        dialogue_dicts = [{"speaker": t.speaker, "text": t.text} for t in req.dialogue]
        result = engine.summarizer.summarize_dialogue(dialogue_dicts, medical_history=req.medical_history)
        return result
    except Exception as e:
        logger.error(f"Summarization failed: {e}", exc_info=True)
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/expand")
async def expand_summary(req: ExpandRequest, authorization: Optional[str] = Header(default=None)):
    """Regenerate issuesParagraph and actionsParagraph when the doctor edits bullets.
    Called by the frontend after the user adds/edits clinical snapshot chips or doctor action bullets."""
    _validate_room_agent_token(_extract_bearer_token(authorization))
    if not engine or not engine.summarizer:
        return JSONResponse({"error": "Summarizer not ready"}, status_code=503)
    try:
        result = engine.summarizer.expand_from_bullets(
            clinical_snapshot=req.clinical_snapshot,
            doctor_actions=req.doctor_actions,
            transcript=req.transcript
        )
        return result
    except Exception as e:
        logger.error(f"Expand failed: {e}", exc_info=True)
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/process/{session_id}")
async def process_session(
    session_id: str,
    background_tasks: BackgroundTasks,
    doctor_name: str = "Doctor",
    patient_name: str = "Patient",
    visit_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(default=None),
):
    token = _extract_bearer_token(authorization)
    _validate_room_agent_token(token)
    if session_id not in pending_sessions:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    if session_id not in session_metadata:
        session_metadata[session_id] = {}
    if visit_id:
        session_metadata[session_id]["visit_id"] = visit_id
    if token:
        session_metadata[session_id]["token"] = token

    background_tasks.add_task(execute_pipeline, session_id, doctor_name, patient_name)
    return {"status": "processing", "session_id": session_id}

@app.get("/session/{session_id}/status")
async def get_session_status(session_id: str, authorization: Optional[str] = Header(default=None)):
    _validate_room_agent_token(_extract_bearer_token(authorization))
    if session_id in completed_sessions:
        return {"status": "completed", "data": completed_sessions[session_id]}
    elif session_id in pending_sessions:
        return {"status": "processing", "stage": session_stages.get(session_id, "processing")}
    else:
        return JSONResponse({"error": "Session not found"}, status_code=404)

def execute_pipeline(session_id: str, doctor_name: str, patient_name: str):
    logger.info(f"Starting pipeline for session: {session_id}")
    audio = pending_sessions.get(session_id)
    if audio is None:
        logger.error(f"Session {session_id} not found in pending_sessions")
        return

    try:
        def status_cb(stage: str):
            session_stages[session_id] = stage

        # Load audio from disk if it's a string path, else use in-memory array
        if isinstance(audio, str) and os.path.exists(audio):
            logger.info(f"Loading audio from persistent storage: {audio}")
            audio_array = np.fromfile(audio, dtype=np.float32)
        else:
            audio_array = audio

        if audio_array is None or len(audio_array) == 0:
            logger.error(f"Audio empty for session {session_id}")
            completed_sessions[session_id] = {"status": "error", "error": "Audio empty or missing"}
            return

        # ASREngine handles transcription + diarization only (no summarization)
        # Summary is generated separately after the user confirms speaker labels
        result = engine.run_pipeline(audio_array, doctor_name, patient_name, should_summarize=False, status_callback=status_cb)

        # Apply confirmed label mapping if it arrived while processing
        meta = session_metadata.get(session_id, {})
        label_map = meta.get("speaker_label_map")

        # Speaker remapping is done client-side in confirmSpeakersClientSide().
        # The label_map stored here is unused at the server level.

        completed_sessions[session_id] = result

        # Persist transcript + dialogue to backend so browser refresh can restore session
        visit_meta = session_metadata.get(session_id, {})
        visit_id = visit_meta.get("visit_id")
        if visit_id and isinstance(result, dict):
            _transcript = result.get("transcript", "")
            _dialogue = result.get("dialogue", [])
            _save_progress_to_backend(
                visit_id,
                _transcript,
                _dialogue,
                auth_token=visit_meta.get("token"),
                status="in_progress",
            )

        if result.get("dialogue"):
            session_transcripts[session_id] = " ".join(
                t.get("text", "") for t in result["dialogue"]
            )
        logger.info(f"Pipeline complete for {session_id}")
    except Exception as e:
        logger.error(f"Pipeline execution failed for {session_id}: {e}", exc_info=True)
        completed_sessions[session_id] = {"status": "error", "error": str(e)}
    finally:
        audio_data = pending_sessions.pop(session_id, None)
        # Cleanup persistent file
        if isinstance(audio_data, str) and os.path.exists(audio_data):
            try:
                os.remove(audio_data)
                logger.info(f"Cleaned up persistent audio file: {audio_data}")
            except Exception as e:
                logger.warning(f"Failed to cleanup audio file {audio_data}: {e}")

        session_stages.pop(session_id, None)

@app.websocket("/ws/transcribe")
async def websocket_transcribe(
    websocket: WebSocket,
    session_id: str = Query(None),
    visit_id: Optional[str] = Query(None),
    token: Optional[str] = Query(None),
):
    try:
        _validate_room_agent_token(token)
    except HTTPException:
        await websocket.close(code=4401)
        return

    await websocket.accept()

    if not session_id:
        session_id = str(uuid.uuid4())
        logger.info(f"Generated new session_id for anonymous connection: {session_id}")
    else:
        logger.info(f"WebSocket connection requested for session_id: {session_id}")

    active_sessions[session_id] = True
    if session_id not in session_metadata:
        session_metadata[session_id] = {}
    if visit_id:
        session_metadata[session_id]["visit_id"] = visit_id
    if token:
        session_metadata[session_id]["token"] = token

    logger.info(f"WebSocket recording session started: {session_id}")

    await websocket.send_json({
        "type": "session_start",
        "session_id": session_id,
        "config": {"sample_rate": SAMPLE_RATE}
    })

    # Rolling buffer for live previews (prevents full RAM blowup)
    preview_rolling_buffer = []
    MAX_PREVIEW_RAM = SAMPLE_RATE * 30 # keep 30s in preview RAM max
    total_samples_received = 0
    LIVE_PREVIEW_INTERVAL = 5.0
    last_preview_time = time.time()
    last_emit_time = 0.0

    # Create session-specific audio backup file in stable recordings dir
    backup_filepath = os.path.join(RECORDINGS_DIR, f"alvyto_audio_{session_id}.raw")
    mode = "ab" if os.path.exists(backup_filepath) else "wb"
    logger.info(f"{'Resuming' if mode == 'ab' else 'Starting'} persistent audio stream: {backup_filepath}")

    try:
        with open(backup_filepath, mode) as backup_file:
            while True:
                ws_msg = await websocket.receive()

                if ws_msg.get("type") == "websocket.disconnect":
                    raise WebSocketDisconnect

                if ws_msg.get("text") is not None:
                    try:
                        data_json = json.loads(ws_msg["text"])
                    except Exception:
                        continue

                    # Ensure visit_id from start/control payload is persisted on session metadata
                    if "visit_id" in data_json:
                        session_metadata[session_id]["visit_id"] = data_json["visit_id"]

                    if data_json.get("type") == "stop_recording":
                        logger.info(f"Received stop_recording for session: {session_id}")
                        pending_sessions[session_id] = backup_filepath
                        await websocket.send_json({"type": "processing", "session_id": session_id})

                        try:
                            audio_array = np.fromfile(backup_filepath, dtype=np.float32)

                            if audio_array is None or len(audio_array) == 0:
                                result = {"status": "error", "error": "Audio empty or missing"}
                            else:
                                loop = asyncio.get_running_loop()
                                doctor_name = data_json.get("doctor_name", "Doctor")
                                patient_name = data_json.get("patient_name", "Patient")
                                result = await loop.run_in_executor(
                                    preview_executor,
                                    engine.run_pipeline,
                                    audio_array,
                                    doctor_name,
                                    patient_name,
                                    False,
                                    None,
                                )

                            completed_sessions[session_id] = result

                            # Persist transcript + dialogue to backend so browser refresh can restore session
                            visit_meta = session_metadata.get(session_id, {})
                            visit_id = visit_meta.get("visit_id")
                            if visit_id and isinstance(result, dict):
                                _transcript = result.get("transcript", "")
                                _dialogue = result.get("dialogue", [])
                                _save_progress_to_backend(
                                    visit_id,
                                    _transcript,
                                    _dialogue,
                                    auth_token=visit_meta.get("token"),
                                    status="in_progress",
                                )

                            if isinstance(result, dict) and result.get("dialogue"):
                                session_transcripts[session_id] = " ".join(
                                    t.get("text", "") for t in result["dialogue"]
                                )

                            await websocket.send_json({
                                "type": "pipeline_complete",
                                "session_id": session_id,
                                "status": "completed",
                            })
                        except Exception as e:
                            logger.error(f"Pipeline execution failed for {session_id}: {e}", exc_info=True)
                            completed_sessions[session_id] = {"status": "error", "error": str(e)}
                            await websocket.send_json({
                                "type": "pipeline_complete",
                                "session_id": session_id,
                                "status": "error",
                                "error": str(e),
                            })
                        finally:
                            audio_data = pending_sessions.pop(session_id, None)
                            if isinstance(audio_data, str) and os.path.exists(audio_data):
                                try:
                                    os.remove(audio_data)
                                    logger.info(f"Cleaned up persistent audio file: {audio_data}")
                                except Exception as e:
                                    logger.warning(f"Failed to cleanup audio file {audio_data}: {e}")

                        continue

                    # Ignore other text/control payloads
                    continue

                data = ws_msg.get("bytes")
                if data is None:
                    continue

                try:
                    # Normalize first to ensure disk format is consistent float32
                    # Try float32 (standard)
                    chunk = np.frombuffer(data, dtype=np.float32)
                    # We don't check dtype here because np.frombuffer with dtype=np.float32
                    # either returns float32 or raises an error if the buffer is too small/misaligned.
                except Exception:
                    try:
                        # Fallback to int16
                        chunk = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
                    except Exception:
                        continue

                # Write normalized float32 bytes to disk immediately
                backup_file.write(chunk.tobytes())
                backup_file.flush()

                # Update preview buffer
                preview_rolling_buffer.append(chunk)

                # Truncate preview buffer if it gets too large for RAM
                current_preview_size = sum(len(c) for c in preview_rolling_buffer)
                if current_preview_size > MAX_PREVIEW_RAM:
                    # Keep the last MAX_PREVIEW_RAM samples
                    flat = np.concatenate(preview_rolling_buffer)
                    preview_rolling_buffer = [flat[-MAX_PREVIEW_RAM:]]

                current_time = time.time()
                total_samples_received += len(chunk)
                duration = total_samples_received / SAMPLE_RATE

                if current_time - last_emit_time >= EMIT_INTERVAL_SECONDS:
                    last_emit_time = current_time
                    await websocket.send_json({
                        "type": "recording_progress",
                        "duration": round(duration, 1)
                    })

                if current_time - last_preview_time >= LIVE_PREVIEW_INTERVAL:
                    last_preview_time = current_time

                    preview_audio = np.concatenate(preview_rolling_buffer)
                    # Use last few seconds for preview
                    max_p = 8 * SAMPLE_RATE
                    if len(preview_audio) > max_p:
                        preview_audio = preview_audio[-max_p:]

                    if engine:
                        loop = asyncio.get_running_loop()
                        preview_text = await loop.run_in_executor(
                            preview_executor,
                            engine.transcribe_preview,
                            preview_audio
                        )

                        if preview_text:
                            await websocket.send_json({
                                "type": "live_preview",
                                "text": preview_text,
                                "is_preview": True,
                                "duration": round(duration, 1)
                            })

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected, session persistent on disk: {session_id}")
        pending_sessions[session_id] = backup_filepath
    except Exception as e:
        logger.error(f"WebSocket error in {session_id}: {e}", exc_info=True)
        # Still store the path if possible
        if os.path.exists(backup_filepath):
            pending_sessions[session_id] = backup_filepath
    finally:
        if session_id in active_sessions:
            del active_sessions[session_id]


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
