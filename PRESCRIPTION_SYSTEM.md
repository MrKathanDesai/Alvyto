# Alvyto EMR: Prescription System Architecture

## Overview

The Alvyto EMR system has a comprehensive prescription workflow built into the visit summary and approval process. Prescriptions are not a separate entity but part of the **VisitSummary** structure, with support for:
- **Quick Prescriptions**: Simple name/dosage/frequency extracted from conversation
- **Prescription Draft**: Rich, detailed prescription data for PDF export
- **PDF Export**: Multi-page prescription document generation

---

## 1. DATA MODEL & SCHEMA

### 1.1 Core Prescription Types (Frontend: `src/types/index.ts`)

```typescript
// Simple prescription (extracted during conversation)
export interface Prescription {
  name: string;
  dosage?: string;
  frequency?: string;
  isSupported?: boolean;  // Confidence flag
}

// Detailed prescription (for PDF export)
export interface PrescriptionMedicationDetail {
  name: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  route?: string;         // e.g., "oral", "IV"
  instructions?: string;  // Special instructions
}

// Investigations/tests prescribed
export interface PrescriptionInvestigation {
  name: string;
  details?: string;
  timing?: string;  // e.g., "immediately", "after 1 week"
}

// Follow-up instructions
export interface PrescriptionFollowUp {
  timeline?: string;  // e.g., "2 weeks", "as needed"
  notes?: string;
}

// Complete prescription draft
export interface PrescriptionDraft {
  diagnoses: string[];                        // Assessment/conditions
  medications: PrescriptionMedicationDetail[]; // Full medication list
  investigations: PrescriptionInvestigation[]; // Tests/investigations
  advice: string[];                           // Doctor's advice
  warnings: string[];                         // Safety warnings
  reportSummary: string;                      // Summary of findings
  followUp?: PrescriptionFollowUp | null;     // Follow-up care
}

// Embedded in visit summary
export interface VisitSummary {
  clinicalSnapshot: KeyFact[];        // Symptoms/conditions/actions
  doctorActions: SummaryItem[];       // Doctor's plan
  prescriptions: Prescription[];      // Quick prescriptions (simple)
  prescriptionDraft?: PrescriptionDraft | null;  // Full draft (rich)
  issuesParagraph: string;            // Narrative assessment
  actionsParagraph: string;           // Narrative action plan
}

// VisitSummary is embedded in Visit
export interface Visit {
  id: string;
  patientId: string;
  summary: VisitSummary | null;  // <-- Prescriptions live here
  status: VisitStatus;
  createdAt: string;
  endedAt?: string | null;
  // ...
}
```

### 1.2 Backend Schema (Pydantic: `backend/schemas.py` lines 19-58)

```python
class Prescription(BaseModel):
    name: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    isSupported: Optional[bool] = None

class PrescriptionMedicationDetail(BaseModel):
    name: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    duration: Optional[str] = None
    route: Optional[str] = None
    instructions: Optional[str] = None

class PrescriptionInvestigation(BaseModel):
    name: str
    details: Optional[str] = None
    timing: Optional[str] = None

class PrescriptionFollowUp(BaseModel):
    timeline: Optional[str] = None
    notes: Optional[str] = None

class PrescriptionDraft(BaseModel):
    diagnoses: List[str] = []
    medications: List[PrescriptionMedicationDetail] = []
    investigations: List[PrescriptionInvestigation] = []
    advice: List[str] = []
    warnings: List[str] = []
    reportSummary: str = ""
    followUp: Optional[PrescriptionFollowUp] = None

class VisitSummary(BaseModel):
    clinicalSnapshot: List[KeyFact] = []
    doctorActions: List[SummaryItem] = []
    prescriptions: List[Prescription] = []
    prescriptionDraft: Optional[PrescriptionDraft] = None
    issuesParagraph: str = ""
    actionsParagraph: str = ""
```

### 1.3 Database Model (SQLAlchemy: `backend/models.py` lines 255-286)

