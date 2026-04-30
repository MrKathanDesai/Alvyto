# Alvyto - Smart EMR System  
## Project Report (Revised)

**B.Tech Final Year Project Report**  
**Institute:** Indus University, IITE, Department of Computer Science and Engineering  
**Academic Year:** 2025–2026  

**Submitted by:**  
- Khush Patel (IU2241230528)  
- Kathan Desai (IU2241230483)  
- Jeet Patel (IU2241230480)  

**Project Guide:**  
- Prof. Zalak Vyas, HOD, CSE, IITE, Indus University

---

## ABSTRACT
Alvyto is a fully local, AI-powered Electronic Medical Record (EMR) system designed for clinic exam rooms to automate post-consultation documentation without sending Protected Health Information (PHI) outside the clinic network. The system captures live doctor–patient audio through WebSocket streaming, transcribes speech using WhisperX (small.en, INT8) with word-level alignment, and separates speakers using pyannote.audio with ResNet34 embeddings and silhouette-based adaptive speaker count detection. A structured clinical summary is then generated using phi4-mini (3.8B, Q4_K_M) served via Ollama. To prevent unsafe AI behavior, Alvyto enforces a zero-inference rule: every generated fact must be supported by transcript text using fuzzy validation (SequenceMatcher ratio > 0.72 and at least 60% token coverage). Unsupported items are amber-highlighted for doctor correction, and summary approval is mandatory before record commitment. Benchmarking against qwen2.5:3b, qwen3:4b, and llama3.1:8b selected phi4-mini with 1.00 hallucination support rate and 100% schema compliance. Deployment follows a hub-and-spoke model with one clinic server and browser-only room thin clients.

---

## ABBREVIATIONS
| Abbreviation | Expansion |
|---|---|
| ACK | Acknowledgement |
| API | Application Programming Interface |
| ASR | Automatic Speech Recognition |
| CPU | Central Processing Unit |
| CSE | Computer Science and Engineering |
| DB | Database |
| DFD | Data Flow Diagram |
| EMR | Electronic Medical Record |
| FR | Functional Requirement |
| FHIR | Fast Healthcare Interoperability Resources |
| GPU | Graphics Processing Unit |
| HL7 | Health Level Seven |
| HTTP | Hypertext Transfer Protocol |
| INT8 | 8-bit Integer Quantization |
| JWT | JSON Web Token |
| LAN | Local Area Network |
| LLM | Large Language Model |
| NFR | Non-Functional Requirement |
| NLP | Natural Language Processing |
| PHI | Protected Health Information |
| RBAC | Role-Based Access Control |
| REST | Representational State Transfer |
| VAD | Voice Activity Detection |
| WS | WebSocket |

---

# CHAPTER 1: INTRODUCTION

## 1.1 Project Summary
Alvyto is a clinical automation platform that converts live doctor–patient consultations into structured EMR entries through a fully local AI pipeline. It combines real-time audio capture, speaker diarization, transcript generation, hallucination validation, and doctor approval into a single workflow. The system is designed for practical clinic deployment where speed, privacy, and record quality are critical.

The production stack is split into three services: Next.js 16.1.6 + React 19 frontend (port 3000), FastAPI backend (port 8080), and FastAPI room agent (port 8000). Core AI methods are WhisperX transcription with word-level timestamps, pyannote.audio diarization with adaptive speaker count, and phi4-mini summarization through Ollama. End-to-end latency is 70–100 seconds on CPU and approximately 37 seconds on GPU.

## 1.2 Project Purpose
Manual medical documentation consumes doctor time, reduces patient interaction quality, and introduces inconsistency in records. Existing cloud AI transcription products often create privacy, compliance, and cost barriers for small and medium clinics.

Alvyto solves this by providing a fully local, speaker-aware, hallucination-controlled EMR pipeline. It transforms consultations into editable structured summaries, requires doctor approval before persistence, and erases raw transcripts after approval to minimize PHI exposure by design.

## 1.3 Project Scope
| **IN SCOPE** | **OUT OF SCOPE** |
|---|---|
| Real-time consultation audio capture over WebSocket | Automated diagnosis, treatment recommendation, or clinical decision support |
| Speaker diarization and word-aligned transcription | National-scale hospital interoperability rollout (full enterprise HL7/FHIR integration) |
| Structured summary generation with transcript-grounded validation | Multi-language production optimization in v1 |
| Doctor review, inline edit, and mandatory approval workflow | Cloud SaaS multi-tenant deployment across multiple clinics |
| Patient visit records and structured history management | Regulatory certification process execution (e.g., formal HIPAA audit) |
| Appointment, queue, room, and staff administration modules | Billing, insurance claims automation, and pharmacy network integration |
| Role-based access (super_admin, admin, room_device) | Biometric identity systems |
| Append-only audit logging without PHI payload in logs | Population analytics and research reporting engine |

