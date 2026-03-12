import json
import logging
import re
import uuid
import requests
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "llama3.1:8b"

MIN_WORDS_PER_TURN = 3

SYSTEM_PROMPT = """You are a highly accurate medical scribe. Your only job is to extract every clinical fact from the doctor-patient transcript below.

═══ ABSOLUTE RULES ═══

1. ZERO-INFERENCE RULE: DO NOT infer or guess specific medications or diagnoses.
   ✗ WRONG: "took Tylenol" → if patient only said "I took some medicine" or "painkillers".
   ✓ RIGHT: "took medicine" or "took painkillers" (copy the exact word used).
   If a specific drug name is NOT in the transcript, it MUST NOT be in your output.

2. COPY EXACT WORDS from the transcript. Never paraphrase, substitute, or infer.
   ✗ WRONG: "fever for a few days"  → if transcript says "since yesterday", write "since yesterday"
   ✗ WRONG: "symptoms on exertion"  → if transcript never says this, do NOT write it
   ✓ RIGHT: copy the speaker's exact phrase

3. Create ONE item per distinct clinical fact. Never merge two facts into one item.

4. Each item: ≤20 words, starts lowercase, no trailing period.

5. If a piece of information was NOT said in the transcript, do NOT include it.

6. If a number or time was said (e.g. "three to four days", "since yesterday", "400mg"), copy it EXACTLY.

═══ WHAT TO CAPTURE ═══

Under "issuesIdentified" — sweep ALL of the following, every single one:
  • Every symptom the patient mentions (headache, fever, cough, sore throat, etc.)
  • Exact duration stated ("since yesterday", "for two weeks", "started this morning")
  • Exact timing/triggers stated ("in the evening", "when climbing stairs", "after meals")
  • Severity ("slightly high temperature", "mild", "sharp", "dull")
  • Medications the patient ALREADY TRIED before the visit — this is mandatory:
      If patient says "I took some medicine but it didn't help" → add: "took medicine, did not help"
      If patient says "I tried ibuprofen" → add: "tried ibuprofen"
      (DO NOT invent drug names. If they say "medicine", write "medicine".)
  • Relevant negative findings stated ("no family history", "no known allergies")
  • Lifestyle factors mentioned (sleep, diet, exercise, work stress)

Under "actionsPlan" — sweep ALL of the following, every single one:
  • Every medication prescribed (exact name, dose, frequency if stated)
  • Every test or investigation ordered
  • Doctor's stated recovery timeline — this is mandatory:
      If doctor says "within three to four days" → add: "recovery expected within three to four days"
      If doctor says "a week" → add: "recovery expected within one week"
  • Lifestyle instructions (rest, hydration, sleep, diet changes)
  • Activity restrictions
  • Follow-up conditions ("come back if fever doesn't go down")
  • Warning signs to watch for

Under "keyFacts" — 6-12 chips, 1-4 words each, VERBATIM from transcript.
  Categories: symptom | duration | timing | medication | action | lifestyle | warning | negative
  • Recovery timelines → use category "action" (e.g. { "label": "3-4 days", "category": "action" })
  • Patient-tried meds → use category "medication"
  • Group: all symptom chips together, then duration, then timing, etc.

═══ OUTPUT FORMAT ═══
Return ONLY valid JSON. No explanation, no markdown, no preamble:
{
  "issuesIdentified": ["headache since yesterday", "..."],
  "actionsPlan": ["antibiotics prescribed", "..."],
  "keyFacts": [
    { "label": "headache", "category": "symptom" },
    { "label": "fever", "category": "symptom" },
    { "label": "since yesterday", "category": "duration" }
  ]
}"""