```python
class Visit(Base):
    __tablename__ = "visits"
    
    id = Column(String, primary_key=True, default=new_uuid)
    patient_id = Column(String, ForeignKey("patients.id"), index=True, nullable=False)
    doctor_id = Column(String, ForeignKey("doctors.id"), index=True, nullable=True)
    room_id = Column(String, ForeignKey("rooms.id"), index=True, nullable=True)
    appointment_id = Column(String, ForeignKey("appointments.id"), nullable=True)
    transcript = Column(Text, default="", nullable=False)
    dialogue = Column(JSON, default=list, nullable=False)
    summary = Column(JSON, nullable=True)  # <-- Prescriptions stored here as JSON
    status = Column(Enum(VisitStatusEnum, name="visit_status_enum"), 
                    default=VisitStatusEnum.pending, nullable=False)
    chief_complaint = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    approved_by = Column(String, nullable=True)
    is_deleted = Column(Boolean, default=False, nullable=False, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
```

**Key Points:**
- Prescriptions are **NOT a separate table** — they're stored as JSON in `Visit.summary`
- `Visit.summary` is a `JSON` column containing the entire `VisitSummary` object
- Prescriptions are versioned with the visit (immutable after approval)

---

## 2. VISIT SUMMARY ENDPOINTS

### 2.1 Get Visit (with Prescription Data)
**Endpoint:** `GET /api/visits/{visitId}`

**Response:**
```json
{
  "id": "visit-12345",
  "patientId": "patient-abc",
  "doctorId": "doctor-xyz",
  "summary": {
    "clinicalSnapshot": [
      { "label": "fever", "category": "symptom", "isSupported": true },
      { "label": "sore throat", "category": "symptom", "isSupported": true }
    ],
    "doctorActions": [
      { "id": "action-1", "text": "Rest for 3 days", "sourceFactIds": [], "isEdited": false }
    ],
    "prescriptions": [
      { "name": "Paracetamol", "dosage": "500mg", "frequency": "twice daily", "isSupported": true },
      { "name": "Throat lozenges", "dosage": "1 lozenge", "frequency": "every 2 hours", "isSupported": true }
    ],
    "prescriptionDraft": {
      "diagnoses": ["Acute pharyngitis"],
      "medications": [
        {
          "name": "Paracetamol",
          "dosage": "500mg",
          "frequency": "twice daily",
          "duration": "5 days",
          "route": "oral",
          "instructions": "Take with food if stomach upset occurs"
        },
        {
          "name": "Throat lozenges",
          "dosage": "1 lozenge",
          "frequency": "every 2 hours",
          "duration": "as needed",
          "route": "oral",
          "instructions": "Dissolve in mouth"
        }
      ],
      "investigations": [
        { "name": "Throat culture", "details": "Check for bacterial infection", "timing": "immediately" }
      ],
      "advice": [
        "Rest your voice",
        "Stay hydrated",
        "Avoid smoking and secondhand smoke"
      ],
      "warnings": [
        "Seek emergency care if difficulty breathing develops"
      ],
      "reportSummary": "Patient presents with acute pharyngitis. Viral etiology suspected based on clinical presentation.",
      "followUp": {
        "timeline": "3 days",
        "notes": "If symptoms persist beyond 5 days, consider antibiotics"
      }
    },
    "issuesParagraph": "Patient presents with fever and sore throat...",
    "actionsParagraph": "Prescribe paracetamol for symptomatic relief..."
  },
  "status": "completed",
  "createdAt": "2025-04-14T10:30:00Z",
  "endedAt": "2025-04-14T10:45:00Z"
}
```

### 2.2 List Visits (with Prescription Data)
**Endpoint:** `GET /api/visits`

**Query Parameters:**
- `status`: Filter by visit status (pending, in_progress, completed, cancelled)
- `doctorId`: Filter by doctor
- `patientId`: Filter by patient
- `limit`: Max results (default 50, max 200)
- `offset`: Pagination offset

**Response:** Array of Visit objects (same structure as Get Visit)

### 2.3 Create Visit (Initialize for Recording)
**Endpoint:** `POST /api/visits`

**Request:**
```json
{
  "patient_id": "patient-abc",
  "doctor_id": "doctor-xyz",
  "room_id": "room-123",
  "appointment_id": "appointment-456",
  "chief_complaint": "Sore throat and fever"
}
```

**Response:** New Visit object (status: "pending", summary: null)

