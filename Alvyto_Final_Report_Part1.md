# ALVYTO: LOCAL AI-ASSISTED CLINICAL CONSULTATION AND CLINIC OPERATIONS PLATFORM
## B.Tech Final Year Project Report (Part 1)

**Submitted to:**  
Department of Computer Science and Engineering (CSE), IITE  
Indus University, Ahmedabad  
Academic Year: 2025–2026

**Submitted by:**
- **Khush Patel** (IU2241230528)
- **Kathan Desai** (IU2241230483)
- **Jeet Patel** (IU2241230480)

**Under the Guidance of:**  
**Prof. Zalak Vyas**  
HOD, CSE, IITE, Indus University

---

## Candidate Declaration

We, the undersigned students of B.Tech (CSE), IITE, Indus University, hereby declare that the project report titled **“Alvyto: Local AI-Assisted Clinical Consultation and Clinic Operations Platform”** is an original work carried out by us during the academic year 2025–2026 under the supervision of **Prof. Zalak Vyas, HOD, CSE, IITE, Indus University**.

We further declare that:
1. This report is submitted in partial fulfillment of the requirements for the award of the B.Tech degree in Computer Science and Engineering.
2. The design, implementation, experiments, and analyses presented in this report are based on our own development work, except where proper acknowledgements have been made.
3. No part of this report has been submitted previously to any university or institution for the award of any degree or diploma.
4. All software, architectural descriptions, evaluation metrics, and security claims in this report are derived from the implemented source code and validated project artifacts.

**Declared by:**

| Name | Enrollment Number | Signature | Date |
|---|---|---|---|
| Khush Patel | IU2241230528 | __________ | __________ |
| Kathan Desai | IU2241230483 | __________ | __________ |
| Jeet Patel | IU2241230480 | __________ | __________ |

---

## Certificate

This is to certify that the project report entitled **“Alvyto: Local AI-Assisted Clinical Consultation and Clinic Operations Platform”** submitted by **Khush Patel (IU2241230528), Kathan Desai (IU2241230483), and Jeet Patel (IU2241230480)** in partial fulfillment of the requirements for the award of the **Bachelor of Technology (B.Tech)** degree in **Computer Science and Engineering** at **IITE, Indus University**, for the academic year **2025–2026**, is a bona fide record of work carried out by them under my guidance and supervision.

To the best of my knowledge, this work has not been submitted elsewhere for any other degree or diploma.

**Guide:**  
**Prof. Zalak Vyas**  
HOD, CSE, IITE, Indus University  
Signature: ____________________  
Date: ____________________

---

## Table of Contents

1. **Title Page**
2. **Candidate Declaration**
3. **Certificate**
4. **Table of Contents**
5. **Abstract**
6. **List of Figures**
7. **List of Tables**
8. **Abbreviations**
9. **CHAPTER 1: INTRODUCTION**
   - 1.1 Project Summary
   - 1.2 Project Purpose
   - 1.3 Project Scope
   - 1.4 Objectives
   - 1.5 Technology Overview
     - 1.5.1 WhisperX
     - 1.5.2 pyannote.audio
     - 1.5.3 phi4-mini via Ollama
     - 1.5.4 FastAPI Backend
     - 1.5.5 Next.js + React 19 Frontend
   - 1.6 Synopsis
10. **CHAPTER 2: LITERATURE SURVEY**
    - 2.1 Introduction to the Survey
    - 2.2 Related Works
      - 2.2.1 Dragon Medical One (Nuance/Microsoft)
      - 2.2.2 Amazon Transcribe Medical
      - 2.2.3 Nuance DAX (Dragon Ambient eXperience)
      - 2.2.4 Epic Ambient Listening
      - 2.2.5 Abridge
      - 2.2.6 OpenEMR + Standard Whisper
    - 2.3 Survey Analysis and Research Gap
    - 2.4 Technology Selection Justification
11. **CHAPTER 3: PROJECT MANAGEMENT**
    - 3.1 Project Planning Objectives
      - 3.1.1 Software Scope
      - 3.1.2 Resources
      - 3.1.3 Development Approach
    - 3.2 Project Scheduling
    - 3.3 Risk Management
12. **References** (to be included in Part 2)
13. **Appendices** (to be included in Part 2)

---

## Abstract

Alvyto is a locally deployable ambient clinical intelligence platform that reduces physician documentation burden while preserving consultation accuracy and privacy in outpatient workflows. It addresses fragmented manual note-taking by implementing a three-service architecture: a Next.js 16.1.6 + React 19 + TypeScript frontend on port 3000, a FastAPI + SQLAlchemy backend on port 8080, and a room-agent FastAPI service on port 8000. The AI pipeline chains WhisperX small.en with INT8 compute and word-level forced alignment, pyannote.audio 3.x diarization using ResNet34 speaker embeddings with silhouette-based adaptive speaker-count detection, and phi4-mini (3.8B, Q4_K_M) served through Ollama for structured summary generation. A strict zero-inference rule prevents unsupported clinical claims, and fuzzy hallucination validation enforces SequenceMatcher ratio > 0.72 plus at least 60% meaningful-token overlap. In benchmarked evaluation, the selected model achieved a hallucination support rate of 1.00 and 100% schema compliance. End-to-end latency is 70–100 seconds on CPU, with lower timings on GPU-class deployments. The system follows a hub-and-spoke deployment model and applies PHI minimization by clearing transcript/dialogue after approval while retaining structured clinical outputs required for continuity, routine daily OPD operations, and auditability.

