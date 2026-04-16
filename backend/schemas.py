from __future__ import annotations
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, model_validator


# ── Shared ──────────────────────────────────────────────────────────────────

class KeyFact(BaseModel):
    label: str = Field(..., max_length=100)
    category: str = Field(..., max_length=30)
    isSupported: Optional[bool] = None
    confidence: Optional[float] = Field(default=None, ge=0, le=1)
    evidence: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern="^(confirmed|probable|denied|unclear)$")


class StructuredFinding(BaseModel):
    id: str
    label: str = Field(..., max_length=140)
    category: str = Field(..., max_length=30)
    status: str = Field(default="confirmed", pattern="^(confirmed|probable|denied|unclear)$")
    confidence: float = Field(default=0.0, ge=0, le=1)
    evidence: Optional[str] = None


class SummaryQuality(BaseModel):
    score: float = Field(default=0, ge=0, le=100)
    confidence: float = Field(default=0, ge=0, le=1)
    missingFields: List[str] = []
    mode: Optional[str] = Field(default=None, pattern="^(hybrid|llm_only|rule_only)$")
    generatedAt: Optional[str] = None
class SummaryItem(BaseModel):
    id: str
    text: str = Field(..., max_length=1000)
    sourceFactIds: List[str] = []
    isEdited: bool = False

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
    chiefComplaint: str = ""
    structuredFindings: List[StructuredFinding] = []
    quality: Optional[SummaryQuality] = None

class Medication(BaseModel):
    name: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None


# ── Auth ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    mode: str = Field(..., pattern="^(admin|room)$")
    email: Optional[str] = None
    password: Optional[str] = None
    room_id: Optional[str] = None
    pin: Optional[str] = None

class LoginResponse(BaseModel):
    token: str
    role: str
    room_id: Optional[str] = None
    admin_id: Optional[str] = None
    name: Optional[str] = None
    expires_at: datetime

class TokenPayload(BaseModel):
    sub: str
    role: str
    room_id: Optional[str] = None
    exp: int


# ── Admin Users ───────────────────────────────────────────────────────────────

class AdminUserCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    email: str = Field(..., max_length=254)
    password: str = Field(..., min_length=8, max_length=128)
    role: str = Field(default="admin", pattern="^(admin|super_admin)$")

class AdminUserOut(BaseModel):
    id: str
    name: str
    email: str
    role: str
    is_active: bool
    created_at: datetime
    last_login_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Doctors ───────────────────────────────────────────────────────────────────

class DoctorCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    specialty: Optional[str] = Field(None, max_length=120)
    email: Optional[str] = Field(None, max_length=254)
    license_number: Optional[str] = Field(None, max_length=50)
    phone: Optional[str] = Field(None, max_length=20)

class DoctorUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=120)
    specialty: Optional[str] = Field(None, max_length=120)
    email: Optional[str] = Field(None, max_length=254)
    license_number: Optional[str] = Field(None, max_length=50)
    phone: Optional[str] = Field(None, max_length=20)
    is_active: Optional[bool] = None

class DoctorAvailabilityUpdate(BaseModel):
    status: str = Field(..., pattern="^(available|in_session|break|off_duty)$")

class DoctorOut(BaseModel):
    id: str
    name: str
    specialty: Optional[str] = None
    email: Optional[str] = None
    license_number: Optional[str] = None
    phone: Optional[str] = None
    is_active: bool
    created_at: datetime
    current_status: Optional[str] = None
    model_config = {"from_attributes": True}


# ── Rooms ─────────────────────────────────────────────────────────────────────

class RoomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    floor: Optional[str] = Field(None, max_length=20)
    room_agent_port: Optional[int] = Field(None, ge=1024, le=65535)
    device_pin: str = Field(..., min_length=4, max_length=8, pattern="^[0-9]+$")

class RoomUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=80)
    floor: Optional[str] = Field(None, max_length=20)
    room_agent_port: Optional[int] = Field(None, ge=1024, le=65535)
    device_pin: Optional[str] = Field(None, min_length=4, max_length=8, pattern="^[0-9]+$")
    status: Optional[str] = Field(None, pattern="^(idle|in_use|cleaning|offline)$")
    current_patient_id: Optional[str] = None
    assigned_doctor_id: Optional[str] = None

class RoomAssignRequest(BaseModel):
    patient_id: Optional[str] = None
    doctor_id: Optional[str] = None

class RoomOut(BaseModel):
    id: str
    name: str
    floor: Optional[str] = None
    room_agent_port: Optional[int] = None
    status: str
    current_patient_id: Optional[str] = None
    assigned_doctor_id: Optional[str] = None
    active_visit_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


# ── Patients ──────────────────────────────────────────────────────────────────

class PatientCreate(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=120)
    last_name: str = Field(..., min_length=1, max_length=120)
    mrn: Optional[str] = Field(None, max_length=50)
    date_of_birth: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    sex: Optional[str] = Field(None, max_length=20)
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=254)
    address: Optional[str] = Field(None, max_length=500)
    insurance_id: Optional[str] = Field(None, max_length=50)

class PatientUpdate(BaseModel):
    first_name: Optional[str] = Field(None, max_length=120)
    last_name: Optional[str] = Field(None, max_length=120)
    mrn: Optional[str] = Field(None, max_length=50)
    date_of_birth: Optional[str] = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    sex: Optional[str] = Field(None, max_length=20)
    phone: Optional[str] = Field(None, max_length=20)
    email: Optional[str] = Field(None, max_length=254)
    address: Optional[str] = Field(None, max_length=500)
    insurance_id: Optional[str] = Field(None, max_length=50)
class MedicalHistoryIn(BaseModel):
    conditions: List[str] = []
    allergies: List[str] = []
    medications: List[Dict[str, Any]] = []
    notes: Optional[str] = None

class MedicalHistoryOut(BaseModel):
    id: str
    patient_id: str
    conditions: List[str]
    allergies: List[str]
    medications: List[Dict[str, Any]]
    notes: Optional[str] = None
    updated_at: datetime
    model_config = {"from_attributes": True}

class PatientOut(BaseModel):
    id: str
    mrn: str
    name: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    date_of_birth: str
    sex: Optional[str] = None
    gender: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    insurance_id: Optional[str] = None
    created_at: datetime
    medical_history: Optional[MedicalHistoryOut] = None

    @model_validator(mode="before")
    @classmethod
    def populate_derived_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            values = dict(data)
        else:
            values = {
                "id": getattr(data, "id", None),
                "mrn": getattr(data, "mrn", None),
                "name": getattr(data, "name", None),
                "date_of_birth": getattr(data, "date_of_birth", None),
                "gender": getattr(data, "gender", None),
                "phone": getattr(data, "phone", None),
                "email": getattr(data, "email", None),
                "address": getattr(data, "address", None),
                "insurance_id": getattr(data, "insurance_id", None),
                "created_at": getattr(data, "created_at", None),
                "medical_history": getattr(data, "medical_history", None),
            }

        name = ((values.get("name") or "") if isinstance(values, dict) else "").strip()
        parts = name.split(" ", 1) if name else []

        if not values.get("first_name"):
            values["first_name"] = parts[0] if parts else ""
        if not values.get("last_name"):
            values["last_name"] = parts[1] if len(parts) > 1 else ""
        if not values.get("sex"):
            values["sex"] = values.get("gender")

        return values

    model_config = {"from_attributes": True}

# ── Appointments ──────────────────────────────────────────────────────────────

class AppointmentCreate(BaseModel):
    patient_id: str
    doctor_id: Optional[str] = None
    room_id: Optional[str] = None
    scheduled_at: datetime
    duration_minutes: int = Field(default=30, ge=5, le=480)
    appointment_type: Optional[str] = Field(None, max_length=80)
    chief_complaint: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = None

