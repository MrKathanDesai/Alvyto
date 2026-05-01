import unittest
import json

from summarizer import Summarizer


TRANSCRIPT = """Doctor: Good afternoon, Mr. Rakesh Shah. I am Dr. Nidhi Trivedi. Please have a seat. How are you feeling today?
Patient: Good afternoon, doctor. Umm, honestly not very good. Since about two weeks I have this burning in my stomach after meals, and in the last four days it has become much worse.
Doctor: Alright, I hear you. Burning after meals for two weeks, worse in the last four days. Can you point to exactly where you feel it?
Patient: Mostly here, in the upper middle part, just below the chest. Sometimes it comes up into my throat, like sour water.
Doctor: So upper abdominal burning with sour reflux. Does it happen after specific foods, like spicy, oily, tea, coffee?
Patient: Yes, yes, especially after spicy dinner and tea. I take three, sometimes four cups of tea in office.
Doctor: Okay. Any nausea, vomiting, black stool, blood in stool, or weight loss recently?
Patient: No vomiting, no blood, no black stool. Weight maybe one kilo down, but appetite is there.
Doctor: Any fever, chest pain while walking, or breathlessness?
Patient: No fever. No breathlessness. Chest pain only this burning type, mostly after food or when lying down.
Doctor: Got it. Does the pain wake you at night?
Patient: Yes, around midnight I wake up with burning, then I sit up and drink water.
Doctor: How often in a week does that happen?
Patient: At least four nights this week.
Doctor: Understood. What have you taken so far for relief?
Patient: I took over-the-counter antacid gel, and one tablet from chemist, I think pantoprazole forty, but not regularly.
Doctor: Okay, irregular pantoprazole use. Any painkiller use, like ibuprofen, diclofenac, aspirin?
Patient: I take ibuprofen maybe two or three times a week for knee pain.
Doctor: That can irritate the stomach. Do you smoke or drink alcohol?
Patient: I do not smoke. I drink socially, maybe two pegs on weekends.
Doctor: Thanks. Tell me about your meal timings.
Patient: Breakfast is late, around ten-thirty. Lunch around three. Dinner very late, like ten-thirty or eleven because of work.
Doctor: And right after dinner, do you lie down quickly?
Patient: Yes doctor, usually within twenty minutes because I am tired.
Doctor: Alright. Any previous history of ulcer, gastritis, or H. pylori treatment?
Patient: About five years back I had gastritis episode, but no endoscopy done. It settled with medicines.
Doctor: Any diabetes, blood pressure, thyroid, heart disease?
Patient: I have borderline blood pressure, taking telmisartan forty daily. No diabetes as far as I know.
Doctor: Any known medicine allergy?
Patient: No known drug allergy.
Doctor: Okay, let me quickly examine you. Please lie down on the couch.
Doctor: Your blood pressure is one thirty six over eighty six, pulse eighty, oxygen ninety nine, temperature normal. Mild tenderness in epigastric region, no guarding, no rigidity.
Doctor: At present this pattern is more consistent with acid peptic disease and reflux, not typical cardiac pain.
Doctor: I will prescribe Pantoprazole forty milligram once daily, empty stomach, thirty minutes before breakfast, for six weeks.
Doctor: Along with that, take Domperidone ten milligram twice daily, fifteen minutes before lunch and dinner, for ten days.
Doctor: For breakthrough burning, keep Liquid Antacid fifteen milliliter after meals and at bedtime as needed, maximum four doses in a day.
Doctor: Try to avoid ibuprofen for now. Use Paracetamol six hundred fifty milligram only if needed, after food, not more than three tablets in twenty four hours.
Doctor: Now regarding tests. Since this is recurrent and night symptoms are present, I will order baseline CBC, liver function test, amylase, and stool occult blood. Also H. pylori stool antigen.
Doctor: Warning signs I want you to remember: black stools, vomiting blood, severe continuous abdominal pain, chest pain with sweating, repeated vomiting, or fainting. If any of these occur, go to emergency immediately.
Doctor: Good. Follow-up after ten days with test reports, earlier if worsening."""