---

## List of Figures

| Figure No. | Figure Title | Page Reference |
|---|---|---|
| Figure 1.1 | Alvyto end-to-end consultation workflow pipeline | refer to section 1.1 |
| Figure 1.2 | Three-service hub-and-spoke deployment topology | refer to section 1.1 |
| Figure 1.3 | Visit approval and PHI minimization lifecycle | refer to section 1.2 |
| Figure 1.4 | Speaker confirmation and transcript remapping flow | refer to section 1.5.2 |
| Figure 1.5 | Frontend room device interaction architecture | refer to section 1.5.5 |
| Figure 2.1 | Comparative positioning of cloud vs local systems | refer to section 2.3 |
| Figure 3.1 | Incremental Agile-Waterfall hybrid with validation gates | refer to section 3.1.3 |
| Figure 3.2 | Project timeline across 8 phases | refer to section 3.2 |
| Figure 3.3 | Risk category matrix for Alvyto | refer to section 3.3 |

---

## List of Tables

| Table No. | Table Title |
|---|---|
| Table 1.1 | In-Scope and Out-of-Scope boundary definition |
| Table 1.2 | Main and secondary objectives |
| Table 1.3 | Core API endpoint surface |
| Table 1.4 | SQLAlchemy data model summary |
| Table 2.1 | Related work comparison matrix |
| Table 2.2 | Aggregate LLM benchmark outcomes |
| Table 3.1 | Human resource allocation and responsibilities |
| Table 3.2 | Software resources used in implementation |
| Table 3.3 | Development environment configuration |
| Table 3.4 | 8-phase schedule and milestone tracking |
| Table 3.5 | Comprehensive risk projection register (R1–R17) |

---

## Abbreviations

| Abbreviation | Full Form |
|---|---|
| AI | Artificial Intelligence |
| API | Application Programming Interface |
| ASR | Automatic Speech Recognition |
| CSE | Computer Science and Engineering |
| CTC | Connectionist Temporal Classification |
| EMR | Electronic Medical Record |
| FK | Foreign Key |
| GPU | Graphics Processing Unit |
| HMM | Hidden Markov Model |
| HS256 | HMAC with SHA-256 |
| INT8 | 8-bit Integer Quantization |
| JWT | JSON Web Token |
| LLM | Large Language Model |
| MRN | Medical Record Number |
| PHI | Protected Health Information |
| RBAC | Role-Based Access Control |
| SQLAlchemy | SQL Toolkit and Object-Relational Mapper for Python |
| UUID | Universally Unique Identifier |
| VAD | Voice Activity Detection |
| JSON-LD | JavaScript Object Notation for Linked Data |
| PII | Personally Identifiable Information |
| RTF | Real-Time Factor |
| UI | User Interface |
| UX | User Experience |

---

# CHAPTER 1: INTRODUCTION

## 1.1 Project Summary

Alvyto is a clinical consultation intelligence and workflow orchestration system designed for outpatient environments where doctors must simultaneously conduct consultations and complete structured documentation. In conventional workflows, physicians split cognitive attention between patient interaction and digital record entry, causing reduced conversational quality, delayed documentation closure, and variability in note completeness. Alvyto addresses this by capturing room audio, producing clinically structured summaries, and embedding those outputs directly into visit, appointment, queue, and room-state operations. The system is not a generic transcription product; it is a medically constrained workflow engine that integrates consultation intelligence with clinic operations.

The Alvyto AI pipeline follows a deterministic sequence: room audio capture is streamed to the room agent, transcribed using WhisperX (small.en, INT8) with word-level forced alignment, diarized using pyannote.audio with adaptive speaker counting, summarized by phi4-mini under strict schema and support constraints, validated through fuzzy hallucination checks, presented for doctor review, and committed only after explicit approval. This chain ensures that generated findings are transcript-grounded rather than model-invented. The explicit doctor confirmation step and transcript-to-summary support validation together provide a two-layer clinical safety mechanism—first at generation, then at approval.

Architecturally, Alvyto is implemented as three services: frontend (Next.js 16.1.6 + React 19 + TypeScript, port 3000), backend (FastAPI + Uvicorn + SQLAlchemy + SQLite, port 8080), and room agent (FastAPI + WhisperX + pyannote.audio + Ollama, port 8000). These services operate in a hub-and-spoke deployment pattern, where the backend acts as the control hub and room agents behave as room-specific spokes for acoustic processing. Persistent state is represented through 10 core transactional SQLAlchemy models, supplemented by an AuditLog model for traceability, enabling operational continuity beyond raw transcript generation.

## 1.2 Project Purpose

The primary purpose of Alvyto is to reduce the manual documentation burden in high-throughput clinics without degrading clinical rigor. Manual consultation notes consume physician time after patient interaction, increase end-of-day administrative load, and introduce inconsistency in how findings and plans are recorded. During live consultation, simultaneous typing and questioning divides attention and can degrade both patient trust and clinical listening quality. A system that preserves conversational flow while producing structured, reviewable outputs can materially improve both care interaction quality and documentation consistency.

Existing alternatives leave major gaps. Cloud transcription solutions provide convenience but raise PHI governance concerns, create recurring per-minute costs, and reduce institutional control over data residency. Standard EMR interfaces still depend on manually authored notes and do not inherently enforce transcript-grounded generation quality. Most ambient summarization products are black-box services with limited transparency into hallucination control and support linkage, making it difficult for clinics to establish verifiable assurance that generated claims are evidence-backed.

