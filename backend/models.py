from datetime import datetime, timezone
from enum import Enum as PyEnum
import uuid

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from backend.database import Base


def new_uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AdminRoleEnum(str, PyEnum):
    super_admin = "super_admin"
    admin = "admin"


class DoctorAvailabilityStatusEnum(str, PyEnum):
    available = "available"
    in_session = "in_session"
    break_ = "break"
    off_duty = "off_duty"


class RoomStatusEnum(str, PyEnum):
    idle = "idle"
    in_use = "in_use"
    cleaning = "cleaning"
    offline = "offline"


class AppointmentStatusEnum(str, PyEnum):
    scheduled = "scheduled"
    checked_in = "checked_in"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"
    no_show = "no_show"


class WaitingQueueStatusEnum(str, PyEnum):
    waiting = "waiting"
    called = "called"
    in_room = "in_room"
    done = "done"
    left = "left"


class VisitStatusEnum(str, PyEnum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(String, primary_key=True, default=new_uuid)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(Enum(AdminRoleEnum, name="admin_role_enum"), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_login_at = Column(DateTime(timezone=True), nullable=True)

    sessions = relationship("Session", back_populates="admin_user")


class Session(Base):
    __tablename__ = "sessions"

    id = Column(String, primary_key=True, default=new_uuid)
    admin_user_id = Column(String, ForeignKey("admin_users.id"), nullable=True)
    room_id = Column(String, ForeignKey("rooms.id"), nullable=True)
    token_hash = Column(String, unique=True, index=True, nullable=False)
    role = Column(String, nullable=False)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    revoked = Column(Boolean, default=False, nullable=False)

    admin_user = relationship("AdminUser", back_populates="sessions")


class Doctor(Base):
    __tablename__ = "doctors"

    id = Column(String, primary_key=True, default=new_uuid)
    name = Column(String, nullable=False)
    specialty = Column(String, nullable=True)
    email = Column(String, index=True, nullable=True)
    license_number = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)

    visits = relationship("Visit", back_populates="doctor")
    availability_slots = relationship("DoctorAvailability", back_populates="doctor")
    appointments = relationship("Appointment", back_populates="doctor")


class DoctorAvailability(Base):
    __tablename__ = "doctor_availabilities"
    __table_args__ = (Index("ix_doctor_availabilities_date_doctor_id", "date", "doctor_id"),)

    id = Column(String, primary_key=True, default=new_uuid)
    doctor_id = Column(String, ForeignKey("doctors.id"), index=True, nullable=False)
    date = Column(String, nullable=False)
    start_time = Column(String, nullable=False)
    end_time = Column(String, nullable=False)
    status = Column(
        Enum(DoctorAvailabilityStatusEnum, name="doctor_availability_status_enum"),
        default=DoctorAvailabilityStatusEnum.available,
        nullable=False,
    )
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    doctor = relationship("Doctor", back_populates="availability_slots")


class Room(Base):
    __tablename__ = "rooms"

    id = Column(String, primary_key=True, default=new_uuid)
    name = Column(String, nullable=False)
    floor = Column(String, nullable=True)
    room_agent_port = Column(Integer, nullable=True)
    device_pin = Column(String, nullable=True)
    status = Column(Enum(RoomStatusEnum, name="room_status_enum"), default=RoomStatusEnum.idle, nullable=False)
    current_patient_id = Column(String, ForeignKey("patients.id"), nullable=True)
    assigned_doctor_id = Column(String, ForeignKey("doctors.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    current_patient = relationship("Patient", foreign_keys=[current_patient_id])
    assigned_doctor = relationship("Doctor", foreign_keys=[assigned_doctor_id])
    visits = relationship("Visit", back_populates="room")
    appointments = relationship("Appointment", back_populates="room")


class Patient(Base):
    __tablename__ = "patients"

    id = Column(String, primary_key=True, default=new_uuid)
    mrn = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    date_of_birth = Column(String, nullable=True)
    gender = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    email = Column(String, nullable=True)
    address = Column(String, nullable=True)
    insurance_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    medical_history = relationship("MedicalHistory", back_populates="patient", uselist=False)
    visits = relationship("Visit", back_populates="patient", order_by="desc(Visit.created_at)")
    appointments = relationship("Appointment", back_populates="patient", order_by="desc(Appointment.scheduled_at)")
    queue_entries = relationship("WaitingQueue", back_populates="patient")


class MedicalHistory(Base):
    __tablename__ = "medical_histories"

    id = Column(String, primary_key=True, default=new_uuid)
    patient_id = Column(String, ForeignKey("patients.id"), unique=True, nullable=False)
    conditions = Column(JSON, default=list, nullable=True)
    allergies = Column(JSON, default=list, nullable=True)
    medications = Column(JSON, default=list, nullable=True)
    notes = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    updated_by = Column(String, nullable=True)

    patient = relationship("Patient", back_populates="medical_history")


class Appointment(Base):
    __tablename__ = "appointments"

    id = Column(String, primary_key=True, default=new_uuid)
    patient_id = Column(String, ForeignKey("patients.id"), index=True, nullable=False)
    doctor_id = Column(String, ForeignKey("doctors.id"), index=True, nullable=True)
    room_id = Column(String, ForeignKey("rooms.id"), index=True, nullable=True)
    scheduled_at = Column(DateTime(timezone=True), index=True, nullable=False)
    duration_minutes = Column(Integer, default=30, nullable=False)
    appointment_type = Column(String, nullable=True)
    chief_complaint = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(
        Enum(AppointmentStatusEnum, name="appointment_status_enum"),
        default=AppointmentStatusEnum.scheduled,
        nullable=False,
        index=True,
    )
    checked_in_at = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    created_by = Column(String, nullable=True)
    visit_id = Column(String, ForeignKey("visits.id"), nullable=True)

    patient = relationship("Patient", back_populates="appointments")
    doctor = relationship("Doctor", back_populates="appointments")
    room = relationship("Room", back_populates="appointments")
    visit = relationship("Visit", foreign_keys=[visit_id])


class WaitingQueue(Base):
    __tablename__ = "waiting_queues"
    __table_args__ = (Index("ix_waiting_queues_status_check_in_time", "status", "check_in_time"),)

    id = Column(String, primary_key=True, default=new_uuid)
    patient_id = Column(String, ForeignKey("patients.id"), index=True, nullable=False)
    appointment_id = Column(String, ForeignKey("appointments.id"), nullable=True)
    room_id = Column(String, ForeignKey("rooms.id"), nullable=True)
    doctor_id = Column(String, ForeignKey("doctors.id"), nullable=True)
    priority = Column(Integer, default=3, nullable=False)
    status = Column(
        Enum(WaitingQueueStatusEnum, name="waiting_queue_status_enum"),
        default=WaitingQueueStatusEnum.waiting,
        nullable=False,
    )
    check_in_time = Column(DateTime(timezone=True), default=utcnow, index=True, nullable=False)
    called_at = Column(DateTime(timezone=True), nullable=True)
    in_room_at = Column(DateTime(timezone=True), nullable=True)
    done_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)
    position = Column(Integer, nullable=True)

    patient = relationship("Patient", back_populates="queue_entries")
    appointment = relationship("Appointment")


class Visit(Base):
    __tablename__ = "visits"
    __table_args__ = (
        Index("ix_visits_patient_id_created_at", "patient_id", "created_at"),
        Index("ix_visits_status", "status"),
    )

    id = Column(String, primary_key=True, default=new_uuid)
    patient_id = Column(String, ForeignKey("patients.id"), index=True, nullable=False)
    doctor_id = Column(String, ForeignKey("doctors.id"), index=True, nullable=True)
    room_id = Column(String, ForeignKey("rooms.id"), index=True, nullable=True)
    appointment_id = Column(String, ForeignKey("appointments.id"), nullable=True)
    transcript = Column(Text, default="", nullable=False)
    dialogue = Column(JSON, default=list, nullable=False)
    summary = Column(JSON, nullable=True)
    status = Column(
        Enum(VisitStatusEnum, name="visit_status_enum"),
        default=VisitStatusEnum.pending,
        nullable=False,
    )
    chief_complaint = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    approved_by = Column(String, nullable=True)
    is_deleted = Column(Boolean, default=False, nullable=False, index=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    patient = relationship("Patient", back_populates="visits")
    doctor = relationship("Doctor", back_populates="visits")
    room = relationship("Room", back_populates="visits")
    appointment = relationship("Appointment", foreign_keys=[appointment_id])


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_actor_id_timestamp", "actor_id", "timestamp"),
        Index("ix_audit_logs_resource_type_resource_id", "resource_type", "resource_id"),
    )

    id = Column(String, primary_key=True, default=new_uuid)
    timestamp = Column(DateTime(timezone=True), default=utcnow, nullable=False, index=True)
    actor_id = Column(String, nullable=True)
    actor_role = Column(String, nullable=True)
    actor_ip = Column(String, nullable=True)
    action = Column(String, nullable=False, index=True)
    resource_type = Column(String, nullable=True)
    resource_id = Column(String, nullable=True)
    detail = Column(JSON, nullable=True)
    success = Column(Boolean, default=True, nullable=False)
    error_detail = Column(Text, nullable=True)

    # Append-only model: do not expose delete operations via API.
