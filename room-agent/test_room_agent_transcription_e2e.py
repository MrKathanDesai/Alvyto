import asyncio
import json
import os
import subprocess
import tempfile
import unittest

import numpy as np
import requests
import websockets


BASE_URL = os.getenv("ROOM_AGENT_URL", "http://127.0.0.1:8000")
BACKEND_URL = os.getenv("BACKEND_URL", "http://127.0.0.1:8080")
ROOM_ID = os.getenv("ROOM_AGENT_TEST_ROOM_ID")
ROOM_PIN = os.getenv("ROOM_AGENT_TEST_ROOM_PIN", "1234")
_ROOM_TOKEN_CACHE: str | None = None


def _get_room_token() -> str:
    global _ROOM_TOKEN_CACHE
    if _ROOM_TOKEN_CACHE:
        return _ROOM_TOKEN_CACHE

    if not ROOM_ID:
        raise RuntimeError("ROOM_AGENT_TEST_ROOM_ID env var is required for e2e test")
    resp = requests.post(
        f"{BACKEND_URL}/api/auth/login",
        json={"mode": "room", "room_id": ROOM_ID, "pin": ROOM_PIN},
        timeout=10,
    )
    resp.raise_for_status()
    payload = resp.json()
    token = payload.get("access_token") or payload.get("token")
    if not token:
        raise RuntimeError("No room access_token returned from backend auth")
    _ROOM_TOKEN_CACHE = token
    return token


def _sine_chunk(seconds: float = 1.0, hz: float = 220.0, sr: int = 16000) -> np.ndarray:
    t = np.linspace(0, seconds, int(sr * seconds), endpoint=False)
    signal = 0.12 * np.sin(2 * np.pi * hz * t)
    return signal.astype(np.float32)


def _generate_tts_audio(text: str) -> np.ndarray:
    with tempfile.TemporaryDirectory() as tmpdir:
        aiff_path = os.path.join(tmpdir, "sample.aiff")
        wav_path = os.path.join(tmpdir, "sample.wav")
        subprocess.run(["say", "-v", "Samantha", "-o", aiff_path, text], check=True)
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                aiff_path,
                "-ac",
                "1",
                "-ar",
                "16000",
                "-f",
                "f32le",
                wav_path,
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        audio = np.fromfile(wav_path, dtype=np.float32)
        return audio


class RoomAgentTranscriptionE2ETests(unittest.TestCase):
    @unittest.skipUnless(os.getenv("RUN_ROOM_AGENT_E2E") == "1", "Set RUN_ROOM_AGENT_E2E=1 to run live e2e test")
    def test_websocket_audio_pipeline_returns_corrections_field(self) -> None:
        asyncio.run(self._run_websocket_flow(use_tts=False))

    @unittest.skipUnless(
        os.getenv("RUN_ROOM_AGENT_E2E") == "1" and os.system("command -v say >/dev/null 2>&1") == 0 and os.system("command -v ffmpeg >/dev/null 2>&1") == 0,
        "Set RUN_ROOM_AGENT_E2E=1 and ensure say/ffmpeg are available",
    )
    def test_websocket_tts_voice_transcription_medication_correction(self) -> None:
        asyncio.run(self._run_websocket_flow(use_tts=True))

    async def _run_websocket_flow(self, use_tts: bool) -> None:
        token = _get_room_token()
        session_id = "e2e-medical-normalizer-tts" if use_tts else "e2e-medical-normalizer"
        ws_url = f"{BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://')}/ws/transcribe?token={token}&session_id={session_id}"

        # Ensure room-agent is accepting HTTP requests before opening WS.
        for _ in range(60):
            try:
                health = requests.get(
                    f"{BASE_URL}/health",
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=5,
                )
                if health.status_code == 200:
                    break
            except Exception:
                pass
            await asyncio.sleep(1)
        else:
            raise RuntimeError("Room-agent did not become healthy in time")

        if use_tts:
            scripted_text = (
                "Doctor says take down for a down ten milligram twice daily before lunch and dinner for ten days. "
                "Also continue tell me certain forty milligram at night."
            )
            chunk = _generate_tts_audio(scripted_text)
        else:
            chunk = _sine_chunk(seconds=1.2)

        async with websockets.connect(ws_url, max_size=2**22) as ws:
            first = json.loads(await ws.recv())
            self.assertEqual(first.get("type"), "session_start")

            frame_size = 16000
            for start in range(0, len(chunk), frame_size):
                await ws.send(chunk[start: start + frame_size].tobytes())

            await ws.send(
                json.dumps(
                    {
                        "type": "stop_recording",
                        "doctor_name": "Doctor",
                        "patient_name": "Patient",
                    }
                )
            )

            # Wait for pipeline_complete message
            for _ in range(60):
                msg = json.loads(await ws.recv())
                if msg.get("type") == "pipeline_complete":
                    break

        status_resp = requests.get(
            f"{BASE_URL}/session/{session_id}/status",
            headers={"Authorization": f"Bearer {token}"},
            timeout=120,
        )
        status_resp.raise_for_status()
        payload = status_resp.json()
        self.assertEqual(payload.get("status"), "completed")
        data = payload.get("data") or {}
        self.assertIn("transcription_corrections", data)
        self.assertIsInstance(data.get("transcription_corrections"), list)

        if use_tts:
            transcript = str(data.get("transcript") or "").lower()
            corrections = data.get("transcription_corrections") or []
            correction_targets = {str(c.get("to") or "").lower() for c in corrections}
            self.assertTrue(
                ("domperidone" in transcript) or ("domperidone" in correction_targets),
                msg=f"Expected domperidone correction or transcript match. transcript={transcript!r}, corrections={corrections!r}",
            )


if __name__ == "__main__":
    unittest.main()
