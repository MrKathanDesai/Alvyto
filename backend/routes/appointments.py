from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from backend.database import get_db
from backend import models
from backend.schemas import AppointmentCreate, AppointmentUpdate, AppointmentOut
from backend.auth import require_admin, require_any_auth, audit, RequestContext

router = APIRouter(prefix="/api/appointments", tags=["appointments"])


def _ensure_queue_entry_for_checked_in_appointment(appt: models.Appointment, db: DBSession) -> models.WaitingQueue:
    active_statuses = [
        models.WaitingQueueStatusEnum.waiting,
        models.WaitingQueueStatusEnum.called,
        models.WaitingQueueStatusEnum.in_room,
    ]

    existing_for_appointment = (
        db.query(models.WaitingQueue)
        .filter(
            models.WaitingQueue.appointment_id == appt.id,
            models.WaitingQueue.status.in_(active_statuses),
        )
        .first()
    )
    if existing_for_appointment:
        if appt.doctor_id and not existing_for_appointment.doctor_id:
            existing_for_appointment.doctor_id = appt.doctor_id
        if appt.room_id and not existing_for_appointment.room_id:
            existing_for_appointment.room_id = appt.room_id
        return existing_for_appointment

    existing_for_patient = (
        db.query(models.WaitingQueue)
        .filter(
            models.WaitingQueue.patient_id == appt.patient_id,
            models.WaitingQueue.status.in_(active_statuses),
        )
        .first()
    )
    if existing_for_patient:
        if not existing_for_patient.appointment_id:
            existing_for_patient.appointment_id = appt.id
        if appt.doctor_id and not existing_for_patient.doctor_id:
            existing_for_patient.doctor_id = appt.doctor_id
        if appt.room_id and not existing_for_patient.room_id:
            existing_for_patient.room_id = appt.room_id
        return existing_for_patient

    queue_notes = appt.chief_complaint or appt.notes
    entry = models.WaitingQueue(
        patient_id=appt.patient_id,
        appointment_id=appt.id,
        doctor_id=appt.doctor_id,
        room_id=appt.room_id,
        priority=3,
        status=models.WaitingQueueStatusEnum.waiting,
        check_in_time=appt.checked_in_at or datetime.utcnow(),
        notes=queue_notes,
    )
    db.add(entry)
    db.flush()
    return entry


@router.get("", response_model=List[AppointmentOut])
@router.get("/", response_model=List[AppointmentOut])
def list_appointments(
    date: Optional[str] = Query(None, description="Filter by date YYYY-MM-DD"),
    patient_id: Optional[str] = Query(None),
    doctor_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    q = db.query(models.Appointment)
    if date:
        q = q.filter(func.date(models.Appointment.scheduled_at) == date)
    if patient_id:
        q = q.filter(models.Appointment.patient_id == patient_id)
    if doctor_id:
        q = q.filter(models.Appointment.doctor_id == doctor_id)
    if status:
        q = q.filter(models.Appointment.status == status)
    return q.order_by(models.Appointment.scheduled_at).all()


@router.post("", response_model=AppointmentOut, status_code=201)
@router.post("/", response_model=AppointmentOut, status_code=201)
def create_appointment(
    body: AppointmentCreate,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    appt = models.Appointment(**body.model_dump(), created_by=ctx.sub)
    db.add(appt)
    db.commit()
    db.refresh(appt)
    audit(
        db,
        ctx,
        "CREATE_APPOINTMENT",
        "appointment",
        appt.id,
        {"patient_id": appt.patient_id, "scheduled_at": str(appt.scheduled_at)},
    )
    return appt


@router.get("/{appt_id}", response_model=AppointmentOut)
def get_appointment(
    appt_id: str,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    appt = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
    if not appt:
        raise HTTPException(404, "Appointment not found")
    return appt


@router.patch("/{appt_id}", response_model=AppointmentOut)
def update_appointment(
    appt_id: str,
    body: AppointmentUpdate,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    appt = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
    if not appt:
        raise HTTPException(404, "Appointment not found")

    updates = body.model_dump(exclude_unset=True)
    if "status" in updates:
        valid_statuses = {status.value for status in models.AppointmentStatusEnum}
        if updates["status"] not in valid_statuses:
            raise HTTPException(400, "Invalid appointment status")

    for k, v in updates.items():
        setattr(appt, k, v)
        if k == "status" and v == "checked_in":
            appt.checked_in_at = datetime.utcnow()

    queue_entry_id = None
    if updates.get("status") == models.AppointmentStatusEnum.checked_in.value:
        queue_entry = _ensure_queue_entry_for_checked_in_appointment(appt, db)
        queue_entry_id = queue_entry.id

    db.commit()
    db.refresh(appt)
    audit(
        db,
        ctx,
        "UPDATE_APPOINTMENT",
        "appointment",
        appt_id,
        {
            "status": appt.status,
            "queue_entry_id": queue_entry_id,
        },
    )
    return appt


@router.post("/{appt_id}/check-in", response_model=AppointmentOut)
def check_in(
    appt_id: str,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    appt = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
    if not appt:
        raise HTTPException(404, "Appointment not found")
    if appt.status not in (models.AppointmentStatusEnum.scheduled.value,):
        raise HTTPException(400, f"Cannot check in appointment with status: {appt.status}")
    appt.status = models.AppointmentStatusEnum.checked_in.value
    appt.checked_in_at = datetime.utcnow()
    queue_entry = _ensure_queue_entry_for_checked_in_appointment(appt, db)
    db.commit()
    db.refresh(appt)
    audit(
        db,
        ctx,
        "CHECK_IN_APPOINTMENT",
        "appointment",
        appt_id,
        {
            "patient_id": appt.patient_id,
            "queue_entry_id": queue_entry.id,
        },
    )
    return appt


@router.delete("/{appt_id}", status_code=204)
def cancel_appointment(
    appt_id: str,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    appt = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
    if not appt:
        raise HTTPException(404, "Appointment not found")
    if appt.status in ["completed", "in_progress"]:
        raise HTTPException(400, "Cannot cancel a completed or in-progress appointment")

    appt.status = "cancelled"
    db.commit()
    audit(db, ctx, "CANCEL_APPOINTMENT", "appointment", appt_id)
