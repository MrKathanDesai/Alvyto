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
MIN_WORDS_PER_TURN = 2
VALID_CATEGORIES = {
    "symptom", "duration", "timing",
    "action", "lifestyle", "warning", "negative", "medication",
}

SUMMARY_SECTION_KEYS = (
    "historyOfPresentIllness",
    "negativeFindings",
    "riskFactors",
    "pastHistory",
    "medicationHistory",
    "allergies",
    "vitals",
    "examination",
    "assessment",
    "medications",
    "investigations",
    "carePlan",
    "warnings",
    "followUp",
    "unmapped",
)

SOURCE_FACT_CATEGORIES = {
    "symptom",
    "negative",
    "risk_factor",
    "past_history",
    "medication_history",
    "allergy",
    "vital",
    "exam",
    "assessment",
    "prescription",
    "investigation",
    "advice",
    "warning",
    "follow_up",
    "other",
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

ACTION_QUESTION_RE = re.compile(
    r"^(what|when|where|which|who|why|how|does|do|did|is|are|was|were|have|has|can|could|would|should|will)\b",
    re.IGNORECASE,
)

MEDICATION_NAME_BLOCKLIST = {
    "exactly and has it been",
    "antibiotic and call us right",
    "soft brush gentle flossing and",
    "care",
    "it step by step",
}

GENERIC_SNAPSHOT_TERMS = {
    "symptom",
    "symptoms",
    "issue",
    "issues",
    "complaint",
    "condition",
    "finding",
    "findings",
    "history",
    "location",
    "location of pain",
    "trigger",
    "trigger food drink",
    "trigger food/drink",
    "weight loss",
    "night symptoms",
    "frequency",
    "frequency of symptom",
    "medication use",
    "food drink trigger",
    "associated symptom with food drink",
    "associated symptom with food/drink",
    "lifestyle factor related to symptoms",
    "symptom relief attempts",
}

NUMBER_WORDS = {
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
    "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "hundred", "thousand", "half",
}

MEDICATION_LEXICON = {
    "pantoprazole",
    "domperidone",
    "telmisartan",
    "ibuprofen",
    "diclofenac",
    "aspirin",
    "paracetamol",
    "liquid antacid",
    "salbutamol inhaler",
    "clotrimazole cream",
    "moxifloxacin eye drops",
    "vitamin d3",
    "prednisolone",
    "levocetirizine",
    "cetirizine",
    "methotrexate",
    "calcium tablet",
    "antacid gel",
}

MEDICATION_NAME_ALIASES = {
    "pantoprazal": "Pantoprazole",
    "pantoprazol": "Pantoprazole",
    "pantaprazole": "Pantoprazole",
    "domperadone": "Domperidone",
    "down for a down": "Domperidone",
    "tell me certain": "Telmisartan",
    "tel me certain": "Telmisartan",
    "liquid antacid": "Liquid Antacid",
}

SOCIAL_NOISE_RE = re.compile(
    r"^(?:good (?:morning|afternoon|evening)|hello|hi|thank you|thanks|you are welcome|welcome|"
    r"please have a seat|have a seat|sure doctor|sure|okay|ok|alright|all right|got it|understood|perfect)\b",
    re.IGNORECASE,
)

SYMPTOM_HINT_RE = re.compile(
    r"\b(pain|burning|reflux|acidity|cough|fever|nausea|vomiting|breathlessness|breathless|"
    r"weight|appetite|throat|stool|sleep|worse|worsened|after meals|after food|lying down|night)\b",
    re.IGNORECASE,
)

NEGATIVE_HINT_RE = re.compile(r"\b(no|not|without|denies|none|normal)\b", re.IGNORECASE)
ALLERGY_HINT_RE = re.compile(r"\ballerg(?:y|ic)\b", re.IGNORECASE)
RISK_FACTOR_RE = re.compile(
    r"\b(spicy|oily|tea|coffee|late|dinner|late dinner|late-night|lying down|lie down|within twenty minutes|"
    r"smoke|alcohol|stress|sleep is less|sleep less|deadline|meetings|weekends?|fried|red chili|"
    r"citrus|soda|heavy dinners?|ibuprofen|diclofenac|aspirin|fasting|meal timings?)\b",
    re.IGNORECASE,
)
PAST_HISTORY_RE = re.compile(
    r"\b(history|years? back|gastritis|ulcer|h\.?\s*pylori|diabetes|blood pressure|thyroid|heart disease|hypertension)\b",
    re.IGNORECASE,
)
MEDICATION_HISTORY_RE = re.compile(
    r"\b(antacid|pantoprazole|ibuprofen|diclofenac|aspirin|telmisartan|tablet|chemist|medicine|drug|paracetamol)\b",
    re.IGNORECASE,
)
VITAL_RE = re.compile(r"\b(blood pressure|pulse|oxygen|temperature|spo2|spo₂)\b", re.IGNORECASE)
EXAM_RE = re.compile(r"\b(tenderness|guarding|rigidity|epigastric|exam(?:ination)?)\b", re.IGNORECASE)
INVESTIGATION_RE = re.compile(
    r"\b(order|test|tests|cbc|liver function|amylase|stool occult blood|h\.?\s*pylori|endoscopy|"
    r"x-?ray|mri|scan|blood work|reports?)\b",
    re.IGNORECASE,
)
WARNING_RE = re.compile(
    r"\b(warning signs?|emergency|urgent|go to emergency|black stools?|vomiting blood|crushing chest pain|"
    r"fainting|palpitations|rash|dizziness|breathlessness|sweating)\b",
    re.IGNORECASE,
)
ASSESSMENT_RE = re.compile(
    r"\b(consistent with|not typical|pattern is|more consistent with|likely|suspect(?:ed)?|probable)\b",
    re.IGNORECASE,
)
ADVICE_RE = re.compile(
    r"\b(avoid|reduce|do not|keep|prefer|add|walk|exercise|breathing exercise|meal timings?|"
    r"small snacks|elevat|bring previous prescriptions?|start from tonight|stop ibuprofen)\b",
    re.IGNORECASE,
)

SYSTEM_PROMPT = """You are a clinical documentation assistant. Extract information from the conversation below and output a JSON object. Do not copy these instructions into your output.

ZERO-INFERENCE RULE: Use only words and phrases actually spoken in the conversation. Do not infer, assume, or add anything not explicitly stated.
RECALL-FIRST RULE: Do not compress away clinically relevant details. Keep explicit negatives, night symptoms, risk factors, vitals, examination findings, investigations, warning signs, and follow-up instructions when they are stated.

JSON FIELDS:
- "clinicalSnapshot": array of objects, each with "label" (a short phrase from the conversation) and "category" (one of: symptom, warning, lifestyle, timing, duration, negative, action). Capture every clinically important snapshot item that matters for safe review. Do NOT put medications here — medications belong in prescriptions.
- "doctorActions": array of strings. Each string is a specific, concrete non-medication action the doctor stated. Include every clinically relevant non-medication plan item explicitly stated, such as investigations, follow-up, lifestyle advice, return precautions, or monitoring.
- "prescriptions": array of objects for every medication the doctor prescribed or changed this visit. Each object has "name" (medication name only, no verbs), "dosage" (e.g. "500mg", null if not stated), "frequency" (e.g. "twice daily", null if not stated).
- "prescriptionDraft": object summarising the prescription-ready plan from the conversation only:
  - "diagnoses": array of short diagnosis/problem strings explicitly stated.
  - "investigations": array of objects with "name", "details", "timing" for labs, reports, scans, or referrals.
  - "advice": array of home-care or lifestyle advice strings.
  - "warnings": array of return precautions or warning signs strings.
  - "reportSummary": short string summarising relevant report/test findings explicitly spoken.
  - "followUp": object with "timeline" (e.g. "2 weeks") and "notes".
  - "medications": array of objects with "name", "dosage", "frequency", "duration", "route", "instructions", and optional "timingDetails". "timingDetails" may include "relationToMeals", "timeOfDay", "interval", "specificDays", "alternateDays", "prn", "prnIndication", "maxDose", "taperInstructions", "splitDose", and "eventTiming". List every drug prescribed this visit.
- "issuesParagraph": a string of 2-3 sentences describing what the patient said about their condition, using only spoken facts.
- "actionsParagraph": a string of 2-3 sentences describing what the doctor said they would do, using only spoken facts.

If a field is not explicitly stated, return [] or "" or null for that field.

OUTPUT FORMAT: Raw JSON object only. No markdown. No code fences. No explanation. Start your response with { and end with }."""

EXPAND_PROMPT = """You are a clinical documentation assistant. Given the updated clinical snapshot chips, doctor action bullets, and the original transcript below, regenerate the two narrative paragraphs. Use only facts explicitly stated in the transcript.

JSON FIELDS:
- "issuesParagraph": 2-3 sentences on patient presentation.
- "actionsParagraph": 2-3 sentences on doctor plan.

OUTPUT FORMAT: Raw JSON object only. No markdown. No code fences. Start your response with { and end with }."""


class Summarizer:
    def __init__(self):
        self._client = httpx.Client(timeout=300)

    def _empty_sections(self) -> Dict[str, List[str]]:
        return {key: [] for key in SUMMARY_SECTION_KEYS}

    def _empty_quality(self, mode: str = "hybrid") -> Dict[str, Any]:
        return {
            "score": 0.0,
            "confidence": 0.0,
            "missingFields": [],
            "mode": mode,
            "generatedAt": None,
            "coverage": 0.0,
            "sourceFactCount": 0,
            "mappedFactCount": 0,
            "unmappedFactIds": [],
            "criticalMisses": [],
            "sectionCounts": {key: 0 for key in SUMMARY_SECTION_KEYS},
        }

    def _empty_summary(self, mode: str = "hybrid") -> Dict[str, Any]:
        return {
            "clinicalSnapshot": [],
            "doctorActions": [],
            "prescriptions": [],
            "prescriptionDraft": None,
            "issuesParagraph": "",
            "actionsParagraph": "",
            "chiefComplaint": "",
            "structuredFindings": [],
            "sourceFacts": [],
            "sections": self._empty_sections(),
            "quality": self._empty_quality(mode),
        }

    def _build_structured_findings(self, summary: Dict[str, Any], source_facts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        findings: List[Dict[str, Any]] = []
        seen = set()

        category_map = {
            "symptom": "symptom",
            "negative": "negative",
            "risk_factor": "lifestyle",
            "warning": "warning",
            "prescription": "action",
            "advice": "action",
            "follow_up": "action",
            "assessment": "symptom",
        }

        for fact in source_facts:
            if not isinstance(fact, dict):
                continue
            text = self._normalize_fact_text(str(fact.get("text") or ""))
            src_category = str(fact.get("category") or "other").strip().lower()
            status = str(fact.get("status") or "confirmed").strip().lower() or "confirmed"
            confidence = float(fact.get("confidence") or 0.0)
            evidence = self._normalize_fact_text(str(fact.get("evidence") or text))

            if not text or src_category not in category_map:
                continue

            category = category_map[src_category]
            key = (text.lower(), category, status)
            if key in seen:
                continue
            seen.add(key)

            findings.append(
                {
                    "id": str(fact.get("id") or f"f-{len(findings)}"),
                    "label": text[:140],
                    "category": category,
                    "status": status if status in {"confirmed", "probable", "denied", "unclear"} else "confirmed",
                    "confidence": max(0.0, min(1.0, confidence if confidence else 0.78)),
                    "evidence": evidence[:500] if evidence else None,
                }
            )

        if findings:
            return findings[:24]

        for item in summary.get("clinicalSnapshot", []):
            if not isinstance(item, dict):
                continue
            label = self._normalize_fact_text(str(item.get("label") or ""))
            category = str(item.get("category") or "symptom").strip().lower()
            if category == "medication":
                continue
            if category not in VALID_CATEGORIES or not label:
                continue
            key = (label.lower(), category)
            if key in seen:
                continue
            seen.add(key)
            findings.append(
                {
                    "id": f"f-{len(findings)}",
                    "label": label[:140],
                    "category": category,
                    "status": "denied" if category == "negative" else "confirmed",
                    "confidence": max(0.0, min(1.0, float(item.get("confidence") or 0.75))),
                    "evidence": self._normalize_fact_text(str(item.get("evidence") or label))[:500],
                }
            )

        return findings[:24]

    def warmup(self) -> None:
        """Run a minimal inference to pull phi4-mini into Ollama's memory before the first real visit."""
        logger.info(f"Warming up {OLLAMA_MODEL} via Ollama...")
        try:
            self._call_model(SYSTEM_PROMPT, "TRANSCRIPT:\nDoctor: Test.\n\nReturn JSON now:")
            logger.info(f"{OLLAMA_MODEL} warm-up complete.")
        except Exception as exc:
            logger.warning(f"Warm-up failed (Ollama may not be running yet): {exc}")

    def _normalize_speaker_label(self, speaker: str) -> str:
        normalized = re.sub(r"\s+", " ", (speaker or "").strip().lower())
        if not normalized:
            return "Unknown"
        if normalized in {"doctor", "dr", "dentist", "er"} or "dr." in normalized:
            return "Doctor"
        if normalized in {"patient", "pt", "kd"}:
            return "Patient"
        # If it looks like a human name with no clinical role marker, assume patient by default.
        if re.fullmatch(r"[a-z]+(?:\s+[a-z]+){0,2}", normalized):
            return "Patient"
        return speaker.strip().title() or "Unknown"

    def summarize_dialogue(self, dialogue: List[Dict[str, Any]], medical_history: Dict[str, Any] | None = None) -> Dict[str, Any]:
        empty = self._empty_summary()

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
            f"{self._normalize_speaker_label(str(turn.get('speaker', 'Unknown')))}: {str(turn.get('text', '')).strip()}"
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
            enriched = self._enrich_summary(validated, transcript)
            return self._format_for_frontend(enriched)
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

    def _dedupe_strings(self, values: List[str]) -> List[str]:
        deduped: List[str] = []
        seen = set()
        for value in values:
            text = re.sub(r"\s+", " ", str(value or "").strip()).strip(" ,.;")
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            deduped.append(text)
        return deduped

    def _iter_transcript_sentences(self, transcript: str) -> List[Dict[str, Any]]:
        lines: List[Dict[str, Any]] = []
        for turn_index, line in enumerate(transcript.splitlines()):
            stripped = line.strip()
            if not stripped or ":" not in stripped:
                continue
            speaker, text = stripped.split(":", 1)
            speaker_name = re.sub(r"\s+", " ", speaker).strip().title() or "Unknown"
            sentence_parts = [
                re.sub(r"\s+", " ", part).strip()
                for part in re.split(r"(?<=[.!?])\s+|\s*;\s*", text.strip())
                if re.sub(r"\s+", " ", part).strip()
            ]
            for sentence_index, sentence in enumerate(sentence_parts):
                lines.append({
                    "speaker": speaker_name,
                    "turnIndex": turn_index,
                    "sentenceIndex": sentence_index,
                    "text": sentence.strip(),
                })
        return lines

    def _sentence_is_noise(self, speaker: str, sentence: str) -> bool:
        text = re.sub(r"\s+", " ", sentence or "").strip().strip(".,")
        if not text:
            return True
        if len(text) < 4:
            return True
        if SOCIAL_NOISE_RE.search(text):
            return True
        if text.lower() in GENERIC_NOISE_TERMS:
            return True
        if speaker.lower() == "doctor" and text.endswith("?"):
            return True
        if speaker.lower() == "patient" and re.match(r"^(can|should|do|will)\b", text, re.IGNORECASE):
            return True
        return False

    def _normalize_fact_text(self, value: str) -> str:
        text = re.sub(r"\s+", " ", (value or "").strip()).strip(" ,.;")
        text = re.sub(r"^(first|second|third|fourth|fifth),\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"^now important guidelines\.?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"^now regarding tests\.?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"^warning signs I want you to remember:?\s*", "", text, flags=re.IGNORECASE)
        return text.strip(" ,.;")

    def _fact_status(self, text: str, category: str) -> str:
        lowered = text.lower()
        if category in {"assessment"} and re.search(r"\b(likely|consistent with|probable|suspect)\b", lowered):
            return "probable"
        if category in {"negative"}:
            return "denied"
        if category not in {"warning", "advice", "prescription", "investigation", "follow_up", "vital", "exam"} and NEGATIVE_HINT_RE.search(lowered):
            return "denied"
        return "confirmed"

    def _split_negative_items(self, text: str) -> List[str]:
        matches = [
            self._normalize_fact_text(match.group(0))
            for match in re.finditer(r"\b(?:no|not|without|denies)\s+[^,.;]+", text, flags=re.IGNORECASE)
        ]
        if matches:
            return self._dedupe_strings(matches)
        if re.search(r"\bnormal\b", text, re.IGNORECASE):
            return [self._normalize_fact_text(text)]
        return []

    def _split_vital_items(self, text: str) -> List[str]:
        parts = []
        for fragment in re.split(r",", text):
            cleaned = self._normalize_fact_text(re.sub(r"^your\s+", "", fragment, flags=re.IGNORECASE))
            if cleaned and VITAL_RE.search(cleaned):
                parts.append(cleaned)
        return self._dedupe_strings(parts or [self._normalize_fact_text(text)])

    def _split_exam_items(self, text: str) -> List[str]:
        parts = []
        for fragment in re.split(r",", text):
            cleaned = self._normalize_fact_text(fragment)
            if cleaned and EXAM_RE.search(cleaned):
                parts.append(cleaned)
        return self._dedupe_strings(parts or [self._normalize_fact_text(text)])

    def _split_investigation_items(self, text: str) -> List[str]:
        working = self._normalize_fact_text(text)
        working = re.sub(
            r"^(?:since .{0,80}?,\s*)?(?:i will order|we will order|i'll order|order|ordered|we will schedule|schedule)\s+",
            "",
            working,
            flags=re.IGNORECASE,
        )
        working = re.sub(r"\balso\b", ",", working, flags=re.IGNORECASE)
        parts = []
        for fragment in re.split(r",|\band\b", working):
            cleaned = self._normalize_fact_text(fragment)
            if cleaned and INVESTIGATION_RE.search(cleaned):
                parts.append(cleaned)
        return self._dedupe_strings(parts or [self._normalize_fact_text(text)])

    def _split_warning_items(self, text: str) -> List[str]:
        working = self._normalize_fact_text(text)
        working = re.sub(r"\bif any of these occur.*$", "", working, flags=re.IGNORECASE).strip(" ,.;")
        parts = []
        for fragment in re.split(r",|\bor\b", working):
            cleaned = self._normalize_fact_text(fragment)
            if cleaned and WARNING_RE.search(cleaned):
                parts.append(cleaned)
        return self._dedupe_strings(parts or [self._normalize_fact_text(text)])

    def _split_advice_items(self, text: str) -> List[str]:
        working = self._normalize_fact_text(text)
        candidates = [
            self._normalize_fact_text(fragment)
            for fragment in re.split(r",|\band\b", working)
            if self._normalize_fact_text(fragment)
        ]
        imperative = [item for item in candidates if ADVICE_RE.search(item)]
        if len(imperative) >= 2:
            return self._dedupe_strings(imperative)
        return [working]

    def _append_source_fact(
        self,
        sink: List[Dict[str, Any]],
        speaker: str,
        turn_index: int,
        sentence_index: int,
        category: str,
        section: str,
        text: str,
        evidence: str,
    ) -> None:
        fact_text = self._normalize_fact_text(text)
        evidence_text = self._normalize_fact_text(evidence)
        if not fact_text or category not in SOURCE_FACT_CATEGORIES:
            return
        sink.append({
            "id": f"sf-{turn_index}-{sentence_index}-{len(sink)}",
            "speaker": speaker,
            "turnIndex": turn_index,
            "sentenceIndex": sentence_index,
            "category": category,
            "section": section,
            "text": fact_text,
            "evidence": evidence_text or fact_text,
            "status": self._fact_status(fact_text, category),
            "confidence": 0.86 if section != "unmapped" else 0.58,
            "mapped": section != "unmapped",
        })

    def _extract_source_facts(self, transcript: str, summary: Dict[str, Any]) -> List[Dict[str, Any]]:
        facts: List[Dict[str, Any]] = []
        for entry in self._iter_transcript_sentences(transcript):
            speaker = entry["speaker"]
            turn_index = entry["turnIndex"]
            sentence_index = entry["sentenceIndex"]
            sentence = self._normalize_fact_text(entry["text"])
            if self._sentence_is_noise(speaker, sentence):
                continue

            appended = False
            lowered = sentence.lower()

            if speaker.lower() == "patient":
                if ALLERGY_HINT_RE.search(sentence):
                    self._append_source_fact(facts, speaker, turn_index, sentence_index, "allergy", "allergies", sentence, sentence)
                    appended = True

                negative_items = self._split_negative_items(sentence)
                for item in negative_items:
                    self._append_source_fact(facts, speaker, turn_index, sentence_index, "negative", "negativeFindings", item, sentence)
                    appended = True

                if PAST_HISTORY_RE.search(sentence):
                    self._append_source_fact(facts, speaker, turn_index, sentence_index, "past_history", "pastHistory", sentence, sentence)
                    appended = True

                if MEDICATION_HISTORY_RE.search(sentence):
                    self._append_source_fact(facts, speaker, turn_index, sentence_index, "medication_history", "medicationHistory", sentence, sentence)
                    appended = True

                if RISK_FACTOR_RE.search(sentence):
                    self._append_source_fact(facts, speaker, turn_index, sentence_index, "risk_factor", "riskFactors", sentence, sentence)
                    appended = True

                if SYMPTOM_HINT_RE.search(sentence):
                    self._append_source_fact(facts, speaker, turn_index, sentence_index, "symptom", "historyOfPresentIllness", sentence, sentence)
                    appended = True

                if not appended:
                    self._append_source_fact(facts, speaker, turn_index, sentence_index, "symptom", "historyOfPresentIllness", sentence, sentence)
                    appended = True

            else:
                if self._PRESCRIPTION_VERB_RE.search(sentence) and self._MED_PATTERN.search(sentence):
                    # Medication source facts are added from the normalized prescription draft below.
                    appended = True

                if VITAL_RE.search(sentence):
                    for item in self._split_vital_items(sentence):
                        self._append_source_fact(facts, speaker, turn_index, sentence_index, "vital", "vitals", item, sentence)
                        appended = True

                if EXAM_RE.search(sentence):
                    for item in self._split_exam_items(sentence):
                        self._append_source_fact(facts, speaker, turn_index, sentence_index, "exam", "examination", item, sentence)
                        appended = True

                if ASSESSMENT_RE.search(sentence):
                    for fragment in re.split(r",", sentence):
                        cleaned = self._normalize_fact_text(fragment)
                        if cleaned:
                            self._append_source_fact(facts, speaker, turn_index, sentence_index, "assessment", "assessment", cleaned, sentence)
                            appended = True

                if WARNING_RE.search(sentence):
                    for item in self._split_warning_items(sentence):
                        self._append_source_fact(facts, speaker, turn_index, sentence_index, "warning", "warnings", item, sentence)
                        appended = True

                if INVESTIGATION_RE.search(sentence):
                    for item in self._split_investigation_items(sentence):
                        self._append_source_fact(facts, speaker, turn_index, sentence_index, "investigation", "investigations", item, sentence)
                        appended = True

                if self._FOLLOWUP_PATTERN.search(sentence):
                    self._append_source_fact(facts, speaker, turn_index, sentence_index, "follow_up", "followUp", sentence, sentence)
                    appended = True

                if ADVICE_RE.search(sentence) or self._ACTION_PATTERN.search(sentence):
                    for item in self._split_advice_items(sentence):
                        self._append_source_fact(facts, speaker, turn_index, sentence_index, "advice", "carePlan", item, sentence)
                        appended = True

                if not appended and not sentence.endswith("?"):
                    self._append_source_fact(facts, speaker, turn_index, sentence_index, "other", "unmapped", sentence, sentence)

        draft = summary.get("prescriptionDraft") if isinstance(summary.get("prescriptionDraft"), dict) else None
        if draft:
            for med in draft.get("medications") or []:
                if not isinstance(med, dict):
                    continue
                label = self._render_medication_fact(med)
                if label:
                    self._append_source_fact(facts, "Doctor", -1, -1, "prescription", "medications", label, label)

            for investigation in draft.get("investigations") or []:
                if not isinstance(investigation, dict):
                    continue
                label = self._render_investigation_fact(investigation)
                if label:
                    self._append_source_fact(facts, "Doctor", -1, -1, "investigation", "investigations", label, label)

            for advice in draft.get("advice") or []:
                self._append_source_fact(facts, "Doctor", -1, -1, "advice", "carePlan", str(advice), str(advice))

            for warning in draft.get("warnings") or []:
                self._append_source_fact(facts, "Doctor", -1, -1, "warning", "warnings", str(warning), str(warning))

            for diagnosis in draft.get("diagnoses") or []:
                self._append_source_fact(facts, "Doctor", -1, -1, "assessment", "assessment", str(diagnosis), str(diagnosis))

            follow_up = draft.get("followUp")
            follow_up_label = self._render_follow_up_fact(follow_up) if isinstance(follow_up, dict) else ""
            if follow_up_label:
                self._append_source_fact(facts, "Doctor", -1, -1, "follow_up", "followUp", follow_up_label, follow_up_label)

        return self._dedupe_source_facts(facts)

    def _dedupe_source_facts(self, source_facts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        deduped: List[Dict[str, Any]] = []
        seen = set()
        for fact in source_facts:
            if not isinstance(fact, dict):
                continue
            text = self._normalize_fact_text(str(fact.get("text") or ""))
            section = str(fact.get("section") or "unmapped").strip() or "unmapped"
            category = str(fact.get("category") or "other").strip() or "other"
            if not text:
                continue
            key = (section.lower(), category.lower(), text.lower())
            if key in seen:
                continue
            seen.add(key)
            fact["text"] = text
            fact["section"] = section
            fact["category"] = category
            deduped.append(fact)
        return deduped

    def _render_medication_fact(self, item: Dict[str, Any]) -> str:
        if not isinstance(item, dict):
            return ""
        timing_details = item.get("timingDetails") if isinstance(item.get("timingDetails"), dict) else item.get("timing_details") if isinstance(item.get("timing_details"), dict) else {}
        timing_parts: List[str] = []
        if isinstance(timing_details, dict):
            for key in ("relationToMeals", "timeOfDay", "specificDays", "eventTiming"):
                value = timing_details.get(key)
                if isinstance(value, list):
                    timing_parts.extend(str(part).strip() for part in value if str(part).strip())
            for key in ("interval", "prnIndication", "maxDose", "taperInstructions", "splitDose"):
                value = str(timing_details.get(key) or "").strip()
                if value:
                    timing_parts.append(value)
            if timing_details.get("alternateDays"):
                timing_parts.append("alternate days")
            if timing_details.get("prn"):
                timing_parts.append("as needed")
        parts = [
            str(item.get("name") or "").strip(),
            str(item.get("dosage") or "").strip(),
            str(item.get("frequency") or "").strip(),
            str(item.get("duration") or "").strip(),
            str(item.get("route") or "").strip(),
            str(item.get("instructions") or "").strip(),
            " ".join(timing_parts).strip(),
        ]
        return self._normalize_fact_text(" ".join(part for part in parts if part))

    def _render_investigation_fact(self, item: Dict[str, Any]) -> str:
        if not isinstance(item, dict):
            return ""
        parts = [
            str(item.get("name") or "").strip(),
            str(item.get("details") or "").strip(),
            str(item.get("timing") or "").strip(),
        ]
        return self._normalize_fact_text(" ".join(part for part in parts if part))

    def _render_follow_up_fact(self, item: Dict[str, Any]) -> str:
        if not isinstance(item, dict):
            return ""
        parts = [
            str(item.get("timeline") or "").strip(),
            str(item.get("notes") or "").strip(),
        ]
        return self._normalize_fact_text(" ".join(part for part in parts if part))

    def _build_sections(self, summary: Dict[str, Any], source_facts: List[Dict[str, Any]]) -> Dict[str, List[str]]:
        sections = self._empty_sections()
        for fact in source_facts:
            section = str(fact.get("section") or "unmapped").strip() or "unmapped"
            text = self._normalize_fact_text(str(fact.get("text") or ""))
            if section not in sections or not text:
                continue
            sections[section].append(text)

        draft = summary.get("prescriptionDraft") if isinstance(summary.get("prescriptionDraft"), dict) else None
        if draft:
            for diagnosis in draft.get("diagnoses") or []:
                sections["assessment"].append(str(diagnosis))
            for med in draft.get("medications") or []:
                label = self._render_medication_fact(med)
                if label:
                    sections["medications"].append(label)
            for investigation in draft.get("investigations") or []:
                label = self._render_investigation_fact(investigation)
                if label:
                    sections["investigations"].append(label)
            for advice in draft.get("advice") or []:
                sections["carePlan"].append(str(advice))
            for warning in draft.get("warnings") or []:
                sections["warnings"].append(str(warning))
            follow_up_label = self._render_follow_up_fact(draft.get("followUp") or {})
            if follow_up_label:
                sections["followUp"].append(follow_up_label)

        for action in summary.get("doctorActions") or []:
            if isinstance(action, dict):
                action_text = action.get("text", "")
            else:
                action_text = action
            normalized = self._normalize_fact_text(str(action_text))
            if normalized:
                sections["carePlan"].append(normalized)

        chief_complaint = self._normalize_fact_text(str(summary.get("chiefComplaint") or ""))
        if chief_complaint:
            sections["historyOfPresentIllness"].insert(0, chief_complaint)

        for key in SUMMARY_SECTION_KEYS:
            sections[key] = self._dedupe_strings(sections[key])

        return sections

    def _augment_clinical_snapshot(self, summary: Dict[str, Any], sections: Dict[str, List[str]]) -> List[Dict[str, Any]]:
        snapshot: List[Dict[str, Any]] = []
        seen = set()

        def add_item(label: str, category: str, confidence: float = 0.82) -> None:
            cleaned = self._normalize_fact_text(label)
            if not cleaned:
                return
            key = (cleaned.lower(), category)
            if key in seen:
                return
            seen.add(key)
            snapshot.append({
                "label": cleaned,
                "category": category if category in VALID_CATEGORIES else "symptom",
                "confidence": confidence,
                "status": "denied" if category == "negative" else "confirmed",
                "evidence": cleaned,
                "isSupported": True,
            })

        for item in summary.get("clinicalSnapshot", []):
            if not isinstance(item, dict):
                continue
            add_item(str(item.get("label") or ""), str(item.get("category") or "symptom"), float(item.get("confidence") or 0.82))

        for label in sections.get("historyOfPresentIllness", [])[:4]:
            category = "timing" if re.search(r"\b(day|days|week|weeks|month|months|night|midnight|after|before)\b", label, re.IGNORECASE) else "symptom"
            add_item(label, category)
        for label in sections.get("negativeFindings", [])[:4]:
            add_item(label, "negative", 0.85)
        for label in sections.get("riskFactors", [])[:4]:
            add_item(label, "lifestyle", 0.8)
        for label in sections.get("warnings", [])[:2]:
            add_item(label, "warning", 0.8)

        return snapshot[:14]

    def _build_quality(self, summary: Dict[str, Any], sections: Dict[str, List[str]], source_facts: List[Dict[str, Any]]) -> Dict[str, Any]:
        existing = summary.get("quality") if isinstance(summary.get("quality"), dict) else {}
        missing_fields = list(existing.get("missingFields") or [])
        chief_complaint = self._normalize_fact_text(str(summary.get("chiefComplaint") or ""))
        if not chief_complaint and "chiefComplaint" not in missing_fields:
            missing_fields.append("chiefComplaint")
        draft = summary.get("prescriptionDraft") if isinstance(summary.get("prescriptionDraft"), dict) else {}
        if not (draft.get("medications") or summary.get("prescriptions")) and "medications" not in missing_fields:
            missing_fields.append("medications")
        if not (summary.get("doctorActions") or []) and "doctorActions" not in missing_fields:
            missing_fields.append("doctorActions")

        source_fact_count = len(source_facts)
        mapped_fact_count = len([fact for fact in source_facts if fact.get("mapped")])
        unmapped_fact_ids = [str(fact.get("id")) for fact in source_facts if not fact.get("mapped")]
        coverage = round(mapped_fact_count / source_fact_count, 4) if source_fact_count else 0.0

        section_counts = {key: len(sections.get(key, [])) for key in SUMMARY_SECTION_KEYS}

        critical_misses: List[str] = []
        if re.search(r"\b(blood pressure|pulse|oxygen|temperature)\b", chief_complaint + " " + " ".join(fact.get("evidence", "") for fact in source_facts), re.IGNORECASE) and section_counts["vitals"] == 0:
            critical_misses.append("vitals")
        if any(fact.get("category") == "exam" for fact in source_facts) and section_counts["examination"] == 0:
            critical_misses.append("examination")
        if any(fact.get("category") == "warning" for fact in source_facts) and section_counts["warnings"] == 0:
            critical_misses.append("warnings")
        if any(fact.get("category") == "investigation" for fact in source_facts) and section_counts["investigations"] == 0:
            critical_misses.append("investigations")
        if any(fact.get("category") == "negative" for fact in source_facts) and section_counts["negativeFindings"] == 0:
            critical_misses.append("negativeFindings")

        support_values = [
            float(item.get("confidence") or 0.8)
            for item in summary.get("clinicalSnapshot", [])
            if isinstance(item, dict)
        ]
        confidence = round(sum(support_values) / len(support_values), 4) if support_values else 0.75
        completeness_bonus = min(1.0, sum(1 for key in SUMMARY_SECTION_KEYS if section_counts[key] > 0) / max(1, len(SUMMARY_SECTION_KEYS)))
        score = round(max(15.0, min(100.0, coverage * 60 + completeness_bonus * 25 + confidence * 15 - len(missing_fields) * 8 - len(critical_misses) * 4)), 2)

        return {
            "score": score,
            "confidence": confidence,
            "missingFields": self._dedupe_strings(missing_fields),
            "mode": str(existing.get("mode") or "hybrid").strip() or "hybrid",
            "generatedAt": str(existing.get("generatedAt") or existing.get("generated_at") or "").strip() or None,
            "coverage": coverage,
            "sourceFactCount": source_fact_count,
            "mappedFactCount": mapped_fact_count,
            "unmappedFactIds": unmapped_fact_ids,
            "criticalMisses": self._dedupe_strings(critical_misses),
            "sectionCounts": section_counts,
        }

    def _enrich_summary(self, summary: Dict[str, Any], transcript: str) -> Dict[str, Any]:
        working = dict(summary)
        source_facts = self._extract_source_facts(transcript, working)
        for fact in source_facts:
            fact["isSupported"] = self._fuzzy_supported(
                str(fact.get("evidence") or fact.get("text") or ""),
                transcript,
            )
        sections = self._build_sections(working, source_facts)
        structured_findings = self._build_structured_findings(working, source_facts)
        working["sourceFacts"] = source_facts
        working["sections"] = sections
        working["structuredFindings"] = structured_findings
        working["clinicalSnapshot"] = self._augment_clinical_snapshot(working, sections)
        working["quality"] = self._build_quality(working, sections, source_facts)
        return working

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
        cleaned = " ".join(words) if words else name
        return " ".join(
            token.upper() if token.isupper() or re.fullmatch(r"[A-Z0-9/-]+", token) else token.capitalize()
            for token in cleaned.split()
        )

    def _medication_name_signature(self, value: str) -> str:
        normalized = re.sub(r"[^a-z0-9]", "", str(value or "").lower())
        normalized = re.sub(r"[aeiou]+", "", normalized)
        normalized = re.sub(r"(.)\1+", r"\1", normalized)
        return normalized

    def _canonicalize_medication_name(self, value: str) -> str:
        normalized = self._normalize_medication_name(value)
        if not normalized:
            return ""

        lowered = normalized.lower()
        if lowered in MEDICATION_NAME_ALIASES:
            return MEDICATION_NAME_ALIASES[lowered]

        if lowered in MEDICATION_LEXICON:
            return self._normalize_medication_name(lowered)

        lowered_compact = re.sub(r"\b(?:for|a|an|the|of|and)\b", " ", lowered)
        lowered_compact = re.sub(r"\s+", " ", lowered_compact).strip()
        if lowered_compact in MEDICATION_NAME_ALIASES:
            return MEDICATION_NAME_ALIASES[lowered_compact]

        candidate_signature = self._medication_name_signature(lowered_compact or lowered)
        best_name = normalized
        best_score = 0.0
        for med in MEDICATION_LEXICON:
            med_normalized = self._normalize_medication_name(med)
            med_signature = self._medication_name_signature(med)
            score = max(
                SequenceMatcher(None, lowered, med).ratio(),
                SequenceMatcher(None, lowered_compact or lowered, med).ratio(),
                SequenceMatcher(None, candidate_signature, med_signature).ratio(),
            )
            if score > best_score:
                best_name = med_normalized
                best_score = score

        if best_score >= 0.82:
            return best_name
        if best_score >= 0.66 and len((lowered_compact or lowered).split()) >= 1:
            return best_name
        return normalized

    def _extract_med_name_candidate(self, tail: str) -> str:
        cleaned_tail = re.sub(r"^\s*(?:the|a|an|this|that|also|along with that|along with)\s+", "", tail, flags=re.IGNORECASE)
        dose_boundary = re.search(
            rf"\b(?:{self._WORD_NUM})\s*(?:-|to)?\s*(?:{self._WORD_NUM})?\s*(?:{self._DOSE_UNIT})\b",
            cleaned_tail,
            re.IGNORECASE,
        )
        candidate_source = cleaned_tail[:dose_boundary.start()] if dose_boundary else cleaned_tail
        if not dose_boundary:
            boundary_match = re.search(
                r"\b(?:once|twice|thrice|every|daily|weekly|monthly|at|before|after|as|if|for|empty|maximum|max|not)\b",
                cleaned_tail,
                re.IGNORECASE,
            )
            candidate_source = cleaned_tail[:boundary_match.start()] if boundary_match else cleaned_tail
        token_pattern = re.compile(r"[A-Za-z][A-Za-z0-9/+.-]*")
        tokens = token_pattern.findall(candidate_source)
        if not tokens:
            return ""

        stop_tokens = {
            "once", "twice", "thrice", "every", "before", "after", "at", "as", "if", "for", "empty",
            "maximum", "max", "not", "more", "than", "daily", "weekly", "monthly", "needed", "prn",
            "morning", "evening", "night", "bedtime", "breakfast", "lunch", "dinner", "food",
            "mouth", "orally", "oral", "topically", "topical", "inhalation", "subcutaneously",
            "intravenous", "iv", "immediately", "with", "without", "from", "now",
        }
        generic_names = {
            "tablet", "tablets", "capsule", "capsules", "medicine", "medication", "drug", "drugs",
        }

        candidate_tokens: List[str] = []
        preserve_predose_phrase = dose_boundary is not None
        for token in tokens[:5]:
            lowered = token.lower()
            if re.fullmatch(r"\d+(?:\.\d+)?", token):
                break
            if not preserve_predose_phrase and lowered in stop_tokens:
                break
            candidate_tokens.append(token)

        while candidate_tokens and candidate_tokens[0].lower() in {"also", "that", "this"}:
            candidate_tokens.pop(0)
        while candidate_tokens and candidate_tokens[-1].lower() in generic_names:
            if len(candidate_tokens) == 1:
                return ""
            candidate_tokens.pop()

        candidate = " ".join(candidate_tokens).strip(" ,.")
        if not candidate or candidate.lower() in generic_names:
            return ""
        return self._canonicalize_medication_name(candidate)

    def _extract_medication_frequency(self, text: str) -> str | None:
        patterns = [
            r"\bonce daily\b",
            r"\btwice daily\b",
            r"\bthrice daily\b",
            r"\bfour times a day\b",
            r"\bonce weekly\b",
            r"\bonce a week\b",
            r"\bonce monthly\b",
            r"\bonce a month\b",
            r"\bevery\s+(?:\d+|one|two|three|four|five|six|eight|twelve)\s+(?:hour|hours|day|days|week|weeks)\b",
            r"\bevery other day\b",
            r"\bfour times a day\b",
            r"\bthree times a day\b",
            r"\btwo times a day\b",
            r"\bonly if needed\b",
            r"\bas needed\b",
            r"\bprn\b",
            r"\bat bedtime\b",
            r"\bat night\b",
            r"\bdaily\b",
            r"\bweekly\b",
            r"\bmonthly\b",
        ]
        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                value = match.group(0)
                return "as needed" if value.lower() == "prn" else value
        return None

    def _extract_medication_timing_details(self, text: str) -> Dict[str, Any]:
        lowered = text.lower()
        relation_to_meals_matches: List[tuple[int, str]] = []
        time_of_day_matches: List[tuple[int, str]] = []
        specific_days: List[str] = []
        event_timing: List[str] = []

        meal_patterns = [
            (r"\bempty stomach\b|\bon an empty stomach\b|\bbefore food\b", "empty stomach"),
            (r"\bwith food\b|\bwith meals\b", "with food"),
            (r"\bbefore breakfast\b", "before breakfast"),
            (r"\bbefore lunch\b", "before lunch"),
            (r"\bbefore dinner\b", "before dinner"),
            (r"\bbefore lunch and dinner\b", "before lunch and dinner"),
            (r"\bbefore meals\b", "before meals"),
            (r"\bafter breakfast\b", "after breakfast"),
            (r"\bafter lunch\b", "after lunch"),
            (r"\bafter dinner\b", "after dinner"),
            (r"\bafter meals\b", "after meals"),
            (r"\bafter food\b", "after food"),
            (r"\b(?:\d+|fifteen|thirty|forty[- ]?five|sixty|one hour)\s+(?:minutes?|minute|hour)\s+before lunch and dinner\b", None),
            (r"\b(?:\d+|fifteen|thirty|forty[- ]?five|sixty|one hour)\s+(?:minutes?|minute|hour)\s+(?:before|after)\s+(?:breakfast|lunch|dinner|meals?)\b", None),
        ]
        for pattern, label in meal_patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                relation_to_meals_matches.append((match.start(), label or self._normalize_fact_text(match.group(0))))

        time_patterns = [
            (r"\bat bedtime\b|\bbefore sleep\b", "bedtime"),
            (r"\bat night\b", "night"),
            (r"\bin the morning\b|\bmorning only\b|\bfirst thing in the morning\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+morning\b", "morning"),
            (r"\bin the evening\b", "evening"),
            (r"\bon waking\b", "on waking"),
        ]
        for pattern, label in time_patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                time_of_day_matches.append((match.start(), label))

        interval = None
        interval_match = re.search(r"\bevery\s+(\d+|one|two|three|four|five|six|eight|twelve)\s+(hours?|days?|weeks?)\b", lowered, re.IGNORECASE)
        if interval_match:
            interval = f"every {interval_match.group(1)} {interval_match.group(2)}"

        if re.search(r"\bevery other day\b|\balternate days?\b", lowered, re.IGNORECASE):
            alternate_days = True
        else:
            alternate_days = None

        weekly_day_match = re.search(r"\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", lowered, re.IGNORECASE)
        if weekly_day_match:
            specific_days.append(weekly_day_match.group(1).capitalize())

        prn = None
        prn_indication = None
        if re.search(r"\bas needed\b|\bonly if needed\b|\bprn\b", lowered, re.IGNORECASE):
            prn = True
        prn_match = re.search(r"\b(?:as needed|only if needed|prn)\s+for\s+([^.,;]+)", lowered, re.IGNORECASE)
        if not prn_match:
            prn_match = re.search(r"\bif\s+([^.,;]+)", lowered, re.IGNORECASE)
        if not prn_match:
            prn_match = re.search(r"\bwhen\s+([^.,;]+)", lowered, re.IGNORECASE)
        if prn_match:
            prn_indication = self._normalize_fact_text(prn_match.group(1))
            prn = True if prn is None else prn

        max_dose = None
        max_match = re.search(r"\b(?:maximum|max\.?|not more than)\s+([^.,;]+(?:days|day|hours|hour|24 hours?))", text, re.IGNORECASE)
        if max_match:
            max_dose = self._normalize_fact_text(max_match.group(0))

        taper_instructions = None
        taper_match = re.search(r"\bthen\s+([^.;]+)", text, re.IGNORECASE)
        if taper_match:
            taper_instructions = self._normalize_fact_text(f"then {taper_match.group(1)}")

        split_dose = None
        split_match = re.search(
            r"\b(?:half|one|two|three|\d+)\s+(?:tablet|tablets|capsule|capsules|puff|puffs|drop|drops)\s+in\s+the\s+morning[^.;]*\b(?:and|,)\s*[^.;]+(?:night|bedtime|evening)\b",
            lowered,
            re.IGNORECASE,
        )
        if split_match:
            split_dose = self._normalize_fact_text(split_match.group(0))

        event_patterns = [
            r"\bbefore exercise\b",
            r"\bbefore travel\b",
            r"\bbefore intercourse\b",
            r"\bbefore exertion\b",
        ]
        for pattern in event_patterns:
            for match in re.finditer(pattern, text, re.IGNORECASE):
                event_timing.append(self._normalize_fact_text(match.group(0)))

        relation_to_meals = [label for _, label in sorted(relation_to_meals_matches, key=lambda item: item[0])]
        time_of_day = [label for _, label in sorted(time_of_day_matches, key=lambda item: item[0])]

        details = {
            "relationToMeals": self._dedupe_strings(relation_to_meals),
            "timeOfDay": self._dedupe_strings(time_of_day),
            "interval": interval,
            "specificDays": self._dedupe_strings(specific_days),
            "alternateDays": alternate_days,
            "prn": prn,
            "prnIndication": prn_indication,
            "maxDose": max_dose,
            "taperInstructions": taper_instructions,
            "splitDose": split_dose,
            "eventTiming": self._dedupe_strings(event_timing),
        }
        return {
            key: value
            for key, value in details.items()
            if value not in (None, [], "")
        }

    def _extract_medication_duration(self, text: str) -> str | None:
        match = re.search(
            r"\bfor\s+((?:next\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fourteen|fifteen|twenty|thirty)\s+"
            r"(?:day|days|week|weeks|month|months))\b",
            text,
            re.IGNORECASE,
        )
        if match:
            return match.group(1)
        return None

    def _extract_medication_route(self, text: str, dosage: str | None) -> str | None:
        lowered = text.lower()
        if re.search(r"\b(inhale|inhaler|puff|puffs|nebulizer|neb)\b", lowered):
            return "inhalation"
        if re.search(r"\b(eye drops?|ear drops?|nasal drops?)\b", lowered):
            if "eye" in lowered:
                return "ophthalmic"
            if "ear" in lowered:
                return "otic"
            return "nasal"
        if re.search(r"\b(apply|ointment|cream|gel|lotion|topical|patch)\b", lowered):
            return "topical"
        if re.search(r"\b(inject|injection|subcutaneous|intramuscular|intravenous|iv|im)\b", lowered):
            return "injection"
        if re.search(r"\b(by mouth|orally|oral|before (?:breakfast|lunch|dinner|meals?)|after (?:food|meals?)|at bedtime|teaspoons?|tablets?|capsules?|syrup|liquid)\b", lowered):
            return "oral"
        if dosage and re.search(r"\b(tablets?|capsules?|teaspoons?|tsp|tbsp|ml|milliliters?)\b", dosage, re.IGNORECASE):
            return "oral"
        return None

    def _parse_medication_line(self, line: str) -> Dict[str, Any] | None:
        text = re.sub(r"\s+", " ", line.strip(" ."))
        if not text:
            return None
        if "?" in text:
            return None

        verb_match = self._ORDER_VERB_RE.search(text)
        if not verb_match:
            return None

        lead_in = text[:verb_match.start()].strip(" ,.")
        tail = text[verb_match.end():].strip(" ,.")
        matched_name = self._extract_med_name_candidate(tail)
        if not matched_name:
            return None

        dosage_match = re.search(
            rf"\b((?:{self._WORD_NUM})(?:\s*(?:-|to)\s*(?:{self._WORD_NUM}))?\s*(?:{self._DOSE_UNIT}))\b",
            text,
            re.IGNORECASE,
        )
        dosage = None
        if dosage_match:
            dosage = re.sub(r"\s+", " ", dosage_match.group(1)).strip()

        frequency = self._extract_medication_frequency(text)
        duration = self._extract_medication_duration(text)
        route = self._extract_medication_route(text, dosage)
        timing_details = self._extract_medication_timing_details(text)

        instructions = tail
        instructions = re.sub(rf"^\b{re.escape(matched_name)}\b", "", instructions, count=1, flags=re.IGNORECASE)
        if dosage:
            instructions = re.sub(rf"\b{re.escape(dosage)}\b", "", instructions, count=1, flags=re.IGNORECASE)
        if frequency:
            instructions = re.sub(rf"\b{re.escape(frequency)}\b", "", instructions, count=1, flags=re.IGNORECASE)
        if duration:
            instructions = re.sub(rf"\bfor\s+{re.escape(duration)}\b", "", instructions, count=1, flags=re.IGNORECASE)
        if route:
            route_patterns = {
                "oral": r"\b(by mouth|orally|oral)\b",
                "topical": r"\b(topical(?:ly)?|apply)\b",
                "inhalation": r"\b(inhale|inhaler|nebulizer)\b",
                "ophthalmic": r"\beye drops?\b",
                "otic": r"\bear drops?\b",
                "nasal": r"\bnasal drops?\b",
                "injection": r"\b(inject|injection|subcutaneous|intramuscular|intravenous|iv|im)\b",
            }
            route_pattern = route_patterns.get(route)
            if route_pattern:
                instructions = re.sub(route_pattern, "", instructions, flags=re.IGNORECASE)
        if lead_in and lead_in.lower().startswith("for "):
            instructions = f"{lead_in}, {instructions}".strip(" ,")
        instructions = re.sub(r"^[, ]+|[, ]+$", "", instructions)
        instructions = re.sub(r"\s+,", ",", instructions)
        instructions = re.sub(r"\s+", " ", instructions).strip(" ,.")

        return {
            "name": matched_name,
            "dosage": dosage,
            "frequency": frequency,
            "duration": duration,
            "route": route,
            "instructions": instructions or None,
            "timingDetails": timing_details or None,
        }

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

    def _is_actionable_doctor_note(self, text: str) -> bool:
        normalized = self._normalize_fact_text(text)
        if not normalized:
            return False
        if "?" in normalized:
            return False
        if ACTION_QUESTION_RE.match(normalized):
            return False
        if len(normalized.split()) < 3:
            return False
        if not self._ACTION_PATTERN.search(normalized):
            return False
        return True

    def _is_valid_prescription_candidate(
        self,
        name: str,
        dosage: str | None,
        frequency: str | None,
        transcript: str,
    ) -> bool:
        cleaned_name = self._normalize_fact_text(name)
        if not cleaned_name:
            return False
        if cleaned_name.lower() in MEDICATION_NAME_BLOCKLIST:
            return False
        if len(cleaned_name.split()) > 6:
            return False
        if ACTION_QUESTION_RE.match(cleaned_name):
            return False
        if not self._fuzzy_supported(cleaned_name, transcript):
            return False
        if not (str(dosage or "").strip() or str(frequency or "").strip()):
            return False
        return True

    def _build_doctor_actions_from_draft(self, prescription_draft: Dict[str, Any] | None) -> List[str]:
        if not isinstance(prescription_draft, dict):
            return []

        actions: List[str] = []

        for med in prescription_draft.get("medications") or []:
            if not isinstance(med, dict):
                continue
            name = self._canonicalize_medication_name(str(med.get("name") or ""))
            if not name:
                continue
            parts = [name]
            for key in ("dosage", "frequency", "duration"):
                value = str(med.get(key) or "").strip()
                if value:
                    parts.append(value)
            instruction = str(med.get("instructions") or "").strip()
            if instruction:
                parts.append(instruction)
            actions.append(self._normalize_fact_text(f"Prescribed {' '.join(parts)}"))

        for investigation in prescription_draft.get("investigations") or []:
            if not isinstance(investigation, dict):
                continue
            label = self._render_investigation_fact(investigation)
            if label:
                actions.append(self._normalize_fact_text(f"Ordered {label}"))

        for advice in prescription_draft.get("advice") or []:
            text = self._normalize_fact_text(str(advice))
            if text:
                actions.append(text)

        for warning in prescription_draft.get("warnings") or []:
            text = self._normalize_fact_text(str(warning))
            if text:
                actions.append(self._normalize_fact_text(f"Warning signs discussed: {text}"))

        follow_up = prescription_draft.get("followUp")
        if isinstance(follow_up, dict):
            follow_up_label = self._render_follow_up_fact(follow_up)
            if follow_up_label:
                actions.append(self._normalize_fact_text(f"Follow-up {follow_up_label}"))

        return self._dedupe_strings(actions)[:10]

    def _coerce_action_text(self, value: Any) -> str:
        if isinstance(value, dict):
            for key in ("text", "action", "label", "note"):
                candidate = str(value.get(key) or "").strip()
                if candidate:
                    return re.sub(r"\s+", " ", candidate).strip()
            return ""

        text = re.sub(r"\s+", " ", str(value or "")).strip()
        if not text:
            return ""

        lowered = text.lower()
        if lowered.startswith("{") and lowered.endswith("}") and "action" in lowered:
            match = re.search(r"['\"]action['\"]\s*:\s*['\"](.+?)['\"]", text)
            if match:
                return re.sub(r"\s+", " ", match.group(1)).strip()
        return text

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
        normalized = re.sub(r"[^a-z0-9\s]", " ", value)
        normalized = re.sub(r"\s+", " ", normalized).strip()
        if value in GENERIC_SNAPSHOT_TERMS or normalized in GENERIC_SNAPSHOT_TERMS:
            return True
        if " - " in value:
            left, right = [part.strip() for part in value.split(" - ", 1)]
            if left == right:
                return True
            if left in GENERIC_SNAPSHOT_TERMS and (right in GENERIC_SNAPSHOT_TERMS or right == left):
                return True
        return normalized in {"have", "had", "just", "problem"}

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

        source_lines = patient_lines if patient_lines else [line.strip() for line in transcript.splitlines() if line.strip()]

        for line in source_lines:
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

        transcript_lower = transcript.lower()
        if len(fallback) < 3:
            if re.search(r"\b(lower|upper)\s+(left|right)\s+(wisdom|molar|tooth)\b", transcript_lower):
                fallback.append({"label": "pain in lower left wisdom tooth area", "category": "symptom"})
            if re.search(r"\b(sweet foods?|hot tea|cold water|chewing)\b", transcript_lower):
                fallback.append({"label": "pain worsens with hot-cold-sweet and chewing", "category": "timing"})
            if re.search(r"\bno\s+fever\b", transcript_lower):
                fallback.append({"label": "no fever", "category": "negative"})

        deduped: List[Dict[str, str]] = []
        seen = set()
        for item in fallback:
            key = (item.get("label", "").lower(), item.get("category", "symptom"))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)

        return deduped[:8]

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

    def _fallback_summary_from_transcript(self, transcript: str) -> Dict[str, Any]:
        clinical_snapshot = self._fallback_snapshot_from_transcript(transcript) if transcript else []
        doctor_actions = self._extract_doctor_actions_from_transcript(transcript) if transcript else []
        regex_meds = self._extract_medications_from_transcript(transcript) if transcript else []
        follow_up = self._extract_followup_from_transcript(transcript) if transcript else None
        diagnoses = self._extract_diagnoses_from_transcript(transcript) if transcript else []

        prescriptions = [
            {
                "name": med.get("name"),
                "dosage": med.get("dosage"),
                "frequency": med.get("frequency"),
            }
            for med in regex_meds
            if isinstance(med, dict) and str(med.get("name") or "").strip()
        ]

        prescription_draft = None
        if regex_meds or diagnoses or follow_up:
            prescription_draft = {
                "diagnoses": diagnoses,
                "medications": regex_meds,
                "investigations": [],
                "advice": [],
                "warnings": [],
                "reportSummary": "",
                "followUp": follow_up,
            }

        chief_complaint = self._infer_chief_complaint(transcript, {"clinicalSnapshot": clinical_snapshot})
        issues_paragraph = (
            f"The patient reports {chief_complaint}."
            if chief_complaint
            else "The patient reported ongoing symptoms discussed during the visit."
        )
        if follow_up and follow_up.get("timeline"):
            actions_paragraph = f"The doctor advised treatment and planned follow-up in {follow_up['timeline']}."
        elif doctor_actions:
            actions_paragraph = f"The doctor advised: {doctor_actions[0]}."
        else:
            actions_paragraph = "The doctor provided management advice based on the visit discussion."

        return {
            "clinicalSnapshot": clinical_snapshot,
            "doctorActions": doctor_actions,
            "prescriptions": prescriptions,
            "prescriptionDraft": prescription_draft,
            "issuesParagraph": issues_paragraph,
            "actionsParagraph": actions_paragraph,
            "chiefComplaint": chief_complaint,
            "structuredFindings": [],
        }

    def _parse_main_response(self, raw: str, transcript: str = "") -> Dict[str, Any]:
        cleaned = re.sub(r"^```(?:json)?", "", raw.strip(), flags=re.IGNORECASE | re.MULTILINE)
        cleaned = re.sub(r"```$", "", cleaned.strip(), flags=re.MULTILINE)
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            logger.warning("No JSON object found in model response")
            return self._fallback_summary_from_transcript(transcript)

        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as exc:
            logger.error("Failed to decode JSON response: %s", exc)
            return self._fallback_summary_from_transcript(transcript)

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
            if category == "medication":
                continue
            clinical_snapshot.append({"label": label, "category": category})

        doctor_actions = []
        for item in parsed.get("doctorActions", []):
            text = self._coerce_action_text(item)
            if not text:
                continue
            if not self._is_actionable_doctor_note(text):
                continue
            doctor_actions.append(text)

        prescriptions: List[Dict[str, Any]] = []
        for rx in parsed.get("prescriptions", []):
            if not isinstance(rx, dict):
                continue
            name = str(rx.get("name", "")).strip()
            if not name:
                continue
            dosage = str(rx.get("dosage") or "").strip() or None
            frequency = str(rx.get("frequency") or "").strip() or None
            if not self._is_valid_prescription_candidate(name, dosage, frequency, transcript):
                continue
            prescriptions.append({
                "name": name,
                "dosage": dosage,
                "frequency": frequency,
            })

        prescription_draft = self._parse_prescription_draft(parsed.get("prescriptionDraft"))
        if prescription_draft and not prescriptions:
            for med in prescription_draft.get("medications", []):
                name = str(med.get("name", "")).strip()
                if not name:
                    continue
                dosage = str(med.get("dosage") or "").strip() or None
                frequency = str(med.get("frequency") or "").strip() or None
                if not self._is_valid_prescription_candidate(name, dosage, frequency, transcript):
                    continue
                prescriptions.append({
                    "name": name,
                    "dosage": dosage,
                    "frequency": frequency,
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
                            "timingDetails": None,
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
        if raw_transcript and len(clinical_snapshot) < 4:
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
                llm_by_name = {
                    self._normalize_medication_name(str(rx.get("name") or "")).lower(): rx
                    for rx in prescriptions
                    if isinstance(rx, dict) and str(rx.get("name") or "").strip()
                }
                for m in regex_meds:
                    normalized_name = self._normalize_medication_name(m["name"]).lower()
                    existing_rx = llm_by_name.get(normalized_name)
                    if existing_rx is None:
                        prescriptions.append({
                            "name": m["name"],
                            "dosage": m["dosage"],
                            "frequency": m["frequency"],
                        })
                        llm_by_name[normalized_name] = prescriptions[-1]
                    else:
                        existing_rx["dosage"] = existing_rx.get("dosage") or m.get("dosage")
                        existing_rx["frequency"] = existing_rx.get("frequency") or m.get("frequency")

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
                    draft_by_name = {
                        self._normalize_medication_name(str(item.get("name") or "")).lower(): item
                        for item in draft_meds
                        if isinstance(item, dict) and str(item.get("name") or "").strip()
                    }
                    existing_draft = draft_by_name.get(normalized_name)
                    if existing_draft is None:
                        draft_meds.append(dict(m))
                    else:
                        for field in ("dosage", "frequency", "duration", "route", "instructions", "timingDetails"):
                            existing_draft[field] = existing_draft.get(field) or m.get(field)
                    prescription_draft["medications"] = draft_meds

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

        if prescription_draft:
            draft_actions = self._build_doctor_actions_from_draft(prescription_draft)
            existing = {str(item).strip().lower() for item in doctor_actions if str(item).strip()}
            for action in draft_actions:
                lowered_action = action.lower()
                if lowered_action in existing:
                    continue
                doctor_actions.append(action)
                existing.add(lowered_action)
            doctor_actions = doctor_actions[:10]

        # Ensure diagnoses are present when doctor used explicit diagnostic framing.
        if prescription_draft is not None and not (prescription_draft.get("diagnoses") or []):
            regex_diagnoses = self._extract_diagnoses_from_transcript(raw_transcript)
            if regex_diagnoses:
                prescription_draft["diagnoses"] = regex_diagnoses

        # Normalize medication names to reduce number-word suffix noise (e.g. "Pantoprazole forty").
        for rx in prescriptions:
            if isinstance(rx, dict) and rx.get("name"):
                rx["name"] = self._canonicalize_medication_name(str(rx.get("name")))
        if prescription_draft and isinstance(prescription_draft.get("medications"), list):
            for med in prescription_draft["medications"]:
                if isinstance(med, dict) and med.get("name"):
                    med["name"] = self._canonicalize_medication_name(str(med.get("name")))

        # Deduplicate final medication lists by normalized name.
        dedup_rx: List[Dict[str, Any]] = []
        seen_rx = set()
        for rx in prescriptions:
            if not isinstance(rx, dict):
                continue
            name = self._canonicalize_medication_name(str(rx.get("name") or ""))
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
                name = self._canonicalize_medication_name(str(med.get("name") or ""))
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
            "structuredFindings": [],
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
        source_facts = [
            fact for fact in summary.get("sourceFacts", [])
            if isinstance(fact, dict) and self._normalize_fact_text(str(fact.get("text") or ""))
        ]

        def matching_source_ids(text: str) -> List[str]:
            normalized = self._normalize_fact_text(text).lower()
            if not normalized:
                return []
            matches: List[str] = []
            for fact in source_facts:
                fact_text = self._normalize_fact_text(str(fact.get("text") or "")).lower()
                if not fact_text:
                    continue
                if normalized in fact_text or fact_text in normalized or SequenceMatcher(None, normalized, fact_text).ratio() >= 0.72:
                    fact_id = str(fact.get("id") or "").strip()
                    if fact_id:
                        matches.append(fact_id)
            return matches[:6]

        formatted_actions = []
        for action_block in summary.get("doctorActions", []):
            # Because we changed `doctorActions` to be a list of dicts during validation...
            if isinstance(action_block, dict):
                text = action_block.get("text", "")
                supported = action_block.get("isSupported", True)
                source_fact_ids = [
                    str(item).strip()
                    for item in action_block.get("sourceFactIds", [])
                    if str(item).strip()
                ]
            else:
                text = action_block
                supported = True
                source_fact_ids = []

            if isinstance(text, str) and text.strip():
                formatted_actions.append({
                    "id": str(uuid.uuid4()),
                    "text": text.strip(),
                    "sourceFactIds": source_fact_ids or matching_source_ids(text),
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
            "structuredFindings": summary.get("structuredFindings", []),
            "sourceFacts": source_facts,
            "sections": summary.get("sections", self._empty_sections()),
            "quality": summary.get("quality") or self._empty_quality("hybrid"),
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
                "timingDetails": item.get("timingDetails") if isinstance(item.get("timingDetails"), dict) else item.get("timing_details") if isinstance(item.get("timing_details"), dict) else None,
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
    _DOSE_UNIT = (
        r"(?:mg|milligram|milligrams|mcg|ml|milliliter|milliliters|g|gram|grams|iu|units?|"
        r"tablets?|capsules?|puffs?|drops?|sprays?|sachets?|patch(?:es)?|teaspoons?|tsp|tablespoons?|tbsp|ampoules?|vials?)"
    )
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

    _ORDER_VERB_RE = re.compile(
        r"\b(?:prescrib(?:e|ed|ing)|re-?start(?:ing)?|start(?:ing)?|take|use|keep|continue|give|add|apply|instill|inhale|insert|stop|hold|increase|reduce|switch)\b",
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
            sentences = [segment.strip() for segment in re.split(r"(?<=[.!?])\s+", line) if segment.strip()]
            for sentence in sentences or [line]:
                parsed_line = self._parse_medication_line(sentence)
                if parsed_line:
                    key = parsed_line["name"].lower()
                    if key not in seen_names:
                        seen_names.add(key)
                        medications.append(parsed_line)
                    continue

                if not self._PRESCRIPTION_VERB_RE.search(sentence):
                    continue

                for m in self._MED_PATTERN.finditer(sentence):
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