### 2.4 Save Visit Progress (Mid-Session Saves)
**Endpoint:** `PATCH /api/visits/{visitId}/progress`

**Purpose:** Save transcript and dialogue without changing status (called periodically during recording)

**Request:**
```json
{
  "transcript": "Doctor: How long have you had this...",
  "dialogue": [
    { "speaker": "Doctor", "text": "How long...", "start": 0, "end": 5 },
    { "speaker": "Patient", "text": "For 3 days...", "start": 6, "end": 12 }
  ],
  "status": "in_progress"
}
```

**Response:** `{ "id": "...", "status": "in_progress" }`

---

## 3. PRESCRIPTION APPROVAL & STORAGE

### 3.1 Approve Visit (Set Prescription Draft)
**Endpoint:** `PATCH /api/visits/{visitId}/approve`

**Route:** `backend/routes/visits.py` (lines 399-506)

**Request:**
```json
{
  "summary": {
    "clinicalSnapshot": [
      { "label": "fever", "category": "symptom" }
    ],
    "doctorActions": [
      { "id": "action-1", "text": "Rest 3 days", "sourceFactIds": [], "isEdited": false }
    ],
    "prescriptions": [
      { "name": "Paracetamol", "dosage": "500mg", "frequency": "twice daily" }
    ],
    "prescriptionDraft": {
      "diagnoses": ["Acute pharyngitis"],
      "medications": [
        {
          "name": "Paracetamol",
          "dosage": "500mg",
          "frequency": "twice daily",
          "duration": "5 days",
          "route": "oral",
          "instructions": "Take with food"
        }
      ],
      "investigations": [],
      "advice": ["Rest your voice"],
      "warnings": ["Seek emergency care if breathing difficulty"],
      "reportSummary": "Acute pharyngitis suspected",
      "followUp": {
        "timeline": "3 days",
        "notes": "Review if persistent"
      }
    },
    "issuesParagraph": "Patient presents with...",
    "actionsParagraph": "Treatment plan..."
  },
  "doctor_id": "doctor-xyz"
}
```

**What This Does:**
1. Stores the `VisitSummary` (including prescriptionDraft) as JSON in `Visit.summary`
2. Sets `Visit.status = "completed"`
3. Sets `Visit.approved_at = now()` and `Visit.approved_by = doctorId`
4. **Merges prescriptions into patient's medical history:**
   - Extracts medications from `prescriptionDraft.medications`
   - Updates `MedicalHistory.medications` (replaces existing list)
   - Extracts symptoms from `clinicalSnapshot` (category="symptom")
   - Appends to `MedicalHistory.conditions` (deduped)
5. Clears PHI (transcript and dialogue set to empty)
6. Marks related appointment as "completed"
7. Releases the room

**Backend Logic (lines 414-458):**
```python
def approve_visit(visit_id: str, body: VisitApprove, ...):
    visit = db.query(Visit).filter(...).first()
    visit.summary = body.summary.model_dump()  # Store full prescription draft
    
    # Merge into medical history
    med_history = db.query(MedicalHistory).filter(...).first()
    if not med_history:
        med_history = MedicalHistory(patient_id=visit.patient_id, 
                                      conditions=[], allergies=[], medications=[])
    
    # Add symptoms to conditions
    new_conditions = list(med_history.conditions or [])
    for fact in body.summary.clinicalSnapshot:
        if fact.category == "symptom":
            new_conditions.append(fact.label)
    
    # Replace medications with newly prescribed
    new_medications = []
    for rx in body.summary.prescriptions:
        new_medications.append({
            "name": rx.name,
            "dosage": rx.dosage,
            "frequency": rx.frequency
        })
    
    med_history.conditions = new_conditions
    med_history.medications = new_medications
    visit.status = VisitStatusEnum.completed
    visit.approved_at = now()
    db.commit()
```

---

## 4. PRESCRIPTION PDF EXPORT

### 4.1 Backend HTML Export Endpoint
**Endpoint:** `GET /api/visits/{visitId}/prescription`

**Route:** `backend/routes/visits.py` (lines 297-319)

**Returns:** HTML (text/html) — can be printed to PDF

**Prerequisites:**
- Visit must be in "completed" status
- Must have a valid `prescriptionDraft` in summary

