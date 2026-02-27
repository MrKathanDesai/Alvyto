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
from typing import Dict, Any
import os
from concurrent.futures import ThreadPoolExecutor

from asr_engine import ASREngine

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

# Active WebSocket sessions (for tracking connected clients)
active_sessions: Dict[str, Any] = {}

# Session audio buffer for WhisperX post-processing
pending_sessions: Dict[str, np.ndarray] = {}
completed_sessions: Dict[str, Any] = {}
session_metadata: Dict[str, Any] = {}

engine = None
preview_executor = ThreadPoolExecutor(max_workers=1)

@app.on_event("startup")
def startup_event():
    global engine
    logger.info("Starting up Local Room Agent base.en for preview and WhisperX caching...")
    engine = ASREngine(model_size="base.en", device="cpu", compute_type="int8")
    engine.load_whisperx_models()

@app.get("/health")
def health():
    status = "ok" if engine else "loading"
    return {
        "status": status,
        "service": "RoomAgent"
    }


class SpeakerMapping(BaseModel):
    mapping: Dict[str, str]

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
    """Called when doctor hits Stop. Processes in background, streams result back."""
    if session_id not in pending_sessions:
        return JSONResponse({"error": "Session not found"}, status_code=404)
    
    background_tasks.add_task(run_whisperx_pipeline, session_id, doctor_name, patient_name)
    return {"status": "processing", "session_id": session_id}

@app.get("/session/{session_id}/status")
async def get_session_status(session_id: str):
    if session_id in completed_sessions:
        return {"status": "completed", "data": completed_sessions[session_id]}
    elif session_id in pending_sessions:
        return {"status": "processing"}
    else:
        return JSONResponse({"error": "Session not found"}, status_code=404)

def run_whisperx_pipeline(session_id: str, doctor_name: str = "Doctor", patient_name: str = "Patient"):
    import whisperx
    import gc
    import torch
    
    logger.info(f"Starting WhisperX pipeline for session: {session_id}")
    audio = pending_sessions[session_id]
    
    device = "cpu"
    compute_type = "int8"
    
    try:
        # Step 1: Transcribe
        logger.info("Step 1: Transcribing...")
        result = engine.wx_model.transcribe(audio, batch_size=8, language="en")
        
        # Step 2: Align
        logger.info("Step 2: Aligning phonemes...")
        result = whisperx.align(
            result["segments"], engine.wx_align_model, engine.wx_metadata, audio, device=device
        )
        
        # Step 3: Diarize
        logger.info("Step 3: Diarizing speakers...")
        # Note: whisperx.diarize.DiarizationPipeline expects a numpy array
        # and wraps it into the Pyannote tensor dict internally.
        diarize_segments = engine.wx_diarize_model(
            audio, min_speakers=2, max_speakers=2
        )
        
        # Step 4: Assign speakers
        logger.info("Step 4: Assigning speakers...")
        result = whisperx.assign_word_speakers(diarize_segments, result)
        
        # Extract speaker confirmation samples
        def extract_speaker_samples(segments):
            """Return one representative line per detected speaker for confirmation UI."""
            samples = {}
            for seg in segments:
                speaker = seg.get("speaker")
                if speaker and speaker not in samples:
                    text = seg.get("text", "").strip()
                    if len(text.split()) >= 4:  # skip very short segments
                        samples[speaker] = {
                            "speaker_id": speaker,
                            "sample_text": text[:100],
                            "start": seg.get("start", 0)
                        }
                if len(samples) >= 3:  # max 3 speakers
                    break
            return list(samples.values())
            
        speaker_samples = extract_speaker_samples(result["segments"])
                
        # Apply label map if available
        meta = session_metadata.get(session_id, {})
        label_map = meta.get("speaker_label_map", {})
        
        # Assign default map if missing, using word count heuristic
        if not label_map:
            from collections import defaultdict
            word_count = defaultdict(int)
            for seg in result["segments"]:
                speaker = seg.get("speaker")
                if speaker:
                    word_count[speaker] += len(seg.get("text", "").split())
            
            sorted_speakers = sorted(word_count, key=word_count.get, reverse=True)
            roles = ["Doctor", "Patient", "Companion"]
            label_map = {spk: roles[i] if i < len(roles) else f"Speaker {i+1}" 
                         for i, spk in enumerate(sorted_speakers)}

        # Apply the map to dialogue and merge consecutive same-speaker turns
        dialogue = []
        
        role_to_name = {
            "Doctor": doctor_name,
            "Patient": patient_name,
            "Companion": "Companion"
        }
        
        name_map = {
            spk_id: role_to_name.get(role, role)
            for spk_id, role in label_map.items()
        }
        
        for seg in result["segments"]:
            if "speaker" in seg:
                raw_spk = seg["speaker"]
                role = label_map.get(raw_spk, "Unknown")
                name = name_map.get(raw_spk, "Unknown")
                text = seg.get("text", "").strip()
                
                if dialogue and dialogue[-1]["speaker"] == name:
                    dialogue[-1]["text"] += " " + text
                    dialogue[-1]["end"] = seg.get("end", 0)
                else:
                    dialogue.append({
                        "speaker": name, 
                        "text": text, 
                        "start": seg.get("start", 0), 
                        "end": seg.get("end", 0)
                    })
                    
        completed_sessions[session_id] = {
            "status": "complete",
            "dialogue": dialogue,
            "raw_segments": result["segments"],
            "speaker_samples": speaker_samples,
            "session_id": session_id
        }
        logger.info(f"WhisperX pipeline completed for {session_id}")
    except Exception as e:
        logger.error(f"WhisperX pipeline failed: {e}")
        completed_sessions[session_id] = {"error": str(e)}






