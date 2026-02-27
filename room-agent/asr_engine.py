import os
import logging
import io
import time
import asyncio
from concurrent.futures import ThreadPoolExecutor
import tempfile
import difflib
import numpy as np
from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)

SLIDING_WINDOW_SECONDS = 6.0
SAMPLE_RATE = 16000
TOKEN_CONFIRM_COUNT = 2

class ASREngine:
    def __init__(self, model_size="base.en", device="cpu", compute_type="int8"):
        logger.info(f"Loading WhisperModel: {model_size} on {device} with {compute_type}")
        self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self.model_size = model_size
        self.wx_model = None
        self.wx_align_model = None
        self.wx_metadata = None
        self.wx_diarize_model = None
        self.warmup()

    def load_whisperx_models(self):
        import whisperx
        import os
        logger.info("Loading WhisperX models into cache...")
        self.wx_model = whisperx.load_model("base.en", device="cpu", compute_type="int8")
        self.wx_align_model, self.wx_metadata = whisperx.load_align_model(
            language_code="en", device="cpu"
        )
        self.wx_diarize_model = whisperx.diarize.DiarizationPipeline(
            token=os.environ.get("HF_TOKEN"),
            device="cpu"
        )
        logger.info("WhisperX models loaded and cached")

    def warmup(self):
        """Warm up the model with a second of silence."""
        logger.info("Warming up model with silence...")
        silence = np.zeros(16000, dtype=np.float32)
        try:
            # Call model.transcribe directly with numpy array for warmup
            segments, _ = self.model.transcribe(silence, beam_size=1)
            list(segments)
            logger.info("Model warmup complete.")
        except Exception as e:
            logger.error(f"Warmup failed: {e}")

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
            "segments": seg_list,
        }

    def transcribe_pcm_simple(self, audio_array: np.ndarray) -> str:
        """Fast transcription for live preview only — no word timestamps, no diarization."""
        if len(audio_array) < 1600:
            return ""
        try:
            segments, _ = self.model.transcribe(
                audio_array,
                language="en",
                beam_size=1,
                vad_filter=True,
                word_timestamps=False,
                condition_on_previous_text=False,
            )
            return " ".join(seg.text.strip() for seg in segments if seg.text.strip())
        except Exception as e:
            logger.error(f"Live preview error: {e}")
            return ""

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
                logger.warning("No PCM samples decoded from audio data")
                return result

            full_audio = np.concatenate(pcm_samples)
            logger.info(f"Decoded {len(full_audio)} samples at {input_rate}Hz")

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
            logger.warning("No words found in transcription segments for diarization alignment")
            return result

        logger.info(f"Aligning {len(all_words)} words to {len(speaker_segments)} speaker segments")
        dialogue = align_words_to_speakers(all_words, speaker_segments)
        logger.info(f"Dialogue alignment complete: {len(dialogue)} turns")

        result["dialogue"] = dialogue
        result["speaker_segments"] = speaker_segments

        return result