Alvyto addresses these gaps through local-first deployment, an explicit zero-inference rule, mandatory doctor approval, and data minimization by design. The system runs core speech and summarization components in local infrastructure, reducing external data exposure and recurring API dependence. Summary entries are validated against transcript evidence using deterministic fuzzy checks before finalization. No visit can transition to approved-completed state without physician confirmation, and after approval the system clears raw transcript and dialogue buffers to minimize PHI retention while preserving structured clinical outcomes and auditable event logs.

## 1.3 Project Scope

### Table 1.1: In-Scope and Out-of-Scope Boundary Definition

| In Scope | Out of Scope |
|---|---|
| Multi-service local deployment (frontend:3000, backend:8080, room agent:8000) | Cloud-hosted, multi-tenant SaaS deployment |
| Room audio ingestion, ASR (WhisperX), diarization (pyannote), LLM summary generation | Real-time telemedicine video consultation workflows |
| Structured VisitSummary generation with schema constraints and evidence support checks | Autonomous diagnosis without clinician validation |
| Doctor speaker confirmation workflow and transcript remapping | Full multilingual clinical model support beyond configured English pipeline |
| Visit approval flow with PHI minimization and appointment/queue/room state synchronization | Insurance claim adjudication and third-party payer integration |
| Admin-facing clinic management: doctors, rooms, patients, appointments, queue | Deep hospital information system integration across all departments |
| RBAC security model (super_admin/admin/room_device) and audit logs | National-scale distributed cluster orchestration |
| Prescription draft creation and PDF/HTML export | Legally signed e-prescription gateways and pharmacy network dispatch |

The scope boundary was intentionally constrained to a production-viable outpatient clinic workflow where technical risk and clinical safety could be validated end-to-end. Functions requiring external regulatory integration, broad multilingual adaptation, or multi-institution interoperability were deferred to preserve implementation depth and controllable validation.

## 1.4 Objectives

### Main Objectives

1. Design and implement a three-service local architecture in which room-level audio processing, central workflow orchestration, and role-based frontend operations remain decoupled but transactionally synchronized through backend APIs and SQLAlchemy persistence.
2. Build a clinically constrained AI pipeline that performs INT8 WhisperX word-level transcription, adaptive pyannote speaker segmentation, and schema-bound phi4-mini summarization while enforcing transcript-grounded support guarantees.
3. Enforce robust data governance by combining JWT HS256 authentication, bcrypt-12 password protection, SHA-256 token-hash session storage, revocation-aware session validation, and room-scoped authorization boundaries.
4. Implement an approval-centric visit lifecycle where structured summaries, medical history merges, appointment/queue updates, and room reset actions occur atomically and raw transcript/dialogue PHI is cleared post-approval.
5. Establish measurable model selection criteria using JSON validity, schema compliance, support rate, and latency, then operationalize the selected model within CPU- and GPU-capable clinic deployment envelopes.

### Secondary Objectives

1. Provide doctor-facing speaker confirmation controls to correct diarization assumptions and ensure legally defensible speaker attribution in clinical transcripts.
2. Integrate prescription drafting with structured follow-up and export mechanisms (PDF and HTML) without requiring external document-generation services.
3. Deliver auditable operational traceability by recording security and resource events in AuditLog with actor identity, action metadata, and success/failure context.
4. Support clinic throughput management by coupling consultation status transitions with appointment progression and waiting-queue state updates.

### Table 1.2: Main and Secondary Objectives

| Objective Type | Objective ID | Statement |
|---|---|---|
| Main | M1 | Implement a decoupled three-service local architecture with synchronized transactional state across consultation and operations workflows. |
| Main | M2 | Build a transcript-grounded AI chain combining aligned ASR, adaptive diarization, and schema-constrained summarization. |
| Main | M3 | Enforce security and identity controls through JWT HS256, bcrypt-12, hashed session storage, and RBAC scoping. |
| Main | M4 | Operationalize approval-gated visit finalization with atomic updates and post-approval PHI clearing. |
| Main | M5 | Select and deploy an LLM using measured JSON/schema/support/latency criteria for clinic-viable inference. |
| Secondary | S1 | Provide clinician-correctable speaker-role mapping before final transcript lock-in. |
| Secondary | S2 | Support prescription draft capture with PDF and HTML export pathways. |
| Secondary | S3 | Maintain complete auditability for sensitive actions through structured audit logs. |
| Secondary | S4 | Integrate consultation progress with appointment and waiting-queue throughput logic. |

## 1.5 Technology Overview

### 1.5.1 WhisperX

WhisperX was selected over segment-level standard Whisper because clinical consultation quality requires accurate word-level timestamps for downstream alignment and evidence mapping. In standard segment-based output, temporal granularity is insufficient for reliable linking of extracted findings to exact spoken evidence, especially when multiple speakers interleave short utterances. WhisperX addresses this by combining transcription with forced alignment, producing tighter word boundaries that improve both diarization merge quality and support validation. The deployed ASR configuration uses the **small.en** model with **INT8** compute type to balance inference speed and resource usage in local setups. This choice allows practical on-premise execution while maintaining clinically useful transcription fidelity. The aligned transcript output becomes the canonical text substrate used by both the summarizer and the hallucination-validation layer.

