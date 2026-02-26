import os
import torch
from pyannote.audio import Pipeline
from dotenv import load_dotenv

load_dotenv()

HF_TOKEN = os.getenv("HF_TOKEN")
if not HF_TOKEN:
    print("Error: HF_TOKEN not found in environment")
    exit(1)

print(f"Loading pipeline with token: {HF_TOKEN[:4]}...")

try:
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=HF_TOKEN
    )
    pipeline.to(torch.device("cpu"))
    print("Pipeline loaded successfully.")
except Exception as e:
    print(f"Failed to load pipeline: {e}")
    exit(1)

AUDIO_FILE = "debug_audio.webm"
if not os.path.exists(AUDIO_FILE):
    print(f"Error: {AUDIO_FILE} not found. Capture audio via the app first.")
    exit(1)

print(f"Processing {AUDIO_FILE}...")
try:
    diarization = pipeline(AUDIO_FILE)
    
    # Handle wrapper if present (same logic as server)
    if hasattr(diarization, "itertracks"):
        iter_source = diarization
    elif hasattr(diarization, "annotation"):
        iter_source = diarization.annotation
    else:
        print(f"Unknown output type: {type(diarization)}")
        exit(1)

    count = 0
    for turn, _, speaker in iter_source.itertracks(yield_label=True):
        print(f"Speaker {speaker}: {turn.start:.1f}s -> {turn.end:.1f}s")
        count += 1
    
    print(f"Found {count} segments.")

except Exception as e:
    print(f"Processing failed: {e}")
    import traceback
    traceback.print_exc()
