import os
import logging
import io
import tempfile
import difflib
import numpy as np
from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)

SLIDING_WINDOW_SECONDS = 6.0
SAMPLE_RATE = 16000
TOKEN_CONFIRM_COUNT = 2


class TranscriptionSession:

    def __init__(self, session_id: str):
        from collections import deque
        self.session_id = session_id
        self.audio_buffer = deque(maxlen=int(SLIDING_WINDOW_SECONDS * SAMPLE_RATE))
        self.previous_text = ""
        self.confirmed_text = ""
        self.stability_count = 0

    def add_audio(self, audio_array: np.ndarray):
        for sample in audio_array:
            self.audio_buffer.append(sample)

    def get_buffer_array(self) -> np.ndarray:
        return np.array(list(self.audio_buffer), dtype=np.float32)

    def update_text(self, new_text: str) -> tuple:

        new_text = new_text.strip()
        if not new_text:
            return self.confirmed_text, ""

        def merge_overlap(base, addition):
            # Check for containment
            start_check = max(0, len(base) - len(addition) - 10)
            if addition in base[start_check:]: return base
            
            b_words = base.split()
            a_words = addition.split()
            # Check overlap of up to 10 words
            for i in range(min(len(b_words), len(a_words), 10), 0, -1):
                if b_words[-i:] == a_words[:i]:
                    return base + " " + " ".join(a_words[i:])
            return base + " " + addition

        # Logic to commit text when it stabilizes or leaves the window
        if new_text.startswith(self.previous_text) and len(self.previous_text) > 10:
            self.stability_count += 1
        else:
            # Window slid or changed
            if self.stability_count >= 1 or (self.previous_text and len(self.previous_text) > 15):
                # Previous text was stable, commit it with merge check
                self.confirmed_text = merge_overlap(self.confirmed_text, self.previous_text)
            
            self.stability_count = 0

        self.previous_text = new_text
        
        # UI Dedup: Remove fuzzy overlap using difflib
        # This handles small changes in Whisper's output (e.g. "Good morning" vs "Good morning.")
        def remove_fuzzy_overlap(base, addition):
             # minimal overlap length to consider worth merging
             if len(addition) < 5: return addition
             
             matcher = difflib.SequenceMatcher(None, base, addition)
             # Looking for overlap at the end of base and start of addition
             match = matcher.find_longest_match(max(0, len(base) - len(addition) - 20), len(base), 0, len(addition))
             
             # If significant match found at the boundary
             if match.size > 5:
                 # Check if match is at the end of base (within 5 chars tolerance)
                 if match.a + match.size >= len(base) - 5 and match.b <= 5:
                     return addition[match.b + match.size:].strip()
             return addition

        clean_partial = remove_fuzzy_overlap(self.confirmed_text, new_text)
        return self.confirmed_text, clean_partial


class DiarizationEngine:
    """Speaker diarization using pyannote.audio."""

    def __init__(self):
        self.pipeline = None
        self._loaded = False

    def load(self, hf_token: str = None):
        if self._loaded:
            return

        token = hf_token or os.environ.get("HF_TOKEN")
        if not token:
            logger.warning("No HF_TOKEN found — diarization will be unavailable")
            return

        try:
            import torch
            from pyannote.audio import Pipeline

            logger.info("Loading pyannote speaker-diarization pipeline (CPU)...")
            self.pipeline = Pipeline.from_pretrained(
                "pyannote/speaker-diarization-3.1",
                token=token,
            )
            self.pipeline.to(torch.device("cpu"))
            self._loaded = True
            logger.info("Diarization pipeline loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load diarization pipeline: {e}")
            self._loaded = False

    @property
    def available(self) -> bool:
        return self._loaded and self.pipeline is not None

    def diarize_audio(self, audio_array: np.ndarray, sample_rate: int = 16000) -> list:
        if not self.available:
            return []

        import torch

        waveform = torch.from_numpy(audio_array).unsqueeze(0).float()
        audio_input = {"waveform": waveform, "sample_rate": sample_rate}

        diarization = self.pipeline(audio_input)
        
        # Handle potential DiarizeOutput wrapper (pyannote 3.1+ edge cases)
        if hasattr(diarization, "itertracks"):
            iter_source = diarization
        elif hasattr(diarization, "annotation"):
            iter_source = diarization.annotation
        else:
            # Fallback for unexpected types
            return []

        segments = []
        for turn, _, speaker in iter_source.itertracks(yield_label=True):
            segments.append({
                "speaker": speaker,
                "start": turn.start,
                "end": turn.end,
            })

        return segments