### 1.5.2 pyannote.audio

The diarization layer is implemented using pyannote.audio 3.x with **ResNet34 speaker embeddings**, enabling acoustic separation of distinct voices in consultation audio. Rather than fixing speaker count a priori, Alvyto applies **silhouette-based adaptive speaker-count detection**, which selects cluster cardinality based on embedding separation quality for each session. The initial output assigns anonymous labels such as SPEAKER_00, SPEAKER_01, and SPEAKER_02, which represent acoustically distinct entities rather than semantic roles. These labels are then provisionally mapped by speaking order (Doctor, Patient, Companion) and exposed to doctors for manual correction through the SpeakerConfirmation UI. Final remapping is applied in the frontend via `confirmSpeakerMapping()` and `mergeConsecutiveSpeakers()` to generate contiguous role-consistent transcript blocks. This hybrid acoustic-plus-human approach was chosen because medical records demand near-perfect speaker attribution under compliance constraints.

### 1.5.3 phi4-mini via Ollama

Alvyto uses **phi4-mini** as the summarization model, with **3.8B parameters** and **Q4_K_M quantization** to reduce memory footprint while preserving structured generation quality. The model is served through Ollama, allowing local process orchestration, predictable model loading, and low-friction deployment on commodity clinic hardware. During benchmark evaluation across GP headache, diabetes, and sore throat scenarios, phi4-mini achieved 100% JSON validity, 100% schema validity, and 1.00 support rate, outperforming qwen3:4b (0% JSON/schema success) and avoiding qwen2.5:3b paraphrase-risk concerns despite speed. Llama3.1:8b matched support quality but was rejected due to higher latency, especially in CPU-only deployments common in smaller clinics. Operationally, phi4-mini warm inference measured **7.6 seconds on GPU** and approximately **30 seconds on CPU**, making it a viable midpoint between quality, determinism, and infrastructure constraints. The model is constrained by a zero-inference summarization policy, requiring grounded outputs tied to transcript evidence.

### 1.5.4 FastAPI Backend

The backend service uses FastAPI with Uvicorn and SQLAlchemy to implement both transactional workflow logic and API governance. Authentication uses **JWT (HS256)** with two expiry classes: 8-hour admin tokens and 24-hour room-device tokens; passwords are hashed using **bcrypt with 12 rounds**. Session management avoids raw token persistence by storing a **SHA-256 hash of the JWT** in `sessions.token_hash`, enabling revocation checks without retaining bearer tokens. Authorization is role-based with three scoped roles—`super_admin`, `admin`, and `room_device`—enforcing management privileges and room-level isolation. The data layer contains 10 core workflow models and a dedicated AuditLog model, and it enforces workflow integrity through status transition constraints and approval-state logic. Session revocation is explicit (`revoked=True`, `revoked_at`) and enforced by `is_session_valid()` through both expiry and revocation checks.

### 1.5.5 Next.js + React 19 Frontend

The frontend is implemented in **Next.js 16.1.6** with **React 19** and TypeScript, providing separate interaction surfaces for clinic administration and room-device workflows. The room device UI emphasizes high-visibility consultation context, including amber highlighting to direct physician attention toward actionable summary confirmations and pending validation states. Audio streaming is coordinated through `useWhisperLive`, which manages WebSocket-based capture/stream lifecycle to the room agent and receives progressively updated transcript segments. Structured summary assembly is managed by `useVisitSummary`, which maintains in-memory consultation state such that raw transcript payloads are not prematurely persisted through backend POST operations before review readiness. Authentication and routing control are centralized in `AuthContext`, which stores JWT credentials client-side and applies role-driven route protection for super-admin, admin, and room-device paths. This architecture keeps the consultation interaction responsive while preserving backend authority for final persistence, approval, and audit-critical transitions.

### Table 1.3: Core API Endpoint Surface

| Domain | Endpoint(s) | Key Purpose |
|---|---|---|
| Authentication | POST `/auth/login`, POST `/auth/room-login`, POST `/auth/logout` | Admin and room login, session revocation |
| Patients | GET/POST/PATCH/DELETE `/api/patients` | Patient lifecycle management |
| Doctors | GET/POST/PATCH `/api/doctors` | Provider data and availability operations |
| Rooms | GET/POST/PATCH `/api/rooms` | Room provisioning and status management |
| Appointments | GET/POST/PATCH/DELETE `/api/appointments`; PATCH `/api/appointments/{id}/checkin` | Scheduling and check-in transition |
| Queue | GET/POST/PATCH `/api/queue` | Waiting-room flow control |
| Visits | POST `/api/visits`, GET `/api/visits`, GET `/api/visits/{id}`, PATCH `/api/visits/{id}/progress`, PATCH `/api/visits/{id}/status`, PATCH `/api/visits/{id}/approve`, PATCH `/api/visits/{id}/prescription-draft`, GET `/api/visits/{id}/prescription`, DELETE `/api/visits/{id}` | Consultation state machine, approval, prescription export, soft delete |
| Audit | GET `/api/audit-logs` | Paginated security and operational audit trail |
| Admin Users | GET/POST/PATCH `/api/admin-users` | Super-admin-only user administration |

### Table 1.4: SQLAlchemy Data Model Summary

