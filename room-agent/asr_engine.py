import os
import logging
import time
import numpy as np
import torch
import whisperx
from pyannote.audio import Inference
from sklearn.cluster import AgglomerativeClustering
from sklearn.metrics import silhouette_score
import pandas as pd
from summarizer import Summarizer
from transcription_normalizer import (
    build_medical_asr_prompt,
    correct_medical_terms_in_dialogue,
)

logger = logging.getLogger(__name__)

def get_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"

DEVICE = get_device()
logger.info(f"Hardware acceleration: {DEVICE}")

SAMPLE_RATE = 16000


class HybridDiarizer:
    def __init__(self, hf_token: str):
        from pyannote.audio import Model
        model = Model.from_pretrained(
            "pyannote/wespeaker-voxceleb-resnet34-LM",
            use_auth_token=hf_token
        )
        self.embedding_model = Inference(model, window="whole")
        self.device = DEVICE
        self.embedding_model.to(torch.device(self.device))
        logger.info(f"HybridDiarizer ready on {self.device}")

    def _estimate_num_speakers(self, embeddings: np.ndarray, max_speakers: int = 4) -> int:
        """Estimate optimal speaker count via silhouette score. Avoids hardcoded 2-speaker assumption."""
        n = len(embeddings)
        if n < 4:
            return 2
        best_score = -1.0
        best_k = 2
        for k in range(2, min(max_speakers + 1, n)):
            labels = AgglomerativeClustering(
                n_clusters=k, metric="cosine", linkage="average"
            ).fit_predict(embeddings)
            if len(set(labels)) < 2:
                continue
            score = silhouette_score(embeddings, labels, metric="cosine")
            if score > best_score:
                best_score = score
                best_k = k
        return best_k

    def _resegment(self, whisperx_result: dict, gap_threshold: float = 0.25) -> list:
        """
        Re-split WhisperX segments at word-level gaps >= gap_threshold seconds.

        WhisperX segments are sentence-length (5-15s) and may span multiple speakers
        when there is little silence between turns. Splitting at word gaps gives
        sub-second granularity so that rapid speaker changes get separate embeddings
        instead of a blended one.
        """
        fine_segments = []
        for seg in whisperx_result.get("segments", []):
            words = [
                w for w in seg.get("words", [])
                if w.get("start") is not None and w.get("end") is not None
            ]

            if not words:
                # No word timestamps — keep the segment as-is
                fine_segments.append({
                    "start": seg["start"],
                    "end": seg["end"],
                    "text": seg.get("text", ""),
                })
                continue

            current_start = words[0]["start"]
            current_words = [words[0]]

            for word in words[1:]:
                gap = word["start"] - current_words[-1]["end"]
                if gap >= gap_threshold:
                    fine_segments.append({
                        "start": current_start,
                        "end": current_words[-1]["end"],
                        "text": " ".join(w.get("word", "") for w in current_words),
                    })
                    current_start = word["start"]
                    current_words = []
                current_words.append(word)

            if current_words:
                fine_segments.append({
                    "start": current_start,
                    "end": current_words[-1]["end"],
                    "text": " ".join(w.get("word", "") for w in current_words),
                })

        return fine_segments

    def diarize(
        self,
        audio_array: np.ndarray,
        whisperx_result: dict,
        sample_rate: int = 16000,
    ) -> list:
        segments = self._resegment(whisperx_result)
        waveform = torch.from_numpy(audio_array).unsqueeze(0).float()

        embeddings = []
        valid_segments = []

        for seg in segments:
            duration = seg["end"] - seg["start"]
            if duration < 0.2:
                continue

            start_sample = int(seg["start"] * sample_rate)
            end_sample = int(seg["end"] * sample_rate)
            segment_audio = waveform[:, start_sample:end_sample]

            audio_input = {
                "waveform": segment_audio,
                "sample_rate": sample_rate
            }

            try:
                embedding = self.embedding_model(audio_input)
                embeddings.append(embedding)
                valid_segments.append({
                    "start": seg["start"],
                    "end": seg["end"],
                    "text": seg.get("text", "")
                })
            except Exception as e:
                logger.warning(f"Embedding failed {seg['start']:.1f}-{seg['end']:.1f}s: {e}")
                continue

        if len(embeddings) < 2:
            logger.warning("Not enough segments for clustering — returning empty")
            return []

        embeddings_matrix = np.vstack(embeddings)
        norms = np.linalg.norm(embeddings_matrix, axis=1, keepdims=True)
        embeddings_matrix = embeddings_matrix / (norms + 1e-8)

        clustering = AgglomerativeClustering(
            n_clusters=2,
            metric="cosine",
            linkage="average"
        )
        labels = clustering.fit_predict(embeddings_matrix)

        return [
            {
                "start": seg["start"],
                "end": seg["end"],
                "speaker": f"SPEAKER_{label:02d}"
            }
            for seg, label in zip(valid_segments, labels)
        ]