class Summarizer:
    def __init__(self, ollama_url: str = OLLAMA_URL, model: str = MODEL):
        self.ollama_url = ollama_url
        self.model = model
        self._check_ollama()

    def _check_ollama(self):
        try:
            resp = requests.get("http://localhost:11434", timeout=3)
            if resp.status_code == 200:
                logger.info(f"Ollama is running. Using model: {self.model}")
        except Exception:
            logger.warning("Ollama not reachable. Summarization will be disabled until Ollama starts.")

    def summarize_dialogue(self, dialogue: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Summarize a medical dialogue into Issues Identified, Actions/Plan, and Key Facts.
        Captures ALL clinical content — no merging, no truncation.
        """
        empty = {"issuesIdentified": [], "actionsPlan": [], "keyFacts": []}

        if not dialogue:
            return empty

        meaningful = [
            turn for turn in dialogue
            if len(turn.get("text", "").split()) >= MIN_WORDS_PER_TURN
        ]

        if not meaningful:
            logger.info("Dialogue too short — skipping summarization.")
            return empty

        transcript = "\n".join(
            f"{turn['speaker']}: {turn['text'].strip()}"
            for turn in meaningful
        )

        prompt = f"{SYSTEM_PROMPT}\n\nTRANSCRIPT:\n{transcript}\n\nJSON:"

        try:
            response = requests.post(
                self.ollama_url,
                json={
                    "model": self.model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.0,
                        "top_p": 1.0,
                        "num_predict": 1024,   # Increased to allow full output
                    }
                },
                timeout=180
            )
            response.raise_for_status()

            raw = response.json().get("response", "").strip()
            logger.debug(f"Raw LLM response: {raw}")

            parsed = self._parse_response(raw)
            return self._format_for_frontend(parsed)

        except requests.exceptions.ConnectionError:
            logger.error("Ollama not running. Start it with: ollama serve")
            return empty
        except requests.exceptions.Timeout:
            logger.error("Ollama timed out.")
            return empty
        except Exception as e:
            logger.error(f"Summarization failed: {e}", exc_info=True)
            return empty

    def _parse_response(self, raw: str) -> Dict[str, Any]:
        """Parse JSON from model output, handling common formatting issues."""
        raw = re.sub(r"^```(?:json)?", "", raw, flags=re.MULTILINE).strip()
        raw = re.sub(r"```$", "", raw, flags=re.MULTILINE).strip()

        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if not match:
            logger.warning("No JSON object found in LLM response.")
            return {"issuesIdentified": [], "actionsPlan": [], "keyFacts": []}

        try:
            parsed = json.loads(match.group())
        except json.JSONDecodeError as e:
            logger.error(f"JSON decode error: {e}")
            return {"issuesIdentified": [], "actionsPlan": [], "keyFacts": []}

        issues = [str(x).strip() for x in parsed.get("issuesIdentified", []) if x and str(x).strip()]
        actions = [str(x).strip() for x in parsed.get("actionsPlan", []) if x and str(x).strip()]

        # Parse keyFacts — accept both {label, category} objects and plain strings
        raw_facts = parsed.get("keyFacts", [])
        valid_categories = {"symptom", "duration", "timing", "medication", "action", "lifestyle", "warning", "negative"}
        key_facts = []
        for fact in raw_facts:
            if isinstance(fact, dict):
                label = str(fact.get("label", "")).strip()
                category = str(fact.get("category", "symptom")).strip().lower()
                if label:
                    key_facts.append({
                        "label": label,
                        "category": category if category in valid_categories else "symptom"
                    })
            elif isinstance(fact, str) and fact.strip():
                key_facts.append({"label": fact.strip(), "category": "symptom"})

        return {"issuesIdentified": issues, "actionsPlan": actions, "keyFacts": key_facts}

    def _format_for_frontend(self, summary: Dict[str, Any]) -> Dict[str, Any]:
        """Convert to SummaryItem objects for the frontend."""
        return {
            "issuesIdentified": [
                {"id": str(uuid.uuid4()), "text": text, "sourceFactIds": [], "isEdited": False}
                for text in summary["issuesIdentified"]
            ],
            "actionsPlan": [
                {"id": str(uuid.uuid4()), "text": text, "sourceFactIds": [], "isEdited": False}
                for text in summary["actionsPlan"]
            ],
            "keyFacts": summary["keyFacts"]
        }