| Model | Core Purpose | Critical Fields/Notes |
|---|---|---|
| AdminUser | Administrative identity and role control | UUID ID, unique email, bcrypt-12 password hash, role, active status |
| Session | Token lifecycle and revocation | SHA-256 token hash, expiry, revoked flag and timestamp |
| Doctor | Clinical provider registry | Specialty, license number, active state |
| DoctorAvailability | Provider schedule state | Date/time windows, status enum |
| Room | Consultation room state | device PIN, agent port, occupancy linkage fields |
| Patient | Demographic and contact profile | Unique MRN, demographics, insurance fields |
| MedicalHistory | Longitudinal clinical profile | JSON conditions/allergies/medications, 1:1 with patient |
| Appointment | Time-boxed encounter planning | status workflow, timestamps, visit linkage |
| WaitingQueue | Real-time throughput queue | priority, position, called/in-room/done timestamps |
| Visit | Consultation artifact container | transcript/dialogue, structured summary, approval and deletion fields |
| AuditLog | Traceability layer | actor metadata, action, resource, success/error detail |

## 1.6 Synopsis

The clinical workflow begins with appointment check-in and queue placement, after which a room device initiates a visit and streams audio to the room agent. WhisperX generates aligned transcript text, pyannote.audio separates speakers, and the frontend presents speaker-role confirmation before final remapping. The summarized output is produced by phi4-mini under strict schema and support constraints, then validated using fuzzy transcript matching (SequenceMatcher ratio > 0.72 and ≥60% meaningful-token overlap). The doctor reviews structured findings, actions, and prescription draft content, and only on approval does the backend commit final summary state, merge medical history updates, complete linked operational entities, and clear transcript/dialogue PHI. Visit status transitions are constrained by backend state rules (`pending→in_progress/cancelled`, `in_progress→completed/cancelled`) to prevent invalid lifecycle progression.

The administrative workflow is managed through role-aware interfaces for super_admin and admin users. Super-admin accounts can create and govern admin users, while admin accounts manage patients, doctors, rooms, appointments, and queue flow without user-management privileges. Session security is maintained through JWT issuance, hashed-token session records, and revocation validation. Audit logs capture actor identity, action type, resource target, and operation outcome for all sensitive actions. This creates an integrated clinic control plane in which operational administration and consultation intelligence remain synchronized rather than isolated subsystems.

---

# CHAPTER 2: LITERATURE SURVEY

## 2.1 Introduction to the Survey

Automatic speech recognition has evolved through three major phases relevant to this project. Early systems were based on HMM/GMM pipelines and required carefully engineered acoustic and language models, with limited robustness in noisy, multi-speaker conversational contexts. Later, end-to-end CTC and sequence-to-sequence approaches improved recognition generalization and reduced handcrafted pipeline complexity. Contemporary transformer-based systems such as Whisper expanded multilingual robustness and domain transfer capacity, making practical ambient transcription feasible in real settings. However, in clinical environments, transcription fidelity alone remains insufficient unless tied to speaker attribution, structured extraction, and verifiable support constraints.

Clinical documentation workflows have similarly shifted from manual free-text entry to digital dictation and now to ambient AI assistance. Manual entry remains accurate but time-intensive and cognitively disruptive; dictation reduces typing but still requires explicit physician narration and post-editing. Ambient AI systems attempt passive capture and automatic note generation, but commonly rely on cloud processing and opaque inference logic. The current research frontier is therefore not only note-generation quality but governance: local control, evidence traceability, hallucination resistance, and tight integration with appointment and room-state workflows.

## 2.2 Related Works

### 2.2.1 Dragon Medical One (Nuance/Microsoft)

Dragon Medical One is a mature cloud dictation product with healthcare vocabulary optimization and broad enterprise adoption. It improves clinician productivity in dictation-heavy workflows but is principally optimized for speech-to-text dictation rather than full ambient conversational structuring. Its cloud-centric operating model can raise concerns for institutions requiring strict local PHI residency.

### 2.2.2 Amazon Transcribe Medical

Amazon Transcribe Medical provides scalable cloud ASR with domain-adapted medical terminology and streaming support. It can integrate into modern backend architectures and supports channel-based separation in certain setups. However, it is not a complete end-to-end clinical workflow system and generally requires additional custom layers for validation, summarization safety, and clinic state synchronization.

### 2.2.3 Nuance DAX (Dragon Ambient eXperience)

Nuance DAX extends beyond dictation to ambient note creation with enterprise-grade EMR pathways. Its workflow maturity demonstrates the viability of AI-assisted documentation in clinical operations. Yet, the platform remains tightly tied to cloud-assisted service infrastructure and proprietary pipelines, limiting transparent control over groundedness and custom validation logic.

### 2.2.4 Epic Ambient Listening

Epic Ambient Listening integrates ambient capture within Epic-centered clinical workflows, reducing context-switching for providers already in the Epic ecosystem. This integration strength is significant for large institutions with standardized Epic operations. The approach is less suitable for smaller clinics needing flexible, local-first deployment independent of enterprise ecosystem lock-in.

### 2.2.5 Abridge

Abridge focuses on ambient capture with clinically formatted outputs and clinician-facing usability. It demonstrates strong product-market fit for reducing documentation overhead and generating structured notes from consultation audio. However, it is a hosted platform and does not primarily target code-level transparency for custom hallucination validation and locally constrained data governance.

### 2.2.6 OpenEMR + Standard Whisper (Open-Source Combination)

