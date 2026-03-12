import os
import logging
import io
import time
import numpy as np
import torch
import whisperx
from pyannote.audio import Inference
from sklearn.cluster import AgglomerativeClustering
import pandas as pd
from summarizer import Summarizer

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

    def diarize(
        self,
        audio_array: np.ndarray,
        whisperx_result: dict,
        sample_rate: int = 16000,
        num_speakers: int = 2
    ) -> list:
        segments = whisperx_result.get("segments", [])
        waveform = torch.from_numpy(audio_array).unsqueeze(0).float()

        embeddings = []
        valid_segments = []

        for seg in segments:
            duration = seg["end"] - seg["start"]
            if duration < 0.4:     
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
            n_clusters=num_speakers,
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
            "base.en",
            device="cpu",           
            compute_type="int8",    
            asr_options={
                "suppress_blank": True,
                "suppress_tokens": [-1],
            }
        )

        
        self.wx_align_model, self.wx_metadata = whisperx.load_align_model(
            language_code="en",
            device=DEVICE          
        )

       
        self.hybrid_diarizer = HybridDiarizer(hf_token=os.environ.get("HF_TOKEN"))
        self.summarizer = Summarizer()

        logger.info("Models loaded: WhisperX base.en + Wav2Vec2 + ResNet34")
        logger.info(f"Alignment and voiceprinting on: {DEVICE}")
        logger.info("ASR and VAD on: CPU (int8)")

    def transcribe_preview(self, audio_array: np.ndarray) -> str:
        """
        Live preview transcription — called during recording.
        Uses WhisperX's built-in VAD.
        """
        if len(audio_array) < 1600: 
            return ""

        try:
            result = self.wx_model.transcribe(
                audio_array,
                language="en",
                batch_size=4,         
                print_progress=False,
            )
            segments = result.get("segments", [])
            if not segments:
                return ""
            return " ".join(
                s["text"].strip()
                for s in segments
                if s["text"].strip()
            )
        except Exception as e:
            logger.warning(f"Preview transcription failed: {e}")
            return ""

    def run_pipeline(self, audio: np.ndarray, doctor_name: str = "Doctor", patient_name: str = "Patient", should_summarize: bool = True) -> dict:
        """
        Full processing pipeline.
        """
        try:
            logger.info("Step 1: Transcribing...")
            t0 = time.time()

            result = self.wx_model.transcribe(
                audio,
                language="en",
                batch_size=8,
                print_progress=False,
            )

            if not result.get("segments"):
                raise ValueError("Transcription returned no segments — audio may be silent")

            logger.info(f"Step 1 done: {time.time()-t0:.1f}s  ({len(result['segments'])} segments)")

            logger.info("Step 2: Aligning phonemes...")
            t0 = time.time()

            aligned = whisperx.align(
                result["segments"],
                self.wx_align_model,
                self.wx_metadata,
                audio,
                device=DEVICE,
                return_char_alignments=False,
            )

            logger.info(f"Step 2 done: {time.time()-t0:.1f}s")

            logger.info("Step 3: Diarizing speakers...")
            t0 = time.time()

            raw_segments = self.hybrid_diarizer.diarize(
                audio_array=audio,
                whisperx_result=aligned,
                sample_rate=16000,
                num_speakers=2
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

            dialogue = []
            for seg in final["segments"]:
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
                        "end": seg["end"]
                    })

            logger.info(f"Step 4+5 done: {time.time()-t0:.1f}s  ({len(dialogue)} turns)")

            summary = {"issuesIdentified": [], "actionsPlan": []}
            if should_summarize and self.summarizer:
                logger.info("Step 6: Summarizing visit...")
                t0 = time.time()
                summary = self.summarizer.summarize_dialogue(dialogue)
                logger.info(f"Step 6 done: {time.time()-t0:.1f}s")

            return {
                "status": "complete",
                "dialogue": dialogue,
                "summary": summary,
                "raw_segments": final["segments"],
                "speaker_samples": self.extract_speaker_samples(final["segments"])
            }

        except Exception as e:
            logger.error(f"Pipeline failed: {e}", exc_info=True)
            return {
                "status": "error",
                "error": str(e)
            }

    def build_label_map(self, segments):
        speaker_order = []
        for seg in segments:
            speaker = seg.get("speaker")
            if speaker and speaker not in speaker_order:
                speaker_order.append(speaker)
            if len(speaker_order) >= 3:
                break
        
        roles = ["Doctor", "Patient", "Companion"]
        return {
            spk: roles[i] if i < len(roles) else f"Speaker {i+1}"
            for i, spk in enumerate(speaker_order)
        }

    def extract_speaker_samples(self, segments):
        samples = {}
        for seg in segments:
            speaker = seg.get("speaker")
            if speaker and speaker not in samples:
                text = seg.get("text", "").strip()
                if len(text.split()) >= 4:
                    samples[speaker] = {
                        "speaker_id": speaker,
                        "sample_text": text[:100],
                        "start": seg.get("start", 0)
                    }
            if len(samples) >= 3:
                break
        return list(samples.values())