## 1.4 Objectives
### Main Objectives
1. Build a fully local exam-room EMR system that captures and processes doctor–patient consultation audio in real time.
2. Implement accurate speaker-aware transcription using WhisperX and pyannote.audio for clinically usable dialogue separation.
3. Generate schema-compliant structured clinical summaries using phi4-mini served locally via Ollama.
4. Enforce a zero-inference hallucination guard that validates all generated facts against transcript evidence before doctor review.
5. Deliver an operational clinic platform combining consultation documentation, record management, appointment flow, and auditable access control.

### Secondary Objectives
1. Reduce doctor documentation burden while preserving mandatory human oversight.
2. Minimize PHI retention by erasing raw transcripts after summary approval.
3. Enable thin-client room deployment using browser-only endpoints on clinic LAN.
4. Keep the architecture modular for independent updates to room agent, backend, and frontend.

## 1.5 Technology Overview
### WhisperX
WhisperX extends Whisper with forced alignment and diarization-friendly output, enabling word-level timestamps required for precise medical note attribution. Alvyto uses `small.en` with INT8 compute for clinic hardware feasibility. Segment-level-only ASR was rejected because speaker-boundary errors propagate into summary extraction. WhisperX provides robust clinical conversation capture without requiring cloud inference.

### pyannote.audio
pyannote.audio performs speaker diarization using deep speaker embeddings and clustering. Alvyto uses ResNet34 embeddings with silhouette-based adaptive speaker count so the pipeline does not hardcode two speakers. This avoids mislabeling when a third voice (assistant or family member) enters a consultation. Diarized segments are merged with aligned ASR words for downstream structured extraction.

### phi4-mini
phi4-mini (3.8B, Q4_K_M) was selected after comparative benchmarking against qwen2.5:3b, qwen3:4b, and llama3.1:8b. It produced 1.00 support rate and 100% schema compliance across benchmark scenarios. qwen3:4b was disqualified due to token-budget consumption by hybrid reasoning traces before valid JSON output. phi4-mini offers quality-speed balance suitable for clinic latency constraints.

### FastAPI
FastAPI powers backend APIs, authentication, and room-agent orchestration interfaces. The backend implements JWT HS256, bcrypt-12 password hashing, RBAC roles, and append-only audit logging. SQLAlchemy models maintain structured patient, visit, queue, and administration data. FastAPI was chosen for high-performance async endpoints and clean schema-driven development.

### Next.js 16.1.6 + React 19
The frontend provides the doctor workflow (recording, transcript review, summary editing, approval) and administrative dashboard. Role-aware routing restricts room devices to room-scoped operations. UI behavior includes amber highlighting for unsupported summary items and mandatory approval gating before commit. Browser-only clients keep room hardware lightweight and easy to maintain.

## 1.6 Synopsis
In each consultation, room audio is streamed from browser to room agent over WebSocket, transcribed and aligned by WhisperX, diarized by pyannote.audio, summarized by phi4-mini, and validated against transcript evidence under strict support thresholds; the doctor then edits or approves the output, after which the backend commits structured records, updates patient history, logs the event in immutable audit trails, and erases raw transcript content to enforce PHI minimization.

---

# CHAPTER 2: LITERATURE SURVEY

## 2.1 Introduction
Clinical documentation automation evolved from post-visit dictation tools to ambient listening systems combining ASR, speaker attribution, and clinical NLP. Early workflows reduced typing effort but still required clinicians to manually structure notes and verify context. Modern transformer ASR and clinical summarization models improved raw transcription and synthesis quality, but reliability and governance remain unresolved in many deployments.

Recent systems emphasize convenience and scale, often through cloud-native architecture. However, healthcare environments with strict data control requirements need local processing, deterministic output structure, and strong hallucination containment. For this project, literature was evaluated on real-time behavior, diarization, deployment model (local/cloud), hallucination validation controls, EMR integration fit, openness, and operational cost.