The OpenEMR plus standard Whisper combination represents a practical open-source baseline for low-cost local experimentation. It offers deployability flexibility and avoids mandatory cloud dependency. Still, it typically lacks an integrated architecture for adaptive diarization, deterministic support validation, and tightly coupled appointment/queue/room operational workflows.

### Table 2.1: Related Work Comparison Matrix

| System | Real-Time Capture | Speaker Diarization | Deployment Model | Hallucination Validation | Integrated EMR/Workflow | Open Source | Approximate Cost Model |
|---|---|---|---|---|---|---|---|
| Dragon Medical One | Dictation-oriented near real-time | Limited/indirect | Cloud SaaS | Not transparent at rule level | Strong dictation integration | No | Subscription per user/provider |
| Amazon Transcribe Medical | Yes (streaming API) | Channel-level/support varies | Cloud API | Not built-in for clinical grounding | Requires custom integration | No | Usage-based (per second/minute) |
| Nuance DAX | Ambient capture supported | Proprietary ambient attribution | Cloud-assisted enterprise | Proprietary, non-user-configurable | Strong enterprise EMR pathways | No | Enterprise licensing |
| Epic Ambient Listening | Integrated ambient workflow | Vendor-managed | Cloud-assisted + Epic ecosystem | Vendor-managed | Deep Epic-native | No | Enterprise contract |
| Abridge | Yes | Platform-managed | Cloud hosted | Not externally configurable | Strong workflow outputs | No | Enterprise/vendor pricing |
| OpenEMR + Standard Whisper | Possible with custom engineering | Basic/custom | Local/self-hosted possible | Usually absent or ad hoc | Partial, custom effort | Yes (components) | Infra + integration effort |
| **Alvyto (this work)** | Yes (room stream pipeline) | pyannote adaptive + manual confirmation | Fully local hub-and-spoke | Deterministic fuzzy support checks | Unified visits + queue + rooms + approval flow | Partially open stack | Local infra; no per-minute cloud fee |

## 2.3 Survey Analysis and Research Gap

A common pattern across commercial cloud systems is strong real-time capture capability and mature enterprise integration but limited operational transparency in grounding and hallucination control. These solutions typically optimize for convenience and scale, yet they externalize PHI handling to vendor infrastructure and impose recurring usage or licensing costs. For clinics with strict residency preferences or constrained budgets, cloud dependence introduces both policy and sustainability challenges.

Open-source alternatives improve control and cost flexibility but usually expose a different limitation: integration discontinuity. Typical deployments provide transcription capability, yet lack a complete orchestration layer linking speaker-aware transcript interpretation, structured summary validation, approval governance, and clinic throughput state transitions. As a result, they often remain toolkits rather than clinically coherent workflow systems.

The identified research and implementation gap has four components: **(i)** fully local deployment without mandatory cloud inference dependency, **(ii)** adaptive speaker-aware processing with human-correctable attribution, **(iii)** transcript-grounded hallucination validation before record finalization, and **(iv)** unified consultation intelligence tightly integrated with appointments, queue movement, room state, and audited approvals. Alvyto is explicitly designed to close these four gaps through an architecture where AI generation is a constrained subsystem inside an operationally complete clinic workflow.

## 2.4 Technology Selection Justification

WhisperX was selected over standard Whisper because Alvyto requires word-level temporal precision for downstream support validation and speaker-text reconciliation. Segment-level outputs from vanilla Whisper are faster to integrate but weaker for fine-grained evidence linking, especially when speakers overlap or alternate rapidly. In a clinically regulated context, improved alignment granularity outweighs minimal implementation simplicity.

pyannote.audio was selected over simpler diarization heuristics because consultation audio is not reliably separable by volume, pause, or turn-length rules. ResNet34 embeddings with adaptive silhouette-based speaker count estimation provide more robust separation under natural conversation variability. The additional complexity is justified by the need for reliable speaker partitioning prior to role confirmation.

phi4-mini was selected because it delivered the best quality-latency-governance balance in measured evaluation. qwen3:4b was disqualified due to 0% JSON and schema compliance in tested scenarios; qwen2.5:3b was fast but rejected due to paraphrase-risk concerns despite passing structure checks; llama3.1:8b matched quality but imposed higher runtime overhead on CPU-first deployments. phi4-mini achieved full compliance and support at practical warm inference speeds (7.6s GPU, ~30s CPU) and therefore aligned with local clinic constraints.

### Table 2.2: Aggregate LLM Benchmark Outcomes

| Model | Avg Time (s) | JSON Validity | Schema Compliance | Support Rate | Decision |
|---|---:|---:|---:|---:|---|
| qwen2.5:3b | 7.1 | 100% | 100% | 0.93 | Rejected (paraphrase risk) |
| qwen3:4b | 33.4 | 0% | 0% | 0.00 | Disqualified |
| phi4-mini | 12.1 (7.6 warm) | 100% | 100% | 1.00 | **Selected** |
| llama3.1:8b | 15.3 | 100% | 100% | 1.00 | Rejected (CPU latency overhead) |

---

# CHAPTER 3: PROJECT MANAGEMENT

## 3.1 Project Planning Objectives

### 3.1.1 Software Scope

Project planning followed a risk-first sequencing strategy in which the highest technical uncertainty components were implemented before administrative conveniences. The room agent pipeline (capture → transcription → diarization → summarization) was prioritized first because failure in this chain would invalidate the entire product proposition regardless of UI maturity. Early stabilization of this pipeline enabled objective benchmarking and safe model selection before deeper integration with scheduling, queue, and security subsystems. This approach reduced late-stage architectural rework by validating feasibility at the point of greatest complexity.

