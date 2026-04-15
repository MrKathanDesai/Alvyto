import json
import logging
import os
import re
import uuid
from difflib import SequenceMatcher
from typing import Any, Dict, List
import httpx

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "phi4-mini")
MIN_WORDS_PER_TURN = 3
VALID_CATEGORIES = {
    "symptom", "duration", "timing",
    "action", "lifestyle", "warning", "negative", "medication",
}

DIAGNOSIS_HINT_PATTERNS = [
    r"\bdiagnos(?:is|ed)\b",
    r"\bimpression\b",
    r"\blooks like\b",
    r"\bconsistent with\b",
    r"\blikely\b",
    r"\bsuspect(?:ed)?\b",
    r"\bprobable\b",
    r"\bmost likely\b",
]

RISKY_DIAGNOSIS_WORDS = {
    "cause", "causes", "pain", "fever", "cough", "headache", "cold", "viral", "infection"
}

DIAGNOSTIC_TERMS = {
    "syndrome", "disease", "infection", "pharyngitis", "tonsillitis", "sinusitis", "otitis",
    "asthma", "bronchitis", "pneumonia", "hypertension", "diabetes", "migraine", "gastritis",
    "dermatitis", "arthritis", "sprain", "strain", "uti", "cystitis", "rhinitis", "anemia",
}

SYSTEM_PROMPT = """You are a clinical documentation assistant. Extract information from the conversation below and output a JSON object. Do not copy these instructions into your output.

ZERO-INFERENCE RULE: Use only words and phrases actually spoken in the conversation. Do not infer, assume, or add anything not explicitly stated.

JSON FIELDS:
- "clinicalSnapshot": array of objects, each with "label" (a short verbatim phrase from the conversation, 2-5 words) and "category" (one of: symptom, warning, lifestyle, timing, duration, negative, action, medication). Include 4 to 6 items. Do NOT put medications here — medications belong in prescriptions.
- "doctorActions": array of strings. Each string is a specific, concrete action the doctor stated, including exact medication names and dosages where mentioned (under 12 words). Include 3 to 5 items. Do NOT include prescriptions here — list non-medication actions only (e.g. referrals, follow-ups, tests ordered, lifestyle advice).
- "prescriptions": array of objects for every medication the doctor prescribed or changed this visit. Each object has "name" (medication name only, no verbs), "dosage" (e.g. "500mg", null if not stated), "frequency" (e.g. "twice daily", null if not stated).
- "prescriptionDraft": object summarising the prescription-ready plan from the conversation only:
  - "diagnoses": array of short diagnosis/problem strings explicitly stated.
  - "medications": array of objects with "name", "dosage", "frequency", "duration", "route", "instructions".
  - "investigations": array of objects with "name", "details", "timing" for labs, reports, scans, or referrals.
  - "advice": array of home-care or lifestyle advice.
  - "warnings": array of return precautions or warning advice.
  - "reportSummary": short string summarising relevant report/test findings explicitly spoken.
  - "followUp": object with "timeline" and "notes".
- "issuesParagraph": a string of 2-3 sentences describing what the patient said about their condition, using only spoken facts.
- "actionsParagraph": a string of 2-3 sentences describing what the doctor said they would do, using only spoken facts.

OUTPUT FORMAT: Raw JSON object only. No markdown. No code fences. No explanation. Start your response with { and end with }."""

EXPAND_PROMPT = """You are a clinical documentation assistant. Given the updated clinical snapshot chips, doctor action bullets, and the original transcript below, regenerate the two narrative paragraphs. Use only facts explicitly stated in the transcript.

JSON FIELDS:
- "issuesParagraph": 2-3 sentences on patient presentation.
- "actionsParagraph": 2-3 sentences on doctor plan.

OUTPUT FORMAT: Raw JSON object only. No markdown. No code fences. Start your response with { and end with }."""