BASE_SUMMARY = {
    "clinicalSnapshot": [],
    "doctorActions": [
        {"id": "a1", "text": "Avoid ibuprofen for now", "sourceFactIds": [], "isEdited": False},
        {"id": "a2", "text": "Follow-up after ten days with test reports", "sourceFactIds": [], "isEdited": False},
    ],
    "prescriptions": [],
    "prescriptionDraft": {
        "diagnoses": ["acid peptic disease", "reflux"],
        "medications": [
            {
                "name": "Pantoprazole",
                "dosage": "40 milligram",
                "frequency": "once daily",
                "duration": "six weeks",
                "route": "oral",
                "instructions": "empty stomach thirty minutes before breakfast",
            },
            {
                "name": "Domperidone",
                "dosage": "10 milligram",
                "frequency": "twice daily",
                "duration": "ten days",
                "route": "oral",
                "instructions": "fifteen minutes before lunch and dinner",
            },
            {
                "name": "Liquid Antacid",
                "dosage": "15 milliliter",
                "frequency": "as needed",
                "duration": None,
                "route": "oral",
                "instructions": "after meals and at bedtime maximum four doses in a day",
            },
            {
                "name": "Paracetamol",
                "dosage": "650 milligram",
                "frequency": "only if needed",
                "duration": None,
                "route": "oral",
                "instructions": "after food not more than three tablets in twenty four hours",
            },
        ],
        "investigations": [
            {"name": "CBC", "details": "baseline", "timing": None},
            {"name": "stool occult blood", "details": None, "timing": None},
            {"name": "H. pylori stool antigen", "details": None, "timing": None},
        ],
        "advice": [
            "Try to avoid ibuprofen for now",
            "Do not lie down for at least two to three hours after dinner",
        ],
        "warnings": [
            "black stools",
            "vomiting blood",
            "chest pain with sweating",
        ],
        "reportSummary": "",
        "followUp": {"timeline": "ten days", "notes": "with test reports, earlier if worsening"},
    },
    "issuesParagraph": "",
    "actionsParagraph": "",
    "chiefComplaint": "burning in my stomach after meals",
}


class SummarizerStructuredExtractionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.summarizer = Summarizer()

    def test_enrichment_captures_sections_and_fact_coverage(self) -> None:
        enriched = self.summarizer._enrich_summary(dict(BASE_SUMMARY), TRANSCRIPT)
        sections = enriched["sections"]
        quality = enriched["quality"]
        source_facts = enriched["sourceFacts"]
        negative_findings = [item.lower() for item in sections["negativeFindings"]]
        risk_factors = [item.lower() for item in sections["riskFactors"]]
        medication_history = [item.lower() for item in sections["medicationHistory"]]
        vitals = [item.lower() for item in sections["vitals"]]
        examination = [item.lower() for item in sections["examination"]]
        medications = [item.lower() for item in sections["medications"]]
        investigations = [item.lower() for item in sections["investigations"]]
        warnings = [item.lower() for item in sections["warnings"]]
        follow_up = [item.lower() for item in sections["followUp"]]

        self.assertGreaterEqual(len(source_facts), 20)
        self.assertTrue(any("no vomiting" in item for item in negative_findings))
        self.assertTrue(any("late" in item for item in risk_factors))
        self.assertTrue(any("ibuprofen" in item for item in medication_history))
        self.assertTrue(any("blood pressure" in item for item in vitals))
        self.assertTrue(any("epigastric" in item or "tenderness" in item for item in examination))
        self.assertTrue(any("pantoprazole" in item for item in medications))
        self.assertTrue(any("cbc" in item for item in investigations))
        self.assertTrue(any("black stools" in item for item in warnings))
        self.assertTrue(any("ten days" in item for item in follow_up))
        self.assertGreaterEqual(quality["coverage"], 0.8)
        self.assertIn("sourceFactCount", quality)

    def test_format_for_frontend_preserves_traceability(self) -> None:
        enriched = self.summarizer._enrich_summary(dict(BASE_SUMMARY), TRANSCRIPT)
        formatted = self.summarizer._format_for_frontend(enriched)

        self.assertIn("sourceFacts", formatted)
        self.assertIn("sections", formatted)
        self.assertIn("quality", formatted)
        self.assertIn("structuredFindings", formatted)
        self.assertTrue(len(formatted["structuredFindings"]) > 0)
        self.assertTrue(all("sourceFactIds" in item for item in formatted["doctorActions"]))

    def test_parse_main_response_drops_snapshot_medication_category(self) -> None:
        raw = json.dumps(
            {
                "clinicalSnapshot": [
                    {"label": "headache", "category": "symptom"},
                    {"label": "pantoprazole", "category": "medication"},
                ],
                "doctorActions": ["Take medicine after food"],
                "prescriptions": [{"name": "Pantoprazole", "dosage": "40 mg", "frequency": "once daily"}],
                "issuesParagraph": "Patient has headache.",
                "actionsParagraph": "Doctor advised medicine.",
                "chiefComplaint": "headache",
            }
        )

        parsed = self.summarizer._parse_main_response(raw, transcript=TRANSCRIPT)
        categories = [item.get("category") for item in parsed.get("clinicalSnapshot", []) if isinstance(item, dict)]
        self.assertNotIn("medication", categories)

    def test_fallback_summary_has_non_empty_paragraphs(self) -> None:
        fallback = self.summarizer._fallback_summary_from_transcript(TRANSCRIPT)
        self.assertTrue(str(fallback.get("issuesParagraph") or "").strip())
        self.assertTrue(str(fallback.get("actionsParagraph") or "").strip())

    def test_regex_medication_extraction_keeps_sig_details(self) -> None:
        meds = self.summarizer._extract_medications_from_transcript(TRANSCRIPT)
        by_name = {item["name"]: item for item in meds}

        self.assertIn("Liquid Antacid", by_name)
        self.assertEqual(by_name["Pantoprazole"]["duration"], "six weeks")
        self.assertIn("before breakfast", by_name["Pantoprazole"]["instructions"] or "")
        self.assertEqual(by_name["Domperidone"]["duration"], "ten days")
        self.assertIn("before lunch and dinner", by_name["Domperidone"]["instructions"] or "")
        self.assertEqual(by_name["Liquid Antacid"]["frequency"], "as needed")
        self.assertIn("after meals and at bedtime", by_name["Liquid Antacid"]["instructions"] or "")
        self.assertIn("maximum four doses", by_name["Liquid Antacid"]["instructions"] or "")
        self.assertEqual(by_name["Paracetamol"]["frequency"], "only if needed")
        self.assertIn("not more than three tablets", by_name["Paracetamol"]["instructions"] or "")

    def test_generic_medication_parser_handles_representative_edge_cases(self) -> None:
        cases = [
            (
                "Doctor: Use salbutamol inhaler 2 puffs every 6 hours as needed for wheezing.",
                {
                    "name": "Salbutamol Inhaler",
                    "dosage": "2 puffs",
                    "frequency": "every 6 hours",
                    "route": "inhalation",
                    "instruction_contains": ["wheezing", "as needed"],
                    "timing": {"interval": "every 6 hours", "prn": True, "prnIndication": "wheezing"},
                },
            ),
            (
                "Doctor: Apply clotrimazole cream twice daily for 2 weeks on the affected area.",
                {
                    "name": "Clotrimazole Cream",
                    "dosage": None,
                    "frequency": "twice daily",
                    "duration": "2 weeks",
                    "route": "topical",
                    "instruction_contains": ["affected area"],
                },
            ),
            (
                "Doctor: Instill moxifloxacin eye drops 1 drop four times a day for 5 days.",
                {
                    "name": "Moxifloxacin Eye Drops",
                    "dosage": "1 drop",
                    "frequency": "four times a day",
                    "duration": "5 days",
                    "route": "ophthalmic",
                },
            ),
            (
                "Doctor: Take vitamin d3 60000 units once weekly for 8 weeks.",
                {
                    "name": "Vitamin D3",
                    "dosage": "60000 units",
                    "frequency": "once weekly",
                    "duration": "8 weeks",
                },
            ),
            (
                "Doctor: Start prednisolone 40 mg once daily for 5 days, then 20 mg once daily for 5 days.",
                {
                    "name": "Prednisolone",
                    "dosage": "40 mg",
                    "frequency": "once daily",
                    "duration": "5 days",
                    "instruction_contains": ["then 20 mg once daily for 5 days"],
                    "timing": {"taperInstructions": "then 20 mg once daily for 5 days"},
                },
            ),
            (
                "Doctor: Continue telmisartan 40 mg daily.",
                {
                    "name": "Telmisartan",
                    "dosage": "40 mg",
                    "frequency": "daily",
                },
            ),
        ]

        for line, expected in cases:
            with self.subTest(line=line):
                meds = self.summarizer._extract_medications_from_transcript(line)
                self.assertEqual(len(meds), 1)
                med = meds[0]
                self.assertEqual(med["name"], expected["name"])
                self.assertEqual(med.get("dosage"), expected.get("dosage"))
                self.assertEqual(med.get("frequency"), expected.get("frequency"))
                if "duration" in expected:
                    self.assertEqual(med.get("duration"), expected.get("duration"))
                if "route" in expected:
                    self.assertEqual(med.get("route"), expected.get("route"))
                timing = med.get("timingDetails") or {}
                for key, value in expected.get("timing", {}).items():
                    self.assertEqual(timing.get(key), value)
                for fragment in expected.get("instruction_contains", []):
                    self.assertIn(fragment, (med.get("instructions") or "").lower())

    def test_medication_parser_ignores_history_and_question_lines(self) -> None:
        transcript = "\n".join([
            "Doctor: Okay, irregular pantoprazole use. Any painkiller use like ibuprofen, diclofenac, aspirin?",
            "Patient: I took antacid gel and one tablet from chemist, I think pantoprazole 40, but not regularly.",
        ])

        meds = self.summarizer._extract_medications_from_transcript(transcript)
        self.assertEqual(meds, [])

    def test_noisy_transcript_recovery_recovers_meds_and_doctor_notes(self) -> None:
        noisy_transcript = """Doctor: I will prescribe pantoprazal 40 milligrams once daily, empty stomach, 30 minutes before breakfast for six weeks.
Doctor: along with that take down for a down 10 milligrams twice daily 15 minutes before lunch and dinner for 10 days.
Doctor: for breakthrough burning keep liquid antacid 15 milliliters after meals and at bed time as needed maximum four doses a day."""

        meds = self.summarizer._extract_medications_from_transcript(noisy_transcript)
        by_name = {item["name"]: item for item in meds}

        self.assertIn("Pantoprazole", by_name)
        self.assertIn("Domperidone", by_name)
        self.assertIn("Liquid Antacid", by_name)
        self.assertEqual(by_name["Domperidone"]["frequency"], "twice daily")
        self.assertIn("before lunch and dinner", by_name["Domperidone"]["instructions"] or "")

        draft = {
            "diagnoses": [],
            "medications": meds,
            "investigations": [],
            "advice": [],
            "warnings": [],
            "reportSummary": "",
            "followUp": None,
        }
        actions = self.summarizer._build_doctor_actions_from_draft(draft)
        joined = " ".join(actions).lower()
        self.assertTrue(actions)
        self.assertIn("pantoprazole", joined)
        self.assertIn("domperidone", joined)
        self.assertIn("liquid antacid", joined)

    def test_timing_details_cover_meal_bedtime_alternate_day_and_event_patterns(self) -> None:
        cases = [
            (
                "Doctor: Take pantoprazole 40 mg once daily empty stomach 30 minutes before breakfast.",
                {
                    "relationToMeals": ["empty stomach", "before breakfast", "30 minutes before breakfast"],
                    "route": "oral",
                },
            ),
            (
                "Doctor: Take calcium tablet after dinner at bedtime.",
                {
                    "relationToMeals": ["after dinner"],
                    "timeOfDay": ["bedtime"],
                },
            ),
            (
                "Doctor: Continue methotrexate 10 mg every other day.",
                {
                    "alternateDays": True,
                },
            ),
            (
                "Doctor: Take vitamin b12 once weekly every Sunday morning.",
                {
                    "specificDays": ["Sunday"],
                    "timeOfDay": ["morning"],
                },
            ),
            (
                "Doctor: Use salbutamol inhaler 2 puffs before exercise.",
                {
                    "eventTiming": ["before exercise"],
                },
            ),
            (
                "Doctor: Take cetirizine at night only if itching starts, not more than 2 tablets in 24 hours.",
                {
                    "timeOfDay": ["night"],
                    "prn": True,
                    "prnIndication": "itching starts",
                    "maxDose": "not more than 2 tablets in 24 hours",
                },
            ),
            (
                "Doctor: Take levocetirizine half tablet in the morning and one tablet at night.",
                {
                    "timeOfDay": ["morning", "night"],
                    "splitDose": "half tablet in the morning and one tablet at night",
                },
            ),
        ]

        for line, expected in cases:
            with self.subTest(line=line):
                med = self.summarizer._extract_medications_from_transcript(line)[0]
                timing = med.get("timingDetails") or {}
                for key, value in expected.items():
                    observed = timing.get(key) if key != "route" else med.get("route")
                    if isinstance(value, list):
                        self.assertEqual(set(observed or []), set(value))
                    else:
                        self.assertEqual(observed, value)


if __name__ == "__main__":
    unittest.main()
