from fastapi import FastAPI, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
import logging
import time
import uuid
import numpy as np
from typing import Dict

from asr_engine import ASREngine, TranscriptionSession

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

# Global model instance
engine = None

# Active WebSocket sessions
active_sessions: Dict[str, TranscriptionSession] = {}


@app.on_event("startup")
def startup_event():
    global engine
    logger.info("Starting up Local Room Agent...")
    engine = ASREngine(model_size="base.en", device="cpu", compute_type="int8")


@app.get("/health")
def health():
    status = "ok" if engine else "loading"
    return {
        "status": status,
        "model": "base.en",
        "service": "RoomAgent",
        "diarization": engine.diarization.available if engine else False,
    }



@app.post("/transcribe/chunk")
async def transcribe_chunk(audio: UploadFile = File(...)):
    """
    Receives a small chunk of audio (audio/webm or wav).
    No VAD, for live feedback.
    """
    if not engine:
        return JSONResponse({"text": "", "confidence": 0, "is_final": False, "error": "Model not ready"})

    audio_bytes = await audio.read()

    if len(audio_bytes) < 1000:
        return JSONResponse({"text": "", "confidence": 0, "is_final": False})

    logger.info(f"Chunk: {len(audio_bytes)} bytes")

    try:
        result = engine.transcribe_chunk(audio_bytes)
        logger.info(f"Chunk result: '{result['text'][:80]}' conf:{result['confidence']}")
        return JSONResponse(result)
    except Exception as e:
        logger.error(f"Chunk error: {e}")
        return JSONResponse({"text": "", "confidence": 0, "is_final": False, "error": str(e)})


@app.post("/transcribe")
async def transcribe_full(audio: UploadFile = File(...), diarize: bool = False):
    if not engine:
        return JSONResponse({"text": "", "confidence": 0, "is_final": True, "error": "Model not ready"})

    audio_bytes = await audio.read()

    if len(audio_bytes) < 1000:
        return JSONResponse({"text": "", "confidence": 0, "is_final": True, "segments": []})

    logger.info(f"Final transcription: {len(audio_bytes)} bytes, diarize={diarize}")

    try:
        # Debug: Save audio to file to inspect quality/format
        with open("debug_audio.webm", "wb") as f:
            f.write(audio_bytes)
        
        logger.info(f"Saved debug_audio.webm ({len(audio_bytes)} bytes)")

        if diarize:
            # Pass the bytes directly; engine handles decoding
            result = engine.transcribe_full_diarized(audio_bytes)
        else:
            result = engine.transcribe_full(audio_bytes)
        logger.info(f"Final result: {len(result['text'])} chars, confidence: {result['confidence']}")
        return JSONResponse(result)
    except Exception as e:
        logger.error(f"Final transcription error: {e}")
        return JSONResponse({"text": "", "confidence": 0, "is_final": True, "error": str(e)})


@app.websocket("/ws/transcribe")
async def websocket_transcribe(websocket: WebSocket):
    await websocket.accept()

    session_id = str(uuid.uuid4())
    session = TranscriptionSession(session_id=session_id)
    active_sessions[session_id] = session

    logger.info(f"WebSocket session started: {session_id}")

    # Send session info
    await websocket.send_json({
        "type": "session_start",
        "session_id": session_id,
        "config": {
            "sample_rate": SAMPLE_RATE,
            "window_seconds": 6.0,
            "emit_interval": EMIT_INTERVAL_SECONDS,
        }
    })

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

            # Add to sliding window
            session.add_audio(audio_chunk)

            # Emit transcription at intervals
            current_time = time.time()
            if current_time - last_emit_time >= EMIT_INTERVAL_SECONDS:
                last_emit_time = current_time

                buffer_audio = session.get_buffer_array()

                if len(buffer_audio) >= SAMPLE_RATE and engine:  # At least 1 second
                    result = engine.transcribe_pcm(buffer_audio)

                    if result["text"]:
                        confirmed, partial = session.update_text(result["text"])

                        await websocket.send_json({
                            "type": "transcription",
                            "confirmed": confirmed,
                            "partial": partial,
                            "full_text": result["text"],
                            "confidence": result["confidence"],
                            "segments": result["segments"],
                            "timestamp": current_time,
                            "session_id": session_id,
                        })

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {session_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if session_id in active_sessions:
            del active_sessions[session_id]


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
