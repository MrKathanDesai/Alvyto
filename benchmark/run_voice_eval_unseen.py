import argparse
import json
import os
import random
import subprocess
import tempfile
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import numpy as np
import requests
import websockets


BASE_URL = os.getenv("ROOM_AGENT_URL", "http://127.0.0.1:8000")
BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8080")
ROOM_ID = os.getenv("ROOM_AGENT_TEST_ROOM_ID")
ROOM_PIN = os.getenv("ROOM_AGENT_TEST_ROOM_PIN", "1234")

ROOT_DIR = Path(__file__).resolve().parents[1]
RECORDINGS_DIR = ROOT_DIR / "room-agent" / "recordings"
OUTPUT_DIR = ROOT_DIR / "benchmark" / "outputs"

SAMPLE_RATE = 16000
FRAME_SIZE = 16000


@dataclass
class DialogueTurn:
    speaker: str
    text: str


def _normalize_text(text: str) -> str:
    return " ".join("".join(ch.lower() if ch.isalnum() or ch.isspace() else " " for ch in text).split())


def _similarity(a: str, b: str) -> float:
    na = _normalize_text(a)
    nb = _normalize_text(b)
    if not na and not nb:
        return 1.0
    if not na or not nb:
        return 0.0
    return SequenceMatcher(None, na, nb).ratio()


def _get_room_token() -> str:
    token = os.getenv("ROOM_AGENT_TOKEN")
    if token:
        return token

    if not ROOM_ID:
        raise RuntimeError(
            "No auth token available. Set ROOM_AGENT_TOKEN, or set ROOM_AGENT_TEST_ROOM_ID (+ optional ROOM_AGENT_TEST_ROOM_PIN)."
        )

    resp = requests.post(
        f"{BACKEND_URL}/api/auth/login",
        json={"mode": "room", "room_id": ROOM_ID, "pin": ROOM_PIN},
        timeout=15,
    )
    resp.raise_for_status()
    payload = resp.json()
    token = payload.get("access_token") or payload.get("token")
    if not token:
        raise RuntimeError("Room login succeeded but no token was returned")
    return str(token)


def _wait_for_health(token: str, timeout_s: int = 120) -> None:
    start = time.time()
    while time.time() - start <= timeout_s:
        try:
            resp = requests.get(
                f"{BASE_URL}/health",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5,
            )
            if resp.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError(f"Room agent did not become healthy within {timeout_s}s")