## 2.2 Related Works
| System / Tool | Real-Time? | Speaker Diarization? | Local / Cloud | Hallucination Validation? | Integrated EMR? | Open Source? | Cost Model |
|---|---|---|---|---|---|---|---|
| Dragon Medical One | Near real-time dictation | Limited (primarily single-speaker dictation) | Cloud | No explicit transcript-grounded validator | Partial via integrations | No | Subscription (high recurring) |
| Amazon Transcribe Medical | Streaming supported | Limited channel/speaker options | Cloud | No built-in clinical fact support gate | No native EMR; API integration required | No | Usage-based API billing |
| Nuance DAX | Ambient workflow | Proprietary | Cloud | Proprietary safeguards, no transparent token-level support test | Yes (enterprise integrations) | No | Enterprise contract |
| Epic Ambient Listening | Ambient in Epic workflow | Proprietary | Cloud-assisted enterprise stack | No public zero-inference mechanism | Yes (Epic-native) | No | Enterprise licensing |
| Google Med-PaLM (research) | Not production ambient system | Not primary focus | Cloud/research | Research safety layers, not transcript support enforcement in clinical deployment | No direct clinic EMR productization | No | Research/enterprise |
| Standard Whisper | Batch/stream wrappers possible | No native diarization | Local or cloud wrappers | No | No | Yes | Low infra cost |
| Alvyto (this work) | Yes (consultation stream + post-stop summarization) | Yes (pyannote adaptive) | Fully local | Yes (ratio > 0.72, token coverage ≥ 60%) | Yes (visit + admin workflow) | Partially (open stack, integrated system project) | One-time infra + maintenance |

## 2.3 Survey Analysis and Research Gap
Table 2.2 shows that existing market solutions generally optimize either enterprise integration or transcription convenience, but not transparent hallucination governance under local deployment constraints. Cloud-first systems provide high availability but introduce recurring cost and PHI transmission risk. Open ASR tools are flexible but typically do not provide end-to-end clinic workflow integration or validated clinical summarization.

The gap addressed by Alvyto is the combination of **(i)** full local operation, **(ii)** speaker-aware consultation structuring, **(iii)** strict transcript-grounded hallucination validation before persistence, and **(iv)** integrated EMR plus clinic operations in one system. This closes the practical gap between standalone ASR research tooling and deployable clinic-grade documentation workflow.

---

# CHAPTER 3: PROJECT MANAGEMENT

## 3.1 Project Planning
Project planning focused on risk-first implementation: highest uncertainty components (real-time AI pipeline and summarization safety) were built first, followed by backend/frontend modules and staged integration.

### 3.1.1 Software Scope
| Area | Planned Scope |
|---|---|
| Core AI | ASR, diarization, summarization, support validation |
| Clinical Data | Patient records, visits, history, approvals |
| Security | JWT authentication, RBAC, token revocation, audit trail |
| Operations | Rooms, appointments, waiting queue, doctor availability |
| Deployment | Hub-and-spoke local clinic setup |

### 3.1.2 Resources
#### Human Resources
| Role | Responsibility |
|---|---|
| AI/ML Engineering | WhisperX, pyannote, benchmarking, prompt + validation pipeline |
| Backend Engineering | FastAPI APIs, SQLAlchemy models, RBAC, audit logs |
| Frontend Engineering | Doctor UI, admin dashboard, stateful review workflow |
| QA & Documentation | Test cases, validation tracking, project reporting |

#### Software Resources
| Resource | Use |
|---|---|
| Python 3.11+ | Backend and room agent runtime |
| FastAPI + Uvicorn | API and service hosting |
| WhisperX | Transcription with alignment |
| pyannote.audio | Diarization |
| Ollama | Local LLM serving |
| phi4-mini (Q4_K_M) | Clinical summary generation |
| Next.js 16.1.6 + React 19 | Frontend |
| SQLAlchemy + SQLite | Persistence |

#### Environment Resources
| Resource | Configuration |
|---|---|
| Server (minimum) | 16 GB RAM, modern CPU |
| Server (recommended) | GPU-enabled (e.g., RTX 3060 class) |
| Room endpoint | Browser-only thin client |
| Network | Local clinic LAN |

## 3.2 Project Scheduling
| Phase | Work Package | Duration |
|---|---|---|
| 1 | Literature survey, architecture definition, risk mapping | Week 1–2 |
| 2 | Environment setup, dependencies, model runtime validation | Week 3 |
| 3 | Room agent core pipeline (ASR + diarization + summary) | Week 4–5 |
| 4 | Hallucination validation and benchmark-driven model selection | Week 6 |
| 5 | Backend API, data models, auth, audit logging | Week 7–8 |
| 6 | Frontend doctor and admin modules | Week 9–10 |
| 7 | Integration, system testing, defect closure | Week 11 |
| 8 | Documentation, final validation, report preparation | Week 12–13 |

