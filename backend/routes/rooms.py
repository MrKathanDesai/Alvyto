from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session as DBSession
from backend.database import get_db
from backend import models
from backend.schemas import RoomCreate, RoomUpdate, RoomOut, RoomAssignRequest, RoomStatusOut, PatientOut, DoctorOut
from backend.auth import require_admin, require_any_auth, audit, RequestContext

router = APIRouter(prefix="/api/rooms", tags=["rooms"])


class RoomPublicOut(BaseModel):
    id: str
    name: str
    floor: Optional[str] = None

def _room_status_out(room: models.Room, db: DBSession) -> RoomStatusOut:
    active_visit = (
        db.query(models.Visit)
        .filter(
            models.Visit.room_id == room.id,
            models.Visit.status.in_(["pending", "in_progress"]),
        )
        .order_by(models.Visit.created_at.desc())
        .first()
    )
    queue_count = (
        db.query(models.WaitingQueue)
        .filter(
            models.WaitingQueue.room_id == room.id,
            models.WaitingQueue.status == "waiting",
        )
        .count()
    )
    next_entry = (
        db.query(models.WaitingQueue)
        .filter(
            models.WaitingQueue.room_id == room.id,
            models.WaitingQueue.status == "waiting",
        )
        .order_by(models.WaitingQueue.priority, models.WaitingQueue.check_in_time)
        .first()
    )
    next_patient = None
    if next_entry:
        next_patient = db.query(models.Patient).filter(models.Patient.id == next_entry.patient_id).first()

    return RoomStatusOut(
        room=RoomOut.model_validate(room),
        current_patient=PatientOut.model_validate(room.current_patient) if room.current_patient else None,
        assigned_doctor=DoctorOut.model_validate(room.assigned_doctor) if room.assigned_doctor else None,
        active_visit_id=active_visit.id if active_visit else None,
        chief_complaint=active_visit.chief_complaint if active_visit else None,
        queue_length=queue_count,
        next_patient=PatientOut.model_validate(next_patient) if next_patient else None,
    )


@router.get("/public", response_model=List[RoomPublicOut])
def list_public_rooms(
    db: DBSession = Depends(get_db),
):
    rooms = db.query(models.Room).order_by(models.Room.name).all()
    return [RoomPublicOut(id=room.id, name=room.name, floor=room.floor) for room in rooms]


@router.get("", response_model=List[RoomOut])
@router.get("/", response_model=List[RoomOut])
def list_rooms(
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    rooms = db.query(models.Room).order_by(models.Room.name).all()
    results = []
    for room in rooms:
        active_visit = (
            db.query(models.Visit)
            .filter(
                models.Visit.room_id == room.id,
                models.Visit.status.in_(["pending", "in_progress"]),
            )
            .order_by(models.Visit.created_at.desc())
            .first()
        )
        room_out = RoomOut.model_validate(room)
        room_out.active_visit_id = active_visit.id if active_visit else None
        results.append(room_out)
    return results

@router.get("/status", response_model=List[RoomStatusOut])
def list_rooms_with_status(
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    rooms = db.query(models.Room).order_by(models.Room.name).all()
    return [_room_status_out(r, db) for r in rooms]


@router.post("", response_model=RoomOut, status_code=201)
@router.post("/", response_model=RoomOut, status_code=201)
def create_room(
    body: RoomCreate,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    room = models.Room(**body.model_dump())
    db.add(room)
    db.commit()
    db.refresh(room)
    audit(db, ctx, "CREATE_ROOM", "room", room.id, {"name": room.name})
    return room


@router.get("/{room_id}", response_model=RoomOut)
def get_room(
    room_id: str,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    room = db.query(models.Room).filter(models.Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    
    active_visit = (
        db.query(models.Visit)
        .filter(
            models.Visit.room_id == room.id,
            models.Visit.status.in_(["pending", "in_progress"]),
        )
        .order_by(models.Visit.created_at.desc())
        .first()
    )
    room_out = RoomOut.model_validate(room)
    room_out.active_visit_id = active_visit.id if active_visit else None
    return room_out


@router.get("/{room_id}/status", response_model=RoomStatusOut)
def get_room_status(
    room_id: str,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    room = db.query(models.Room).filter(models.Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    return _room_status_out(room, db)


@router.patch("/{room_id}", response_model=RoomOut)
def update_room(
    room_id: str,
    body: RoomUpdate,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    room = db.query(models.Room).filter(models.Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(room, k, v)
    db.commit()
    db.refresh(room)
    audit(db, ctx, "UPDATE_ROOM", "room", room_id)
    return room


@router.post("/{room_id}/assign", response_model=RoomOut)
@router.post("/{room_id}/assign/", response_model=RoomOut)
def assign_room(
    room_id: str,
    body: RoomAssignRequest,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    room = db.query(models.Room).filter(models.Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    if body.patient_id is not None:
        room.current_patient_id = body.patient_id or None
    if body.doctor_id is not None:
        room.assigned_doctor_id = body.doctor_id or None
    if body.patient_id:
        room.status = "in_use"
    db.commit()
    db.refresh(room)
    audit(db, ctx, "ASSIGN_ROOM", "room", room_id,
          {"patient_id": body.patient_id, "doctor_id": body.doctor_id})
    return room


@router.delete("/{room_id}", status_code=204)
def delete_room(
    room_id: str,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    room = db.query(models.Room).filter(models.Room.id == room_id).first()
    if not room:
        raise HTTPException(404, "Room not found")
    db.delete(room)
    db.commit()
    audit(db, ctx, "DELETE_ROOM", "room", room_id)
