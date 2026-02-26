from pydantic import BaseModel
from typing import List, Optional, Any
from datetime import datetime


class Medication(BaseModel):
    name: str
    dosage: str
    frequency: str

class MedicalHistoryBase(BaseModel):
    conditions: List[str] = []
    allergies: List[str] = []
    medications: List[Medication] = []

class MedicalHistoryCreate(MedicalHistoryBase):
    pass

class MedicalHistory(MedicalHistoryBase):
    id: str
    patient_id: str
    updated_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True


class PatientBase(BaseModel):
    name: str
    mrn: str
    date_of_birth: str
    gender: str

class PatientCreate(PatientBase):
    medical_history: Optional[MedicalHistoryCreate] = None

class Patient(PatientBase):
    id: str
    created_at: datetime
    medical_history: Optional[MedicalHistory] = None
    
    class Config:
        from_attributes = True


class DoctorBase(BaseModel):
    name: str
    specialty: str
    email: str

class DoctorCreate(DoctorBase):
    pass

class Doctor(DoctorBase):
    id: str
    
    class Config:
        from_attributes = True


class RoomBase(BaseModel):
    name: str
    floor: str
    device_pin: str
    status: str = "free"

class RoomCreate(RoomBase):
    pass

class RoomUpdate(BaseModel):
    status: Optional[str] = None
    current_patient_id: Optional[str] = None
    assigned_doctor_id: Optional[str] = None

class Room(RoomBase):
    id: str
    current_patient_id: Optional[str] = None
    assigned_doctor_id: Optional[str] = None
    assigned_doctor: Optional[Doctor] = None
    
    class Config:
        from_attributes = True


class VisitSummary(BaseModel):
    issuesIdentified: List[Any] = []
    actionsPlan: List[Any] = []

class VisitBase(BaseModel):
    patient_id: str
    doctor_id: Optional[str] = None
    room_id: Optional[str] = None
    status: str = "scheduled"

class VisitCreate(VisitBase):
    pass

class VisitUpdate(BaseModel):
    transcript: Optional[str] = None
    summary: Optional[VisitSummary] = None
    status: Optional[str] = None
    ended_at: Optional[datetime] = None

class Visit(VisitBase):
    id: str
    transcript: str
    summary: VisitSummary
    created_at: datetime
    ended_at: Optional[datetime]
    
    class Config:
        from_attributes = True
