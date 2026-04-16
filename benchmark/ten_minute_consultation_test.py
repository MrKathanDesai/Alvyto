import json
import urllib.request


ROOM_AGENT_SUMMARIZE_URL = "http://localhost:8000/summarize"


def build_dialogue() -> list[dict[str, str]]:
    return [
        {"speaker": "Doctor", "text": "Good afternoon, Mr. Rakesh Shah. I am Dr. Nidhi Trivedi. Please have a seat. How are you feeling today?"},
        {"speaker": "Patient", "text": "Good afternoon, doctor. Umm, honestly not very good. Since about two weeks I have this burning in my stomach after meals, and in the last four days it has become much worse."},
        {"speaker": "Doctor", "text": "Alright, I hear you. Burning after meals for two weeks, worse in the last four days. Can you point to exactly where you feel it?"},
        {"speaker": "Patient", "text": "Mostly here, in the upper middle part, just below the chest. Sometimes it comes up into my throat, like sour water."},
        {"speaker": "Doctor", "text": "So upper abdominal burning with sour reflux. Does it happen after specific foods, like spicy, oily, tea, coffee?"},
        {"speaker": "Patient", "text": "Yes, yes, especially after spicy dinner and tea. I take three, sometimes four cups of tea in office."},
        {"speaker": "Doctor", "text": "Okay. Any nausea, vomiting, black stool, blood in stool, or weight loss recently?"},
        {"speaker": "Patient", "text": "No vomiting, no blood, no black stool. Weight maybe one kilo down, but appetite is there."},
        {"speaker": "Doctor", "text": "Any fever, chest pain while walking, or breathlessness?"},
        {"speaker": "Patient", "text": "No fever. No breathlessness. Chest pain only this burning type, mostly after food or when lying down."},
        {"speaker": "Doctor", "text": "Got it. Does the pain wake you at night?"},
        {"speaker": "Patient", "text": "Yes, around midnight I wake up with burning, then I sit up and drink water."},
        {"speaker": "Doctor", "text": "How often in a week does that happen?"},
        {"speaker": "Patient", "text": "At least four nights this week."},
        {"speaker": "Doctor", "text": "Understood. What have you taken so far for relief?"},
        {"speaker": "Patient", "text": "I took over-the-counter antacid gel, and one tablet from chemist, I think pantoprazole forty, but not regularly."},
        {"speaker": "Doctor", "text": "Okay, irregular pantoprazole use. Any painkiller use, like ibuprofen, diclofenac, aspirin?"},
        {"speaker": "Patient", "text": "I take ibuprofen maybe two or three times a week for knee pain."},
        {"speaker": "Doctor", "text": "That can irritate the stomach. Do you smoke or drink alcohol?"},
        {"speaker": "Patient", "text": "I do not smoke. I drink socially, maybe two pegs on weekends."},
        {"speaker": "Doctor", "text": "Thanks. Tell me about your meal timings."},
        {"speaker": "Patient", "text": "Breakfast is late, around ten-thirty. Lunch around three. Dinner very late, like ten-thirty or eleven because of work."},
        {"speaker": "Doctor", "text": "And right after dinner, do you lie down quickly?"},
        {"speaker": "Patient", "text": "Yes doctor, usually within twenty minutes because I am tired."},
        {"speaker": "Doctor", "text": "Alright. Any previous history of ulcer, gastritis, or H. pylori treatment?"},
        {"speaker": "Patient", "text": "About five years back I had gastritis episode, but no endoscopy done. It settled with medicines."},
        {"speaker": "Doctor", "text": "Any diabetes, blood pressure, thyroid, heart disease?"},
        {"speaker": "Patient", "text": "I have borderline blood pressure, taking telmisartan forty daily. No diabetes as far as I know."},
        {"speaker": "Doctor", "text": "Any known medicine allergy?"},
        {"speaker": "Patient", "text": "No known drug allergy."},
        {"speaker": "Doctor", "text": "Okay, let me quickly examine you. Please lie down on the couch."},
        {"speaker": "Patient", "text": "Sure."},
        {"speaker": "Doctor", "text": "Your blood pressure is one thirty six over eighty six, pulse eighty, oxygen ninety nine, temperature normal. Mild tenderness in epigastric region, no guarding, no rigidity."},
        {"speaker": "Patient", "text": "So is it serious, doctor? I am worried maybe heart problem or something."},
        {"speaker": "Doctor", "text": "At present this pattern is more consistent with acid peptic disease and reflux, not typical cardiac pain. But if you get crushing chest pain with sweating or breathlessness, that is different and urgent."},
        {"speaker": "Patient", "text": "Okay, that is reassuring."},
        {"speaker": "Doctor", "text": "Let me ask one more thing. Any difficulty swallowing or food getting stuck?"},
        {"speaker": "Patient", "text": "No, swallowing is normal."},
        {"speaker": "Doctor", "text": "Any persistent vomiting or severe abdominal pain radiating to back?"},
        {"speaker": "Patient", "text": "No, none of that."},
        {"speaker": "Doctor", "text": "Good. We can start treatment and lifestyle correction first."},
        {"speaker": "Patient", "text": "Yes please, I really need relief. Office concentration is getting affected."},
        {"speaker": "Doctor", "text": "I will prescribe Pantoprazole forty milligram once daily, empty stomach, thirty minutes before breakfast, for six weeks."},
        {"speaker": "Patient", "text": "Okay, before breakfast, daily."},
        {"speaker": "Doctor", "text": "Along with that, take Domperidone ten milligram twice daily, fifteen minutes before lunch and dinner, for ten days."},
        {"speaker": "Patient", "text": "Twice daily before lunch and dinner, understood."},
        {"speaker": "Doctor", "text": "For breakthrough burning, keep Liquid Antacid fifteen milliliter after meals and at bedtime as needed, maximum four doses in a day."},
        {"speaker": "Patient", "text": "Alright. Can I continue ibuprofen for knee pain?"},
        {"speaker": "Doctor", "text": "Try to avoid ibuprofen for now. Use Paracetamol six hundred fifty milligram only if needed, after food, not more than three tablets in twenty four hours."},
        {"speaker": "Patient", "text": "Okay, I will stop ibuprofen for now."},
        {"speaker": "Doctor", "text": "Now important guidelines. First, fixed meal timings. No long gaps beyond four hours."},
        {"speaker": "Patient", "text": "Hmm, that will be hard with meetings, but I can try."},
        {"speaker": "Doctor", "text": "Keep small snacks, like banana or roasted chana, to avoid prolonged fasting. Second, reduce tea to one cup a day, avoid late-night spicy food."},
        {"speaker": "Patient", "text": "One cup tea only... that is tough, but yes, I get your point."},
        {"speaker": "Doctor", "text": "Third, do not lie down for at least two to three hours after dinner. Keep head-end elevated by about six inches while sleeping."},
        {"speaker": "Patient", "text": "Should I use two pillows?"},
        {"speaker": "Doctor", "text": "Better to elevate the bed head, not just extra pillows, because pillows can bend your neck and not reduce reflux properly."},
        {"speaker": "Patient", "text": "Got it."},
        {"speaker": "Doctor", "text": "Fourth, avoid trigger foods: fried snacks, red chili, citrus juices on empty stomach, soda, and very late heavy dinners."},
        {"speaker": "Patient", "text": "Can I have curd and buttermilk?"},
        {"speaker": "Doctor", "text": "Yes, plain curd and buttermilk are usually okay if they do not trigger symptoms. Prefer early dinner by eight-thirty if possible."},
        {"speaker": "Patient", "text": "Okay, I will shift dinner earlier."},
        {"speaker": "Doctor", "text": "Do you feel stress has increased recently? Stress can worsen acidity."},
        {"speaker": "Patient", "text": "Yes doctor, major project deadline this month, sleep is less, maybe five to six hours."},
        {"speaker": "Doctor", "text": "Please add ten to fifteen minutes of evening walk and simple breathing exercise. It helps symptoms and sleep."},
        {"speaker": "Patient", "text": "Alright, I can start walking after work."},
        {"speaker": "Doctor", "text": "Now regarding tests. Since this is recurrent and night symptoms are present, I will order baseline CBC, liver function test, amylase, and stool occult blood. Also H. pylori stool antigen."},
        {"speaker": "Patient", "text": "Do I need endoscopy immediately?"},
        {"speaker": "Doctor", "text": "Not immediately today because no alarm signs like bleeding, persistent vomiting, progressive weight loss, or swallowing difficulty. But if symptoms persist after two to three weeks of proper treatment, we will schedule upper GI endoscopy."},
        {"speaker": "Patient", "text": "Okay, fair enough."},
        {"speaker": "Doctor", "text": "Please bring previous prescriptions if available during follow-up."},
        {"speaker": "Patient", "text": "Yes, I have old file at home, I will bring it."},
        {"speaker": "Doctor", "text": "Warning signs I want you to remember: black stools, vomiting blood, severe continuous abdominal pain, chest pain with sweating, repeated vomiting, or fainting. If any of these occur, go to emergency immediately."},
        {"speaker": "Patient", "text": "Yes, I will not ignore those."},
        {"speaker": "Doctor", "text": "Good. Follow-up after ten days with test reports, earlier if worsening."},
        {"speaker": "Patient", "text": "Ten days, with reports. Okay. Can I message the clinic if medicine causes side effects?"},
        {"speaker": "Doctor", "text": "Yes, absolutely. If you get severe loose motions, palpitations, rash, or dizziness, stop that medicine and contact us."},
        {"speaker": "Patient", "text": "Thank you, doctor. You explained very clearly."},
        {"speaker": "Doctor", "text": "You are welcome, Mr. Shah. Start from tonight with diet changes, and from tomorrow morning begin the tablets on schedule."},
        {"speaker": "Patient", "text": "Sure doctor, I will follow this properly."},
        {"speaker": "Doctor", "text": "Great. We should see significant improvement in one week if routine is maintained."},
        {"speaker": "Patient", "text": "Perfect. Thank you again."},
    ]


