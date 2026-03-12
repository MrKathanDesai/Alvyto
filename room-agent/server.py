from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi import BackgroundTasks
from pydantic import BaseModel
import uvicorn
import logging
import asyncio
import time
import uuid
import numpy as np
from typing import Dict, Any, List
import os
from concurrent.futures import ThreadPoolExecutor

from asr_engine import ASREngine, DEVICE

# Configure Logging
logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logger = logging.getLogger("RoomAgent")

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
pending_sessions: Dict[str, np.ndarray] = {}
completed_sessions: Dict[str, Any] = {}
session_metadata: Dict[str, Any] = {}

engine = None
preview_executor = ThreadPoolExecutor(max_workers=1)

@app.on_event("startup")
def startup_event():
    global engine
    logger.info("Starting up Local Room Agent with unified WhisperX pipeline...")
    engine = ASREngine()

@app.get("/health")
def health():
    status = "ok" if engine else "loading"
    return {
        "status": status,
        "service": "RoomAgent"
    }

class SpeakerMapping(BaseModel):
    mapping: Dict[str, str]

class DialogueTurn(BaseModel):
    speaker: str
    text: str
    start: float = 0.0
    end: float = 0.0

class SummarizeRequest(BaseModel):
    dialogue: List[DialogueTurn]

@app.post("/summarize")
async def summarize_dialogue(req: SummarizeRequest):
    """Generate summary from a confirmed, speaker-labelled dialogue.
    Called by the frontend AFTER the user has confirmed speaker assignments."""
    if not engine or not engine.summarizer:
        return JSONResponse({"error": "Summarizer not ready"}, status_code=503)
    try:
        dialogue_dicts = [{"speaker": t.speaker, "text": t.text} for t in req.dialogue]
        result = engine.summarizer.summarize_dialogue(dialogue_dicts)
        return result
    except Exception as e:
        logger.error(f"Summarization failed: {e}", exc_info=True)
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/session/{session_id}/confirm_speakers")
async def confirm_speakers(session_id: str, payload: SpeakerMapping):
    if session_id in pending_sessions or session_id in active_sessions or session_id in session_metadata:
        if session_id not in session_metadata:
            session_metadata[session_id] = {}
        session_metadata[session_id]["speaker_label_map"] = payload.mapping
        session_metadata[session_id]["speaker_confirmed"] = True
        return {"status": "ok"}
    return JSONResponse({"error": "Session not found"}, status_code=404)

@app.post("/process/{session_id}")
async def process_session(
    session_id: str, 
    background_tasks: BackgroundTasks,
    doctor_name: str = "Doctor",
    patient_name: str = "Patient"
):
    if session_id not in pending_sessions:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    
    background_tasks.add_task(execute_pipeline, session_id, doctor_name, patient_name)
    return {"status": "processing", "session_id": session_id}

@app.get("/session/{session_id}/status")
async def get_session_status(session_id: str):
    if session_id in completed_sessions:
        return {"status": "completed", "data": completed_sessions[session_id]}
    elif session_id in pending_sessions:
        return {"status": "processing"}
    else:
        return JSONResponse({"error": "Session not found"}, status_code=404)

def execute_pipeline(session_id: str, doctor_name: str, patient_name: str):
    logger.info(f"Starting pipeline for session: {session_id}")
    audio = pending_sessions.get(session_id)
    if audio is None:
        logger.error(f"Session {session_id} not found in pending_sessions")
        return

    try:
        # ASREngine handles transcription + diarization only (no summarization)
        # Summary is generated separately after the user confirms speaker labels
        result = engine.run_pipeline(audio, doctor_name, patient_name, should_summarize=False)
        
        # Apply confirmed label mapping if it arrived while processing
        meta = session_metadata.get(session_id, {})
        label_map = meta.get("speaker_label_map")
        
        if label_map and result.get("status") == "complete":
             # We could re-map here if needed, but for now we follow the engine default
             # or the user can confirm in the UI. 
             pass

        completed_sessions[session_id] = result
        logger.info(f"Pipeline complete for {session_id}")
    except Exception as e:
        logger.error(f"Pipeline execution failed for {session_id}: {e}", exc_info=True)
        completed_sessions[session_id] = {"status": "error", "error": str(e)}
    finally:
        pending_sessions.pop(session_id, None)

@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    await websocket.accept()

    session_id = str(uuid.uuid4())
    active_sessions[session_id] = True

    logger.info(f"WebSocket recording session started: {session_id}")

    await websocket.send_json({
        "type": "session_start",
        "session_id": session_id,
        "config": {"sample_rate": SAMPLE_RATE}
    })

    audio_chunks = []
    preview_chunks = []
    LIVE_PREVIEW_INTERVAL = 5.0
    last_preview_time = time.time()
    last_emit_time = 0.0

    try:
        while True:
            data = await websocket.receive_bytes()

            try:
                audio_chunk = np.frombuffer(data, dtype=np.float32)
            except Exception:
                try:
                    audio_chunk = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
                except Exception:
                    continue

            audio_chunks.append(audio_chunk)
            preview_chunks.append(audio_chunk)

            current_time = time.time()
            duration = sum(len(c) for c in audio_chunks) / SAMPLE_RATE

            if current_time - last_emit_time >= EMIT_INTERVAL_SECONDS:
                last_emit_time = current_time
                await websocket.send_json({
                    "type": "recording_progress",
                    "duration": round(duration, 1)
                })

            if current_time - last_preview_time >= LIVE_PREVIEW_INTERVAL:
                last_preview_time = current_time
                
                preview_audio = np.concatenate(preview_chunks)
                max_preview_samples = 8 * SAMPLE_RATE
                if len(preview_audio) > max_preview_samples:
                    preview_audio = preview_audio[-max_preview_samples:]
                
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
                
                keep_samples = 3 * SAMPLE_RATE
                flat = np.concatenate(preview_chunks)
                if len(flat) > keep_samples:
                    preview_chunks = [flat[-keep_samples:]]
                else:
                    preview_chunks = [flat]

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected, saving audio: {session_id}")
        if audio_chunks:
            pending_sessions[session_id] = np.concatenate(audio_chunks)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if session_id in active_sessions:
            del active_sessions[session_id]


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)