class AppointmentUpdate(BaseModel):
    doctor_id: Optional[str] = None
    room_id: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    duration_minutes: Optional[int] = Field(None, ge=5, le=480)
    appointment_type: Optional[str] = Field(None, max_length=80)
    chief_complaint: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = None
    status: Optional[str] = Field(None, pattern="^(scheduled|checked_in|in_progress|completed|cancelled|no_show)$")

class AppointmentOut(BaseModel):
    id: str
    patient_id: str
    doctor_id: Optional[str] = None
    room_id: Optional[str] = None
    scheduled_at: datetime
    duration_minutes: int
    appointment_type: Optional[str] = None
    chief_complaint: Optional[str] = None
    notes: Optional[str] = None
    status: str
    checked_in_at: Optional[datetime] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    visit_id: Optional[str] = None
    model_config = {"from_attributes": True}


# ── Queue ─────────────────────────────────────────────────────────────────────

class QueueEntryCreate(BaseModel):
    patient_id: str
    appointment_id: Optional[str] = None
    doctor_id: Optional[str] = None
    room_id: Optional[str] = None
    priority: int = Field(default=3, ge=1, le=4)
    notes: Optional[str] = Field(None, max_length=500)

class QueueEntryUpdate(BaseModel):
    room_id: Optional[str] = None
    doctor_id: Optional[str] = None
    priority: Optional[int] = Field(None, ge=1, le=4)
    status: Optional[str] = Field(None, pattern="^(waiting|called|in_room|done|left)$")
    notes: Optional[str] = Field(None, max_length=500)
    position: Optional[int] = None

class QueueEntryOut(BaseModel):
    id: str
    patient_id: str
    appointment_id: Optional[str] = None
    room_id: Optional[str] = None
    doctor_id: Optional[str] = None
    priority: int
    status: str
    check_in_time: datetime
    called_at: Optional[datetime] = None
    in_room_at: Optional[datetime] = None
    done_at: Optional[datetime] = None
    notes: Optional[str] = None
    position: Optional[int] = None
    model_config = {"from_attributes": True}


# ── Visits ────────────────────────────────────────────────────────────────────

class VisitCreate(BaseModel):
    patient_id: str
    doctor_id: Optional[str] = None
    room_id: Optional[str] = None
    appointment_id: Optional[str] = None
    chief_complaint: Optional[str] = Field(None, max_length=500)

class VisitUpdate(BaseModel):
    status: Optional[str] = Field(None, pattern="^(pending|in_progress|completed|cancelled)$")

class VisitApprove(BaseModel):
    summary: VisitSummary
    doctor_id: Optional[str] = None
class VisitOut(BaseModel):
    id: str
    patient_id: str
    doctor_id: Optional[str] = None
    room_id: Optional[str] = None
    appointment_id: Optional[str] = None
    transcript: str = ""
    dialogue: List[Dict[str, Any]] = []
    summary: Optional[VisitSummary] = None
    status: str
    chief_complaint: Optional[str] = None
    created_at: datetime
    ended_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ── Dashboard ─────────────────────────────────────────────────────────────────

class RoomStatusOut(BaseModel):
    room: RoomOut
    current_patient: Optional[PatientOut] = None
    assigned_doctor: Optional[DoctorOut] = None
    active_visit_id: Optional[str] = None
    chief_complaint: Optional[str] = None
    queue_length: int = 0
    next_patient: Optional[PatientOut] = None

class QueueSummaryOut(BaseModel):
    total_waiting: int
    total_in_room: int
    entries: List[QueueEntryOut]

class AutoAssignRequest(BaseModel):
    queue_entry_id: str
    preferred_doctor_id: Optional[str] = None
    preferred_room_id: Optional[str] = None

class AutoAssignResponse(BaseModel):
    queue_entry_id: str
    assigned_room_id: Optional[str] = None
    assigned_doctor_id: Optional[str] = None
    message: str


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: str
    timestamp: datetime
    actor_id: Optional[str] = None
    actor_role: Optional[str] = None
    action: str
    resource_type: Optional[str] = None
    resource_id: Optional[str] = None
    detail: Optional[Dict[str, Any]] = None
    success: bool
    model_config = {"from_attributes": True}
