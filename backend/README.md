# Exam Room EMR - WhisperX Transcription Backend

High-accuracy, local speech-to-text transcription server for medical consultations using WhisperX.

## Features

- **WhisperX** - State-of-the-art transcription with word-level timestamps
- **VAD (Voice Activity Detection)** - Faster processing by skipping silence
- **Live Streaming** - Real-time transcription during recording
- **100% Local** - No data leaves your machine
- **Free** - No API costs or subscriptions

## Quick Start

### 1. Set up Python Environment

```bash
cd backend

# Create virtual environment
python3 -m venv venv

# Activate it
source venv/bin/activate  # macOS/Linux
# or: .\venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt
```

### 2. Install Additional Dependencies (if needed)

For ffmpeg (required for audio processing):
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg

# Windows - download from https://ffmpeg.org/download.html
```

### 3. Start the Server

```bash
python server.py
```

The server will start on `http://localhost:8000`

## Configuration

Set environment variables to customize:

```bash
# Model size: tiny, base, small, medium, large-v2, large-v3
export WHISPER_MODEL=base

# Device: cpu or cuda (for GPU)
export DEVICE=cpu

# Compute type: int8 (CPU), float16 (GPU with good VRAM), float32 (fallback)
export COMPUTE_TYPE=int8
```

### Model Size Guide

| Model | Size | Speed | Accuracy | Best For |
|-------|------|-------|----------|----------|
| tiny | 39 MB | Fastest | Good | Quick testing |
| base | 74 MB | Fast | Better | **Recommended for MVP** |
| small | 244 MB | Medium | Good | Balance of speed/accuracy |
| medium | 769 MB | Slow | Great | High accuracy needs |
| large-v3 | 1.5 GB | Slowest | Best | Maximum accuracy |

## API Endpoints

### `GET /health`
Health check and status.

### `POST /transcribe`
Full transcription of an audio file.

```bash
curl -X POST -F "audio=@recording.webm" http://localhost:8000/transcribe
```

### `POST /transcribe/chunk`
Transcribe an audio chunk (for live streaming).

```bash
curl -X POST -F "audio=@chunk.webm" http://localhost:8000/transcribe/chunk
```

### `WebSocket /ws/transcribe`
Real-time streaming transcription via WebSocket.

## Troubleshooting

### "No module named 'whisperx'"
```bash
pip install whisperx
```

### Audio processing errors
Make sure ffmpeg is installed:
```bash
ffmpeg -version
```

### Slow on CPU
Use a smaller model:
```bash
export WHISPER_MODEL=tiny
python server.py
```

### GPU Support
For NVIDIA GPU acceleration:
```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
export DEVICE=cuda
export COMPUTE_TYPE=float16
python server.py
```

## Integration with Frontend

The frontend automatically:
1. Sends audio chunks every 3 seconds during recording
2. Gets live transcription updates via the `/transcribe/chunk` endpoint
3. Gets final accurate transcription via `/transcribe` when recording stops

This provides consistent, high-quality transcription directly in the browser without any Web Speech API dependency.
