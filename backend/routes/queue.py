from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session as DBSession

from backend.database import get_db
from backend import models
from backend.schemas import (
    QueueEntryCreate,
    QueueEntryUpdate,
    QueueEntryOut,
    QueueSummaryOut,
    AutoAssignRequest,
)
from backend.auth import require_admin, require_any_auth, audit, RequestContext

router = APIRouter(prefix="/api/queue", tags=["queue"])


def _release_room_bindings(db: DBSession, room_id: str | None) -> None:
    if not room_id:
        return
    room = db.query(models.Room).filter(models.Room.id == room_id).first()
    if room:
        room.status = models.RoomStatusEnum.idle
        room.current_patient_id = None
        room.assigned_doctor_id = None
        if hasattr(room, "current_doctor_id"):
            setattr(room, "current_doctor_id", None)


def _set_doctor_available_if_in_session(db: DBSession, doctor_id: str | None) -> None:
    if not doctor_id:
        return
    today = datetime.utcnow().date().isoformat()
    availabilities = (
        db.query(models.DoctorAvailability)
        .filter(
            models.DoctorAvailability.doctor_id == doctor_id,
            models.DoctorAvailability.date == today,
            models.DoctorAvailability.status == models.DoctorAvailabilityStatusEnum.in_session,
        )
        .all()
    )
    for availability in availabilities:
        availability.status = models.DoctorAvailabilityStatusEnum.available