def align_words_to_speakers(word_segments: list, speaker_segments: list) -> list:
    """
    Align word-level timestamps with speaker diarization segments.
    Returns a dialogue: [{speaker: "Doctor"/"Patient", text: "...", start: ..., end: ...}]
    """
    if not speaker_segments:
        return []

    speaker_order = []
    for seg in speaker_segments:
        if seg["speaker"] not in speaker_order:
            speaker_order.append(seg["speaker"])

    label_map = {}
    for i, raw_label in enumerate(speaker_order):
        label_map[raw_label] = "Doctor" if i == 0 else "Patient"

    def get_speaker_at(time_point: float) -> str:
        best_speaker = None
        best_overlap = -1
        for seg in speaker_segments:
            if seg["start"] <= time_point <= seg["end"]:
                overlap = seg["end"] - seg["start"]
                if overlap > best_overlap:
                    best_overlap = overlap
                    best_speaker = seg["speaker"]
        return label_map.get(best_speaker, "Unknown") if best_speaker else "Unknown"

    dialogue = []
    current_speaker = None
    current_words = []
    current_start = 0
    current_end = 0

    for word_info in word_segments:
        word_mid = (word_info["start"] + word_info["end"]) / 2
        speaker = get_speaker_at(word_mid)

        if speaker != current_speaker and current_words:
            dialogue.append({
                "speaker": current_speaker,
                "text": " ".join(current_words).strip(),
                "start": round(current_start, 2),
                "end": round(current_end, 2),
            })
            current_words = []

        if not current_words:
            current_start = word_info["start"]
            current_speaker = speaker

        current_words.append(word_info["word"].strip())
        current_end = word_info["end"]

    if current_words:
        dialogue.append({
            "speaker": current_speaker,
            "text": " ".join(current_words).strip(),
            "start": round(current_start, 2),
            "end": round(current_end, 2),
        })

    return dialogue