## 3.3 Risk Management
### 3.3.1 Risk Identification and Projection (R1–R17)
| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Pipeline drift between ASR, diarization, summary | Medium | High | Stage-wise validation and schema checkpoints |
| R2 | Streaming packet loss | Medium | High | Buffered chunking + retry and ACK logic |
| R3 | Context fragmentation in long consults | High | Medium | Context stitching and boundary-aware merge |
| R4 | Model cold start latency | Medium | Medium | Pre-warm models on service startup |
| R5 | Database write bottleneck | Medium | High | Async operations and optimized transaction scope |
| R6 | Tight coupling cascade failure | Low | High | Service modularity with failure isolation |
| R7 | Session state inconsistency | Medium | High | Session IDs and state checkpoints |
| R8 | WebSocket ordering issues | Medium | Medium | Timestamped messages and ordering reconciliation |
| R9 | Clinical misinterpretation by model | Medium | Very High | Zero-inference prompts + mandatory doctor approval |
| R10 | Over-trust in automation | Low | Very High | UX warnings and enforced review-before-commit |
| R11 | Missing non-verbal context | High | Medium | Explicit limitation disclosure and manual edit support |
| R12 | Workflow disruption from latency | Medium | Medium | GPU recommendation and pipeline optimization |
| R13 | User resistance | Medium | Medium | Minimal-interaction UI and onboarding |
| R14 | Session-level PHI exposure | Low | Very High | No PHI in logs + memory lifecycle controls |
| R15 | Data retention beyond need | Medium | High | Auto deletion of transcript after approval |
| R16 | Performance drop with concurrent sessions | High | High | Queue control and horizontal scale strategy |
| R17 | Model version inconsistency | Low | Medium | Version pinning and deployment manifest tracking |

---

# CHAPTER 4: SYSTEM REQUIREMENTS

## 4.1 User Characteristics
1. **Doctors / Healthcare Professionals (Primary Users):** Use the room interface during and immediately after consultation, verify transcript-grounded summary output, and approve final records.
2. **Clinic Staff / Medical Assistants (Secondary Users):** Manage appointments, patient flow, waiting queue, and routine administrative updates.
3. **System Administrators (Technical Users):** Configure deployments, manage model/runtime versions, monitor service health, and maintain role/access policies.

> **Note:** Patients are not direct software users in Alvyto; they are subjects of medical records.

## 4.2 Functional Requirements (FR1–FR8)
| ID | Requirement |
|---|---|
| FR1 | Capture and stream consultation audio in real time from room browser to room agent via WebSocket. |
| FR2 | Perform word-aligned transcription using WhisperX small.en (INT8) for clinically readable dialogue output. |
| FR3 | Execute speaker diarization with pyannote.audio and adaptive speaker count detection. |
| FR4 | Generate schema-compliant clinical JSON summaries using phi4-mini through Ollama. |
| FR5 | Validate each generated fact against transcript evidence using fuzzy support thresholds (ratio > 0.72, token coverage ≥ 60%). |
| FR6 | Provide doctor review UI with inline edits, unsupported-item highlighting, and mandatory approval gate. |
| FR7 | Manage patient visits, history, appointments, room assignment, and queue workflows. |
| FR8 | Enforce secure multi-role access (super_admin, admin, room_device), server-side token revocation, and append-only audit logging without PHI payload content. |

## 4.3 Non-Functional Requirements (NFR1–NFR6)
| ID | Requirement |
|---|---|
| NFR1 | Performance: End-to-end post-stop latency 70–100 s on CPU, ~37 s on GPU under benchmarked conditions. |
| NFR2 | Accuracy: Model selection must achieve high support reliability; phi4-mini benchmark achieved support rate 1.00 and 100% schema compliance. |
| NFR3 | Security & Privacy: JWT HS256, bcrypt-12, no raw transcript persistence, no PHI in audit logs, transcript deletion after approval. |
| NFR4 | Reliability: Stable long-session streaming and recoverable WebSocket interruptions with controlled job queue behavior. |
| NFR5 | Usability: Doctor workflow must allow quick scan, edit, and approval with visual emphasis on unsupported items. |
| NFR6 | Maintainability & Scalability: Three-service modular design supports independent updates and staged scaling. |

## 4.4 Hardware and Software Requirements
### 4.4.1 Hardware Requirements
| Component | Minimum | Recommended |
|---|---|---|
| CPU | Modern quad-core (i5/Ryzen 5 class) | i7/Ryzen 7+ |
| GPU | Not required | NVIDIA RTX 3060 class or equivalent |
| RAM | 16 GB | 32 GB |
| Storage | 20 GB SSD | 50 GB+ SSD |
| Network | Local LAN | Gigabit LAN |

### 4.4.2 Software Requirements
| Component | Technology | Version |
|---|---|---|
| Backend language | Python | 3.11+ |
| Backend framework | FastAPI + Uvicorn | Stable latest |
| Frontend | Next.js + React + TypeScript | 16.1.6 + 19 + 5.x |
| ASR | WhisperX | Stable latest |
| Diarization | pyannote.audio | 3.x |
| LLM serving | Ollama | Stable latest |
| LLM | phi4-mini (Q4_K_M) | Pinned production build |
| Database | SQLite (single-clinic deployment) | Migration-ready |