def _generate_unseen_dialogue(case_index: int) -> list[DialogueTurn]:
    patient_names = ["Riya Nair", "Aman Verma", "Kritika Desai", "Neel Joshi"]
    dentists = ["Dr. Meera Sethi", "Dr. Arjun Bhat", "Dr. Kavita Rao"]
    painful_teeth = ["lower right back tooth", "upper left molar", "lower left wisdom area"]
    triggers = ["cold water", "hot tea", "chewing on that side", "sweet foods"]
    intensities = ["seven out of ten", "eight out of ten", "nine out of ten"]
    duration = ["for five days", "for one week", "for ten days"]
    analgesics = ["ibuprofen four hundred", "paracetamol six fifty", "mefenamic acid"]
    nonce = uuid.uuid4().hex[:10]

    rnd = random.Random()
    patient = rnd.choice(patient_names)
    dentist = rnd.choice(dentists)
    painful_tooth = rnd.choice(painful_teeth)
    trigger_primary = rnd.choice(triggers)
    trigger_secondary = rnd.choice([t for t in triggers if t != trigger_primary])
    pain_score = rnd.choice(intensities)
    pain_duration = rnd.choice(duration)
    prior_med = rnd.choice(analgesics)

    # Long dental consultation with explicit edge cases, medications, negatives, and after-care.
    script = [
        DialogueTurn("Doctor", f"Good morning {patient}, I am {dentist}, your dentist today. What is bothering you?"),
        DialogueTurn("Patient", f"Since {pain_duration} I have severe pain in my {painful_tooth}."),
        DialogueTurn("Doctor", "When did it start exactly and has it been constant or on and off?"),
        DialogueTurn("Patient", f"It started gradually and became worse over the last two nights. Pain is about {pain_score} now."),
        DialogueTurn("Doctor", f"Does pain increase with {trigger_primary} or {trigger_secondary}?"),
        DialogueTurn("Patient", f"Yes, both make it worse, and chewing on that side is very difficult."),
        DialogueTurn("Doctor", "Do you also get spontaneous throbbing pain that wakes you at night?"),
        DialogueTurn("Patient", "Yes, especially after midnight. I had to wake up and rinse with warm water."),
        DialogueTurn("Doctor", "Any swelling on face, fever, bad taste, or pus discharge near the tooth?"),
        DialogueTurn("Patient", "There is mild gum swelling and a bad taste, but no fever."),
        DialogueTurn("Doctor", "Any difficulty opening mouth or swallowing?"),
        DialogueTurn("Patient", "Mouth opening is slightly painful but I can swallow normally."),
        DialogueTurn("Doctor", "Have you taken any medicine yourself for this pain?"),
        DialogueTurn("Patient", f"I took {prior_med} twice yesterday and one dose this morning. Relief lasted only two to three hours."),
        DialogueTurn("Doctor", "Any known allergy to antibiotics, pain medicines, or local anesthesia injections?"),
        DialogueTurn("Patient", "No known drug allergy. I have had dental injection before without reaction."),
        DialogueTurn("Doctor", "Are you pregnant, breastfeeding, diabetic, or on blood thinner medications?"),
        DialogueTurn("Patient", "Not pregnant, not breastfeeding, no diabetes, and no blood thinners."),
        DialogueTurn("Doctor", "Do you have history of acidity, kidney issues, asthma, or ulcers?"),
        DialogueTurn("Patient", "I have occasional acidity, no kidney disease, no asthma, and no ulcers."),
        DialogueTurn("Doctor", "I will examine now. Please open your mouth wide."),
        DialogueTurn("Doctor", "I can see deep decay on the lower right first molar, tenderness on tapping, and gum inflammation around it."),
        DialogueTurn("Doctor", "There is no large facial cellulitis, but this tooth is likely acutely infected pulp with apical inflammation."),
        DialogueTurn("Patient", "Is this a root canal case, or will the tooth need removal?"),
        DialogueTurn("Doctor", "Most likely root canal treatment can save the tooth if the remaining structure is strong."),
        DialogueTurn("Doctor", "I recommend an intraoral periapical X-ray today to check root and surrounding bone."),
        DialogueTurn("Patient", "Okay, please do the X-ray."),
        DialogueTurn("Doctor", "X-ray confirms deep caries reaching pulp and widening near root tip. Tooth is restorable."),
        DialogueTurn("Doctor", "Plan is: first emergency pain relief and drainage from canal, then complete root canal in two to three sittings."),
        DialogueTurn("Patient", "Can we start treatment today? I have an important meeting tomorrow."),
        DialogueTurn("Doctor", "Yes, we can start today with local anesthesia, open access, cleaning, and temporary dressing."),
        DialogueTurn("Doctor", "For medicines: Amoxicillin clavulanate six hundred twenty five milligram three times daily after food for five days."),
        DialogueTurn("Doctor", "If penicillin intolerance develops, stop and call us immediately."),
        DialogueTurn("Doctor", "For pain: Ibuprofen plus paracetamol combination every eight hours only as needed, maximum three doses per day."),
        DialogueTurn("Doctor", "Because you have acidity, take Pantoprazole forty milligram once daily before breakfast for five days."),
        DialogueTurn("Patient", "Should I avoid chewing completely on that side?"),
        DialogueTurn("Doctor", "Yes, avoid chewing on the treated side for forty eight hours and avoid very hot, very cold, and sticky food."),
        DialogueTurn("Doctor", "Maintain oral hygiene: soft brushing, gentle flossing, and warm saline rinse three to four times daily."),
        DialogueTurn("Patient", "Any warning signs where I should come back urgently?"),
        DialogueTurn("Doctor", "Yes. Return urgently for increasing facial swelling, fever above one hundred point four Fahrenheit, trouble swallowing, or reduced mouth opening."),
        DialogueTurn("Doctor", "Also return if pain is worsening after twenty four hours despite medicines."),
        DialogueTurn("Patient", "Understood. Please repeat follow-up timing."),
        DialogueTurn("Doctor", f"Follow-up in forty eight hours for reassessment and second root canal sitting. Your run marker is dental {nonce}."),
        DialogueTurn("Patient", f"Got it. I will come in two days. Marker noted as dental {nonce}."),
    ]
    return script


def _tts_turn(text: str, voice: str) -> np.ndarray:
    with tempfile.TemporaryDirectory() as tmpdir:
        aiff_path = os.path.join(tmpdir, "sample.aiff")
        raw_path = os.path.join(tmpdir, "sample.raw")

        subprocess.run(["say", "-v", voice, "-o", aiff_path, text], check=True)
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                aiff_path,
                "-ac",
                "1",
                "-ar",
                str(SAMPLE_RATE),
                "-f",
                "f32le",
                raw_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return np.fromfile(raw_path, dtype=np.float32)


