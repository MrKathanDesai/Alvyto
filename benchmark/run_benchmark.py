"""
Alvyto Summarizer Benchmark
Compares models on the exact prompts used in summarizer.py
"""

import json
import re
import time
import httpx
from difflib import SequenceMatcher
from typing import Any, Dict, List

# ── Exact prompts from summarizer.py ────────────────────────────────────────

SYSTEM_PROMPT = """You are a clinical documentation assistant. Extract information from the conversation below and output a JSON object. Do not copy these instructions into your output.

ZERO-INFERENCE RULE: Use only words and phrases actually spoken in the conversation. Do not infer, assume, or add anything not explicitly stated.

JSON FIELDS:
- "clinicalSnapshot": array of objects, each with "label" (a short verbatim phrase from the conversation, 2-5 words) and "category" (one of: symptom, medication, action, warning, lifestyle, timing, negative). Include 4 to 6 items.
- "doctorActions": array of strings. Each string is a short action the doctor stated (under 8 words). Include 3 to 5 items.
- "issuesParagraph": a string of 2-3 sentences describing what the patient said about their condition, using only spoken facts.
- "actionsParagraph": a string of 2-3 sentences describing what the doctor said they would do, using only spoken facts.

OUTPUT FORMAT: Raw JSON object only. No markdown. No code fences. No explanation. Start your response with { and end with }."""

EXPAND_PROMPT = """You are a clinical documentation assistant. Given the updated clinical snapshot chips, doctor action bullets, and the original transcript below, regenerate the two narrative paragraphs. Use only facts explicitly stated in the transcript.

JSON FIELDS:
- "issuesParagraph": 2-3 sentences on patient presentation.
- "actionsParagraph": 2-3 sentences on doctor plan.

OUTPUT FORMAT: Raw JSON object only. No markdown. No code fences. Start your response with { and end with }."""

# ── Test dialogues ───────────────────────────────────────────────────────────

DIALOGUES = [
    {
        "name": "GP visit — headache + BP",
        "dialogue": [
            {"speaker": "Doctor", "text": "Good morning, what brings you in today?"},
            {"speaker": "Patient", "text": "I've had a headache for three days now, mostly on the right side."},
            {"speaker": "Doctor", "text": "Is it throbbing or more of a pressure feeling?"},
            {"speaker": "Patient", "text": "Throbbing. Gets worse when I bend down. Light really bothers me too."},
            {"speaker": "Doctor", "text": "Any nausea or vomiting?"},
            {"speaker": "Patient", "text": "Some nausea, yeah. No vomiting though."},
            {"speaker": "Doctor", "text": "Are you on any medications currently?"},
            {"speaker": "Patient", "text": "Just ibuprofen 400mg I've been taking twice a day, but it's not really helping."},
            {"speaker": "Doctor", "text": "Your blood pressure is a bit high today, 145 over 92. I'm going to prescribe sumatriptan 50mg for the migraines."},
            {"speaker": "Patient", "text": "Okay, do I take it when the headache starts?"},
            {"speaker": "Doctor", "text": "Yes, take it at onset. Also stop the ibuprofen, it can cause rebound headaches. I want to see you back in two weeks to recheck your blood pressure. If you get a headache with fever or stiff neck, go to the ER immediately."},
        ],
    },
    {
        "name": "Diabetes follow-up — medication adjustment",
        "dialogue": [
            {"speaker": "Doctor", "text": "How have you been feeling since we last saw you?"},
            {"speaker": "Patient", "text": "Pretty tired most of the time. Also my feet have been tingling, especially at night."},
            {"speaker": "Doctor", "text": "How are you managing your diet?"},
            {"speaker": "Patient", "text": "I've been trying to cut out sugar but I still eat a lot of white rice. My wife cooks it every day."},
            {"speaker": "Doctor", "text": "Your A1C came back at 8.4, which is higher than last time. Your metformin dose is 500mg twice daily, correct?"},
            {"speaker": "Patient", "text": "Yes, 500 in the morning and 500 at night."},
            {"speaker": "Doctor", "text": "I'm going to increase your metformin to 1000mg twice daily. I also want to refer you to a dietitian to help with the rice substitution. We'll do a nerve conduction test for the tingling."},
            {"speaker": "Patient", "text": "Will the higher dose upset my stomach?"},
            {"speaker": "Doctor", "text": "It can initially. Take it with food and that usually helps. Come back in six weeks for repeat bloodwork."},
        ],
    },
    {
        "name": "Short visit — sore throat",
        "dialogue": [
            {"speaker": "Doctor", "text": "What's going on today?"},
            {"speaker": "Patient", "text": "My throat has been really sore for about two days. Hurts to swallow."},
            {"speaker": "Doctor", "text": "Any fever?"},
            {"speaker": "Patient", "text": "Yeah, 38.5 last night."},
            {"speaker": "Doctor", "text": "Let me take a look. I can see white patches on your tonsils. That's likely strep. I'll do a rapid test to confirm. I'm going to prescribe amoxicillin 500mg three times a day for ten days if it comes back positive."},
            {"speaker": "Patient", "text": "I'm not allergic to anything."},
            {"speaker": "Doctor", "text": "Good. Finish the full course even if you feel better in two days. Drink plenty of fluids and rest."},
        ],
    },
]