## 4.5 Deployment Architecture
Alvyto uses a **hub-and-spoke** topology. One clinic server hosts frontend (`:3000`), backend (`:8080`), and room agent (`:8000`). Room and admin PCs access via browser on LAN as thin clients. No consultation audio or transcript leaves the local network. This architecture reduces endpoint complexity while centralizing model and data controls.

---

# CHAPTER 5: SYSTEM ANALYSIS

## 5.1 Study of Current System
Current clinical documentation approaches were analyzed in four categories:
1. **Manual documentation:** High cognitive overhead, delayed record completion, and inconsistent structure.
2. **Conventional EMR platforms:** Strong storage/reporting but still manual data entry heavy.
3. **Dictation tools:** Improve text capture but usually lack full speaker separation and structured EMR logic.
4. **Cloud AI ambient systems:** Better automation but depend on external infrastructure, recurring cost, and PHI transfer.

## 5.2 Problems in Current System
- Manual documentation reduces doctor-patient attention quality.
- Conversation context is often lost in post-visit notes.
- Many AI summaries lack explicit hallucination containment.
- Cloud dependency increases privacy and governance burden.
- Tooling is fragmented across transcription, summary, and admin operations.
- Workflow approval control is weak in several existing systems.

## 5.3 Requirements of New System
1. Local real-time consultation audio ingestion.
2. Accurate speaker-aware transcript generation.
3. Structured summary extraction with deterministic JSON schema.
4. Transcript-grounded fact validation before display.
5. Mandatory doctor edit/approval step before persistence.
6. PHI-minimized lifecycle with transcript deletion after approval.
7. Unified EMR + operational workflow support.
8. Secure role-based access with immutable, non-PHI audit events.

## 5.4 Process Model
Alvyto followed an **Incremental + Agile-Waterfall Hybrid** model over 13 weeks. Waterfall discipline was used at phase boundaries (requirements, architecture, test gates), while agile iteration was used within phases for component-level refinement.

The **highest-risk service (room agent AI pipeline)** was implemented first and validated independently (transcription, diarization, summarization, hallucination guard, latency). Backend and frontend were then developed in parallel with contract-first API alignment. Integration testing occurred after each service milestone, not only at the end, reducing cascading defects and stabilizing deployment behavior.

## 5.5 Feasibility Study
- **Technical Feasibility:** Open-source stack and validated models demonstrate practical deployment on clinic-grade infrastructure.
- **Operational Feasibility:** Browser-first interfaces align with current clinic workflows and require limited user retraining.
- **Economic Feasibility:** Local deployment avoids recurring cloud API expenditure; cost is primarily one-time server provisioning and maintenance.
- **Schedule Feasibility:** Risk-first staging and modular implementation enabled completion within final-year project timeline.

## 5.6 Features of New System
1. **Real-time consultation capture:** Streams room audio continuously during consultation.
2. **Word-aligned transcription:** Produces timestamped text suitable for precise review.
3. **Adaptive diarization:** Dynamically estimates active speaker count and labels dialogue.
4. **Structured clinical JSON generation:** Outputs machine-consumable summary fields.
5. **Hallucination guard:** Blocks unsupported claims via transcript evidence scoring.
6. **Doctor-in-the-loop approval:** Ensures human clinical authority over final record.
7. **PHI minimization lifecycle:** Raw transcript deletion after approved commit.
8. **Integrated clinic operations:** Includes appointments, room assignment, and queue management.
9. **Role-secured access model:** Enforces scoped permissions and token revocation.
10. **Immutable audit traceability:** Captures accountable actions without storing PHI narrative payload.

---

# CHAPTER 6: DETAILED DESCRIPTION

## 6.1 Doctor / User Module
The doctor module is optimized for low-friction room workflow. Doctors authenticate via room device context, start/stop capture, inspect live and post-processed output, edit summary items inline, and approve final records. Unsupported claims appear in amber to prioritize correction. Transcript side panel enables evidence verification without leaving the screen. Approval commits structured data and triggers transcript erasure.

## 6.2 System / Backend Module
The backend manages authentication, persistence, workflow transitions, and audit integrity. It includes core models: Patient, MedicalHistory, Visit, Room, Doctor, DoctorAvailability, Appointment, WaitingQueue, AdminUser, and AuditLog. On approval, structured fields are persisted, history is updated with deduplication logic, and raw transcript fields are cleared. JWT HS256 and bcrypt-12 secure identity workflows; token hashes support revocation controls.

## 6.3 Administrator Module
Admin workflows cover patient registration, doctor availability, room allocation, queue monitoring, appointment scheduling, user management, and audit-log review. Super_admin users can manage admin accounts and global settings; admin users handle routine clinic operations. The module is built for operational continuity rather than clinical authoring.

---