def call_summarize_api(payload: dict) -> dict:
    req = urllib.request.Request(
        ROOM_AGENT_SUMMARIZE_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        raw = resp.read().decode("utf-8")
        if resp.status != 200:
            raise RuntimeError(f"Summarize API failed with status {resp.status}: {raw[:500]}")
    return json.loads(raw)


def run_quality_checks(summary: dict) -> dict[str, bool]:
    prescription_draft = summary.get("prescriptionDraft") or {}
    checks = {
        "clinical_snapshot_present": len(summary.get("clinicalSnapshot", [])) >= 4,
        "doctor_actions_present": len(summary.get("doctorActions", [])) >= 3,
        "prescriptions_present": len(summary.get("prescriptions", [])) >= 2,
        "diagnosis_present": len(prescription_draft.get("diagnoses", [])) >= 1,
        "draft_medications_present": len(prescription_draft.get("medications", [])) >= 2,
        "advice_present": len(prescription_draft.get("advice", [])) >= 2,
        "warnings_present": len(prescription_draft.get("warnings", [])) >= 1,
        "follow_up_present": bool((prescription_draft.get("followUp") or {}).get("timeline")),
        "issues_paragraph_present": bool((summary.get("issuesParagraph") or "").strip()),
        "actions_paragraph_present": bool((summary.get("actionsParagraph") or "").strip()),
    }
    return checks


def main() -> None:
    dialogue = build_dialogue()
    payload = {
        "dialogue": dialogue,
        "medical_history": {
            "conditions": ["Recurrent gastritis", "Stage 1 hypertension"],
            "allergies": ["No known drug allergy"],
            "medications": [
                {"name": "Telmisartan", "dosage": "40mg", "frequency": "once daily"}
            ],
        },
    }

    summary = call_summarize_api(payload)
    checks = run_quality_checks(summary)

    print("=== 10-minute consultation summary test ===")
    print("turns:", len(dialogue))
    print("status: success")
    print("checks:")
    for key, value in checks.items():
        print(f"- {key}: {'PASS' if value else 'FAIL'}")

    print("\nextracted prescriptions:")
    print(json.dumps(summary.get("prescriptions", []), indent=2))

    print("\nextracted diagnoses:")
    print(json.dumps((summary.get("prescriptionDraft") or {}).get("diagnoses", []), indent=2))

    print("\nactions paragraph:")
    print(summary.get("actionsParagraph", ""))


if __name__ == "__main__":
    main()