def _dialogue_to_audio(dialogue: list[DialogueTurn]) -> np.ndarray:
    chunks: list[np.ndarray] = []
    for turn in dialogue:
        voice = "Samantha" if turn.speaker == "Doctor" else "Daniel"
        chunk = _tts_turn(turn.text, voice)
        if len(chunk) > 0:
            chunks.append(chunk)
            chunks.append(np.zeros(int(0.28 * SAMPLE_RATE), dtype=np.float32))
    if not chunks:
        return np.array([], dtype=np.float32)
    return np.concatenate(chunks).astype(np.float32)


async def _run_ws_pipeline(token: str, session_id: str, audio: np.ndarray, visit_id: str | None = None) -> dict[str, Any]:
    ws_url = f"{BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://')}/ws/transcribe?token={token}&session_id={session_id}"
    if visit_id:
        ws_url += f"&visit_id={visit_id}"
    async with websockets.connect(ws_url, max_size=2**22) as ws:
        first = json.loads(await ws.recv())
        if first.get("type") != "session_start":
            raise RuntimeError(f"Unexpected first WS event: {first}")

        for start in range(0, len(audio), FRAME_SIZE):
            await ws.send(audio[start: start + FRAME_SIZE].tobytes())

        stop_payload: dict[str, Any] = {
            "type": "stop_recording",
            "doctor_name": "Doctor",
            "patient_name": "Patient",
        }
        if visit_id:
            stop_payload["visit_id"] = visit_id
        await ws.send(json.dumps(stop_payload))

        for _ in range(240):
            msg = json.loads(await ws.recv())
            if msg.get("type") == "pipeline_complete":
                break
        else:
            raise RuntimeError("Timed out waiting for pipeline_complete")

    for _ in range(240):
        status_resp = requests.get(
            f"{BASE_URL}/session/{session_id}/status",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        status_resp.raise_for_status()
        payload = status_resp.json()
        if payload.get("status") == "completed":
            return payload
        time.sleep(1)

    raise RuntimeError("Timed out waiting for completed session status")


def _summarize_dialogue(token: str, dialogue: list[dict[str, Any]]) -> dict[str, Any]:
    resp = requests.post(
        f"{BASE_URL}/summarize",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"dialogue": dialogue, "medical_history": {}},
        timeout=300,
    )
    resp.raise_for_status()
    return resp.json()


def _approve_visit(token: str, visit_id: str, summary: dict[str, Any]) -> dict[str, Any]:
    resp = requests.patch(
        f"{BACKEND_URL}/api/visits/{visit_id}/approve",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"summary": summary},
        timeout=60,
    )
    if resp.status_code >= 400:
        raise RuntimeError(f"Approve failed {resp.status_code}: {resp.text[:1200]}")
    return resp.json()


def _summary_for_approval(summary: dict[str, Any], dialogue: list[dict[str, Any]]) -> dict[str, Any]:
    prepared = dict(summary or {})

    snapshot = prepared.get("clinicalSnapshot") or []
    if not isinstance(snapshot, list):
        snapshot = []
    prepared["clinicalSnapshot"] = snapshot

    chief = str(prepared.get("chiefComplaint") or "").strip()
    if not chief:
        for item in snapshot:
            if isinstance(item, dict) and str(item.get("label") or "").strip():
                chief = str(item.get("label")).strip()
                break
    if not chief and dialogue:
        for turn in dialogue:
            if str(turn.get("speaker") or "").lower() == "patient":
                text = str(turn.get("text") or "").strip()
                if text:
                    chief = text[:120]
                    break
    prepared["chiefComplaint"] = chief

    raw_actions = prepared.get("doctorActions") or []
    normalized_actions: list[dict[str, Any]] = []
    if isinstance(raw_actions, list):
        for i, action in enumerate(raw_actions):
            if isinstance(action, dict):
                text = str(action.get("text") or "").strip()
                if not text:
                    continue
                normalized_actions.append(
                    {
                        "id": str(action.get("id") or f"auto-action-{i+1}"),
                        "text": text,
                        "sourceFactIds": action.get("sourceFactIds") or [],
                        "isEdited": bool(action.get("isEdited") or False),
                    }
                )
            elif isinstance(action, str) and action.strip():
                normalized_actions.append(
                    {
                        "id": f"auto-action-{i+1}",
                        "text": action.strip(),
                        "sourceFactIds": [],
                        "isEdited": False,
                    }
                )
    prepared["doctorActions"] = normalized_actions

    prescriptions = prepared.get("prescriptions") or []
    if not isinstance(prescriptions, list):
        prescriptions = []
    if len(prescriptions) == 0:
        draft = prepared.get("prescriptionDraft") or {}
        meds = draft.get("medications") if isinstance(draft, dict) else []
        if isinstance(meds, list):
            for med in meds:
                if not isinstance(med, dict):
                    continue
                name = str(med.get("name") or "").strip()
                if not name:
                    continue
                prescriptions.append(
                    {
                        "name": name,
                        "dosage": med.get("dosage"),
                        "frequency": med.get("frequency"),
                        "isSupported": True,
                    }
                )
    prepared["prescriptions"] = prescriptions

    return prepared


