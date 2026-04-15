from datetime import date as date_type, datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session as DBSession
from backend.database import get_db
from backend import models
from backend.schemas import DoctorCreate, DoctorUpdate, DoctorOut, DoctorAvailabilityUpdate
from backend.auth import require_admin, require_any_auth, audit, RequestContext

router = APIRouter(prefix="/api/doctors", tags=["doctors"])


def _enrich_doctor(doctor: models.Doctor, db: DBSession) -> dict:
    today = date_type.today().isoformat()
    avail = (
        db.query(models.DoctorAvailability)
        .filter(
            models.DoctorAvailability.doctor_id == doctor.id,
            models.DoctorAvailability.date == today,
        )
        .first()
    )
    d = DoctorOut.model_validate(doctor).model_dump()
    d["current_status"] = avail.status if avail else "available"
    return d


@router.get("", response_model=List[DoctorOut])
@router.get("/", response_model=List[DoctorOut])
def list_doctors(
    active_only: bool = Query(True),
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    q = db.query(models.Doctor)
    if active_only:
        q = q.filter(models.Doctor.is_active == True)
    doctors = q.order_by(models.Doctor.name).all()
    return [_enrich_doctor(d, db) for d in doctors]


@router.post("", response_model=DoctorOut, status_code=201)
@router.post("/", response_model=DoctorOut, status_code=201)
def create_doctor(
    body: DoctorCreate,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    doctor = models.Doctor(**body.model_dump())
    db.add(doctor)
    db.commit()
    db.refresh(doctor)
    audit(db, ctx, "CREATE_DOCTOR", "doctor", doctor.id, {"name": doctor.name})
    return _enrich_doctor(doctor, db)


@router.get("/{doctor_id}", response_model=DoctorOut)
def get_doctor(
    doctor_id: str,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    doctor = db.query(models.Doctor).filter(models.Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(404, "Doctor not found")
    return _enrich_doctor(doctor, db)


@router.patch("/{doctor_id}", response_model=DoctorOut)
def update_doctor(
    doctor_id: str,
    body: DoctorUpdate,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    doctor = db.query(models.Doctor).filter(models.Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(404, "Doctor not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(doctor, k, v)
    db.commit()
    db.refresh(doctor)
    audit(db, ctx, "UPDATE_DOCTOR", "doctor", doctor_id)
    return _enrich_doctor(doctor, db)


@router.patch("/{doctor_id}/availability")
def set_availability(
    doctor_id: str,
    body: DoctorAvailabilityUpdate,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    doctor = db.query(models.Doctor).filter(models.Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(404, "Doctor not found")
    today = date_type.today().isoformat()
    avail = (
        db.query(models.DoctorAvailability)
        .filter(
            models.DoctorAvailability.doctor_id == doctor_id,
            models.DoctorAvailability.date == today,
        )
        .first()
    )
    if avail:
        avail.status = body.status
        avail.updated_at = datetime.utcnow()
    else:
        avail = models.DoctorAvailability(
            doctor_id=doctor_id, date=today,
            start_time="09:00", end_time="17:00",
            status=body.status, updated_at=datetime.utcnow(),
        )
        db.add(avail)
    db.commit()
    return {"doctor_id": doctor_id, "status": body.status, "date": today}


@router.delete("/{doctor_id}", status_code=204)
def delete_doctor(
    doctor_id: str,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    doctor = db.query(models.Doctor).filter(models.Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(404, "Doctor not found")
    db.delete(doctor)
    db.commit()
    audit(db, ctx, "DELETE_DOCTOR", "doctor", doctor_id)