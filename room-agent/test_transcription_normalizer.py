import unittest

from transcription_normalizer import build_medical_asr_prompt, correct_medical_terms_in_dialogue


class TranscriptionNormalizerTests(unittest.TestCase):
    def test_prompt_includes_medical_bias_terms(self) -> None:
        prompt = build_medical_asr_prompt().lower()
        self.assertIn("medical", prompt)
        self.assertIn("pantoprazole", prompt)
        self.assertIn("domperidone", prompt)

    def test_alias_replacement_fixes_known_medication_mishear(self) -> None:
        dialogue = [
            {
                "speaker": "Doctor",
                "text": "Along with that take down for a down 10 milligrams twice daily before lunch and dinner.",
            }
        ]

        corrected, corrections = correct_medical_terms_in_dialogue(dialogue)
        self.assertEqual(len(corrected), 1)
        self.assertIn("Domperidone", corrected[0]["text"])
        self.assertTrue(any(c["reason"] == "alias" for c in corrections))

    def test_context_fuzzy_replacement_fixes_unlisted_misspelling(self) -> None:
        dialogue = [
            {
                "speaker": "Doctor",
                "text": "Start pantoprazzole 40 milligram once daily empty stomach before breakfast for six weeks.",
            }
        ]

        corrected, corrections = correct_medical_terms_in_dialogue(dialogue)
        self.assertIn("Pantoprazole", corrected[0]["text"])
        self.assertTrue(any(c["reason"] == "context_fuzzy_medication" for c in corrections))

    def test_context_guard_prevents_over_correction(self) -> None:
        dialogue = [
            {
                "speaker": "Patient",
                "text": "I have burning pain in the upper stomach after meals and at night.",
            }
        ]

        corrected, corrections = correct_medical_terms_in_dialogue(dialogue)
        self.assertEqual(corrected[0]["text"], dialogue[0]["text"])
        self.assertEqual(corrections, [])

    def test_history_aware_medication_correction(self) -> None:
        dialogue = [
            {
                "speaker": "Patient",
                "text": "I was taking rabeprazzole 20 mg once daily before breakfast.",
            }
        ]
        medical_history = {
            "medications": [
                {"name": "Rabeprazole", "dosage": "20mg", "frequency": "once daily"},
            ]
        }

        corrected, corrections = correct_medical_terms_in_dialogue(dialogue, medical_history=medical_history)
        self.assertIn("Rabeprazole", corrected[0]["text"])
        self.assertTrue(corrections)

    def test_multiturn_voice_style_regression(self) -> None:
        dialogue = [
            {"speaker": "Doctor", "text": "I will prescribe pantoprazal 40 milligram once daily."},
            {"speaker": "Doctor", "text": "Also continue tell me certain 40 milligram at night."},
            {"speaker": "Doctor", "text": "No need for indoor spoopy right now."},
        ]

        corrected, corrections = correct_medical_terms_in_dialogue(dialogue)
        joined = " ".join(turn["text"] for turn in corrected)
        self.assertIn("Pantoprazole", joined)
        self.assertIn("Telmisartan", joined)
        self.assertIn("endoscopy", joined.lower())
        self.assertGreaterEqual(len(corrections), 3)


if __name__ == "__main__":
    unittest.main()
