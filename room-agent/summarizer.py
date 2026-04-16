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

GENERIC_NOISE_TERMS = {
    "all right",
    "alright",
    "okay",
    "ok",
    "sure",
    "thanks",
    "thank you",
    "symptom",
    "issue",
    "have",
    "had",
    "just",
    "problem",
}

NUMBER_WORDS = {
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
    "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "hundred", "thousand", "half",
}

SYSTEM_PROMPT = """You are a clinical documentation assistant. Extract information from the conversation below and output a JSON object. Do not copy these instructions into your output.

ZERO-INFERENCE RULE: Use only words and phrases actually spoken in the conversation. Do not infer, assume, or add anything not explicitly stated.

JSON FIELDS:
- "clinicalSnapshot": array of objects, each with "label" (a short verbatim phrase from the conversation, 2-5 words) and "category" (one of: symptom, warning, lifestyle, timing, duration, negative, action, medication). Include 4 to 6 items. Do NOT put medications here — medications belong in prescriptions.
- "doctorActions": array of strings. Each string is a specific, concrete action the doctor stated, including exact medication names and dosages where mentioned (under 12 words). Include 3 to 5 items. Do NOT include prescriptions here — list non-medication actions only (e.g. referrals, follow-ups, tests ordered, lifestyle advice).
- "prescriptions": array of objects for every medication the doctor prescribed or changed this visit. Each object has "name" (medication name only, no verbs), "dosage" (e.g. "500mg", null if not stated), "frequency" (e.g. "twice daily", null if not stated).
- "prescriptionDraft": object summarising the prescription-ready plan from the conversation only:
  - "diagnoses": array of short diagnosis/problem strings explicitly stated.
  - "investigations": array of objects with "name", "details", "timing" for labs, reports, scans, or referrals.
  - "advice": array of home-care or lifestyle advice strings.
  - "warnings": array of return precautions or warning signs strings.
  - "reportSummary": short string summarising relevant report/test findings explicitly spoken.
  - "followUp": object with "timeline" (e.g. "2 weeks") and "notes".
  - "medications": array of objects with "name", "dosage", "frequency", "duration", "route", "instructions". List every drug prescribed this visit.
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
            parsed = self._parse_main_response(raw, transcript)
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
                        "num_predict": 4096,
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
        claim_words = [w for w in re.findall(r"\b\w+\b", claim.lower()) if len(w) >= 3]
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

    def _normalize_medication_name(self, value: str) -> str:
        name = re.sub(r"\s+", " ", (value or "").strip())
        if not name:
            return ""
        words = name.split()
        while words and words[-1].lower() in NUMBER_WORDS:
            words.pop()
        return " ".join(words) if words else name

    def _extract_doctor_actions_from_transcript(self, transcript: str) -> List[str]:
        doctor_lines = [
            line.split(":", 1)[1].strip()
            for line in transcript.splitlines()
            if re.match(r"(?i)^doctor\s*:", line.strip()) and ":" in line
        ]
        actions: List[str] = []
        seen = set()
        for line in doctor_lines:
            for sentence in re.split(r"[.!?]", line):
                text = re.sub(r"\s+", " ", sentence).strip()
                if len(text) < 12:
                    continue
                if text.lower() in GENERIC_NOISE_TERMS:
                    continue
                if not self._ACTION_PATTERN.search(text):
                    continue
                key = text.lower()
                if key in seen:
                    continue
                seen.add(key)
                actions.append(text)
        return actions[:8]

    def _extract_diagnoses_from_transcript(self, transcript: str) -> List[str]:
        doctor_lines = [
            line.split(":", 1)[1].strip()
            for line in transcript.splitlines()
            if re.match(r"(?i)^doctor\s*:", line.strip()) and ":" in line
        ]
        patterns = [
            re.compile(r"\bconsistent with\s+([a-zA-Z][a-zA-Z\s\-/]{2,80})", re.IGNORECASE),
            re.compile(r"\blooks like\s+([a-zA-Z][a-zA-Z\s\-/]{2,80})", re.IGNORECASE),
            re.compile(r"\blikely\s+([a-zA-Z][a-zA-Z\s\-/]{2,80})", re.IGNORECASE),
            re.compile(r"\bdiagnos(?:is|ed)\s*(?:as|:)?\s*([a-zA-Z][a-zA-Z\s\-/]{2,80})", re.IGNORECASE),
        ]
        out: List[str] = []
        seen = set()
        for line in doctor_lines:
            for pattern in patterns:
                for match in pattern.finditer(line):
                    raw = re.sub(r"\s+", " ", (match.group(1) or "")).strip(" .,-")
                    if not raw:
                        continue
                    # split on conjunctions to avoid long run-ons
                    for part in re.split(r"\band\b|,", raw):
                        diagnosis = re.sub(r"\s+", " ", part).strip(" .,-")
                        if len(diagnosis) < 4:
                            continue
                        key = diagnosis.lower()
                        if key in seen:
                            continue
                        seen.add(key)
                        out.append(diagnosis)
        return out[:5]

    def _coerce_paragraph_text(self, value: Any) -> str:
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, dict):
            text = value.get("text")
            return str(text).strip() if text is not None else ""
        if isinstance(value, list):
            parts = [self._coerce_paragraph_text(item) for item in value]
            return " ".join(part for part in parts if part).strip()
        return str(value).strip() if value is not None else ""

    def _is_generic_snapshot_label(self, label: str) -> bool:
        value = re.sub(r"\s+", " ", (label or "").strip().lower())
        if not value:
            return True
        generic = {
            "symptom",
            "issue",
            "complaint",
            "condition",
            "finding",
            "have",
            "had",
            "just",
            "problem",
            "location of pain",
            "associated symptom with food/drink",
            "lifestyle factor related to symptoms",
            "symptom relief attempts",
        }
        return value in generic

    def _fallback_snapshot_from_transcript(self, transcript: str) -> List[Dict[str, str]]:
        patient_lines = [
            line.split(":", 1)[1].strip()
            for line in transcript.splitlines()
            if re.match(r"(?i)^patient\s*:", line.strip()) and ":" in line
        ]
        fallback: List[Dict[str, str]] = []
        seen = set()

        symptom_pattern = re.compile(
            r"\b(headache|fever|cough|pain|burning|nausea|vomiting|dizziness|tightness|reflux|acidity|breathlessness|itching|swelling)\b",
            re.IGNORECASE,
        )
        duration_pattern = re.compile(
            r"\b(for|since)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|\w+)\s+(day|days|week|weeks|month|months)\b",
            re.IGNORECASE,
        )

        for line in patient_lines:
            symptom = symptom_pattern.search(line)
            if symptom:
                label = symptom.group(1).lower()
                key = (label, "symptom")
                if key not in seen:
                    seen.add(key)
                    fallback.append({"label": label, "category": "symptom"})

            duration = duration_pattern.search(line)
            if duration:
                label = f"{duration.group(2).lower()} {duration.group(3).lower()}"
                key = (label, "duration")
                if key not in seen:
                    seen.add(key)
                    fallback.append({"label": label, "category": "duration"})

            if re.search(r"\bno\b.*\bfever\b|\bdenies\b.*\bfever\b", line, re.IGNORECASE):
                key = ("no fever", "negative")
                if key not in seen:
                    seen.add(key)
                    fallback.append({"label": "no fever", "category": "negative"})

        return fallback[:6]

    def _infer_chief_complaint(self, transcript: str, parsed: Dict[str, Any]) -> str:
        explicit = str(parsed.get("chiefComplaint") or parsed.get("chief_complaint") or "").strip()
        if explicit and explicit.lower() not in GENERIC_NOISE_TERMS:
            return explicit[:160]

        snapshot = parsed.get("clinicalSnapshot") or []
        if isinstance(snapshot, list):
            for item in snapshot:
                if not isinstance(item, dict):
                    continue
                label = str(item.get("label") or "").strip()
                category = str(item.get("category") or "").strip().lower()
                if category == "symptom" and label and label.lower() not in GENERIC_NOISE_TERMS:
                    return label[:160]

        for line in transcript.splitlines():
            if not re.match(r"(?i)^patient\s*:", line.strip()):
                continue
            text = line.split(":", 1)[1].strip()
            for sentence in re.split(r"[.!?]", text):
                s = re.sub(r"\s+", " ", sentence).strip()
                if len(s) < 8:
                    continue
                if s.lower() in GENERIC_NOISE_TERMS:
                    continue
                if re.search(r"\b(pain|burning|cough|fever|breathless|breathlessness|nausea|vomiting|headache|dizziness|tightness|reflux|acidity|itching|swelling)\b", s, re.IGNORECASE):
                    return s[:160]
        return ""

    def _parse_main_response(self, raw: str, transcript: str = "") -> Dict[str, Any]:
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
            if self._is_generic_snapshot_label(label):
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

        # Backfill prescriptionDraft.medications when model only returns `prescriptions`.
        # This keeps medication extraction stable for downstream prescription workflows.
        if prescriptions:
            if not prescription_draft:
                prescription_draft = {
                    "diagnoses": [],
                    "medications": [],
                    "investigations": [],
                    "advice": [],
                    "warnings": [],
                    "reportSummary": "",
                    "followUp": None,
                }

            draft_medications = prescription_draft.get("medications") or []
            if not draft_medications:
                normalized_draft_meds: List[Dict[str, Any]] = []
                for rx in prescriptions:
                    if not isinstance(rx, dict):
                        continue
                    name = str(rx.get("name", "")).strip()
                    if not name:
                        continue
                    normalized_draft_meds.append(
                        {
                            "name": name,
                            "dosage": str(rx.get("dosage") or "").strip() or None,
                            "frequency": str(rx.get("frequency") or "").strip() or None,
                            "duration": None,
                            "route": None,
                            "instructions": None,
                        }
                    )
                if normalized_draft_meds:
                    prescription_draft["medications"] = normalized_draft_meds

        # --- Transcript-based regex merge ---
        # Always run the regex extractor and merge any medications that the LLM missed.
        # The LLM often returns partial lists (e.g. only the first 2 of 6 drugs) because
        # phi4-mini stops generating tokens early on long transcripts.
        # We deduplicate by lowercase name so LLM entries are never overwritten.
        raw_transcript = transcript
        if raw_transcript and len(clinical_snapshot) < 2:
            fallback_snapshot = self._fallback_snapshot_from_transcript(raw_transcript)
            if fallback_snapshot:
                existing = {(item["label"].lower(), item["category"]) for item in clinical_snapshot}
                for item in fallback_snapshot:
                    key = (item["label"].lower(), item["category"])
                    if key in existing:
                        continue
                    clinical_snapshot.append(item)
                    existing.add(key)

        chief_complaint = self._infer_chief_complaint(raw_transcript, parsed) if raw_transcript else ""
        if chief_complaint:
            has_symptom_chip = any((item.get("category") == "symptom") for item in clinical_snapshot if isinstance(item, dict))
            if not has_symptom_chip:
                clinical_snapshot.insert(0, {"label": chief_complaint, "category": "symptom"})
                clinical_snapshot = clinical_snapshot[:6]

        if raw_transcript:
            regex_meds = self._extract_medications_from_transcript(raw_transcript)
            if regex_meds:
                llm_names = {self._normalize_medication_name(rx["name"]).lower() for rx in prescriptions}
                new_rx: List[Dict[str, Any]] = []
                new_draft_meds: List[Dict[str, Any]] = []
                for m in regex_meds:
                    if self._normalize_medication_name(m["name"]).lower() not in llm_names:
                        new_rx.append({
                            "name": m["name"],
                            "dosage": m["dosage"],
                            "frequency": m["frequency"],
                        })
                        new_draft_meds.append(m)

                if new_rx:
                    prescriptions = prescriptions + new_rx
                    if not prescription_draft:
                        prescription_draft = {
                            "diagnoses": [],
                            "medications": [],
                            "investigations": [],
                            "advice": [],
                            "warnings": [],
                            "reportSummary": "",
                            "followUp": None,
                        }
                    draft_meds = prescription_draft.get("medications") or []
                    draft_names = {self._normalize_medication_name(m["name"]).lower() for m in draft_meds}
                    for m in new_draft_meds:
                        if self._normalize_medication_name(m["name"]).lower() not in draft_names:
                            draft_meds.append(m)
                    prescription_draft["medications"] = draft_meds
                    logger.info(
                        "Regex medication merge: added %d missing medication(s) to LLM output.",
                        len(new_rx),
                    )

        # Follow-up fallback: if the LLM produced no followUp timeline, try regex.
        if prescription_draft and raw_transcript:
            existing_followup = prescription_draft.get("followUp")
            if not (isinstance(existing_followup, dict) and existing_followup.get("timeline")):
                regex_followup = self._extract_followup_from_transcript(raw_transcript)
                if regex_followup:
                    prescription_draft["followUp"] = regex_followup
                    logger.info("Regex follow-up fallback: %s", regex_followup["timeline"])

        # Ensure doctor actions include key instructions when LLM under-returns.
        if raw_transcript:
            fallback_actions = self._extract_doctor_actions_from_transcript(raw_transcript)
            existing = {str(item).strip().lower() for item in doctor_actions if str(item).strip()}
            for action in fallback_actions:
                if action.lower() in existing:
                    continue
                doctor_actions.append(action)
                existing.add(action.lower())
            doctor_actions = doctor_actions[:8]

        # Ensure diagnoses are present when doctor used explicit diagnostic framing.
        if prescription_draft is not None and not (prescription_draft.get("diagnoses") or []):
            regex_diagnoses = self._extract_diagnoses_from_transcript(raw_transcript)
            if regex_diagnoses:
                prescription_draft["diagnoses"] = regex_diagnoses

        # Normalize medication names to reduce number-word suffix noise (e.g. "Pantoprazole forty").
        for rx in prescriptions:
            if isinstance(rx, dict) and rx.get("name"):
                rx["name"] = self._normalize_medication_name(str(rx.get("name")))
        if prescription_draft and isinstance(prescription_draft.get("medications"), list):
            for med in prescription_draft["medications"]:
                if isinstance(med, dict) and med.get("name"):
                    med["name"] = self._normalize_medication_name(str(med.get("name")))

        # Deduplicate final medication lists by normalized name.
        dedup_rx: List[Dict[str, Any]] = []
        seen_rx = set()
        for rx in prescriptions:
            if not isinstance(rx, dict):
                continue
            name = self._normalize_medication_name(str(rx.get("name") or ""))
            if not name:
                continue
            key = name.lower()
            if key in seen_rx:
                continue
            seen_rx.add(key)
            rx["name"] = name
            dedup_rx.append(rx)
        prescriptions = dedup_rx

        if prescription_draft and isinstance(prescription_draft.get("medications"), list):
            dedup_draft_meds: List[Dict[str, Any]] = []
            seen_dm = set()
            for med in prescription_draft["medications"]:
                if not isinstance(med, dict):
                    continue
                name = self._normalize_medication_name(str(med.get("name") or ""))
                if not name:
                    continue
                key = name.lower()
                if key in seen_dm:
                    continue
                seen_dm.add(key)
                med["name"] = name
                dedup_draft_meds.append(med)
            prescription_draft["medications"] = dedup_draft_meds

        return {
            "clinicalSnapshot": clinical_snapshot,
            "doctorActions": doctor_actions,
            "prescriptions": prescriptions,
            "prescriptionDraft": prescription_draft,
            "issuesParagraph": self._coerce_paragraph_text(parsed.get("issuesParagraph", "")),
            "actionsParagraph": self._coerce_paragraph_text(parsed.get("actionsParagraph", "")),
            "chiefComplaint": chief_complaint,
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
            "issuesParagraph": self._coerce_paragraph_text(parsed.get("issuesParagraph", "")),
            "actionsParagraph": self._coerce_paragraph_text(parsed.get("actionsParagraph", "")),
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
            "issuesParagraph": self._coerce_paragraph_text(summary.get("issuesParagraph", "")),
            "actionsParagraph": self._coerce_paragraph_text(summary.get("actionsParagraph", "")),
            "chiefComplaint": str(summary.get("chiefComplaint", "")).strip(),
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

    # Action verbs used in doctor lines (for extracting doctor actions).
    _ACTION_PATTERN = re.compile(
        r"\b(prescrib|start|continue|stop|avoid|order|follow\s*up|warning|go to emergency|advise|recommend|test|investigation|reduce|do not)\b",
        re.IGNORECASE,
    )

    # Prescription verbs pattern (shared between medication extraction and line pre-filter).
    _PRESCRIPTION_VERBS = (
        r"(?:prescrib(?:e|ed|ing)|"
        r"re-?start(?:ing)?|"
        r"\bstart(?:ing)?\b|"
        r"\btake\b|\btaking\b|"
        r"\buse\b|\busing\b|"
        r"\bkeep\b|"
        r"\bcontinue\b|"
        r"\bgive\b|\bgiving\b|"
        r"\badd(?:ing)?\b)"
    )
    _PRESCRIPTION_VERB_RE = re.compile(_PRESCRIPTION_VERBS, re.IGNORECASE)

    # Word-number tokens that appear in spoken dosages.
    # Handles plain ("forty milligram"), compound ("five hundred"), and hyphenated
    # ("seventy-five milligram") forms.
    _WORD_NUM = (
        r"(?:a half|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
        r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|"
        r"forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|\d+(?:\.\d+)?)"
        r"(?:[-\s]+(?:a half|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
        r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|"
        r"forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|\d+(?:\.\d+)?)){0,3}"
    )
    _DOSE_UNIT = r"(?:mg|milligram|milligrams|mcg|ml|milliliter|milliliters|g|gram|grams|IU|units?)"
    _FREQ = (
        r"(?:once|twice|thrice|one|two|three)"
        r"[\w\s]+?"
        r"(?:daily|weekly|hourly|a day|times?\s*a\s*day|at night|at bedtime|as needed|prn)"
    )

    # Patterns for spoken follow-up instructions.
    _FOLLOWUP_PATTERN = re.compile(
        r"(?:follow.?up|come back|return|review|see you|revisit)"
        r".{0,30}?"
        r"(\d+|one|two|three|four|five|six|seven|eight|ten|twelve|fourteen)\s*"
        r"(day|week|month|fortnight)s?",
        re.IGNORECASE,
    )

    # Compiled medication extraction pattern — built from the class-level string
    # constants so it is compiled once at class definition time.
    _MED_PATTERN = re.compile(
        r"(?:" + _PRESCRIPTION_VERBS + r"\s+)"
        r"([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)"         # capitalised drug name (1-2 words)
        r"(?:\s+(" + _WORD_NUM + r"\s*" + _DOSE_UNIT + r"))"  # dosage required
        r"(?:\s+(" + _FREQ + r"))?",                        # frequency optional
        re.IGNORECASE,
    )

    def _extract_followup_from_transcript(self, transcript: str) -> Dict[str, Any] | None:
        """
        Regex fallback: extract a follow-up timeline from the transcript.
        Returns {"timeline": "...", "notes": None} or None.
        """
        doctor_lines: List[str] = [
            line.split(":", 1)[1].strip()
            for line in transcript.splitlines()
            if re.match(r"(?i)^doctor\s*:", line.strip()) and ":" in line
        ]
        for line in doctor_lines:
            m = self._FOLLOWUP_PATTERN.search(line)
            if m:
                qty = m.group(1)
                unit = m.group(2).lower()
                timeline = f"{qty} {unit}{'s' if qty not in ('1', 'one') else ''}"
                # Capture the full surrounding context as notes (up to 80 chars).
                start = max(0, m.start() - 10)
                end = min(len(line), m.end() + 40)
                notes = line[start:end].strip()
                return {"timeline": timeline, "notes": notes}
        return None

    def _extract_medications_from_transcript(self, transcript: str) -> List[Dict[str, Any]]:
        """
        Regex-based fallback to pull explicit prescription statements from the transcript
        when the LLM fails to populate prescriptions / prescriptionDraft.medications.
        Matches doctor lines that contain a prescription verb followed by a capitalised
        drug name and an optional word-number or numeric dosage.
        """
        medications: List[Dict[str, Any]] = []
        seen_names: set = set()

        # Only scan doctor-spoken lines.
        doctor_lines: List[str] = []
        for line in transcript.splitlines():
            stripped = line.strip()
            if re.match(r"(?i)^doctor\s*:", stripped):
                doctor_lines.append(stripped.split(":", 1)[1].strip())

        # Non-drug words to skip if the regex captures them as a name.
        _SKIP = {
            "take", "keep", "also", "only", "then", "this", "that", "with", "from",
            "start", "once", "stop", "meal", "food", "diet", "dose", "before", "after",
            "liquid", "avoid",
        }
        # Number words that may bleed into the drug name due to IGNORECASE.
        _NUM_WORDS = {
            "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
            "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
            "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty",
            "seventy", "eighty", "ninety", "hundred", "thousand", "half",
        }

        for line in doctor_lines:
            if not self._PRESCRIPTION_VERB_RE.search(line):
                continue

            for m in self._MED_PATTERN.finditer(line):
                name = m.group(1).strip()
                # Strip trailing number words that bled in because of IGNORECASE,
                # and reattach them as a prefix to the dosage so nothing is lost.
                name_words = name.split()
                orphaned_num_words: list = []
                while name_words and name_words[-1].lower() in _NUM_WORDS:
                    orphaned_num_words.insert(0, name_words.pop())
                name = " ".join(name_words)

                raw_dosage = m.group(2).strip() if m.group(2) else None
                if orphaned_num_words and raw_dosage:
                    dosage = " ".join(orphaned_num_words) + " " + raw_dosage
                else:
                    dosage = raw_dosage
                frequency = m.group(3).strip() if m.group(3) else None

                if len(name) < 4 or name.lower() in _SKIP:
                    continue

                key = name.lower()
                if key in seen_names:
                    continue
                seen_names.add(key)

                medications.append({
                    "name": name,
                    "dosage": dosage,
                    "frequency": frequency,
                    "duration": None,
                    "route": None,
                    "instructions": None,
                })

        return medications

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