@router.get("", response_model=QueueSummaryOut)
@router.get("/", response_model=QueueSummaryOut)
def get_queue(
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    base_query = db.query(models.WaitingQueue)
    if ctx.is_room_device:
        base_query = base_query.filter(models.WaitingQueue.room_id == ctx.room_id)

    waiting = (
        base_query
        .filter(models.WaitingQueue.status == models.WaitingQueueStatusEnum.waiting)
        .order_by(models.WaitingQueue.priority, models.WaitingQueue.check_in_time)
        .all()
    )
    in_room = (
        base_query
        .filter(models.WaitingQueue.status == models.WaitingQueueStatusEnum.in_room)
        .all()
    )
    all_active = (
        base_query
        .filter(
            models.WaitingQueue.status.in_(
                [
                    models.WaitingQueueStatusEnum.waiting,
                    models.WaitingQueueStatusEnum.called,
                    models.WaitingQueueStatusEnum.in_room,
                ]
            )
        )
        .order_by(models.WaitingQueue.priority, models.WaitingQueue.check_in_time)
        .all()
    )
    return QueueSummaryOut(
        total_waiting=len(waiting),
        total_in_room=len(in_room),
        entries=all_active,
    )


@router.post("", response_model=QueueEntryOut, status_code=201)
@router.post("/", response_model=QueueEntryOut, status_code=201)
def add_to_queue(
    body: QueueEntryCreate,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    patient = db.query(models.Patient).filter(models.Patient.id == body.patient_id).first()
    if not patient:
        raise HTTPException(404, "Patient not found")

    existing = (
        db.query(models.WaitingQueue)
        .filter(
            models.WaitingQueue.patient_id == body.patient_id,
            models.WaitingQueue.status.in_(
                [
                    models.WaitingQueueStatusEnum.waiting,
                    models.WaitingQueueStatusEnum.called,
                    models.WaitingQueueStatusEnum.in_room,
                ]
            ),
        )
        .first()
    )
    if existing:
        raise HTTPException(409, "Patient already in queue")

    entry = models.WaitingQueue(**body.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    audit(db, ctx, "ADD_QUEUE_ENTRY", "queue", entry.id, {"patient_id": body.patient_id})
    return entry


@router.patch("/{entry_id}", response_model=QueueEntryOut)
def update_queue_entry(
    entry_id: str,
    body: QueueEntryUpdate,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    entry = db.query(models.WaitingQueue).filter(models.WaitingQueue.id == entry_id).first()
    if not entry:
        raise HTTPException(404, "Queue entry not found")

    updates = body.model_dump(exclude_unset=True)

    if ctx.is_room_device:
        blocked_fields = {"priority", "notes", "doctor_id", "position"}
        attempted_blocked_fields = sorted(field for field in blocked_fields if field in updates)
        if attempted_blocked_fields:
            raise HTTPException(403, f"Room device cannot update: {', '.join(attempted_blocked_fields)}")

        requested_room_id = updates.get("room_id")
        if requested_room_id and requested_room_id != ctx.room_id:
            raise HTTPException(403, "Room device can only operate on its own room")

        if entry.room_id and entry.room_id != ctx.room_id:
            raise HTTPException(403, "Queue entry is assigned to a different room")

        current_status = str(entry.status)
        next_status = updates.get("status")
        if not next_status:
            raise HTTPException(400, "Room device must provide status")

        allowed_room_transitions = {
            models.WaitingQueueStatusEnum.waiting.value: {models.WaitingQueueStatusEnum.in_room.value},
            models.WaitingQueueStatusEnum.called.value: {
                models.WaitingQueueStatusEnum.in_room.value,
                models.WaitingQueueStatusEnum.done.value,
                models.WaitingQueueStatusEnum.left.value,
            },
            models.WaitingQueueStatusEnum.in_room.value: {
                models.WaitingQueueStatusEnum.done.value,
                models.WaitingQueueStatusEnum.left.value,
            },
        }
        if next_status not in allowed_room_transitions.get(current_status, set()):
            raise HTTPException(400, f"Invalid status transition: {current_status} -> {next_status}")

        if next_status == models.WaitingQueueStatusEnum.in_room.value:
            updates["room_id"] = ctx.room_id
        elif not entry.room_id and not requested_room_id:
            updates["room_id"] = ctx.room_id

    previous_status = str(entry.status)
    next_status = updates.get("status")

    for k, v in updates.items():
        setattr(entry, k, v)

    now = datetime.utcnow()
    if next_status is not None:
        if next_status == models.WaitingQueueStatusEnum.called.value and not entry.called_at:
            entry.called_at = now
        elif next_status == models.WaitingQueueStatusEnum.in_room.value and not entry.in_room_at:
            entry.in_room_at = now
            if entry.room_id:
                room = db.query(models.Room).filter(models.Room.id == entry.room_id).first()
                if room:
                    room.status = models.RoomStatusEnum.in_use
                    room.current_patient_id = entry.patient_id
                    room.assigned_doctor_id = entry.doctor_id
        elif next_status in (models.WaitingQueueStatusEnum.done.value, models.WaitingQueueStatusEnum.left.value):
            entry.done_at = now
            _release_room_bindings(db, entry.room_id)
            _set_doctor_available_if_in_session(db, entry.doctor_id)

    db.commit()
    db.refresh(entry)
    audit(
        db,
        ctx,
        "UPDATE_QUEUE_ENTRY",
        "queue",
        entry_id,
            {"from_status": previous_status, "to_status": str(entry.status)},
    )
    return entry


@router.delete("/{entry_id}", status_code=204)
def remove_from_queue(
    entry_id: str,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    entry = db.query(models.WaitingQueue).filter(models.WaitingQueue.id == entry_id).first()
    if not entry:
        raise HTTPException(404, "Queue entry not found")

    entry.status = models.WaitingQueueStatusEnum.left
    entry.done_at = datetime.utcnow()
    _release_room_bindings(db, entry.room_id)
    _set_doctor_available_if_in_session(db, entry.doctor_id)

    db.commit()
    audit(db, ctx, "REMOVE_QUEUE_ENTRY", "queue", entry_id, {"status": models.WaitingQueueStatusEnum.left.value})


@router.post("/auto-assign", response_model=QueueEntryOut)
def auto_assign(
    body: AutoAssignRequest,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    try:
        entry = db.query(models.WaitingQueue).filter(models.WaitingQueue.id == body.queue_entry_id).first()
        if not entry:
            raise HTTPException(404, "Queue entry not found")

        if entry.status not in (models.WaitingQueueStatusEnum.waiting, models.WaitingQueueStatusEnum.called):
            raise HTTPException(400, "Queue entry must be in waiting or called status")

        room_query = (
            db.query(models.Room)
            .filter(
                models.Room.status == models.RoomStatusEnum.idle,
                models.Room.current_patient_id.is_(None),
            )
            .order_by(models.Room.name)
        )
        if body.preferred_room_id:
            preferred_room = room_query.filter(models.Room.id == body.preferred_room_id).first()
            room = preferred_room or room_query.first()
        else:
            room = room_query.first()

        if not room:
            raise HTTPException(400, "No available rooms")

        today = datetime.utcnow().date().isoformat()
        availability_rows = (
            db.query(models.DoctorAvailability.doctor_id)
            .filter(
                models.DoctorAvailability.date == today,
                models.DoctorAvailability.status == models.DoctorAvailabilityStatusEnum.available,
            )
            .all()
        )
        available_doctor_ids = [row[0] for row in availability_rows]

    # Fallback: if no availability records exist for today, use all active doctors
        if not available_doctor_ids:
            all_active_doctors = (
                db.query(models.Doctor.id)
                .filter(models.Doctor.is_active == True)
                .all()
            )
            available_doctor_ids = [row[0] for row in all_active_doctors]

        if not available_doctor_ids:
            raise HTTPException(400, "No available doctors")

    # Honor preferred doctor if specified and in the available pool
        if body.preferred_doctor_id and body.preferred_doctor_id in available_doctor_ids:
            available_doctor_ids = [body.preferred_doctor_id] + [
                did for did in available_doctor_ids if did != body.preferred_doctor_id
            ]
    # Also honor preferred doctor even if not in availability list (direct preference override)
        elif body.preferred_doctor_id:
            preferred_doc = (
                db.query(models.Doctor)
                .filter(models.Doctor.id == body.preferred_doctor_id, models.Doctor.is_active == True)
                .first()
            )
            if preferred_doc:
                available_doctor_ids = [body.preferred_doctor_id] + [
                    did for did in available_doctor_ids if did != body.preferred_doctor_id
                ]

        active_visit_counts = (
            db.query(models.Visit.doctor_id, func.count(models.Visit.id).label("visit_count"))
            .filter(
                models.Visit.doctor_id.in_(available_doctor_ids),
                models.Visit.status.in_([models.VisitStatusEnum.pending, models.VisitStatusEnum.in_progress]),
            )
            .group_by(models.Visit.doctor_id)
            .all()
        )
        count_map = {doctor_id: count for doctor_id, count in active_visit_counts}

        ordered_doctors = sorted(available_doctor_ids, key=lambda did: count_map.get(did, 0))
        doctor_id = ordered_doctors[0]

        doctor = (
            db.query(models.Doctor)
            .filter(models.Doctor.id == doctor_id, models.Doctor.is_active == True)
            .first()
        )
        if not doctor:
            raise HTTPException(400, "No available doctors")

        db.refresh(entry)
        db.refresh(room)
        if entry.status not in (models.WaitingQueueStatusEnum.waiting, models.WaitingQueueStatusEnum.called):
            raise HTTPException(409, "Queue entry changed during assignment. Refresh and retry.")
        if room.status != models.RoomStatusEnum.idle or room.current_patient_id is not None:
            raise HTTPException(409, "Selected room is no longer available. Refresh and retry.")

        room.status = models.RoomStatusEnum.in_use
        room.current_patient_id = entry.patient_id
        room.assigned_doctor_id = doctor.id

        entry.room_id = room.id
        entry.doctor_id = doctor.id
        entry.status = models.WaitingQueueStatusEnum.called
        if not entry.called_at:
            entry.called_at = datetime.utcnow()

        availability = (
            db.query(models.DoctorAvailability)
            .filter(
                models.DoctorAvailability.doctor_id == doctor.id,
                models.DoctorAvailability.date == today,
                models.DoctorAvailability.status == models.DoctorAvailabilityStatusEnum.available,
            )
            .first()
        )
        if availability:
            db.refresh(availability)
            if availability.status != models.DoctorAvailabilityStatusEnum.available:
                raise HTTPException(409, "Selected doctor is no longer available. Refresh and retry.")
            availability.status = models.DoctorAvailabilityStatusEnum.in_session

        db.commit()
        db.refresh(entry)
        audit(
            db,
            ctx,
            "AUTO_ASSIGN",
            "queue",
            entry.id,
            {"room_id": entry.room_id, "doctor_id": entry.doctor_id, "status": str(entry.status)},
        )
        return entry
    except Exception:
        db.rollback()
        raise