def _render_script(dialogue: list[DialogueTurn]) -> str:
    return "\n".join(f"{turn.speaker}: {turn.text}" for turn in dialogue)


def _render_script_plain(dialogue: list[DialogueTurn]) -> str:
    return " ".join(turn.text for turn in dialogue)


def _write_txt_report(results: list[dict[str, Any]], output_path: Path) -> None:
    lines: list[str] = []
    lines.append("Alvyto Voice Transcription + Summary Evaluation")
    lines.append(f"Generated at: {datetime.now().isoformat(timespec='seconds')}")
    lines.append("")

    for i, item in enumerate(results, start=1):
        lines.append(f"=== Case {i}: {item['case_id']} ===")
        lines.append(f"session_id: {item['session_id']}")
        lines.append(f"recording_path: {item['recording_path']}")
        lines.append(f"recording_file_exists_after_pipeline: {item['recording_exists_after']}")
        lines.append(f"transcription_similarity_vs_script: {item['transcript_similarity']:.3f}")
        if item.get("visit_id"):
            lines.append(f"visit_id: {item['visit_id']}")
        if item.get("approval_result"):
            lines.append(f"approval_result: {json.dumps(item['approval_result'])}")
        lines.append("")
        lines.append("[Generated Script]")
        lines.append(item["script_text"])
        lines.append("")
        lines.append("[Transcription]")
        lines.append(item["transcript"])
        lines.append("")
        lines.append("[Summary JSON]")
        lines.append(json.dumps(item["summary"], indent=2))
        lines.append("")

        lines.append("[Storage Checks]")
        lines.append("- /ws/transcribe persists raw float32 audio to room-agent/recordings during capture")
        lines.append("- on stop_recording, room-agent runs ASR pipeline and stores final data in completed_sessions memory")
        lines.append("- persistent raw file is removed after processing (if cleanup succeeds)")
        lines.append("- transcript+dialogue are sent to backend /api/visits/{visit_id}/progress when visit_id is provided")
        lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")


async def _run(cases: int, visit_id: str | None = None, approve_visit: bool = False) -> Path:
    token = _get_room_token()
    _wait_for_health(token)

    results: list[dict[str, Any]] = []
    for idx in range(cases):
        case_id = f"unseen-{idx + 1}"
        session_id = f"voice-eval-{int(time.time())}-{idx}-{uuid.uuid4().hex[:6]}"
        dialogue = _generate_unseen_dialogue(idx)
        audio = _dialogue_to_audio(dialogue)

        if len(audio) == 0:
            raise RuntimeError(f"Generated empty audio for case {case_id}")

        status_payload = await _run_ws_pipeline(token, session_id, audio, visit_id=visit_id)
        data = status_payload.get("data") or {}
        transcript = str(data.get("transcript") or "")
        dialogue_for_summary = data.get("dialogue") or []
        summary = _summarize_dialogue(token, dialogue_for_summary)
        approval_result: dict[str, Any] | None = None
        if approve_visit and visit_id:
            approval_summary = _summary_for_approval(summary, dialogue_for_summary)
            approval_result = _approve_visit(token, visit_id, approval_summary)

        script_text = _render_script(dialogue)
        script_plain_text = _render_script_plain(dialogue)
        similarity = _similarity(script_plain_text, transcript)
        recording_path = RECORDINGS_DIR / f"alvyto_audio_{session_id}.raw"

        results.append(
            {
                "case_id": case_id,
                "session_id": session_id,
                "recording_path": str(recording_path),
                "recording_exists_after": recording_path.exists(),
                "script_text": script_text,
                "transcript": transcript,
                "summary": summary,
                "transcript_similarity": similarity,
                "visit_id": visit_id,
                "approval_result": approval_result,
            }
        )

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_path = OUTPUT_DIR / f"voice_eval_report_{stamp}.txt"
    _write_txt_report(results, output_path)
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run unseen voice transcription+summary eval and save TXT report")
    parser.add_argument("--cases", type=int, default=2, help="Number of generated unseen cases")
    parser.add_argument("--visit-id", type=str, default=None, help="Optional backend visit_id to persist into")
    parser.add_argument("--approve-visit", action="store_true", help="Approve the linked visit after summary generation")
    args = parser.parse_args()

    if args.cases < 1:
        raise SystemExit("--cases must be >= 1")

    report_path = __import__("asyncio").run(_run(args.cases, visit_id=args.visit_id, approve_visit=args.approve_visit))
    print(f"Voice eval complete. TXT report: {report_path}")


if __name__ == "__main__":
    main()