### 3.1.2 Resources

#### Table 3.1: Human Resource Allocation and Responsibilities

| Role | Personnel | Responsibilities |
|---|---|---|
| Project Team Lead / Full-Stack Integrator | Kathan Desai | Cross-service architecture, backend integration, API contracts, security controls, release coordination |
| AI Pipeline Engineer | Khush Patel | ASR-diarization-summarization pipeline, model benchmarking, inference optimization, validation rule tuning |
| Frontend & Clinical UX Engineer | Jeet Patel | Room device workflow UI, admin dashboard flows, speaker confirmation UX, state management hooks |
| Academic Guide / Quality Supervisor | Prof. Zalak Vyas | Technical review, methodological supervision, compliance guidance, evaluation milestone validation |

#### Table 3.2: Software Resources Used in Implementation

| Category | Technology | Purpose |
|---|---|---|
| Frontend Framework | Next.js 16.1.6 | Application shell, routing, frontend runtime |
| UI Runtime | React 19 | Component-driven room/admin interfaces |
| Language | TypeScript 5.x | Type-safe frontend implementation |
| Backend Framework | FastAPI | REST APIs and workflow orchestration |
| ASGI Server | Uvicorn | Backend and room-agent serving |
| ORM | SQLAlchemy | Relational model mapping and transactions |
| Database | SQLite | Local persistent storage |
| ASR Engine | WhisperX small.en (INT8) | Aligned speech-to-text transcription |
| Diarization Engine | pyannote.audio 3.x (ResNet34 embeddings) | Speaker segmentation and adaptive count detection |
| LLM Serving Layer | Ollama | Local model serving and inference orchestration |
| Summarization Model | phi4-mini 3.8B (Q4_K_M) | Structured clinical summary generation |
| Auth Security | JWT HS256 + bcrypt-12 + SHA-256 session hash | Authentication, password security, revocation tracking |
| PDF Export | pdf-lib (frontend) | Client-side prescription PDF generation |
| HTML Prescription Export | `_build_prescription_html()` (backend) | Server-side prescription document rendering |

#### Table 3.3: Development Environment Configuration

| Environment Dimension | Configuration |
|---|---|
| Operating Mode | Local hub-and-spoke clinic deployment |
| Frontend Port | 3000 |
| Backend Port | 8080 |
| Room Agent Port | 8000 |
| Compute Profiles | CPU-only baseline and GPU-accelerated (RTX 3060 class) |
| Security Profile | Production-aware seeding controls (`ENVIRONMENT=production` disables seed insertion) |
| Seed ID Strategy | UUID5 stable IDs (`uuid.uuid5(NAMESPACE_DNS, "alvyto-seed-{seed}")`) |

### 3.1.3 Development Approach

Alvyto adopted an **Incremental Agile-Waterfall Hybrid** model: iterative development inside each module, with hard validation gates between integration layers. Agile loops enabled rapid correction of pipeline outputs and UX behavior, while Waterfall-style gates enforced non-negotiable quality thresholds before moving to dependent stages.

- **Gate 1: Stable audio capture and streaming** — verified room-device capture continuity and WebSocket transport reliability.
- **Gate 2: Transcript word-level alignment quality** — verified WhisperX alignment integrity and timestamp usefulness for downstream evidence mapping.
- **Gate 3: Diarization speaker attribution accuracy** — validated pyannote segmentation plus clinician-correctable role mapping behavior.
- **Gate 4: Summarization schema compliance + support rate** — benchmarked model candidates for JSON validity, schema adherence, and transcript support ratio.
- **Gate 5: Doctor review and approval workflow** — validated mandatory approval path, correction controls, and post-approval state updates.
- **Gate 6: Admin operations integration** — connected visits with appointments, queue transitions, room occupancy reset, and audit behavior.
- **Gate 7: Security and RBAC enforcement** — enforced JWT role boundaries, session revocation, room scoping, and elimination of unsafe fallback IDs.

This gated progression prevented operational coupling of immature components and ensured each subsequent stage inherited proven behavior rather than assumptions.

## 3.2 Project Scheduling

### Table 3.4: 8-Phase Schedule and Milestone Tracking

| Phase | Week Range | Major Activities | Deliverables / Exit Criteria |
|---|---|---|---|
| Phase 1: Problem Definition & Requirements | Weeks 1–2 | Clinical workflow study, role mapping, data fields, compliance constraints | Approved requirement specification and scope matrix |
| Phase 2: Architecture & Data Modeling | Weeks 3–4 | Three-service architecture design, model schema drafting, API contracts | Finalized architecture and SQLAlchemy schema plan |
| Phase 3: Room Agent Prototype | Weeks 5–6 | Audio streaming, WhisperX integration, alignment verification | Gate 1 and Gate 2 passed |
| Phase 4: Diarization & Speaker Workflow | Weeks 7–8 | pyannote integration, speaker-count adaptation, confirmation UI hookup | Gate 3 passed with stable role remapping |
| Phase 5: Summarization & Validation Engine | Weeks 9–10 | Candidate model benchmarks, prompt constraints, fuzzy support checks | Gate 4 passed; phi4-mini selected |
| Phase 6: Clinical Approval Workflow Integration | Weeks 11–12 | Visit status machine, approval endpoint, PHI clearing, prescription draft flow | Gate 5 passed with end-to-end clinical cycle |
| Phase 7: Admin Operations & Security Hardening | Weeks 13–14 | Patients/doctors/rooms/appointments/queue integration, RBAC, session controls, audit logs | Gate 6 and Gate 7 passed |
| Phase 8: Testing, Documentation, and Reporting | Weeks 15–16 | Latency runs (CPU/GPU), regression checks, report compilation | Final build freeze and project report completion |