EXPAND_TEST = {
    "name": "Expand paragraphs after editing",
    "clinical_snapshot": [
        {"label": "throbbing headache right side", "category": "symptom"},
        {"label": "three days duration", "category": "duration"},
        {"label": "light sensitivity", "category": "symptom"},
        {"label": "ibuprofen 400mg twice daily", "category": "medication"},
        {"label": "blood pressure 145 over 92", "category": "symptom"},
    ],
    "doctor_actions": [
        "Prescribe sumatriptan 50mg",
        "Stop ibuprofen",
        "Recheck blood pressure in two weeks",
        "ER if fever or stiff neck",
    ],
    "transcript": "\n".join([
        f"{t['speaker']}: {t['text']}" for t in DIALOGUES[0]["dialogue"]
    ]),
}

VALID_CATEGORIES = {"symptom","duration","timing","medication","action","lifestyle","warning","negative"}

# ── Scoring ──────────────────────────────────────────────────────────────────

def _fuzzy_supported(claim: str, transcript: str, threshold: float = 0.72) -> bool:
    claim_words = [w for w in re.findall(r"\b\w+\b", claim.lower()) if len(w) > 3]
    if not claim_words:
        return True
    transcript_lower = transcript.lower()
    transcript_words = re.findall(r"\b\w+\b", transcript_lower)
    matched = sum(
        1 for w in claim_words
        if w in transcript_lower or any(SequenceMatcher(None, w, tw).ratio() > threshold for tw in transcript_words)
    )
    return (matched / len(claim_words)) >= 0.6


def parse_json(raw: str) -> dict | None:
    cleaned = re.sub(r"^```(?:json)?", "", raw.strip(), flags=re.IGNORECASE | re.MULTILINE)
    cleaned = re.sub(r"```$", "", cleaned.strip(), flags=re.MULTILINE)
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def score_summarize(parsed: dict | None, transcript: str) -> dict:
    if parsed is None:
        return {"valid_json": False, "schema_ok": False, "snapshot_count": 0,
                "actions_count": 0, "categories_valid": 0, "support_rate": 0.0,
                "paragraphs_ok": False}

    snapshot = parsed.get("clinicalSnapshot", [])
    actions  = parsed.get("doctorActions", [])
    issues   = parsed.get("issuesParagraph", "")
    actions_p = parsed.get("actionsParagraph", "")

    schema_ok = (
        isinstance(snapshot, list) and isinstance(actions, list)
        and isinstance(issues, str) and isinstance(actions_p, str)
    )

    valid_cats = sum(
        1 for item in snapshot
        if isinstance(item, dict) and item.get("category", "") in VALID_CATEGORIES
    )

    support_checks = []
    for item in snapshot:
        if isinstance(item, dict) and item.get("label"):
            support_checks.append(_fuzzy_supported(item["label"], transcript))
    for action in actions:
        text = action.get("text", action) if isinstance(action, dict) else action
        if text:
            support_checks.append(_fuzzy_supported(str(text), transcript))

    support_rate = sum(support_checks) / len(support_checks) if support_checks else 0.0

    return {
        "valid_json": True,
        "schema_ok": schema_ok,
        "snapshot_count": len(snapshot),
        "actions_count": len(actions),
        "categories_valid": valid_cats,
        "support_rate": round(support_rate, 2),
        "paragraphs_ok": len(issues) > 20 and len(actions_p) > 20,
    }


def score_expand(parsed: dict | None) -> dict:
    if parsed is None:
        return {"valid_json": False, "paragraphs_ok": False}
    issues  = parsed.get("issuesParagraph", "")
    actions = parsed.get("actionsParagraph", "")
    return {
        "valid_json": True,
        "paragraphs_ok": len(issues) > 20 and len(actions) > 20,
    }


# ── Ollama call ──────────────────────────────────────────────────────────────