**Response Headers:**
```
Content-Type: text/html; charset=utf-8
Content-Disposition: attachment; filename="prescription-{patient}-{id}.html"
```

### 4.2 Backend HTML Template
**Function:** `_build_prescription_html()` (lines 112-217 in `backend/routes/visits.py`)

**Data Used:**
- Patient name, MRN, DOB, gender (from Patient model)
- Doctor name, specialty (from Visit.doctor)
- Allergies (from Patient.medicalHistory.allergies)
- All prescription fields (from Visit.summary.prescriptionDraft)
- Visit date (from Visit.createdAt)

**HTML Sections:**
1. **Header** — Patient info card (name, MRN, DOB, sex, allergies)
2. **Assessment** — Diagnoses from `prescriptionDraft.diagnoses`
3. **Medications** — Formatted list from `prescriptionDraft.medications`
4. **Reports & Investigations** — From `reportSummary` and `investigations`
5. **Advice** — From `prescriptionDraft.advice`
6. **Warnings & Follow-up** — From `warnings` and `followUp`
7. **Footer** — Doctor signature line, issue date, visit reference

### 4.3 Frontend PDF Export
**File:** `src/utils/prescriptionExport.ts` (499 lines)

**Main Function:** `triggerPrescriptionDownload(filename, params)`

**Features:**
- Uses `pdf-lib` library for PDF generation
- Creates multi-page PDF with professional layout
- Draws:
  - Header with "ALVYTO CLINICAL PRESCRIPTION"
  - Patient demographics box
  - Allergies alert box (red if present)
  - Assessment section
  - Medication list with dosage/frequency/instructions
  - Investigations and advice
  - Doctor signature line
  - Page breaks when content overflows

**Parameters:**
```typescript
{
  visit: Visit;              // The visit object
  patient?: EMRPatient | null;    // Patient data (optional — uses from API)
  doctor?: Doctor | null;         // Doctor data (optional — uses from API)
  allergies?: string[];           // Allergies list (optional)
}
```

**Data Normalization:** `normalizeDraft()` (lines 49-101)
- If `prescriptionDraft` exists with medications → use as-is
- Fallback: extract from `prescriptions` array
- Fallback: extract diagnoses from `clinicalSnapshot`
- Fallback: extract advice from `doctorActions`

**Usage in Components:**
```typescript
// From visit summary/detail pages
await triggerPrescriptionDownload(
  `prescription-${patient.name}-${visit.id.slice(0, 8)}.pdf`,
  { visit, patient, doctor, allergies: patient?.medicalHistory?.allergies }
);
```

---

## 5. PRESCRIPTION-RELATED COMPONENTS & PAGES

### 5.1 PrescriptionPreview Component
**File:** `src/components/PrescriptionPreview/PrescriptionPreview.tsx` (159 lines)

**Purpose:** Display prescription draft in UI (preview before approval)

**Props:**
```typescript
interface PrescriptionPreviewProps {
  patient: EMRPatient;
  doctorName?: string | null;
  visitDate?: string | null;
  draft: PrescriptionDraft;
  allergies?: string[];
}
```

**Displays:**
- Patient meta (MRN, age, gender, allergies)
- Diagnoses (as chips)
- Medications (cards with dosage, frequency, instructions)
- Investigations/reports
- Advice (bulleted list)
- Warnings and follow-up

### 5.2 SummaryPanel Component
**File:** `src/components/SummaryPanel/SummaryPanel.tsx` (441 lines)

**Purpose:** Edit clinical snapshot and doctor actions (affects prescriptions indirectly)

**Features:**
- Edit clinical snapshot (symptoms, conditions, actions)
- Edit doctor actions (advice items)
- Auto-expand narrative paragraphs via `/expand` API call
- Triggers prescription draft regeneration (via AI pipeline)

### 5.3 Visit Summary Page (Admin)
**File:** `src/app/admin/visits/page.tsx`

**Features:**
- List all visits with status
- View visit details
- Download prescription PDF
- Approve visits (set summary/prescriptions)

---

## 6. API FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│ VISIT LIFECYCLE & PRESCRIPTION FLOW                             │
└─────────────────────────────────────────────────────────────────┘