class ASREngine:
    def __init__(self):
        self.wx_model = None
        self.wx_align_model = None
        self.wx_metadata = None
        self.hybrid_diarizer = None
        self.summarizer = None
        self.load_models()

    def load_models(self):
        logger.info(f"Loading models on device: {DEVICE}")

        self.wx_model = whisperx.load_model(
            os.environ.get("WHISPERX_MODEL", "small.en"),
            device="cpu",
            compute_type="int8",
            asr_options={
                "suppress_blank": True,
                "suppress_tokens": [-1],
                "initial_prompt": build_medical_asr_prompt(),
                "condition_on_previous_text": True,
                "temperatures": [0.0],
            }
        )

        self.wx_align_model, self.wx_metadata = whisperx.load_align_model(
            language_code="en",
            device=DEVICE
        )

        self.hybrid_diarizer = HybridDiarizer(hf_token=os.environ.get("HF_TOKEN"))
        self.summarizer = Summarizer()
        self.summarizer.warmup()

        logger.info(f"Models loaded: WhisperX {os.environ.get('WHISPERX_MODEL', 'small.en')} + Wav2Vec2 ({DEVICE}) + ResNet34 ({DEVICE}) + phi4-mini (Ollama)")
        logger.info(f"Alignment and voiceprinting on: {DEVICE} (Metal)")
        logger.info("ASR on: CPU (int8, vad_filter=False)")

    def transcribe_preview(self, audio_array: np.ndarray) -> str:
        if self.wx_model is None or len(audio_array) < 1600:
            return ""
        try:
            result = self._transcribe_with_faster_whisper(
                np.asarray(audio_array, dtype=np.float32),
                word_timestamps=False,
                beam_size=1,
                best_of=1,
            )
            return " ".join(seg.get("text", "").strip() for seg in result.get("segments", [])).strip()
        except Exception as e:
            logger.warning(f"Preview transcription error: {e}")
            return ""

    def _transcribe_with_faster_whisper(
        self,
        audio_array: np.ndarray,
        *,
        word_timestamps: bool,
        beam_size: int,
        best_of: int,
    ) -> dict:
        fw = getattr(self.wx_model, "model", None)
        if fw is None:
            raise RuntimeError("WhisperX model wrapper has no underlying faster-whisper model")

        segments, info = fw.transcribe(
            audio_array,
            language="en",
            beam_size=beam_size,
            best_of=best_of,
            temperature=0.0,
            vad_filter=True,
            word_timestamps=word_timestamps,
            initial_prompt=build_medical_asr_prompt(),
            condition_on_previous_text=True,
        )

        whisperx_segments = []
        for seg in segments:
            if seg.start is None or seg.end is None:
                continue

            whisperx_seg = {
                "start": float(seg.start),
                "end": float(seg.end),
                "text": (seg.text or "").strip(),
            }

            if word_timestamps and getattr(seg, "words", None):
                words = []
                for w in seg.words:
                    if w.start is None or w.end is None:
                        continue
                    words.append(
                        {
                            "word": (w.word or "").strip(),
                            "start": float(w.start),
                            "end": float(w.end),
                            "score": float(w.probability) if w.probability is not None else None,
                        }
                    )
                if words:
                    whisperx_seg["words"] = words

            whisperx_segments.append(whisperx_seg)

        return {
            "segments": whisperx_segments,
            "language": getattr(info, "language", "en"),
        }

    def run_pipeline(
        self,
        audio: np.ndarray,
        doctor_name: str = "Doctor",
        patient_name: str = "Patient",
        should_summarize: bool = True,
        status_callback=None,
        medical_history: dict | None = None,
    ) -> dict:
        """
        Full processing pipeline.
        """
        try:
            if status_callback:
                status_callback("transcribing")
            logger.info("Step 1: Transcribing...")
            t0 = time.time()

            asr_audio = np.asarray(audio, dtype=np.float32)

            result = self._transcribe_with_faster_whisper(
                asr_audio,
                word_timestamps=True,
                beam_size=2,
                best_of=1,
            )

            if not result.get("segments"):
                raise ValueError("Transcription returned no segments — audio may be silent")

            logger.info(f"Step 1 done: {time.time()-t0:.1f}s  ({len(result['segments'])} segments)")

            if status_callback:
                status_callback("aligning")
            logger.info("Step 2: Aligning phonemes...")
            t0 = time.time()

            aligned = whisperx.align(
                result["segments"],
                self.wx_align_model,
                self.wx_metadata,
                asr_audio,
                device=DEVICE,
                return_char_alignments=False,
            )

            logger.info(f"Step 2 done: {time.time()-t0:.1f}s")

            if status_callback:
                status_callback("diarizing")
            logger.info("Step 3: Diarizing speakers...")
            t0 = time.time()

            raw_segments = self.hybrid_diarizer.diarize(
                audio_array=audio,
                whisperx_result=aligned,
                sample_rate=16000,
            )

            if not raw_segments:
                logger.warning("Diarization returned no segments — falling back to single speaker")
                raw_segments = [{"start": s["start"], "end": s["end"], "speaker": "SPEAKER_00"} for s in aligned["segments"]]

            diarize_df = pd.DataFrame(raw_segments)
            logger.info(f"Step 3 done: {time.time()-t0:.1f}s  ({len(raw_segments)} segments)")

            logger.info("Step 4: Assigning speakers...")
            t0 = time.time()

            final = whisperx.assign_word_speakers(diarize_df, aligned)

            label_map = self.build_label_map(final["segments"])

            role_to_name = {
                "Doctor": doctor_name,
                "Patient": patient_name,
                "Companion": "Companion"
            }
            name_map = {
                spk_id: role_to_name.get(role, role)
                for spk_id, role in label_map.items()
            }

            dialogue = self._build_dialogue_from_words(final, name_map)
            dialogue, transcription_corrections = correct_medical_terms_in_dialogue(dialogue, medical_history=medical_history)

            logger.info(f"Step 4+5 done: {time.time()-t0:.1f}s  ({len(dialogue)} turns)")

            summary = {"issuesIdentified": [], "actionsPlan": []}
            if should_summarize and self.summarizer:
                logger.info("Step 6: Summarizing visit...")
                t0 = time.time()
                summary = self.summarizer.summarize_dialogue(dialogue)
                logger.info(f"Step 6 done: {time.time()-t0:.1f}s")

            transcript = " ".join(
                turn.get("text", "").strip()
                for turn in dialogue
                if turn.get("text")
            ).strip()

            return {
                "status": "complete",
                "transcript": transcript,
                "dialogue": dialogue,
                "summary": summary,
                "raw_segments": final["segments"],
                "speaker_samples": self.extract_speaker_samples(final["segments"], label_map),
                "transcription_corrections": transcription_corrections,
            }

        except Exception as e:
            logger.error(f"Pipeline failed: {e}", exc_info=True)
            return {
                "status": "error",
                "error": str(e)
            }

    def _build_dialogue_from_words(self, final: dict, name_map: dict) -> list:
        """Build speaker-turn dialogue using word-level speaker assignments.

        whisperx.assign_word_speakers tags each individual word with a speaker
        label in final["word_segments"].  Using this instead of the coarser
        final["segments"] means a single Whisper segment that spans multiple
        speakers (e.g. "Do you have a fever? No, just headache.") is correctly
        split into separate turns.

        Falls back to segment-level if word_segments is unavailable.
        """
        words = final.get("word_segments") or []

        if words:
            dialogue: list = []
            cur_name: str | None = None
            cur_words: list[str] = []
            cur_start: float = 0.0
            cur_end: float = 0.0

            for w in words:
                spk_id = w.get("speaker") or ""
                name = name_map.get(spk_id) if spk_id else None

                # Carry forward previous speaker for untagged words
                # (can happen at segment edges when diarization has gaps)
                if not name:
                    name = cur_name or "Unknown"

                word_text = (w.get("word") or "").strip()
                if not word_text:
                    continue

                if name != cur_name:
                    if cur_words and cur_name is not None:
                        dialogue.append({
                            "speaker": cur_name,
                            "text": " ".join(cur_words).strip(),
                            "start": cur_start,
                            "end": cur_end,
                        })
                    cur_name = name
                    cur_words = [word_text]
                    cur_start = w.get("start") or 0.0
                    cur_end = w.get("end") or cur_start
                else:
                    cur_words.append(word_text)
                    if w.get("end"):
                        cur_end = w["end"]

            if cur_words and cur_name is not None:
                dialogue.append({
                    "speaker": cur_name,
                    "text": " ".join(cur_words).strip(),
                    "start": cur_start,
                    "end": cur_end,
                })

            return dialogue

        # ── Fallback: segment-level (less precise) ──────────────────────
        dialogue = []
        for seg in final.get("segments", []):
            name = name_map.get(seg.get("speaker", ""), "Unknown")
            text = seg.get("text", "").strip()
            if not text:
                continue
            if dialogue and dialogue[-1]["speaker"] == name:
                dialogue[-1]["text"] += " " + text
                dialogue[-1]["end"] = seg["end"]
            else:
                dialogue.append({
                    "speaker": name,
                    "text": text,
                    "start": seg["start"],
                    "end": seg["end"],
                })
        return dialogue

    def build_label_map(self, segments):
        speaker_order = []
        for seg in segments:
            speaker = seg.get("speaker")
            if speaker and speaker not in speaker_order:
                speaker_order.append(speaker)
            if len(speaker_order) >= 3:
                break

        return {
            spk: f"Speaker {i+1}"
            for i, spk in enumerate(speaker_order)
        }

    def extract_speaker_samples(self, segments, label_map: dict | None = None):
        """Return one sample per speaker (first segment with ≥4 words).

        Each sample now includes ``backend_role`` so the client can match
        speakerSamples back to the correct dialogue label without relying on
        positional ordering (which can differ from build_label_map's order).
        """
        samples = {}
        for seg in segments:
            speaker = seg.get("speaker")
            if speaker and speaker not in samples:
                text = seg.get("text", "").strip()
                if len(text.split()) >= 4:
                    samples[speaker] = {
                        "speaker_id": speaker,
                        "sample_text": text[:100],
                        "start": seg.get("start", 0),
                        "backend_role": (label_map or {}).get(speaker, "Unknown"),
                    }
            if len(samples) >= 3:
                break
        return list(samples.values())