## 3.3 Risk Management

Risk management was structured into four categories: **Technical Pipeline**, **Integration/State**, **Clinical Use**, and **Security/Scale**. Each risk was tracked with trigger conditions tied to observable system events, then mapped to preventive controls and residual exposure. This method avoided abstract risk statements and kept mitigation linked to implemented mechanisms.

### Table 3.5: Comprehensive Risk Projection Register (R1–R17)

| Risk ID | Risk Title | Trigger Condition in Alvyto | Likelihood | Impact | Control in Place | Residual Exposure |
|---|---|---|---|---|---|---|
| R1 | Audio stream interruption | WebSocket disconnect during active consultation | Medium | High | Reconnect strategy, session-state buffering, explicit restart controls | Medium |
| R2 | ASR quality degradation | Noisy room or overlapping speech reduces WhisperX clarity | Medium | High | WhisperX alignment checks, physician review before approval | Medium |
| R3 | Speaker misattribution | Diarization clusters map incorrectly to doctor/patient roles | Medium | High | Manual SpeakerConfirmation and remapping workflow | Low |
| R4 | Under/over speaker count | Silhouette-based detection chooses wrong cluster count | Medium | Medium | Adaptive scoring + human correction UI | Low |
| R5 | Model hallucination | Summary item not grounded in transcript | Low | Very High | Zero-inference rule + fuzzy support validation | Low |
| R6 | Schema generation failure | LLM returns malformed JSON or invalid structure | Low (selected model) | High | Strict schema parser and benchmark-based model selection | Low |
| R7 | Cold-start latency spikes | Initial phi4-mini load delays summary generation | Medium | Medium | Warm-up routines, user feedback indicators | Medium |
| R8 | Backend state desynchronization | Visit approved but linked appointment/queue/room not updated | Low | High | Atomic approval flow updates across entities | Low |
| R9 | Invalid status transitions | Unauthorized move from completed/cancelled to active states | Medium | Medium | Backend-enforced transition matrix | Low |
| R10 | Missing relational reference | Visit missing doctor/room/patient linkage due to fallback IDs | Low | High | Hard error on missing IDs; fallback IDs removed | Low |
| R11 | Medical history merge corruption | Duplicate condition/medication entries from repeated approvals | Medium | Medium | Case-insensitive deduplication logic in approval step | Low |
| R12 | Premature PHI persistence | Transcript posted/stored before doctor approval | Low | High | In-memory frontend handling + explicit approval commit path | Low |
| R13 | Unauthorized access via stale token | Revoked or expired session still accepted | Low | Very High | SHA-256 token hash sessions + revocation/expiry checks | Low |
| R14 | Privilege escalation | Admin performs super_admin-only user operations | Low | High | RBAC checks on `/api/admin-users` endpoints | Low |
| R15 | Room scope violation | Room device accesses visits outside assigned room | Low | High | Room-scoped access validation in visit endpoints | Low |
| R16 | Audit trail incompleteness | Sensitive action executed without audit record | Medium | Medium | Centralized AuditLog writes for critical operations | Medium |
| R17 | Deployment drift to production seeds | Seed data appears in production due to config error | Low | Medium | `ENVIRONMENT=production` seeding guard + UUID5 seed strategy | Low |

**Technical Pipeline Risk Profile:** The highest intrinsic uncertainty originated in acoustic and generation components (R1–R7), where runtime variability from room acoustics, speaker overlap, and model initialization could destabilize output quality and latency. Mitigation combined deterministic engineering (alignment checks, schema parsing, warm-up paths) with controlled human override (speaker confirmation, mandatory doctor review). This dual mechanism intentionally treats AI output as assistive, not autonomous.

**Integration/State Risk Profile:** Cross-entity consistency risks (R8–R12) could compromise operational correctness even when AI output is accurate. The most critical safeguard is the approval transaction sequence that synchronizes visit completion with appointment, queue, and room state transitions while applying PHI clearing at commit time. Removal of fallback IDs and transition-rule enforcement further reduced hidden state corruption vectors.

**Clinical Use Risk Profile:** Clinical safety risks are dominated by unsupported claims and attribution errors (R3, R5, R11). Alvyto mitigates these by requiring transcript support thresholds, preserving explicit confidence/state fields, and enforcing physician sign-off before durable storage. This keeps final clinical authority with the doctor and positions AI output as structured draft assistance rather than independent decision-making.

**Security/Scale Risk Profile:** Security risks (R13–R17) were managed through layered controls spanning identity, authorization, session lifecycle, and deployment hygiene. Hashed-token sessions, revocation checks, and strict RBAC boundaries protect access pathways, while audit logging and production seeding guards improve operational trustworthiness. Residual exposure remains primarily around process discipline (e.g., audit coverage completeness) rather than architectural absence.

---

**End of Part 1**

(Part 2 will include implementation deep dive, test cases, results, discussion, conclusion, future work, references, and appendices.)