@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    await websocket.accept()

    session_id = str(uuid.uuid4())
    active_sessions[session_id] = True

    logger.info(f"WebSocket recording session started: {session_id}")

    # Send session info
    await websocket.send_json({
        "type": "session_start",
        "session_id": session_id,
        "config": {
            "sample_rate": SAMPLE_RATE,
        }
    })

    audio_chunks = []
    preview_chunks = []
    LIVE_PREVIEW_INTERVAL = 5.0
    last_preview_time = time.time()
    last_emit_time = 0.0

    try:
        while True:
            data = await websocket.receive_bytes()

            # Decode audio — expect float32 PCM
            try:
                audio_chunk = np.frombuffer(data, dtype=np.float32)
            except Exception:
                try:
                    audio_chunk = np.frombuffer(data, dtype=np.int16).astype(np.float32) / 32768.0
                except Exception:
                    continue

            audio_chunks.append(audio_chunk)
            preview_chunks.append(audio_chunk)

            # Emit duration progress at intervals
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
                
                # Use last 8 seconds only — enough for a sentence
                preview_audio = np.concatenate(preview_chunks)
                max_preview_samples = 8 * SAMPLE_RATE
                if len(preview_audio) > max_preview_samples:
                    preview_audio = preview_audio[-max_preview_samples:]
                
                if engine:
                    loop = asyncio.get_running_loop()
                    preview_text = await loop.run_in_executor(
                        preview_executor,
                        engine.transcribe_pcm_simple,
                        preview_audio
                    )
                    
                    if preview_text:
                        await websocket.send_json({
                            "type": "live_preview",
                            "text": preview_text,
                            "is_preview": True,
                            "duration": round(duration, 1)
                        })
                
                # Roll the preview buffer — keep last 3s for continuity
                keep_samples = 3 * SAMPLE_RATE
                flat = np.concatenate(preview_chunks)
                if len(flat) > keep_samples:
                    preview_chunks = [flat[-keep_samples:]]
                else:
                    preview_chunks = [flat]

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected, saving audio for processing: {session_id}")
        if audio_chunks:
            full_audio = np.concatenate(audio_chunks)
            pending_sessions[session_id] = full_audio
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if session_id in active_sessions:
            del active_sessions[session_id]


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)