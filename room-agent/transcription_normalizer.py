import re
from difflib import SequenceMatcher
from typing import Any

ASR_MEDICAL_HINT_TERMS = [
    "pantoprazole",
    "domperidone",
    "telmisartan",
    "paracetamol",
    "ibuprofen",
    "diclofenac",
    "aspirin",
    "antacid",
    "endoscopy",
    "h pylori",
    "acid peptic disease",
    "reflux",
    "gastritis",
    "epigastric",
    "stool occult blood",
    "amylase",
    "liver function test",
    "blood pressure",
    "oxygen saturation",
]

MEDICATION_LEXICON = {
    "Pantoprazole",
    "Domperidone",
    "Telmisartan",
    "Paracetamol",
    "Ibuprofen",
    "Diclofenac",
    "Aspirin",
    "Liquid Antacid",
    "Antacid Gel",
}

MEDICAL_PHRASE_ALIASES = {
    "pantoprazal": "Pantoprazole",
    "pantoprazol": "Pantoprazole",
    "pantaprazole": "Pantoprazole",
    "down for a down": "Domperidone",
    "domperadone": "Domperidone",
    "tell me certain": "Telmisartan",
    "tel me certain": "Telmisartan",
    "indoor spoopy": "endoscopy",
    "sour reflex": "sour reflux",
}

MED_CONTEXT_TERMS = {
    "mg", "milligram", "milligrams", "ml", "milliliter", "milliliters",
    "tablet", "tablets", "capsule", "capsules", "dose", "doses", "daily",
    "once", "twice", "thrice", "before", "after", "breakfast", "lunch",
    "dinner", "bedtime", "empty", "stomach", "prescribe", "take", "continue",
}

COMMON_NON_MED_WORDS = {
    "doctor", "patient", "burning", "pain", "today", "week", "night", "food",
    "water", "coffee", "tea", "office", "chest", "stomach", "history",
}


def build_medical_asr_prompt() -> str:
    term_block = ", ".join(ASR_MEDICAL_HINT_TERMS)
    return (
        "Clinical consultation transcript. Prefer exact medical spellings and medication names. "
        f"Key terms: {term_block}."
    )


def _normalized_signature(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]", "", value.lower())
    normalized = re.sub(r"[aeiou]+", "", normalized)
    normalized = re.sub(r"(.)\1+", r"\1", normalized)
    return normalized


def _candidate_similarity(candidate: str, medication: str) -> float:
    candidate_lower = candidate.lower()
    med_lower = medication.lower()
    direct_score = SequenceMatcher(None, candidate_lower, med_lower).ratio()
    signature_score = SequenceMatcher(None, _normalized_signature(candidate_lower), _normalized_signature(med_lower)).ratio()
    return max(direct_score, signature_score)


def _replace_alias_phrases(text: str, corrections: list[dict[str, Any]], turn_index: int, speaker: str) -> str:
    updated = text
    for wrong, right in MEDICAL_PHRASE_ALIASES.items():
        pattern = re.compile(rf"\b{re.escape(wrong)}\b", re.IGNORECASE)
        if pattern.search(updated):
            updated = pattern.sub(right, updated)
            corrections.append(
                {
                    "turnIndex": turn_index,
                    "speaker": speaker,
                    "from": wrong,
                    "to": right,
                    "score": 1.0,
                    "reason": "alias",
                }
            )
    return updated


def _context_contains_medication_clues(context_window: str) -> bool:
    tokens = {t.lower() for t in re.findall(r"[A-Za-z]+", context_window)}
    return len(tokens.intersection(MED_CONTEXT_TERMS)) >= 2


def correct_medical_terms_in_dialogue(dialogue: list[dict[str, Any]], medical_history: dict | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not dialogue:
        return dialogue, []

    history_meds: set[str] = set()
    if isinstance(medical_history, dict):
        for med in medical_history.get("medications", []) or []:
            if isinstance(med, dict):
                name = str(med.get("name") or "").strip()
            else:
                name = str(med).strip()
            if name:
                history_meds.add(name.title())

    med_lexicon = sorted(set(MEDICATION_LEXICON).union(history_meds), key=len, reverse=True)
    med_lexicon_lower = {m.lower() for m in med_lexicon}
    corrections: list[dict[str, Any]] = []
    corrected_dialogue: list[dict[str, Any]] = []

    for idx, turn in enumerate(dialogue):
        original_text = str(turn.get("text") or "")
        speaker = str(turn.get("speaker") or "Unknown")
        corrected_text = _replace_alias_phrases(original_text, corrections, idx, speaker)

        words = re.findall(r"[A-Za-z][A-Za-z0-9/-]*", corrected_text)
        lowered_words = [w.lower() for w in words]
        consumed_spans: set[tuple[int, int]] = set()

        for ngram_size in (3, 2, 1):
            if len(lowered_words) < ngram_size:
                continue
            for start in range(0, len(lowered_words) - ngram_size + 1):
                end = start + ngram_size
                if any((s <= start < e) or (s < end <= e) for (s, e) in consumed_spans):
                    continue
                candidate = " ".join(lowered_words[start:end]).strip()
                if not candidate or candidate in COMMON_NON_MED_WORDS:
                    continue
                if candidate in med_lexicon_lower:
                    continue

                best_med = ""
                best_score = 0.0
                for med in med_lexicon:
                    score = _candidate_similarity(candidate, med)
                    if score > best_score:
                        best_score = score
                        best_med = med

                if not best_med:
                    continue

                token_context = " ".join(lowered_words[max(0, start - 4): min(len(lowered_words), end + 5)])
                has_context = _context_contains_medication_clues(token_context)
                threshold = 0.86
                if has_context:
                    threshold = 0.74
                if best_score < threshold:
                    continue

                from_phrase = " ".join(words[start:end])
                pattern = re.compile(rf"\b{re.escape(from_phrase)}\b", re.IGNORECASE)
                if pattern.search(corrected_text):
                    corrected_text = pattern.sub(best_med, corrected_text, count=1)
                    consumed_spans.add((start, end))
                    corrections.append(
                        {
                            "turnIndex": idx,
                            "speaker": speaker,
                            "from": from_phrase,
                            "to": best_med,
                            "score": round(float(best_score), 3),
                            "reason": "context_fuzzy_medication",
                        }
                    )

        updated_turn = dict(turn)
        updated_turn["text"] = corrected_text
        if corrected_text != original_text:
            updated_turn["original_text"] = original_text
        corrected_dialogue.append(updated_turn)

    return corrected_dialogue, corrections
