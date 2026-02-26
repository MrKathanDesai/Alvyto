from sqlalchemy.orm import Session
from . import models, schemas
import json


def get_patient(db: Session, patient_id: str):
    return db.query(models.Patient).filter(models.Patient.id == patient_id).first()

def get_patients(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Patient).offset(skip).limit(limit).all()

def create_patient(db: Session, patient: schemas.PatientCreate):
    db_patient = models.Patient(
        mrn=patient.mrn,
        name=patient.name,
        date_of_birth=patient.date_of_birth,
        gender=patient.gender
    )
    db.add(db_patient)
    db.commit()
    db.refresh(db_patient)
    
    if patient.medical_history:
        db_history = models.MedicalHistory(
            patient_id=db_patient.id,
            conditions=patient.medical_history.conditions,
            allergies=patient.medical_history.allergies,
            medications=[m.dict() for m in patient.medical_history.medications]
        )
        db.add(db_history)
        db.commit()
        db.refresh(db_history)
        
    return db_patient

def update_patient_history(db: Session, patient_id: str, history: schemas.MedicalHistoryCreate):
    db_history = db.query(models.MedicalHistory).filter(models.MedicalHistory.patient_id == patient_id).first()
    if not db_history:
        db_history = models.MedicalHistory(patient_id=patient_id)
        db.add(db_history)
    
    db_history.conditions = history.conditions
    db_history.allergies = history.allergies
    db_history.medications = [m.dict() for m in history.medications]
    
    db.commit()
    db.refresh(db_history)
    return db_history


def get_rooms(db: Session, skip: int = 0, limit: int = 100):
    return db.query(models.Room).offset(skip).limit(limit).all()

def get_room(db: Session, room_id: str):
    return db.query(models.Room).filter(models.Room.id == room_id).first()

def update_room(db: Session, room_id: str, updates: schemas.RoomUpdate):
    db_room = get_room(db, room_id)
    if not db_room:
        return None
    
    # Check if we are assigning a patient
    if updates.current_patient_id:
        # Find any other room where this patient is currently assigned
        other_rooms = db.query(models.Room).filter(
            models.Room.current_patient_id == updates.current_patient_id,
            models.Room.id != room_id
        ).all()
        
        # Remove patient from other rooms and set them to free
        for other_room in other_rooms:
            other_room.current_patient_id = None
            other_room.status = "free"
            db.add(other_room)
    
    update_data = updates.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_room, key, value)
    
    db.commit()
    db.refresh(db_room)
    db.commit()
    db.refresh(db_room)
    return db_room

def create_room(db: Session, room: schemas.RoomCreate):
    db_room = models.Room(
        name=room.name,
        floor=room.floor,
        device_pin=room.device_pin,
        status=room.status
    )
    db.add(db_room)
    db.commit()
    db.refresh(db_room)
    return db_room

def delete_room(db: Session, room_id: str):
    db_room = get_room(db, room_id)
    if not db_room:
        return None
    db.delete(db_room)
    db.commit()
    return True


def get_doctors(db: Session):
    return db.query(models.Doctor).all()


def get_admin_by_email(db: Session, email: str):
    return db.query(models.Admin).filter(models.Admin.email == email).first()


def create_visit(db: Session, visit: schemas.VisitCreate):
    db_visit = models.Visit(
        patient_id=visit.patient_id,
        doctor_id=visit.doctor_id,
        room_id=visit.room_id,
        status=visit.status
    )
    db.add(db_visit)
    db.commit()
    db.refresh(db_visit)
    return db_visit

def update_visit(db: Session, visit_id: str, updates: schemas.VisitUpdate):
    db_visit = db.query(models.Visit).filter(models.Visit.id == visit_id).first()
    if not db_visit:
        return None
        
    update_data = updates.dict(exclude_unset=True)
    for key, value in update_data.items():
        if key == 'summary' and value:
             setattr(db_visit, key, value.dict())
        else:
            setattr(db_visit, key, value)
            
    db.commit()
    db.refresh(db_visit)
    return db_visit

def get_visits(db: Session, skip: int = 0, limit: int = 100, room_id: str = None, status: str = None):
    query = db.query(models.Visit)
    if room_id:
        query = query.filter(models.Visit.room_id == room_id)
    if status:
        query = query.filter(models.Visit.status == status)
    return query.offset(skip).limit(limit).all()

def get_patient_visits(db: Session, patient_id: str):
    return db.query(models.Visit).filter(models.Visit.patient_id == patient_id).order_by(models.Visit.created_at.desc()).all()
