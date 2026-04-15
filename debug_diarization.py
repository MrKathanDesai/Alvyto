import logging
import os
import numpy as np
from room_agent.asr_engine import ASREngine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Debug")

def debug():
    # Set HF_TOKEN from .env if possible
    if os.path.exists("room-agent/.env"):
        with open("room-agent/.env") as f:
            for line in f:
                if line.startswith("HF_TOKEN="):
                    os.environ["HF_TOKEN"] = line.split("=", 1)[1].strip()

    engine = ASREngine(model_size="base.en", device="cpu", compute_type="int8")
    
    audio_path = "room-agent/debug_audio.webm"
    if not os.path.exists(audio_path):
        print(f"File not found: {audio_path}")
        return

    with open(audio_path, "rb") as f:
        audio_bytes = f.read()

    print(f"Procesing {len(audio_bytes)} bytes...")
    result = engine.transcribe_full_diarized(audio_bytes)
    
    print("\n--- RESULT ---")
    print(f"Text: {result.get('text', '')[:100]}...")
    print(f"Dialogue turns: {len(result.get('dialogue', []))}")
    if result.get('dialogue'):
        for turn in result['dialogue'][:5]:
            print(f"[{turn['speaker']}] ({turn['start']}-{turn['end']}): {turn['text']}")
    else:
        print("DIALOUGE IS EMPTY!")
        print(f"Segments count: {len(result.get('segments', []))}")
        if result.get('segments'):
            print(f"Words in first segment: {len(result['segments'][0].get('words', []))}")

if __name__ == "__main__":
    debug()