class ASREngine:
    def __init__(self, model_size="base.en", device="cpu", compute_type="int8"):
        logger.info(f"Loading WhisperModel: {model_size} on {device} with {compute_type}")
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self.model_size = model_size
        self.diarization = DiarizationEngine()
        self.warmup()

    def warmup(self):
        logger.info("Warming up model with silence...")
        silence = np.zeros(16000, dtype=np.float32)
        try:
            segments, _ = self.model.transcribe(silence, beam_size=1)
            list(segments)
            logger.info("Model warmup complete.")
        except Exception as e:
            logger.error(f"Warmup failed: {e}")

    def init_diarization(self, hf_token: str = None):
        self.diarization.load(hf_token)

    def transcribe_chunk(self, audio_data: bytes) -> dict:
        audio_file = io.BytesIO(audio_data)

        segments, info = self.model.transcribe(
            audio_file,
            language="en",
            vad_filter=False,
            word_timestamps=True,
            condition_on_previous_text=False,
        )

        text_parts = []
        total_confidence = 0
        word_count = 0

        for segment in segments:
            t = segment.text.strip()
            if t:
                text_parts.append(t)
                if segment.words:
                    for w in segment.words:
                        total_confidence += w.probability
                        word_count += 1

        avg_confidence = total_confidence / word_count if word_count > 0 else 0

        return {
            "text": " ".join(text_parts),
            "confidence": round(avg_confidence, 3),
            "is_final": False,
        }

    def transcribe_pcm(self, audio_array: np.ndarray) -> dict:
        if len(audio_array) < 1600:
            return {"text": "", "confidence": 0, "segments": []}

        segments, info = self.model.transcribe(
            audio_array,
            language="en",
            beam_size=1,
            vad_filter=False,
            word_timestamps=True,
            condition_on_previous_text=False,
        )

        text_parts = []
        total_confidence = 0
        word_count = 0
        seg_list = []

        for segment in segments:
            t = segment.text.strip()
            if t:
                text_parts.append(t)
                seg_confidence = 0
                if segment.words:
                    word_probs = [w.probability for w in segment.words]
                    seg_confidence = sum(word_probs) / len(word_probs) if word_probs else 0
                    word_count += len(segment.words)
                    total_confidence += seg_confidence * len(segment.words)

                seg_list.append({
                    "text": t,
                    "start": segment.start,
                    "end": segment.end,
                    "confidence": round(seg_confidence, 3),
                })

        avg_confidence = total_confidence / word_count if word_count > 0 else 0

        return {
            "text": " ".join(text_parts),
            "confidence": round(avg_confidence, 3),
            "segments": seg_list,
        }

    def transcribe_full(self, audio_data: bytes) -> dict:
        audio_file = io.BytesIO(audio_data)

        segments, info = self.model.transcribe(
            audio_file,
            language="en",
            beam_size=5,
            best_of=5,
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=300,
                speech_pad_ms=100,
            ),
            word_timestamps=True,
        )

        text_parts = []
        total_confidence = 0
        word_count = 0
        seg_list = []

        for segment in segments:
            t = segment.text.strip()
            if t:
                text_parts.append(t)
                seg_confidence = 0
                if segment.words:
                    word_probs = [w.probability for w in segment.words]
                    seg_confidence = sum(word_probs) / len(word_probs) if word_probs else 0
                    word_count += len(segment.words)
                    total_confidence += seg_confidence * len(segment.words)

                seg_list.append({
                    "text": t,
                    "start": segment.start,
                    "end": segment.end,
                    "confidence": round(seg_confidence, 3),
                    "words": [{
                        "word": w.word,
                        "start": w.start,
                        "end": w.end,
                        "probability": round(w.probability, 3),
                    } for w in segment.words] if segment.words else [],
                })

        avg_confidence = total_confidence / word_count if word_count > 0 else 0

        return {
            "text": " ".join(text_parts),
            "confidence": round(avg_confidence, 3),
            "is_final": True,
            "segments": seg_list,
        }

    def transcribe_full_diarized(self, audio_data: bytes) -> dict:
        """
        Full transcription with speaker diarization.
        Lazily loads the diarization pipeline on first call.
        """
        result = self.transcribe_full(audio_data)

        if not self.diarization.available:
            self.init_diarization()

        if not self.diarization.available:
            logger.warning("Diarization not available, returning plain transcript")
            return result

        try:
            import av

            audio_stream = io.BytesIO(audio_data)
            container = av.open(audio_stream)
            pcm_samples = []
            input_rate = None

            for stream in container.streams.audio:
                input_rate = stream.rate

            for frame in container.decode(audio=0):
                arr = frame.to_ndarray().flatten()
                if frame.format.name != 'flt':
                    arr = arr.astype(np.float32) / 32768.0
                pcm_samples.append(arr)

            container.close()

            if not pcm_samples:
                return result

            full_audio = np.concatenate(pcm_samples)

            if input_rate and input_rate != SAMPLE_RATE:
                from scipy.signal import resample
                num_samples = int(len(full_audio) * SAMPLE_RATE / input_rate)
                full_audio = resample(full_audio, num_samples).astype(np.float32)

        except Exception as e:
            logger.error(f"Audio decode for diarization failed: {e}")
            return result

        logger.info(f"Running speaker diarization on {len(full_audio)/SAMPLE_RATE:.1f}s of audio...")
        speaker_segments = self.diarization.diarize_audio(full_audio, SAMPLE_RATE)
        logger.info(f"Diarization found {len(speaker_segments)} speaker segments")

        if not speaker_segments:
            return result

        all_words = []
        for seg in result.get("segments", []):
            for w in seg.get("words", []):
                all_words.append(w)

        if not all_words:
            return result

        dialogue = align_words_to_speakers(all_words, speaker_segments)

        result["dialogue"] = dialogue
        result["speaker_segments"] = speaker_segments

        return result