class Summarizer:
    def __init__(self):
        self._client = httpx.Client(timeout=300)

    def warmup(self) -> None:
        """Run a minimal inference to pull phi4-mini into Ollama's memory before the first real visit."""
        logger.info(f"Warming up {OLLAMA_MODEL} via Ollama...")
        try:
            self._call_model(SYSTEM_PROMPT, "TRANSCRIPT:\nDoctor: Test.\n\nReturn JSON now:")
            logger.info(f"{OLLAMA_MODEL} warm-up complete.")
        except Exception as exc:
            logger.warning(f"Warm-up failed (Ollama may not be running yet): {exc}")

    def summarize_dialogue(self, dialogue: List[Dict[str, Any]], medical_history: Dict[str, Any] | None = None) -> Dict[str, Any]:

        empty = {
            "clinicalSnapshot": [],
            "doctorActions": [],
            "prescriptions": [],
            "prescriptionDraft": None,
            "issuesParagraph": "",
            "actionsParagraph": "",
        }

        if not dialogue:
            return empty

        meaningful_turns = [
            turn
            for turn in dialogue
            if len(str(turn.get("text", "")).split()) >= MIN_WORDS_PER_TURN
        ]

        if not meaningful_turns:
            return empty

        transcript = "\n".join(
            f"{str(turn.get('speaker', 'Unknown')).strip()}: {str(turn.get('text', '')).strip()}"
            for turn in meaningful_turns
            if str(turn.get("text", "")).strip()
        )

        if not transcript.strip():
            return empty

        history_context = ""
        if medical_history:
            existing_meds = medical_history.get("medications", [])
            existing_conditions = medical_history.get("conditions", [])
            existing_allergies = medical_history.get("allergies", [])
            if existing_meds or existing_conditions or existing_allergies:
                parts = []
                if existing_conditions:
                    cond_list = ", ".join(str(c) for c in existing_conditions if c)
                    parts.append(f"Known conditions: {cond_list}")
                if existing_allergies:
                    allergy_list = ", ".join(str(a) for a in existing_allergies if a)
                    parts.append(f"Known allergies: {allergy_list}")
                if existing_meds:
                    med_names = []
                    for m in existing_meds:
                        if isinstance(m, dict):
                            name = str(m.get("name", "")).strip()
                            dosage = str(m.get("dosage", "")).strip()
                            freq = str(m.get("frequency", "")).strip()
                            if name:
                                med_names.append(f"{name} {dosage} {freq}".strip())
                        elif isinstance(m, str) and m.strip():
                            med_names.append(m.strip())
                    if med_names:
                        parts.append(f"Current medications: {', '.join(med_names)}")
                history_context = "PATIENT HISTORY (from records, not from this conversation):\n" + "\n".join(parts) + "\n\n"

        user_message = f"{history_context}TRANSCRIPT:\n{transcript}\n\nReturn JSON now:"

        try:
            raw = self._call_model(SYSTEM_PROMPT, user_message)
            parsed = self._parse_main_response(raw)
            parsed = self._sanitize_diagnoses(parsed, transcript)
            validated = self._validate_against_transcript(parsed, transcript)
            return self._format_for_frontend(validated)
        except Exception as exc:
            logger.error("Summarization failed: %s", exc, exc_info=True)
            return empty

    def expand_from_bullets(
        self,
        clinical_snapshot: List[Dict[str, Any]],
        doctor_actions: List[Any],
        transcript: str,
    ) -> Dict[str, str]:
        empty = {"issuesParagraph": "", "actionsParagraph": ""}

        if not transcript or not transcript.strip():
            return empty

        normalized_snapshot: List[Dict[str, str]] = []
        for item in clinical_snapshot or []:
            if isinstance(item, dict):
                label = str(item.get("label", "")).strip()
                category = str(item.get("category", "symptom")).strip().lower()
                if label:
                    normalized_snapshot.append(
                        {
                            "label": label,
                            "category": category if category in VALID_CATEGORIES else "symptom",
                        }
                    )

        normalized_actions: List[str] = []
        for action in doctor_actions or []:
            if isinstance(action, dict):
                text = str(action.get("text", "")).strip()
            else:
                text = str(action).strip()
            if text:
                normalized_actions.append(text)

        prompt_payload = {
            "clinicalSnapshot": normalized_snapshot,
            "doctorActions": normalized_actions,
            "transcript": transcript,
        }

        user_message = f"INPUT:\n{json.dumps(prompt_payload, ensure_ascii=False)}\n\nReturn JSON now:"

        try:
            raw = self._call_model(EXPAND_PROMPT, user_message)
            expanded = self._parse_expand_response(raw)
            validated = self._validate_against_transcript(
                {
                    "clinicalSnapshot": normalized_snapshot,
                    "doctorActions": normalized_actions,
                    "issuesParagraph": expanded.get("issuesParagraph", ""),
                    "actionsParagraph": expanded.get("actionsParagraph", ""),
                },
                transcript,
            )
            return {
                "issuesParagraph": validated.get("issuesParagraph", ""),
                "actionsParagraph": validated.get("actionsParagraph", ""),
            }
        except Exception as exc:
            logger.error("Expand failed: %s", exc, exc_info=True)
            return empty

    def _call_model(self, system_prompt: str, user_message: str) -> str:
        try:
            response = self._client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_message},
                    ],
                    "options": {
                        "temperature": 0.1,
                        "top_p": 0.95,
                        "num_predict": 2048,
                        "repeat_penalty": 1.1,
                    },
                    "stream": False,
                },
            )
            response.raise_for_status()
            return str(response.json()["message"]["content"]).strip()
        except Exception as exc:
            logger.error("Model call failed: %s", exc, exc_info=True)
            raise

    def _fuzzy_supported(self, claim: str, transcript_text: str, threshold: float = 0.72) -> bool:
        claim_words = [w for w in re.findall(r"\b\w+\b", claim.lower()) if len(w) > 3]
        if not claim_words:
            return True

        transcript_lower = transcript_text.lower()
        transcript_words = re.findall(r"\b\w+\b", transcript_lower)

        matched = 0
        for word in claim_words:
            if word in transcript_lower:
                matched += 1
                continue

            if any(SequenceMatcher(None, word, tw).ratio() > threshold for tw in transcript_words):
                matched += 1

        return (matched / len(claim_words)) >= 0.6

    def _validate_against_transcript(self, parsed: dict, transcript: str) -> dict:
        for item in parsed.get("clinicalSnapshot", []):
            if isinstance(item, dict):
                item["isSupported"] = self._fuzzy_supported(item.get("label", ""), transcript)

        normalized_actions: List[Dict[str, Any]] = []
        for item in parsed.get("doctorActions", []):
            if isinstance(item, dict):
                action_item = item
            else:
                action_item = {"text": str(item).strip()}
            action_item["isSupported"] = self._fuzzy_supported(action_item.get("text", ""), transcript)
            normalized_actions.append(action_item)
        parsed["doctorActions"] = normalized_actions

        for rx in parsed.get("prescriptions", []):
            if isinstance(rx, dict):
                rx["isSupported"] = self._fuzzy_supported(rx.get("name", ""), transcript)

        return parsed

    def _parse_main_response(self, raw: str) -> Dict[str, Any]:
        empty = {
            "clinicalSnapshot": [],
            "doctorActions": [],
            "prescriptions": [],
            "prescriptionDraft": None,
            "issuesParagraph": "",
            "actionsParagraph": "",
        }

        cleaned = re.sub(r"^```(?:json)?", "", raw.strip(), flags=re.IGNORECASE | re.MULTILINE)
        cleaned = re.sub(r"```$", "", cleaned.strip(), flags=re.MULTILINE)
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            logger.warning("No JSON object found in model response")
            return empty

        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            logger.error("Failed to decode JSON response: %s", exc)
            return empty

        clinical_snapshot: List[Dict[str, str]] = []
        for item in parsed.get("clinicalSnapshot", []):
            if not isinstance(item, dict):
                continue
            label = str(item.get("label", "")).strip()
            category = str(item.get("category", "symptom")).strip().lower()
            if not label:
                continue
            if category not in VALID_CATEGORIES:
                category = "symptom"
            clinical_snapshot.append({"label": label, "category": category})

        doctor_actions = [
            str(item).strip()
            for item in parsed.get("doctorActions", [])
            if str(item).strip()
        ]

        prescriptions: List[Dict[str, Any]] = []
        for rx in parsed.get("prescriptions", []):
            if not isinstance(rx, dict):
                continue
            name = str(rx.get("name", "")).strip()
            if not name:
                continue
            prescriptions.append({
                "name": name,
                "dosage": str(rx.get("dosage") or "").strip() or None,
                "frequency": str(rx.get("frequency") or "").strip() or None,
            })

        prescription_draft = self._parse_prescription_draft(parsed.get("prescriptionDraft"))
        if prescription_draft and not prescriptions:
            for med in prescription_draft.get("medications", []):
                name = str(med.get("name", "")).strip()
                if not name:
                    continue
                prescriptions.append({
                    "name": name,
                    "dosage": str(med.get("dosage") or "").strip() or None,
                    "frequency": str(med.get("frequency") or "").strip() or None,
                })

        return {
            "clinicalSnapshot": clinical_snapshot,
            "doctorActions": doctor_actions,
            "prescriptions": prescriptions,
            "prescriptionDraft": prescription_draft,
            "issuesParagraph": str(parsed.get("issuesParagraph", "")).strip(),
            "actionsParagraph": str(parsed.get("actionsParagraph", "")).strip(),
        }

    def _parse_expand_response(self, raw: str) -> Dict[str, str]:
        cleaned = re.sub(r"^```(?:json)?", "", raw.strip(), flags=re.IGNORECASE | re.MULTILINE)
        cleaned = re.sub(r"```$", "", cleaned.strip(), flags=re.MULTILINE)
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            logger.warning("No JSON object found in model response")
            return {"issuesParagraph": "", "actionsParagraph": ""}

        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            logger.error("Failed to decode JSON response: %s", exc)
            return {"issuesParagraph": "", "actionsParagraph": ""}

        return {
            "issuesParagraph": str(parsed.get("issuesParagraph", "")).strip(),
            "actionsParagraph": str(parsed.get("actionsParagraph", "")).strip(),
        }
    def _format_for_frontend(self, summary: Dict[str, Any]) -> Dict[str, Any]:
        formatted_actions = []
        for action_block in summary.get("doctorActions", []):
            # Because we changed `doctorActions` to be a list of dicts during validation...
            if isinstance(action_block, dict):
                text = action_block.get("text", "")
                supported = action_block.get("isSupported", True)
            else:
                text = action_block
                supported = True

            if isinstance(text, str) and text.strip():
                formatted_actions.append({
                    "id": str(uuid.uuid4()),
                    "text": text.strip(),
                    "sourceFactIds": [],
                    "isEdited": False,
                    "isSupported": supported
                })

        return {
            "clinicalSnapshot": summary.get("clinicalSnapshot", []),
            "doctorActions": formatted_actions,
            "prescriptions": summary.get("prescriptions", []),
            "prescriptionDraft": summary.get("prescriptionDraft"),
            "issuesParagraph": str(summary.get("issuesParagraph", "")).strip(),
            "actionsParagraph": str(summary.get("actionsParagraph", "")).strip(),
        }

    def _parse_prescription_draft(self, raw: Any) -> Dict[str, Any] | None:
        if not isinstance(raw, dict):
            return None

        diagnoses = [
            str(item).strip()
            for item in raw.get("diagnoses", [])
            if str(item).strip()
        ]

        medications: List[Dict[str, Any]] = []
        for item in raw.get("medications", []):
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            medications.append({
                "name": name,
                "dosage": str(item.get("dosage") or "").strip() or None,
                "frequency": str(item.get("frequency") or "").strip() or None,
                "duration": str(item.get("duration") or "").strip() or None,
                "route": str(item.get("route") or "").strip() or None,
                "instructions": str(item.get("instructions") or "").strip() or None,
            })

        investigations: List[Dict[str, Any]] = []
        for item in raw.get("investigations", []):
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            investigations.append({
                "name": name,
                "details": str(item.get("details") or "").strip() or None,
                "timing": str(item.get("timing") or "").strip() or None,
            })

        advice = [
            str(item).strip()
            for item in raw.get("advice", [])
            if str(item).strip()
        ]
        warnings = [
            str(item).strip()
            for item in raw.get("warnings", [])
            if str(item).strip()
        ]

        follow_up = raw.get("followUp")
        normalized_follow_up = None
        if isinstance(follow_up, dict):
            timeline = str(follow_up.get("timeline") or "").strip() or None
            notes = str(follow_up.get("notes") or "").strip() or None
            if timeline or notes:
                normalized_follow_up = {"timeline": timeline, "notes": notes}

        report_summary = str(raw.get("reportSummary") or "").strip()

        if not (diagnoses or medications or investigations or advice or warnings or report_summary or normalized_follow_up):
            return None

        return {
            "diagnoses": diagnoses,
            "medications": medications,
            "investigations": investigations,
            "advice": advice,
            "warnings": warnings,
            "reportSummary": report_summary,
            "followUp": normalized_follow_up,
        }

    def _sanitize_diagnoses(self, parsed: Dict[str, Any], transcript: str) -> Dict[str, Any]:
        draft = parsed.get("prescriptionDraft")
        if not isinstance(draft, dict):
            return parsed

        raw_diagnoses = draft.get("diagnoses") or []
        if not isinstance(raw_diagnoses, list):
            draft["diagnoses"] = []
            parsed["prescriptionDraft"] = draft
            return parsed

        transcript_lower = transcript.lower()
        doctor_lines = [
            line.split(":", 1)[1].strip().lower()
            for line in transcript.splitlines()
            if line.lower().startswith("doctor:") and ":" in line
        ]
        has_diag_hint = any(re.search(pattern, transcript_lower) for pattern in DIAGNOSIS_HINT_PATTERNS)

        def looks_like_condition(text: str) -> bool:
            words = re.findall(r"\b\w+\b", text.lower())
            if not words:
                return False
            if any(word in DIAGNOSTIC_TERMS for word in words):
                return True
            if any(text.lower().endswith(suffix) for suffix in ("itis", "osis", "emia", "pathy", "oma")):
                return True
            return False

        cleaned: List[str] = []
        for item in raw_diagnoses:
            diagnosis = str(item).strip()
            if not diagnosis:
                continue

            low = diagnosis.lower()
            token_count = len(re.findall(r"\b\w+\b", low))
            if token_count <= 1 and low in RISKY_DIAGNOSIS_WORDS:
                continue

            # Must either be explicitly supported in transcript,
            # or transcript must include diagnostic language and fuzzy support.
            is_supported = self._fuzzy_supported(diagnosis, transcript)
            if not is_supported and not has_diag_hint:
                continue

            in_doctor_speech = any(self._fuzzy_supported(diagnosis, line) for line in doctor_lines)
            if not in_doctor_speech:
                continue

            # If doctor didn't use diagnostic framing, require condition-like terminology.
            if not has_diag_hint and not looks_like_condition(diagnosis):
                continue

            # Guardrail: drop symptom-like labels unless explicitly framed as diagnosis.
            if (" pain" in low or low.endswith("pain") or low in {"fever", "cough", "headache", "fatigue"}) and not has_diag_hint:
                continue

            if diagnosis not in cleaned:
                cleaned.append(diagnosis)

        draft["diagnoses"] = cleaned
        parsed["prescriptionDraft"] = draft
        return parsed