# CHAPTER 7: TESTING

## 7.1 Black Box Testing
| Test ID | Scenario | Input | Expected Output | Result |
|---|---|---|---|---|
| BB01 | Real-time audio capture | Live consultation audio | Continuous stream without interruption | Pass |
| BB02 | WhisperX transcription | Doctor–patient conversation | Accurate text with word-level alignment | Pass |
| BB03 | Speaker diarization | Multi-speaker audio | Correct doctor/patient segmentation | Pass |
| BB04 | Hallucination validation | Transcript + LLM output | Unsupported facts flagged | Pass |
| BB05 | AI summarization | Diarized transcript | Valid JSON summary in expected latency band | Pass |
| BB06 | Doctor inline edit | Chip modification | Direct update without full regenerate | Pass |
| BB07 | Paragraph regeneration | Edited chips + transcript | Regenerated paragraphs aligned to edits | Pass |
| BB08 | Visit approval | Doctor approves | Summary committed, transcript erased, history merged | Pass |
| BB09 | Patient history retrieval | Patient ID | Prior visits and summaries displayed | Pass |
| BB10 | Record editing | Existing summary update | Updated record persisted | Pass |
| BB11 | Appointment scheduling | New booking details | Conflict-free appointment created | Pass |
| BB12 | Room allocation | Room-doctor mapping | Assignment and PIN generation | Pass |
| BB13 | Invalid audio input | Corrupted stream | Graceful error response | Pass |
| BB14 | JWT revocation | Logout then token reuse | Reused token rejected | Pass |
| BB15 | Room scope control | room_device token | Access limited to assigned room | Pass |

## 7.2 White Box Testing
| Test ID | Module / Function | Internal Scenario | Expected Behaviour | Result |
|---|---|---|---|---|
| WB01 | WebSocket + VAD pipeline | Streaming chunk order | Ordered processing with silence trimming | Pass |
| WB02 | WhisperX config path | INT8 + thread params | Stable model load and transcript output | Pass |
| WB03 | Diarization clustering | Silhouette adaptive count | Dynamic speaker count selection | Pass |
| WB04 | Alignment merger | Segment-word merge | Correct speaker-word attribution | Pass |
| WB05 | Fuzzy matcher | Paraphrased claim input | Ratio threshold logic applied | Pass |
| WB06 | Token coverage logic | Partial overlap case | Minimum 60% token evidence enforced | Pass |
| WB07 | Prompt constraints | Zero-inference instruction handling | No unsupported free-form generation admitted | Pass |
| WB08 | Output parser | Markdown fence contamination | Clean JSON extraction | Pass |
| WB09 | Auth middleware | Expired/revoked token path | Rejection with auth failure response | Pass |

## 7.3 Test Cases (TC01–TC15)
| Test ID | Module | Description | Expected Output | Status |
|---|---|---|---|---|
| TC01 | Audio Pipeline | Capture live consultation stream | Stable real-time audio capture | Pass |
| TC02 | Transcription | Convert speech to text | Accurate aligned transcript | Pass |
| TC03 | Diarization | Separate speakers | Correct speaker labels | Pass |
| TC04 | Validation | Detect unsupported claims | Proper support flag assignment | Pass |
| TC05 | Summarization | Generate structured summary | Schema-compliant JSON output | Pass |
| TC06 | Doctor Edit | Modify summary items | Immediate update reflected | Pass |
| TC07 | Regeneration | Regenerate narrative | Paragraphs aligned to edited fields | Pass |
| TC08 | Approval | Finalize visit | Record saved, transcript removed | Pass |
| TC09 | History | Fetch prior consultations | Complete prior records displayed | Pass |
| TC10 | Record Mgmt | Update existing record | Data updated in storage | Pass |
| TC11 | Scheduling | Create appointment | Conflict-safe scheduling | Pass |
| TC12 | Room Mgmt | Assign room and PIN | Valid assignment artifact | Pass |
| TC13 | Error Handling | Handle invalid audio input | User-readable error path | Pass |
| TC14 | Auth Security | Validate token revocation | Token reuse blocked | Pass |
| TC15 | RBAC | Enforce room-device boundaries | Cross-room access denied | Pass |

