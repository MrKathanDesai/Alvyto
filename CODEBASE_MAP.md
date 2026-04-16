# Alvyto Codebase Map

## Overview
- Frontend: Next.js App Router (`src/app`) for room UI and admin console.
- Backend: FastAPI (`backend`) for auth, EMR, queue, rooms, appointments, and visits.
- Room Agent: Whisper-based transcription + summarization service (`room-agent`).
- Persistence: SQLite (`emr.db`) through SQLAlchemy models in `backend/models.py`.

## Top-Level Structure
- `src/` - web app frontend (room workflow + admin workflow).
- `backend/` - FastAPI server, routes, schemas, auth, tests.
- `room-agent/` - ASR pipeline, diarization, summary generation service.
- `benchmark/` - transcription/summary benchmark scripts and datasets.
- `public/` - static web assets.
- `start.sh`, `setup_and_run.sh` - local startup scripts.

## Frontend Map (`src/`)

### App Routes
- `src/app/page.tsx` - main exam room experience (queue pickup, recording, summary, approval).
- `src/app/login/page.tsx` - admin/room login.
- `src/app/admin/layout.tsx` - admin shell.
- `src/app/admin/page.tsx` - admin dashboard.
- `src/app/admin/patients/page.tsx` - patient CRUD UI.
- `src/app/admin/patients/[id]/page.tsx` - patient detail, history, visit medication editing.
- `src/app/admin/queue/page.tsx` - waiting room queue operations.
- `src/app/admin/schedule/page.tsx` - appointment calendar + check-in.
- `src/app/admin/rooms/page.tsx` - room management.
- `src/app/admin/doctors/page.tsx` - doctor management.
- `src/app/admin/visits/page.tsx` - visits list.
- `src/app/admin/audit-logs/page.tsx` - audit trail viewer.

### Contexts
- `src/contexts/AuthContext.tsx` - auth/session state and login identity.
- `src/contexts/RoomContext.tsx` - room list/status polling and room actions.

### Data Layer
- `src/services/api.ts` - typed API client for auth, patients, queue, rooms, visits, appointments, admins, audit logs.
- `src/types/emr.ts` - EMR/queue/room/appointment/domain types.
- `src/types/index.ts` - visit summary/transcript/prescription types.

### Room Workflow Components
- `src/components/QueuePanel/QueuePanel.tsx` - room-side queue list and start-visit trigger.
- `src/components/PatientHeader/PatientHeader.tsx` - patient demographics + history switcher.
- `src/components/MedicalSnapshot/MedicalSnapshot.tsx` - medical history and live updates.
- `src/components/TranscriptionPanel/TranscriptionPanel.tsx` - live transcript + turn editing.
- `src/components/SummaryPanel/SummaryPanel.tsx` - generated summary editing and polishing.
- `src/components/RecordingButton/RecordingButton.tsx` - recording/summarize/approve controls.
- `src/components/SpeakerConfirmation/SpeakerConfirmation.tsx` - speaker correction step.
- `src/components/HistoryPanel/HistoryPanel.tsx` - previous visit summaries.

### Hooks
- `src/hooks/useWhisperLive.ts` - realtime streaming to room-agent + transcription/summarization orchestration.
- `src/hooks/useVisitSummary.ts` - in-memory visit state and approval/discard actions.
- `src/hooks/useRoomQueue.ts` - room-scoped queue polling.
- `src/hooks/useSessionPersistence.ts` - draft/session recovery.

### Utilities
- `src/utils/medicalSnapshot.ts` - derive live medical snapshot from history + summary.
- `src/utils/prescriptionExport.ts` - prescription download/export helpers.
- `src/utils/roomAgentAuth.ts` - room-agent auth helper.

## Backend Map (`backend/`)

### Entrypoint and Core
- `backend/server.py` - FastAPI app bootstrap, route registration, middleware.
- `backend/database.py` - SQLAlchemy engine/session/base.
- `backend/models.py` - ORM models (patients, rooms, queue, appointments, visits, auth).
- `backend/schemas.py` - Pydantic request/response schemas.
- `backend/auth.py` - login/session token handling and permission guards.

### Route Modules
- `backend/routes/auth.py` - admin/room login, token validation, logout.
- `backend/routes/patients.py` - patient CRUD and medical history.
- `backend/routes/doctors.py` - doctor CRUD and availability.
- `backend/routes/rooms.py` - room CRUD, assignment, room status views.
- `backend/routes/queue.py` - queue CRUD, transitions, auto-assign logic.
- `backend/routes/appointments.py` - appointment lifecycle + check-in to queue.
- `backend/routes/visits.py` - visit lifecycle, progress saves, approval, prescription download.
- `backend/routes/admin_users.py` - admin user management.
- `backend/routes/audit_logs.py` - audit log listing.

### Tests
- `backend/tests/test_api.py` - integration tests covering auth, queue flow, visit approval, side effects.

## Room Agent Map (`room-agent/`)
- `room-agent/server.py` - HTTP endpoints consumed by frontend (`/health`, summarize, pipeline status).
- `room-agent/asr_engine.py` - ASR + diarization pipeline execution.
- `room-agent/summarizer.py` - structured summary and narrative generation.
- `room-agent/audio_utils.py` - audio preprocessing helpers.
- `room-agent/test_summarizer.py`, `room-agent/test_agent.py` - agent/summarizer tests.

## End-to-End Runtime Flow
1. Admin checks in patient to queue (`/admin/queue` -> `POST /api/queue`).
2. Room device sees assigned queue entries (`GET /api/queue`, room-filtered in frontend).
3. Room starts visit (`PATCH /api/queue/:id` to `in_room`; room bindings updated).
4. Frontend creates visit (`POST /api/visits`) and starts room-agent audio pipeline.
5. Transcript/summary are generated and edited in room UI.
6. Approve saves summary (`PATCH /api/visits/:id/approve`), clears transcript PHI, marks queue done, releases room, updates appointment/history.

## Operational Notes
- Queue/room status sync is controlled by `backend/routes/queue.py` transitions.
- Visit completion side effects are centralized in `backend/routes/visits.py` approval handler.
- Room UI assumes polling-driven freshness (RoomContext + useRoomQueue intervals).
- Audit trail is written for major state changes (queue, visits, appointments, room assignments).