STEP 1: CREATE VISIT
  POST /api/visits
  ↓
  CREATE Visit(status=pending, summary=null)

STEP 2: RECORD & SAVE PROGRESS (During Session)
  PATCH /api/visits/{id}/progress (multiple times)
  ↓
  UPDATE Visit(transcript, dialogue)

STEP 3: AI PIPELINE (External)
  Transcription → ASR → NLU → Medical NER → Summary Generation
  ↓
  Returns PrescriptionDraft with medications, advice, warnings

STEP 4: DOCTOR REVIEW & APPROVAL
  PATCH /api/visits/{id}/approve
  Request includes: VisitSummary with prescriptionDraft
  ↓
  - Store summary as JSON in Visit.summary
  - Merge medications into Patient.medicalHistory.medications
  - Set Visit.status = "completed"
  - Mark appointment as "completed"
  - Clear transcript/dialogue (PHI protection)

STEP 5: PRESCRIPTION EXPORT
  GET /api/visits/{id}/prescription (backend)
  ↓ (HTML returned)
  ↓
  Frontend calls triggerPrescriptionDownload()
  ↓
  Generate PDF using pdf-lib
  ↓
  Download as {patient-name}-{visit-id}.pdf

STEP 6: ARCHIVE (Medical History)
  Patient.medicalHistory.medications
  Patient.medicalHistory.conditions
  (Kept for future reference)