## 7.4 Model Benchmark
### 7.4.1 Raw Benchmark Scores
| Model | Test Case | Time (s) | JSON OK | Schema OK | Support Rate | Categories Valid | Pass |
|---|---:|---:|---|---|---:|---:|---|
| qwen2.5:3b | GP Headache | 10.3 | Yes | Yes | 1.00 | 6/6 | Yes |
| qwen2.5:3b | Diabetes | 7.4 | Yes | Yes | 0.89 | 5/6 | Yes |
| qwen2.5:3b | Sore Throat | 6.9 | Yes | Yes | 0.90 | 5/6 | Yes |
| qwen3:4b | GP Headache | 41.5 | No | No | 0.00 | 0/0 | No |
| qwen3:4b | Diabetes | 30.0 | No | No | 0.00 | 0/0 | No |
| qwen3:4b | Sore Throat | 30.7 | No | No | 0.00 | 0/0 | No |
| phi4-mini | GP Headache* | 25.4 | Yes | Yes | 1.00 | 6/6 | Yes |
| phi4-mini | Diabetes | 7.6 | Yes | Yes | 1.00 | 6/6 | Yes |
| phi4-mini | Sore Throat | 9.2 | Yes | Yes | 1.00 | 5/5 | Yes |
| llama3.1:8b | GP Headache | 22.4 | Yes | Yes | 1.00 | 6/6 | Yes |
| llama3.1:8b | Diabetes | 16.0 | Yes | Yes | 1.00 | 6/6 | Yes |
| llama3.1:8b | Sore Throat | 12.3 | Yes | Yes | 1.00 | 5/6 | Yes |

*Cold start; warm phi4-mini inference measured at ~7.6 s.

### 7.4.2 Aggregate Summary
| Model | Avg Time | JSON Compliance | Schema Compliance | Avg Support Rate | Decision |
|---|---:|---:|---:|---:|---|
| qwen2.5:3b | 7.1 s | 100% | 100% | 0.93 | Rejected (paraphrase risk) |
| qwen3:4b | 33.4 s | 0% | 0% | 0.00 | Disqualified |
| phi4-mini | 12.1 s (7.6 s warm) | 100% | 100% | 1.00 | **Selected** |
| llama3.1:8b | 15.3 s | 100% | 100% | 1.00 | Rejected (CPU latency/size tradeoff) |

### 7.4.3 Key Findings
- qwen3:4b failed under constrained output budget due to excessive hybrid reasoning token usage before producing valid schema output.
- qwen2.5:3b was faster but had insufficiently strict support behavior for zero-inference clinical use.
- llama3.1:8b met quality targets but imposed higher latency and footprint penalties.
- phi4-mini was selected for best quality-governance-latency balance, achieving support rate 1.00 and schema compliance 100%.

---

# CHAPTER 8: SYSTEM DESIGN

## 8.1 Class Diagram (Textual Description)
The design includes ten primary models: **Patient**, **MedicalHistory**, **Visit**, **Doctor**, **DoctorAvailability**, **Room**, **Appointment**, **WaitingQueue**, **AdminUser**, and **AuditLog**. `Patient` has a one-to-one relation with `MedicalHistory`, and one-to-many relation with `Visit` and `Appointment`. `Doctor` links to `DoctorAvailability`, `Appointment`, and room assignment contexts. `Visit` references patient and room/doctor context, stores structured summary, and excludes permanent raw transcript retention post-approval. `AdminUser` manages authentication role metadata. `AuditLog` references actor/entity IDs and immutable action metadata.

## 8.2 Use Case Diagram (Textual Description)
Actors: **Doctor**, **Clinic Staff/Admin**, **System Administrator**, and **Room Device**. Core doctor use cases: start recording, review transcript, edit summary, approve visit. Staff/admin use cases: register patient, schedule appointment, manage room queue, update doctor availability. System admin use cases: manage user roles, monitor audit logs, maintain deployment configurations. Room device use case is constrained to room-specific consultation workflows.

## 8.3 Sequence Diagram (Main Consultation Flow)
1. Doctor starts session on room client.
2. Browser streams audio chunks to room agent.
3. Room agent runs ASR + diarization + summary + support validation.
4. Structured output is returned to frontend.
5. Doctor edits/approves.
6. Frontend sends approval to backend.
7. Backend commits structured visit/history update, writes audit event, clears transcript fields.
8. Confirmation returned to doctor UI.

## 8.4 Activity Diagram (Flow Description)
Consultation activity begins at patient selection and recording start, proceeds through streaming capture and AI processing branches, converges at doctor review, then decision node: **Edit** (loop back to validate/regenerate as needed) or **Approve** (commit and close session). A rejection or defer branch preserves draft state without permanent commit.

## 8.5 Data Flow Diagram (DFD Description)
- **Level 0:** External entities (Doctor, Admin, Room Device) interact with Alvyto EMR System; outputs include structured records and operational updates.
- **Level 1:** Processes split into Authentication, Consultation Processing, Record Management, and Admin Operations; data stores include Patient DB, Visit DB, Queue DB, AuditLog DB.
- **Level 2 (Consultation Processing):** Audio stream intake → ASR alignment → diarization merge → summary generation → support validator → doctor review/approval → final persistence and transcript purge.

---

# CHAPTER 9: LIMITATIONS AND FUTURE ENHANCEMENTS

