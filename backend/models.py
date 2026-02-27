from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base
import uuid

def generate_uuid():
    return str(uuid.uuid4())

class Patient(Base):
    __tablename__ = "patients"

    id = Column(String, primary_key=True, default=generate_uuid)
    mrn = Column(String, unique=True, index=True)
    name = Column(String, index=True)
    date_of_birth = Column(String)
    gender = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    medical_history = relationship("MedicalHistory", back_populates="patient", uselist=False)
    visits = relationship("Visit", back_populates="patient")
    current_room = relationship("Room", back_populates="current_patient", uselist=False)

class MedicalHistory(Base):
    __tablename__ = "medical_histories"

    id = Column(String, primary_key=True, default=generate_uuid)
    patient_id = Column(String, ForeignKey("patients.id"))
    conditions = Column(JSON, default=list)
    allergies = Column(JSON, default=list)
    medications = Column(JSON, default=list)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    patient = relationship("Patient", back_populates="medical_history")

class Doctor(Base):
    __tablename__ = "doctors"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, index=True)
    specialty = Column(String)
    email = Column(String, unique=True)
    
    assigned_rooms = relationship("Room", back_populates="assigned_doctor")
    visits = relationship("Visit", back_populates="doctor")

class Room(Base):
    __tablename__ = "rooms"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String)
    status = Column(String, default="free")
    floor = Column(String)
    device_pin = Column(String)
    
    current_patient_id = Column(String, ForeignKey("patients.id"), nullable=True)
    assigned_doctor_id = Column(String, ForeignKey("doctors.id"), nullable=True)

    current_patient = relationship("Patient", back_populates="current_room")
    assigned_doctor = relationship("Doctor", back_populates="assigned_rooms")
    visits = relationship("Visit", back_populates="room")

class Visit(Base):
    __tablename__ = "visits"

    id = Column(String, primary_key=True, default=generate_uuid)
    patient_id = Column(String, ForeignKey("patients.id"))
    doctor_id = Column(String, ForeignKey("doctors.id"), nullable=True)
    room_id = Column(String, ForeignKey("rooms.id"), nullable=True)
    
    transcript = Column(Text, default="")
    dialogue = Column(JSON, default=list)
    summary = Column(JSON, default=dict)
    status = Column(String, default="scheduled")
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    ended_at = Column(DateTime(timezone=True), nullable=True)

    patient = relationship("Patient", back_populates="visits")
    doctor = relationship("Doctor", back_populates="visits")
    room = relationship("Room", back_populates="visits")

class Admin(Base):
    __tablename__ = "admins"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