```

---

## 7. DATA STRUCTURE EXAMPLES

### 7.1 Minimal Prescription (Quick Extraction)
```json
{
  "prescriptions": [
    { "name": "Aspirin", "dosage": "500mg", "frequency": "daily" },
    { "name": "Ibuprofen", "dosage": "400mg", "frequency": "every 6 hours" }
  ]
}
```

### 7.2 Full Prescription Draft (Detailed)
```json
{
  "prescriptionDraft": {
    "diagnoses": ["Type 2 Diabetes", "Hypertension"],
    "medications": [
      {
        "name": "Metformin",
        "dosage": "1000mg",
        "frequency": "twice daily",
        "duration": "ongoing",
        "route": "oral",
        "instructions": "Take with meals. Do not crush tablets."
      },
      {
        "name": "Lisinopril",
        "dosage": "10mg",
        "frequency": "once daily",
        "duration": "ongoing",
        "route": "oral",
        "instructions": "Take in morning. Report dizziness."
      }
    ],
    "investigations": [
      {
        "name": "HbA1c",
        "details": "Monitor glycemic control",
        "timing": "every 3 months"
      },
      {
        "name": "Blood pressure",
        "details": "Monitor BP control",
        "timing": "weekly at home"
      }
    ],
    "advice": [
      "Reduce salt intake",
      "Regular exercise 30 min/day",
      "Dietary consultation recommended"
    ],
    "warnings": [
      "Watch for signs of hypoglycemia",
      "Report persistent dry cough"
    ],
    "reportSummary": "Patient well-controlled on current regimen. Continue current therapy.",
    "followUp": {
      "timeline": "4 weeks",
      "notes": "Recheck BP and glucose. Review medications."
    }
  }
}
```

### 7.3 Complete Visit with Prescription
```json
{
  "id": "visit-xyz",
  "patientId": "patient-123",
  "doctorId": "doctor-456",
  "status": "completed",
  "createdAt": "2025-04-14T10:00:00Z",
  "endedAt": "2025-04-14T10:30:00Z",
  "approvedAt": "2025-04-14T10:35:00Z",
  "approvedBy": "doctor-456",
  "summary": {
    "clinicalSnapshot": [
      { "label": "fever 38.5C", "category": "symptom", "isSupported": true },
      { "label": "cough 3 days", "category": "symptom", "isSupported": true }
    ],
    "doctorActions": [
      { "id": "a1", "text": "Rest for 5 days", "sourceFactIds": [], "isEdited": false },
      { "id": "a2", "text": "Follow up if no improvement", "sourceFactIds": [], "isEdited": true }
    ],
    "prescriptions": [
      { "name": "Amoxicillin", "dosage": "500mg", "frequency": "every 8 hours", "isSupported": true }
    ],
    "prescriptionDraft": {
      "diagnoses": ["Upper respiratory infection"],
      "medications": [
        {
          "name": "Amoxicillin",
          "dosage": "500mg",
          "frequency": "every 8 hours",
          "duration": "7 days",
          "route": "oral",
          "instructions": "Complete full course. Take with water."
        }
      ],
      "investigations": [],
      "advice": ["Rest", "Hydration"],
      "warnings": ["Allergy risk"],
      "reportSummary": "URI suspected, likely viral",
      "followUp": { "timeline": "1 week", "notes": "If no improvement" }
    },
    "issuesParagraph": "Patient presents with fever and cough for 3 days...",
    "actionsParagraph": "Symptomatic treatment with rest and hydration recommended..."
  }
}
```

---

## 8. CURRENT LIMITATIONS & GAPS

1. **No Prescription History:**
   - Prescriptions are versioned with visits but not separately queryable
   - No "get all prescriptions for patient" endpoint
   - Requires fetching all patient visits to see prescription history

2. **No Medication Database:**
   - No drug database for validation (name, contraindications, interactions)
   - Medications stored as free text strings
   - No dosage validation or conversion

3. **No Prescription Editing After Approval:**
   - Once approved, prescription is immutable
   - Would require creating a new visit to modify

4. **Limited Prescription Tracking:**
   - No "dispensed", "fulfilled", "expired" status tracking
   - No refill tracking
   - No reconciliation with pharmacy systems

5. **Simple Allergy Handling:**
   - Allergies stored as JSON array in medical_history
   - No severity levels or reaction types
   - No drug-allergy interaction checking

6. **PDF Export Only to HTML:**
   - Backend returns HTML (requires client-side PDF generation)
   - No server-side PDF generation
   - Limited formatting options compared to true PDF libraries

---

## 9. KEY FILES REFERENCE

| Component | Location | Lines | Purpose |
|-----------|----------|-------|---------|
| Visit Model | `backend/models.py` | 255-286 | SQLAlchemy Visit model with summary JSON |
| Schemas | `backend/schemas.py` | 19-105 | Pydantic schemas for prescription types |
| Visits API | `backend/routes/visits.py` | 399-506 | Approve endpoint (stores prescriptions) |
| Prescription HTML | `backend/routes/visits.py` | 112-217 | HTML template for prescription export |
| Prescription PDF | `src/utils/prescriptionExport.ts` | 1-499 | Frontend PDF generation |
| Preview Component | `src/components/PrescriptionPreview/` | | Prescription UI display |
| Summary Panel | `src/components/SummaryPanel/` | | Clinical snapshot editing |
| API Service | `src/services/api.ts` | 481-741 | API functions for prescription operations |
| Type Definitions | `src/types/index.ts` | 60-95 | TypeScript interfaces |
| EMR Types | `src/types/emr.ts` | | EMR-specific type definitions |

---

## 10. QUICK API REFERENCE

```bash
# CREATE VISIT
POST /api/visits
{ "patient_id": "...", "doctor_id": "...", "room_id": "..." }

# SAVE PROGRESS (during recording)
PATCH /api/visits/{visitId}/progress
{ "transcript": "...", "dialogue": [...], "status": "in_progress" }

# APPROVE VISIT (set prescription draft)
PATCH /api/visits/{visitId}/approve
{ "summary": { "prescriptionDraft": {...}, ... }, "doctor_id": "..." }

# GET VISIT (with prescription data)
GET /api/visits/{visitId}

# LIST VISITS
GET /api/visits?status=completed&limit=50

# DOWNLOAD PRESCRIPTION (HTML)
GET /api/visits/{visitId}/prescription

# GET PATIENT HISTORY (includes medications)
GET /api/patients/{patientId}/history
```

---

## 11. INTEGRATION POINTS FOR EXTENSION

### To Add:
1. **Prescription Search:** Add endpoint to list medications by patient/date range
2. **Medication Database:** Create drug lookup with contraindications
3. **Refill Tracking:** Add refill status and count
4. **E-prescription:** Integrate with pharmacy systems
5. **Allergy Severity:** Add reaction types and severity levels
6. **Drug Interactions:** Implement interaction checker
7. **Audit Trail:** Add prescription modification history
8. **Compliance Monitoring:** Track medication adherence