## 9.1 Limitations
1. CPU-only deployments show 70–100 second post-stop latency in typical runs.
2. Transcription quality degrades with severe noise or overlapping speech.
3. English-focused model stack has limited multilingual readiness in v1.
4. Current deployment targets single-clinic local infrastructure.
5. Compliance hardening (full external certification workflows) is not part of current implementation.
6. Concurrent high-volume room sessions require further queue/worker scaling strategies.

## 9.2 Future Enhancements
1. GPU-first deployment profile with automated performance tuning presets.
2. Advanced VAD and silence trimming pipeline to reduce processing overhead.
3. Incremental summarization for partial transcript pre-processing.
4. Mobile doctor approval interface for cross-room workflow continuity.
5. HL7/FHIR export adapters for enterprise EMR interoperability.
6. Multilingual ASR and terminology expansion for diverse clinical populations.
7. Compliance extensions: TLS everywhere, deeper policy controls, formal security validation.
8. Distributed room-agent scaling with centralized model/version governance.

---

# CHAPTER 10: CONCLUSION

## 10.1 Conclusion
Alvyto demonstrates that reliable AI-assisted clinical documentation can be implemented with a fully local architecture that protects PHI while remaining practical for real clinic workflows. The project integrates real-time capture, aligned transcription, adaptive diarization, transcript-grounded summarization, and mandatory doctor approval into a coherent EMR pipeline instead of isolated tooling.

Empirical model benchmarking and strict hallucination validation were decisive engineering choices. By selecting phi4-mini after quantitative testing and enforcing the zero-inference support rule, the system achieved strong factual control with deployable latency. The resulting platform is a technically valid and operationally relevant foundation for safe, scalable clinical documentation automation in resource-constrained healthcare settings.

---

# CHAPTER 11: APPENDICES

## 11.1 Business Model
Alvyto follows a B2B clinic productivity model focused on documentation-time reduction and workflow consolidation. Primary value is operational efficiency: doctors spend less time typing notes, clinics reduce tool fragmentation, and record quality improves through structured outputs and approval gates. Commercialization options include one-time on-prem deployment fee, annual support contract, or managed private-cloud enterprise package.

## 11.2 Deployment Details
- **Topology:** One clinic server, multiple room/admin thin clients.
- **Ports:** Frontend 3000, Backend 8080, Room Agent 8000.
- **Runtime order:** Start backend and room-agent services, pre-warm models, then start frontend.
- **Data policy:** Local DB storage for approved records; no raw transcript persistence post-approval.
- **Ops notes:** Maintain model/version manifest, backup DB and configs, monitor queue latency and service health.

## 11.3 API and Web Services
| Module | Interface | Purpose |
|---|---|---|
| Authentication | REST | Login, token issue/revoke, role validation |
| Room Streaming | WebSocket | Real-time audio chunk ingestion |
| Summarization | REST | Structured JSON generation and validation responses |
| Visits | REST | Save/edit/approve consultation records |
| Patients | REST | CRUD and history retrieval |
| Scheduling/Queue | REST | Appointment, room allocation, waiting flow |
| Audit | REST | Immutable operational event retrieval |

---

# BIBLIOGRAPHY (IEEE)
[1] A. Radford *et al.*, “Robust Speech Recognition via Large-Scale Weak Supervision,” *arXiv preprint arXiv:2212.04356*, 2022.  
[2] M. Bain, J. Huh, T. Han, and A. Zisserman, “WhisperX: Time-Accurate Speech Transcription of Long-Form Audio,” *arXiv preprint arXiv:2303.00747*, 2023.  
[3] H. Bredin and A. Laurent, “End-to-end speaker segmentation for overlap-aware resegmentation,” in *Proc. ICASSP*, 2023.  
[4] Microsoft Research, “Phi-4-Mini Technical Report,” 2024. [Online]. Available: https://aka.ms/phi4-mini-report  
[5] FastAPI Documentation, “FastAPI: High-performance Python APIs,” 2025. [Online]. Available: https://fastapi.tiangolo.com/  
[6] PyTorch Documentation, “PyTorch Machine Learning Framework,” 2025. [Online]. Available: https://pytorch.org/docs/  
[7] Ollama, “Run large language models locally,” 2025. [Online]. Available: https://ollama.com/  
[8] SQLAlchemy Documentation, “The Python SQL Toolkit and ORM,” 2025. [Online]. Available: https://docs.sqlalchemy.org/  
[9] Next.js Documentation, “The React framework for production,” 2025. [Online]. Available: https://nextjs.org/docs  
[10] A. Vaswani *et al.*, “Attention Is All You Need,” in *Advances in Neural Information Processing Systems*, vol. 30, 2017.

---

**End of Report**