def call_ollama(model: str, system: str, user: str, temperature: float = 0.1) -> tuple[str, float]:
    start = time.time()
    r = httpx.post(
        "http://localhost:11434/api/chat",
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            "options": {"temperature": temperature, "top_p": 0.95, "num_predict": 768},
            "stream": False,
        },
        timeout=300,
    )
    r.raise_for_status()
    elapsed = time.time() - start
    content = r.json()["message"]["content"].strip()
    return content, round(elapsed, 1)


# ── Main benchmark ───────────────────────────────────────────────────────────

MODELS = ["qwen2.5:3b", "qwen3:4b", "phi4-mini", "llama3.1:8b"]

def run():
    results: dict[str, list] = {m: [] for m in MODELS}

    print("\n" + "="*70)
    print("ALVYTO SUMMARIZER BENCHMARK")
    print("="*70)

    for model in MODELS:
        print(f"\n{'─'*70}")
        print(f"MODEL: {model}")
        print('─'*70)

        # ── Summarize tests ───────────────────────────────────────────────
        for test in DIALOGUES:
            transcript = "\n".join(
                f"{t['speaker']}: {t['text']}" for t in test["dialogue"]
            )
            user_msg = f"TRANSCRIPT:\n{transcript}\n\nReturn JSON now:"

            try:
                raw, elapsed = call_ollama(model, SYSTEM_PROMPT, user_msg)
                parsed = parse_json(raw)
                scores = score_summarize(parsed, transcript)
                scores["elapsed"] = elapsed
                scores["test"] = test["name"]
                scores["task"] = "summarize"
                scores["raw_snippet"] = raw[:120].replace("\n", " ")
                results[model].append(scores)

                status = "✓" if (scores["valid_json"] and scores["schema_ok"] and scores["paragraphs_ok"]) else "✗"
                print(f"  [{status}] {test['name']}")
                print(f"      Time: {elapsed}s | JSON: {scores['valid_json']} | Schema: {scores['schema_ok']}")
                print(f"      Snapshot: {scores['snapshot_count']} items | Actions: {scores['actions_count']}")
                print(f"      Support rate: {scores['support_rate']} | Cats valid: {scores['categories_valid']}")
            except Exception as e:
                print(f"  [✗] {test['name']} — ERROR: {e}")
                results[model].append({"test": test["name"], "task": "summarize", "error": str(e)})

        # ── Expand test ───────────────────────────────────────────────────
        exp = EXPAND_TEST
        payload = {
            "clinicalSnapshot": exp["clinical_snapshot"],
            "doctorActions": exp["doctor_actions"],
            "transcript": exp["transcript"],
        }
        user_msg = f"INPUT:\n{json.dumps(payload, ensure_ascii=False)}\n\nReturn JSON now:"

        try:
            raw, elapsed = call_ollama(model, EXPAND_PROMPT, user_msg)
            parsed = parse_json(raw)
            scores = score_expand(parsed)
            scores["elapsed"] = elapsed
            scores["test"] = exp["name"]
            scores["task"] = "expand"
            results[model].append(scores)

            status = "✓" if (scores["valid_json"] and scores["paragraphs_ok"]) else "✗"
            print(f"  [{status}] Expand: {exp['name']}")
            print(f"      Time: {elapsed}s | JSON: {scores['valid_json']} | Paragraphs OK: {scores['paragraphs_ok']}")
        except Exception as e:
            print(f"  [✗] Expand — ERROR: {e}")

    # ── Summary table ─────────────────────────────────────────────────────
    print("\n" + "="*70)
    print("SUMMARY")
    print("="*70)
    print(f"{'Model':<20} {'Avg Time':>9} {'JSON OK':>8} {'Schema OK':>10} {'Support':>9} {'Pass':>6}")
    print("─"*70)

    for model in MODELS:
        rows = [r for r in results[model] if "error" not in r]
        if not rows:
            print(f"{model:<20}  {'ERROR':>9}")
            continue

        avg_time   = round(sum(r["elapsed"] for r in rows) / len(rows), 1)
        json_ok    = sum(1 for r in rows if r.get("valid_json")) / len(rows)
        schema_ok  = sum(1 for r in rows if r.get("schema_ok", True)) / len(rows)
        support    = [r["support_rate"] for r in rows if "support_rate" in r]
        avg_sup    = round(sum(support) / len(support), 2) if support else 0
        passed     = sum(1 for r in rows if r.get("valid_json") and r.get("paragraphs_ok", True))

        print(f"{model:<20} {avg_time:>8}s {json_ok:>8.0%} {schema_ok:>10.0%} {avg_sup:>9} {passed:>5}/{len(rows)}")

    # ── Save full results ─────────────────────────────────────────────────
    out_path = "/Users/kathandesai/alvyto/benchmark/results.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nFull results saved to {out_path}")


if __name__ == "__main__":
    run()
