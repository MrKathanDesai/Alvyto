"""
Benchmark: ~10-minute OPD consultation — Cardio-Metabolic new case.
Patient: Meera Pillai, 52 F. Chief complaint: chest tightness on exertion + fatigue + polyuria.
Covers: reason for visit, history, exam findings, differential/impression, medications,
        lifestyle guidelines, investigations, warnings, follow-up.
Natural flow: filler words, pauses, patient interruptions, comprehension checks.
"""
import json
import urllib.request

ROOM_AGENT_SUMMARIZE_URL = "http://localhost:8000/summarize"


def build_dialogue() -> list[dict[str, str]]:
    return [
        # --- Greeting + chief complaint ---
        {"speaker": "Doctor", "text": "Good morning, Mrs. Pillai. I am Dr. Arvind Mehta. Please take a seat and make yourself comfortable. So, what brings you in today?"},
        {"speaker": "Patient", "text": "Good morning doctor. Umm, I have been having this… this tightness in my chest for the last maybe three weeks? It comes mostly when I climb the stairs or walk fast, and then it just goes away when I sit down. Plus I am feeling very tired all the time, which is unusual for me."},
        {"speaker": "Doctor", "text": "Okay. So tightness in the chest on exertion, relieved by rest, and fatigue. Anything else prompting the visit today?"},
        {"speaker": "Patient", "text": "Hmm, yes actually — I have been going to the bathroom very frequently, especially at night. Like four or five times. And I am thirsty a lot. My husband said I should get checked, so… here I am."},
        {"speaker": "Doctor", "text": "Good that you came. Frequent urination, increased thirst — those are important symptoms. Let me take a complete history. How long has the chest tightness been happening?"},
        {"speaker": "Patient", "text": "About three to four weeks, I would say. It never happened before."},
        {"speaker": "Doctor", "text": "How long does an episode last?"},
        {"speaker": "Patient", "text": "Maybe two to three minutes? It goes on its own when I stop and rest. It is not very painful, more like… pressure. A heaviness."},
        {"speaker": "Doctor", "text": "Does the tightness radiate anywhere — to your left arm, jaw, shoulder, or back?"},
        {"speaker": "Patient", "text": "Umm, sometimes I feel a little bit of something in the left shoulder. Not sure if that is related."},
        {"speaker": "Doctor", "text": "That is relevant, yes. Any sweating, dizziness, or nausea during these episodes?"},
        {"speaker": "Patient", "text": "A little sweating once, last week. I thought it was just the heat."},
        {"speaker": "Doctor", "text": "I understand. Any palpitations — like your heart racing or fluttering?"},
        {"speaker": "Patient", "text": "No, not really. Well, once or twice I felt my heart going a bit fast after climbing, but nothing scary."},
        {"speaker": "Doctor", "text": "Okay. And the fatigue — is it present all day or mainly with exertion?"},
        {"speaker": "Patient", "text": "Both, honestly. I wake up tired. Earlier I used to manage cooking and housework no problem, but these days I sit and rest every twenty minutes or so."},
        {"speaker": "Doctor", "text": "Noted. Now the urinary symptoms — you said four to five times at night. How many times in the day?"},
        {"speaker": "Patient", "text": "Oh, during the day also quite a lot. Maybe eight to ten times total. And the quantity is also more than usual."},
        {"speaker": "Doctor", "text": "Any burning or pain when passing urine?"},
        {"speaker": "Patient", "text": "No, no burning. Just frequency and quantity."},
        {"speaker": "Doctor", "text": "Any blurring of vision, any tingling or numbness in hands or feet?"},
        {"speaker": "Patient", "text": "Hmm, actually yes — I have had some blurring when I read in the evenings. I thought it was my reading glasses getting old. And sometimes the feet feel a little tingly at night."},
        {"speaker": "Doctor", "text": "Those are very important, thank you for mentioning. Any recent weight changes?"},
        {"speaker": "Patient", "text": "Actually I lost about four kilos in the last two months without trying. Which surprised me because I have not changed my diet."},
        {"speaker": "Doctor", "text": "Unexplained weight loss — noted. Now your past medical history. Any known illness — blood pressure, thyroid, heart disease, diabetes?"},
        {"speaker": "Patient", "text": "Hmm, I was told a couple of years back that my blood pressure is slightly high. I took tablets for a while, then I stopped because I was feeling fine. No diabetes as far as I know. Thyroid was done once, it was normal."},
        {"speaker": "Doctor", "text": "What was the blood pressure tablet you were taking? Do you remember the name?"},
        {"speaker": "Patient", "text": "Something starting with A — Amlodipine maybe? Five milligram. I stopped it about eight months ago on my own."},
        {"speaker": "Doctor", "text": "Okay. Any surgery or hospitalisation in the past?"},
        {"speaker": "Patient", "text": "C-section, twenty-three years ago. No other surgery."},
        {"speaker": "Doctor", "text": "Family history — anyone with heart disease, diabetes in the family?"},
        {"speaker": "Patient", "text": "Yes, my father had a heart attack at fifty-eight. And my mother has diabetes for twenty years now."},
        {"speaker": "Doctor", "text": "That is significant family history. Any known medicine allergy?"},
        {"speaker": "Patient", "text": "No allergy that I know of."},
        {"speaker": "Doctor", "text": "Do you smoke or drink?"},
        {"speaker": "Patient", "text": "No, never smoked. Occasionally social drinking, maybe once a month."},
        {"speaker": "Doctor", "text": "What does your typical diet look like?"},
        {"speaker": "Patient", "text": "I am vegetarian. I eat rice twice a day usually, and lots of chapati. I like sweets — cannot help it. And definitely too much tea, five or six cups."},
        {"speaker": "Doctor", "text": "How much physical activity do you get?"},
        {"speaker": "Patient", "text": "Umm, very less now honestly. Earlier I used to walk thirty minutes in the morning but I stopped since these chest symptoms started."},
        # --- Examination findings ---
        {"speaker": "Doctor", "text": "Alright. Let me examine you now. Please sit comfortably. Your blood pressure today is one fifty-four over ninety-two. Pulse is eighty-eight, regular. Oxygen saturation ninety-eight percent on room air. Your BMI is approximately twenty-nine point five — that is overweight range."},
        {"speaker": "Patient", "text": "Is the blood pressure very high, doctor?"},
        {"speaker": "Doctor", "text": "It is elevated, yes. Especially because you stopped your medication, and with your current symptoms it needs to be addressed properly. On examination, there is no pedal oedema, lungs are clear, heart sounds are normal. But with your symptoms, the blood pressure, and the family history, I am concerned."},
        {"speaker": "Patient", "text": "Concerned about what exactly? My heart?"},
        # --- Clinical impression ---
        {"speaker": "Doctor", "text": "Let me explain. The chest tightness on exertion with left shoulder referral, the sweating, combined with high blood pressure that was untreated for eight months — this pattern is consistent with angina, which is reduced blood flow to the heart muscle during activity. It is not a heart attack but it is a warning that we must take seriously."},
        {"speaker": "Patient", "text": "Oh. That sounds scary."},
        {"speaker": "Doctor", "text": "I understand, but the good news is that we caught it early and there is a lot we can do. Now, separately, the frequent urination, increased thirst, weight loss, blurred vision, tingling in feet — these symptoms are very typical of undiagnosed diabetes. I strongly suspect you have Type 2 diabetes."},
        {"speaker": "Patient", "text": "Diabetes also? Both?"},
        {"speaker": "Doctor", "text": "That is what we need to confirm with tests. Both conditions often come together and each makes the other worse. But we will manage them systematically, okay?"},
        {"speaker": "Patient", "text": "Okay doctor. Tell me what to do."},
        # --- Investigations ---
        {"speaker": "Doctor", "text": "First, investigations. I am ordering a fasting blood sugar and HbA1c to confirm diabetes and check three-month sugar control. Lipid profile, kidney function tests, urine microalbumin, ECG, and an Echo if the ECG shows anything, and a TMT — that is a treadmill stress test — to evaluate the chest symptoms."},
        {"speaker": "Patient", "text": "So many tests. Can I do fasting tests today?"},
        {"speaker": "Doctor", "text": "If you are fasting since last night, yes, we can do the blood work today. The ECG can be done right now here. TMT we will schedule after we see the ECG and echo reports."},
        {"speaker": "Patient", "text": "I had tea this morning, nothing else."},
        {"speaker": "Doctor", "text": "Tea without sugar counts as borderline. Let us do the tests today — the non-fasting tests at least, and note it on the request form. Come back fasting for HbA1c and lipid profile tomorrow morning."},
        # --- Medications prescribed ---
        {"speaker": "Doctor", "text": "Now, regarding medicines. I am restarting Amlodipine five milligram once daily for blood pressure. Take it in the morning with water."},
        {"speaker": "Patient", "text": "The same tablet I took before. Okay."},
        {"speaker": "Doctor", "text": "I am also adding Telmisartan forty milligram once daily at night, because your pressure is quite high and we need dual control. Please take it after dinner."},
        {"speaker": "Patient", "text": "So two blood pressure tablets?"},
        {"speaker": "Doctor", "text": "Yes, for now. We will review after two weeks. Additionally, I am starting Aspirin seventy-five milligram once daily after breakfast, to protect the heart given the anginal symptoms and family history. Do not take it on empty stomach."},
        {"speaker": "Patient", "text": "After breakfast. Got it."},
        {"speaker": "Doctor", "text": "For the possible angina, I am giving Isosorbide Mononitrate ten milligram twice daily — morning and afternoon, not at night because it can cause headache. This helps widen the blood vessels."},
        {"speaker": "Patient", "text": "And the diabetes? You will give medicine for that also?"},
        {"speaker": "Doctor", "text": "I want to start Metformin five hundred milligram twice daily, with lunch and dinner. It should be taken with food always to avoid stomach upset. This is the safest first-line medicine for Type 2 diabetes. We will increase the dose after seeing the HbA1c report."},
        {"speaker": "Patient", "text": "Metformin, twice, with food. Okay."},
        {"speaker": "Doctor", "text": "I am also adding Atorvastatin twenty milligram once daily at night to manage your cholesterol and reduce cardiovascular risk. We have not checked your lipids yet but given the clinical picture I want to start early."},
        {"speaker": "Patient", "text": "So how many medicines total, doctor?"},
        {"speaker": "Doctor", "text": "Six medicines for now — Amlodipine, Telmisartan, Aspirin, Isosorbide Mononitrate, Metformin, and Atorvastatin. I know it sounds like a lot, but each has a clear reason. We will simplify as things stabilise."},
        # --- Lifestyle guidelines ---
        {"speaker": "Doctor", "text": "Now lifestyle — this is equally important, maybe more so. First, cut down on rice and chapati portions by half. Increase vegetables, dal, salads. Try to limit sweets to once a week, maximum."},
        {"speaker": "Patient", "text": "Sweets once a week only... that will be hard. But okay."},
        {"speaker": "Doctor", "text": "I know it is hard. But with diabetes and blood pressure both, diet control directly reduces how much medication you need. Second — reduce tea to maximum two cups a day, and switch to no-sugar or use a very small amount. No full-fat milk."},
        {"speaker": "Patient", "text": "Two cups. Okay."},
        {"speaker": "Doctor", "text": "Third — walking. I know you stopped because of chest symptoms. For now, start with very slow flat walking, just ten minutes. No stairs, no inclines. If you get chest tightness, stop immediately. Once we have the TMT result and have better control, we will increase activity gradually."},
        {"speaker": "Patient", "text": "Ten minutes slow walking. I can do that."},
        {"speaker": "Doctor", "text": "Fourth — weight management. Even a five percent weight reduction, that is about three kilos for you, significantly improves both blood pressure and blood sugar. Every kilo matters."},
        {"speaker": "Patient", "text": "Okay."},
        {"speaker": "Doctor", "text": "Fifth — stress. I know housework and family responsibilities are there. Try to build in ten minutes of quiet time or slow breathing exercises every day. Stress raises blood pressure acutely."},
        # --- Warning signs ---
        {"speaker": "Doctor", "text": "Now, warning signs. I want you to go to the emergency immediately — do not wait, do not call me first — if you experience chest pain or tightness lasting more than five minutes even at rest, pain spreading to jaw or both arms, sudden breathlessness while lying flat, severe giddiness or fainting, or if you feel your heart beating very fast or irregularly for more than a minute."},
        {"speaker": "Patient", "text": "I will remember that. Should I write it down?"},
        {"speaker": "Doctor", "text": "Yes, please do. I will also write it on your prescription card. These are called red flag symptoms and they need immediate attention."},
        {"speaker": "Patient", "text": "What about the sugar level? If it goes very low?"},
        {"speaker": "Doctor", "text": "Good question. With Metformin alone, low sugar is not common. But if you feel shaky, sweating, confused, or very hungry suddenly, eat two to three glucose tablets or four teaspoons of sugar dissolved in water immediately. Then eat a proper meal."},
        {"speaker": "Patient", "text": "Okay. I will keep sugar tablets at home."},
        # --- Follow-up ---
        {"speaker": "Doctor", "text": "Good. Follow-up plan — come back in two weeks with the fasting blood sugar, HbA1c, lipid profile, kidney function, urine microalbumin, and ECG reports. We will review everything and decide on dose adjustments and whether TMT is needed. If chest symptoms worsen before that, come sooner."},
        {"speaker": "Patient", "text": "Two weeks. With all the reports. Understood. Can I message on the clinic number if I have questions?"},
        {"speaker": "Doctor", "text": "Yes, absolutely. The clinic WhatsApp is available on weekdays nine to six. For anything urgent, use the emergency number I am writing on the card."},
        {"speaker": "Patient", "text": "Thank you so much, doctor. I was nervous coming in but I feel better now that there is a plan."},
        {"speaker": "Doctor", "text": "You did the right thing by coming early. We have caught this at a manageable stage. Follow the medicines and diet strictly, and you will see improvement in two weeks. Take care, Mrs. Pillai."},
        {"speaker": "Patient", "text": "Thank you, doctor. I will see you in two weeks."},
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
            raise RuntimeError(f"API failed {resp.status}: {raw[:500]}")
    return json.loads(raw)


def run_checks(summary: dict) -> dict[str, bool]:
    draft = summary.get("prescriptionDraft") or {}
    meds = draft.get("medications") or []
    rx = summary.get("prescriptions") or []
    return {
        "clinical_snapshot ≥ 4 items":    len(summary.get("clinicalSnapshot", [])) >= 4,
        "doctor_actions ≥ 3 items":       len(summary.get("doctorActions", [])) >= 3,
        "prescriptions ≥ 4 items":        len(rx) >= 4,
        "draft_medications ≥ 4 items":    len(meds) >= 4,
        "diagnoses ≥ 1":                  len(draft.get("diagnoses", [])) >= 1,
        "investigations ≥ 3":             len(draft.get("investigations", [])) >= 3,
        "advice ≥ 3":                     len(draft.get("advice", [])) >= 3,
        "warnings ≥ 1":                   len(draft.get("warnings", [])) >= 1,
        "follow_up present":              bool((draft.get("followUp") or {}).get("timeline")),
        "issues_paragraph present":       bool((summary.get("issuesParagraph") or "").strip()),
        "actions_paragraph present":      bool((summary.get("actionsParagraph") or "").strip()),
    }


def main() -> None:
    dialogue = build_dialogue()
    print(f"Dialogue turns: {len(dialogue)}")
    print(f"Sending to {ROOM_AGENT_SUMMARIZE_URL} …\n")

    payload = {
        "dialogue": dialogue,
        "medical_history": {
            "conditions": ["Hypertension (self-discontinued treatment)"],
            "allergies": [],
            "medications": [],
        },
    }

    summary = call_summarize_api(payload)
    checks = run_checks(summary)

    pass_count = sum(checks.values())
    total = len(checks)

    print("=" * 55)
    print(f"  RESULT: {pass_count}/{total} checks passed")
    print("=" * 55)
    for label, ok in checks.items():
        print(f"  {'✓' if ok else '✗'}  {label}")

    print("\n── Extracted prescriptions ──────────────────────────────")
    rxlist = summary.get("prescriptions", [])
    if rxlist:
        for r in rxlist:
            print(f"  • {r.get('name')}  {r.get('dosage') or ''}  {r.get('frequency') or ''}")
    else:
        print("  (none)")

    draft = summary.get("prescriptionDraft") or {}
    print("\n── Draft medications ────────────────────────────────────")
    for m in (draft.get("medications") or []):
        print(f"  • {m.get('name')}  {m.get('dosage') or ''}  {m.get('frequency') or ''}")

    print("\n── Diagnoses ────────────────────────────────────────────")
    for d in (draft.get("diagnoses") or []):
        print(f"  • {d}")

    print("\n── Investigations ───────────────────────────────────────")
    for i in (draft.get("investigations") or []):
        print(f"  • {i.get('name')}  {i.get('details') or ''}")

    print("\n── Advice ───────────────────────────────────────────────")
    for a in (draft.get("advice") or []):
        print(f"  • {a}")

    print("\n── Warnings ─────────────────────────────────────────────")
    for w in (draft.get("warnings") or []):
        print(f"  • {w}")

    follow_up = draft.get("followUp") or {}
    print(f"\n── Follow-up ─────────────────────────────────────────────")
    print(f"  timeline : {follow_up.get('timeline') or '—'}")
    print(f"  notes    : {follow_up.get('notes') or '—'}")

    print(f"\n── Issues paragraph ──────────────────────────────────────")
    print(f"  {summary.get('issuesParagraph') or '(empty)'}")

    print(f"\n── Actions paragraph ─────────────────────────────────────")
    print(f"  {summary.get('actionsParagraph') or '(empty)'}")


if __name__ == "__main__":
    main()
