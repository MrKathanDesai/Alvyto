import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DBSession
from backend.database import get_db
from backend import models
from backend.schemas import PatientCreate, PatientUpdate, PatientOut, MedicalHistoryIn, MedicalHistoryOut
from backend.auth import require_any_auth, require_admin, audit, RequestContext

router = APIRouter(prefix="/api/patients", tags=["patients"])


def _compose_name(first_name: str, last_name: str) -> str:
    return " ".join([first_name.strip(), last_name.strip()]).strip()


def _split_name(name: Optional[str]) -> tuple[str, str]:
    parts = ((name or "").strip()).split(" ", 1)
    if not parts or not parts[0]:
        return "", ""
    return parts[0], parts[1] if len(parts) > 1 else ""


def generate_mrn(db: DBSession) -> str:
    while True:
        mrn = "MRN-" + str(uuid.uuid4())[:8].upper()
        if not db.query(models.Patient).filter(models.Patient.mrn == mrn).first():
            return mrn


@router.get("", response_model=List[PatientOut])
@router.get("/", response_model=List[PatientOut])
def list_patients(
    search: Optional[str] = Query(None),
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    audit(db, ctx, "LIST_PATIENTS")
    q = db.query(models.Patient)
    if search:
        term = f"%{search}%"
        q = q.filter(
            models.Patient.name.ilike(term) |
            models.Patient.mrn.ilike(term) |
            models.Patient.phone.ilike(term)
        )
    return q.order_by(models.Patient.name).all()


@router.post("", response_model=PatientOut, status_code=201)
@router.post("/", response_model=PatientOut, status_code=201)
def create_patient(
    body: PatientCreate,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    if body.mrn and db.query(models.Patient).filter(models.Patient.mrn == body.mrn).first():
        raise HTTPException(400, "MRN already exists")

    patient = models.Patient(
        mrn=body.mrn or generate_mrn(db),
        name=_compose_name(body.first_name, body.last_name),
        date_of_birth=body.date_of_birth,
        gender=body.sex,
        phone=body.phone,
        email=body.email,
        address=body.address,
        insurance_id=body.insurance_id,
    )
    db.add(patient)
    db.flush()
    history = models.MedicalHistory(patient_id=patient.id)
    db.add(history)
    db.commit()
    db.refresh(patient)
    audit(db, ctx, "CREATE_PATIENT", "patient", patient.id, {"name": patient.name, "mrn": patient.mrn})
    return patient


@router.get("/{patient_id}", response_model=PatientOut)
def get_patient(
    patient_id: str,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    patient = db.query(models.Patient).filter(models.Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(404, "Patient not found")
    audit(db, ctx, "VIEW_PATIENT", "patient", patient_id)
    return patient


@router.patch("/{patient_id}", response_model=PatientOut)
def update_patient(
    patient_id: str,
    body: PatientUpdate,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    patient = db.query(models.Patient).filter(models.Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(404, "Patient not found")

    payload = body.model_dump(exclude_unset=True)

    first_name = payload.pop("first_name", None)
    last_name = payload.pop("last_name", None)
    sex = payload.pop("sex", None)

    if "mrn" in payload:
        mrn = payload["mrn"]
        if mrn and db.query(models.Patient).filter(models.Patient.mrn == mrn, models.Patient.id != patient_id).first():
            raise HTTPException(400, "MRN already exists")

    if first_name is not None or last_name is not None:
        current_first_name, current_last_name = _split_name(patient.name)
        patient.name = _compose_name(
            first_name if first_name is not None else current_first_name,
            last_name if last_name is not None else current_last_name,
        )

    if sex is not None:
        patient.gender = sex

    for k, v in payload.items():
        setattr(patient, k, v)

    db.commit()
    db.refresh(patient)
    audit(db, ctx, "UPDATE_PATIENT", "patient", patient_id)
    return patient


@router.get("/{patient_id}/visits")
def get_patient_visits(
    patient_id: str,
    status: Optional[str] = Query("completed"),
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    patient = db.query(models.Patient).filter(models.Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(404, "Patient not found")
    audit(db, ctx, "VIEW_PATIENT_VISITS", "patient", patient_id)
    visit_query = db.query(models.Visit).filter(models.Visit.patient_id == patient_id)

    if status:
        try:
            status_enum = models.VisitStatusEnum(status)
        except ValueError as exc:
            raise HTTPException(400, "Invalid visit status") from exc
        visit_query = visit_query.filter(models.Visit.status == status_enum)

    visits = visit_query.order_by(models.Visit.created_at.desc()).all()
    return [
        {
            "id": v.id,
            "patientId": v.patient_id,
            "doctorId": v.doctor_id,
            "roomId": v.room_id,
            "summary": v.summary,
            "status": v.status,
            "createdAt": v.created_at.isoformat() if v.created_at else None,
            "endedAt": v.ended_at.isoformat() if v.ended_at else None,
        }
        for v in visits
    ]


@router.put("/{patient_id}/history", response_model=MedicalHistoryOut)
def update_medical_history(
    patient_id: str,
    body: MedicalHistoryIn,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    patient = db.query(models.Patient).filter(models.Patient.id == patient_id).first()
    if not patient:
        raise HTTPException(404, "Patient not found")
    hist = db.query(models.MedicalHistory).filter(models.MedicalHistory.patient_id == patient_id).first()
    if not hist:
        hist = models.MedicalHistory(patient_id=patient_id)
        db.add(hist)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(hist, k, v)
    hist.updated_by = ctx.sub
    db.commit()
    db.refresh(hist)
    audit(db, ctx, "UPDATE_MEDICAL_HISTORY", "patient", patient_id)
    return hist
