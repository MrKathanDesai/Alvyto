# Local Room Agent

This directory contains the backend service for the Exam Room EMR's local transcription capability.

It uses [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper) to perform speech-to-text locally on the CPU, ensuring privacy and eliminating cloud costs.

## Requirements

1. **Python 3.10+**
2. **FFmpeg** installed system-wide.
   - Mac: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`
   - Windows: Download valid FFmpeg binary and add to PATH.

## Setup

1. Create a virtual environment (recommended):
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Running the Agent

You can use the helper script:

```bash
chmod +x start.sh
./start.sh
```

Or run manually:

```bash
uvicorn server:app --host 127.0.0.1 --port 8000
```

The server binds to `127.0.0.1` (localhost) to prevent external network access.

## API Endpoints

- `GET /health`
  - Returns `{"status": "ok", "model": "base.en"}`
- `POST /transcribe/chunk`
  - Body: `file` (audio/webm or wav)
  - Returns: `{"text": "partial transcript"}`
- `POST /transcribe`
  - Body: `file` (audio/webm or wav)
  - Returns: `{"segments": [...]}` with word-level timestamps.
