import requests
import numpy as np
import scipy.io.wavfile as wav
import io
import time

BASE_URL = "http://127.0.0.1:8000"

def create_dummy_audio(duration_sec=2):
    """Generates a sine wave audio file in memory."""
    sample_rate = 16000
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), endpoint=False)
    # Generate 440Hz sine wave
    audio = 0.5 * np.sin(2 * np.pi * 440 * t)
    
    byte_io = io.BytesIO()
    wav.write(byte_io, sample_rate, audio.astype(np.float32))
    byte_io.seek(0)
    return byte_io, "test_audio.wav"

def test_health():
    print("Testing /health...")
    try:
        resp = requests.get(f"{BASE_URL}/health")
        print(f"Status: {resp.status_code}")
        print(f"Response: {resp.json()}")
    except Exception as e:
        print(f"Failed: {e}")

def test_chunk_transcription():
    print("\nTesting /transcribe/chunk...")
    audio_file, filename = create_dummy_audio(1.0)
    files = {"file": (filename, audio_file, "audio/wav")}
    
    start = time.time()
    try:
        resp = requests.post(f"{BASE_URL}/transcribe/chunk", files=files)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            print(f"Response: {resp.json()}")
            print(f"Latency: {(time.time() - start)*1000:.2f}ms")
        else:
            print(f"Error: {resp.text}")
    except Exception as e:
        print(f"Failed: {e}")

def test_full_transcription():
    print("\nTesting /transcribe (full)...")
    audio_file, filename = create_dummy_audio(3.0)
    files = {"file": (filename, audio_file, "audio/wav")}
    
    start = time.time()
    try:
        resp = requests.post(f"{BASE_URL}/transcribe", files=files)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            # Just print summary to avoid huge output
            seg_count = len(data.get("segments", []))
            print(f"Response: Received {seg_count} segments")
            if seg_count > 0:
                print(f"First segment text: {data['segments'][0].get('text')}")
            print(f"Latency: {(time.time() - start)*1000:.2f}ms")
        else:
            print(f"Error: {resp.text}")
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    print("Ensure the server is running: ./start.sh")
    test_health()
    test_chunk_transcription()
    test_full_transcription()
