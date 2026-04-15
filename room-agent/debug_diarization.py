import os
import torch
import numpy as np
from pyannote.audio import Pipeline
from dotenv import load_dotenv
from asr_engine import ASREngine

load_dotenv()

HF_TOKEN = os.getenv("HF_TOKEN")
if not HF_TOKEN:
    print("Error: HF_TOKEN not found in environment")
    exit(1)

print(f"Loading pipeline with token: {HF_TOKEN[:4]}...")

try:
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=HF_TOKEN
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
    import av
    container = av.open(AUDIO_FILE)
    pcm_samples = []
    for frame in container.decode(audio=0):
        arr = frame.to_ndarray().flatten()
        if frame.format.name != 'flt':
            arr = arr.astype(np.float32) / 32768.0
        pcm_samples.append(arr)
    container.close()
    
    if not pcm_samples:
        print("Error: No PCM samples decoded by pyAV")
        exit(1)
        
    full_audio = np.concatenate(pcm_samples)
    print(f"Decoded {len(full_audio)} samples.")
    
    waveform = torch.from_numpy(full_audio).unsqueeze(0).float()
    audio_input = {"waveform": waveform, "sample_rate": 16000}
    
    diarization = pipeline(audio_input, num_speakers=2)
    print(f"Diarization output type: {type(diarization)}")
    
    if hasattr(diarization, "speaker_diarization"):
        iter_source = diarization.speaker_diarization
        print("Using speaker_diarization attribute.")
    elif hasattr(diarization, "itertracks"):
        iter_source = diarization
        print("Using itertracks directly.")
    elif hasattr(diarization, "annotation"):
        iter_source = diarization.annotation
        print("Using annotation attribute.")
    else:
        print("No known source found.")
        exit(1)

    speaker_segments = []
    for turn, _, speaker in iter_source.itertracks(yield_label=True):
        speaker_segments.append({
            "start": turn.start,
            "end": turn.end,
            "speaker": speaker
        })
    
    print(f"Found {len(speaker_segments)} diarization segments.")
    
    if all_words and speaker_segments:
        from asr_engine import align_words_to_speakers
        dialogue = align_words_to_speakers(all_words, speaker_segments)
        print(f"Diarization result turns: {len(dialogue)}")
        for turn in dialogue[:5]:
            print(f"[{turn['speaker']}] {turn['text']}")
    else:
        print("MISSING WORDS OR SPEAKER SEGMENTS - DIARIZATION IMPOSSIBLE")

except Exception as e:
    print(f"Processing failed: {e}")
    import traceback
    traceback.print_exc()
