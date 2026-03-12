"""
test_summarizer.py — Test the local Ollama summarizer without needing a full recording.

Usage:
    cd room-agent && source venv/bin/activate && python test_summarizer.py

Ensure Ollama is running:
    ollama serve
    ollama pull llama3.1:8b
"""
import logging
from summarizer import Summarizer

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

# ----- Test fixtures -----

NORMAL_VISIT = [
    {"speaker": "Doctor", "text": "Hello Mr. Smith, what brings you in today?"},
    {"speaker": "Patient", "text": "I've been having a sharp pain in my lower back for about three days now. It's been getting worse when I sit for long periods."},
    {"speaker": "Doctor", "text": "Have you lifted anything heavy recently?"},
    {"speaker": "Patient", "text": "Yes, I was moving boxes in the garage over the weekend."},
    {"speaker": "Doctor", "text": "It sounds like a muscle strain. I'm going to prescribe Ibuprofen 400mg twice a day with food. Please rest and avoid lifting for the next week. If there's no improvement in seven days, come back and we'll order an MRI."},
    {"speaker": "Patient", "text": "Okay, should I apply heat or ice?"},
    {"speaker": "Doctor", "text": "Apply ice for the first 48 hours, then switch to heat if it helps. You can also do light stretching."},
]

EMPTY_VISIT = []

SHORT_CHIT_CHAT = [
    {"speaker": "Doctor", "text": "Hi"},
    {"speaker": "Patient", "text": "Hello"},
]

def run_test(name: str, dialogue: list):
    print(f"\n{'='*60}")
    print(f"TEST: {name}")
    print('='*60)
    s = Summarizer()
    result = s.summarize_dialogue(dialogue)

    issues = result.get("issuesIdentified", [])
    actions = result.get("actionsPlan", [])

    print(f"\n📋 Issues Identified ({len(issues)}):")
    if issues:
        for item in issues:
            print(f"   • {item['text']}")
    else:
        print("   (none)")

    print(f"\n✅ Actions / Plan ({len(actions)}):")
    if actions:
        for item in actions:
            print(f"   • {item['text']}")
    else:
        print("   (none)")

    # Assertions
    if name == "Normal Visit":
        assert len(issues) > 0, "FAIL: should have extracted issues for a normal visit"
        assert len(actions) > 0, "FAIL: should have extracted actions for a normal visit"
        print("\n✅ PASS")
    elif name in ("Empty Visit", "Short Chit Chat"):
        assert len(issues) == 0, f"FAIL: should return empty issues for '{name}'"
        assert len(actions) == 0, f"FAIL: should return empty actions for '{name}'"
        print("\n✅ PASS")


if __name__ == "__main__":
    run_test("Normal Visit", NORMAL_VISIT)
    run_test("Empty Visit", EMPTY_VISIT)
    run_test("Short Chit Chat", SHORT_CHIT_CHAT)
    print("\n\n✅ All tests complete.")
