import importlib
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend import auth as auth_module
from backend import database as database_module
from backend import models


@pytest.fixture()
def client(tmp_path):
    db_path = tmp_path / "test_emr.db"
    test_engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

    database_module.Base.metadata.create_all(bind=test_engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    server_module = importlib.import_module("backend.server")
    server_module.engine = test_engine
    server_module.app.dependency_overrides[database_module.get_db] = override_get_db

    with TestingSessionLocal() as db:
        super_admin = models.AdminUser(
            name="Super Admin",
            email="super@clinic.com",
            password_hash=auth_module.hash_password("supersecure"),
            role=models.AdminRoleEnum.super_admin,
            is_active=True,
        )
        admin = models.AdminUser(
            name="Ops Admin",
            email="ops@clinic.com",
            password_hash=auth_module.hash_password("opssecure"),
            role=models.AdminRoleEnum.admin,
            is_active=True,
        )
        inactive_admin = models.AdminUser(
            name="Inactive Admin",
            email="inactive@clinic.com",
            password_hash=auth_module.hash_password("inactivepass"),
            role=models.AdminRoleEnum.admin,
            is_active=False,
        )
        doctor_1 = models.Doctor(
            name="Dr. One",
            specialty="General",
            email="dr1@clinic.com",
            is_active=True,
        )
        doctor_2 = models.Doctor(
            name="Dr. Two",
            specialty="Cardiology",
            email="dr2@clinic.com",
            is_active=True,
        )
        room_1 = models.Room(
            name="Room A",
            floor="1",
            room_agent_port=8010,
            device_pin=auth_module.hash_password("1234"),
            status=models.RoomStatusEnum.idle,
        )
        room_2 = models.Room(
            name="Room B",
            floor="1",
            room_agent_port=8011,
            device_pin=auth_module.hash_password("5678"),
            status=models.RoomStatusEnum.idle,
        )
        patient_1 = models.Patient(
            mrn="MRN-BASE-0001",
            name="Alice Smith",
            date_of_birth="1990-01-01",
            gender="Female",
            phone="555-0001",
        )
        patient_2 = models.Patient(
            mrn="MRN-BASE-0002",
            name="Bob Jones",
            date_of_birth="1985-02-02",
            gender="Male",
            phone="555-0002",
        )
        db.add_all(
            [
                super_admin,
                admin,
                inactive_admin,
                doctor_1,
                doctor_2,
                room_1,
                room_2,
                patient_1,
                patient_2,
            ]
        )
        db.commit()
        db.refresh(super_admin)
        db.refresh(admin)
        db.refresh(doctor_1)
        db.refresh(doctor_2)
        db.refresh(room_1)
        db.refresh(room_2)
        db.refresh(patient_1)
        db.refresh(patient_2)

        db.add_all(
            [
                models.MedicalHistory(
                    patient_id=patient_1.id,
                    conditions=["asthma"],
                    allergies=[],
                    medications=[{"name": "LegacyMed", "dosage": "10mg", "frequency": "daily"}],
                ),
                models.MedicalHistory(patient_id=patient_2.id, conditions=[], allergies=[], medications=[]),
                models.DoctorAvailability(
                    doctor_id=doctor_1.id,
                    date=datetime.utcnow().date().isoformat(),
                    start_time="09:00",
                    end_time="17:00",
                    status=models.DoctorAvailabilityStatusEnum.available,
                ),
                models.DoctorAvailability(
                    doctor_id=doctor_2.id,
                    date=datetime.utcnow().date().isoformat(),
                    start_time="09:00",
                    end_time="17:00",
                    status=models.DoctorAvailabilityStatusEnum.available,
                ),
            ]
        )
        db.commit()

    with TestClient(server_module.app) as test_client:
        yield test_client, TestingSessionLocal

    server_module.app.dependency_overrides.clear()
    database_module.Base.metadata.drop_all(bind=test_engine)
    test_engine.dispose()


def _auth_headers(client, email, password):
    response = client.post(
        "/api/auth/login",
        json={"mode": "admin", "email": email, "password": password},
    )
    assert response.status_code == 200, response.text
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


def _room_headers(client, room_id, pin):
    response = client.post(
        "/api/auth/login",
        json={"mode": "room", "room_id": room_id, "pin": pin},
    )
    assert response.status_code == 200, response.text
    token = response.json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_health_endpoints(client):
    test_client, _ = client
    assert test_client.get("/health").json()["status"] == "ok"
    assert test_client.get("/api/health").json()["status"] == "ok"


def test_auth_login_me_and_logout_flow(client):
    test_client, _ = client

    missing = test_client.post("/api/auth/login", json={"mode": "admin"})
    assert missing.status_code == 400

    bad = test_client.post(
        "/api/auth/login",
        json={"mode": "admin", "email": "super@clinic.com", "password": "wrong"},
    )
    assert bad.status_code == 401

    inactive = test_client.post(
        "/api/auth/login",
        json={"mode": "admin", "email": "inactive@clinic.com", "password": "inactivepass"},
    )
    assert inactive.status_code == 401

    headers = _auth_headers(test_client, "super@clinic.com", "supersecure")
    me = test_client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["role"] == "super_admin"

    logout = test_client.post("/api/auth/logout", headers=headers)
    assert logout.status_code == 200

    revoked = test_client.get("/api/auth/me", headers=headers)
    assert revoked.status_code == 401


def test_room_auth_and_room_scoped_visit_access(client):
    test_client, SessionLocal = client
    admin_headers = _auth_headers(test_client, "super@clinic.com", "supersecure")

    rooms = test_client.get("/api/rooms", headers=admin_headers).json()
    room_a = rooms[0]
    room_b = rooms[1]
    patients = test_client.get("/api/patients", headers=admin_headers).json()
    patient_id = patients[0]["id"]

    create_visit = test_client.post(
        "/api/visits",
        headers=admin_headers,
        json={"patient_id": patient_id, "room_id": room_b["id"]},
    )
    assert create_visit.status_code == 201
    visit_id = create_visit.json()["id"]

    room_headers = _room_headers(test_client, room_a["id"], "1234")
    forbidden = test_client.get(f"/api/visits/{visit_id}", headers=room_headers)
    assert forbidden.status_code == 403

    own_visit = test_client.post(
        "/api/visits",
        headers=room_headers,
        json={"patient_id": patient_id, "room_id": room_b["id"]},
    )
    assert own_visit.status_code == 403

    own_room_visit = test_client.post(
        "/api/visits",
        headers=room_headers,
        json={"patient_id": patient_id},
    )
    assert own_room_visit.status_code == 201
    own_room_id = own_room_visit.json()["room_id"]
    assert own_room_id == room_a["id"]

    with SessionLocal() as db:
        created = db.query(models.Visit).filter(models.Visit.id == own_room_visit.json()["id"]).first()
        assert created is not None
        assert created.room_id == room_a["id"]


def test_patient_crud_and_history_flow(client):
    test_client, _ = client
    admin_headers = _auth_headers(test_client, "super@clinic.com", "supersecure")

    unauthorized = test_client.get("/api/patients")
    assert unauthorized.status_code == 401

    listed = test_client.get("/api/patients?search=Alice", headers=admin_headers)
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    created = test_client.post(
        "/api/patients",
        headers=admin_headers,
        json={
            "first_name": "Charlie",
            "last_name": "Brown",
            "date_of_birth": "2000-03-03",
            "sex": "Male",
            "phone": "555-9999",
            "email": "charlie@example.com",
            "address": "123 Main St",
            "insurance_id": "INS-123",
        },
    )
    assert created.status_code == 201, created.text
    patient = created.json()
    assert patient["name"] == "Charlie Brown"
    assert patient["mrn"].startswith("MRN-")

    duplicate = test_client.post(
        "/api/patients",
        headers=admin_headers,
        json={
            "first_name": "Copy",
            "last_name": "Cat",
            "date_of_birth": "2000-03-03",
            "mrn": patient["mrn"],
        },
    )
    assert duplicate.status_code == 400

    updated = test_client.patch(
        f"/api/patients/{patient['id']}",
        headers=admin_headers,
        json={"first_name": "Charles", "last_name": "Brownstone", "sex": "Other"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Charles Brownstone"
    assert updated.json()["sex"] == "Other"

    history = test_client.put(
        f"/api/patients/{patient['id']}/history",
        headers=admin_headers,
        json={
            "conditions": ["migraine"],
            "allergies": ["pollen"],
            "medications": [{"name": "Ibuprofen", "dosage": "200mg", "frequency": "daily"}],
            "notes": "Needs follow-up",
        },
    )
    assert history.status_code == 200
    assert history.json()["conditions"] == ["migraine"]


def test_doctor_room_and_appointment_flows(client):
    test_client, _ = client
    admin_headers = _auth_headers(test_client, "super@clinic.com", "supersecure")

    doctors = test_client.get("/api/doctors", headers=admin_headers)
    assert doctors.status_code == 200
    assert len(doctors.json()) >= 2

    created_doctor = test_client.post(
        "/api/doctors",
        headers=admin_headers,
        json={"name": "Dr. Three", "specialty": "Dermatology", "email": "dr3@clinic.com"},
    )
    assert created_doctor.status_code == 201
    doctor_id = created_doctor.json()["id"]

    availability = test_client.patch(
        f"/api/doctors/{doctor_id}/availability",
        headers=admin_headers,
        json={"status": "break"},
    )
    assert availability.status_code == 200
    assert availability.json()["status"] == "break"

    created_room = test_client.post(
        "/api/rooms",
        headers=admin_headers,
        json={"name": "Room C", "floor": "2", "room_agent_port": 8012, "device_pin": "2468"},
    )
    assert created_room.status_code == 201
    room_id = created_room.json()["id"]

    room_assign = test_client.post(
        f"/api/rooms/{room_id}/assign",
        headers=admin_headers,
        json={"doctor_id": doctor_id},
    )
    assert room_assign.status_code == 200
    assert room_assign.json()["assigned_doctor_id"] == doctor_id

    patient_id = test_client.get("/api/patients", headers=admin_headers).json()[0]["id"]
    appt = test_client.post(
        "/api/appointments",
        headers=admin_headers,
        json={
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "room_id": room_id,
            "scheduled_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            "duration_minutes": 30,
            "appointment_type": "consult",
            "chief_complaint": "tooth pain",
        },
    )
    assert appt.status_code == 201, appt.text
    appt_id = appt.json()["id"]

    invalid_status = test_client.patch(
        f"/api/appointments/{appt_id}",
        headers=admin_headers,
        json={"status": "bogus"},
    )
    assert invalid_status.status_code == 422

    checked_in = test_client.post(f"/api/appointments/{appt_id}/check-in", headers=admin_headers)
    assert checked_in.status_code == 200
    assert checked_in.json()["status"] == "checked_in"

    queue_summary = test_client.get("/api/queue", headers=admin_headers)
    assert queue_summary.status_code == 200
    assert any(
        entry["appointment_id"] == appt_id and entry["patient_id"] == patient_id
        for entry in queue_summary.json()["entries"]
    )

    listed = test_client.get(
        f"/api/appointments?patient_id={patient_id}&status=checked_in",
        headers=admin_headers,
    )
    assert listed.status_code == 200
    assert any(item["id"] == appt_id for item in listed.json())


def test_queue_auto_assign_and_release_flow(client):
    test_client, SessionLocal = client
    admin_headers = _auth_headers(test_client, "super@clinic.com", "supersecure")
    patient_id = test_client.get("/api/patients", headers=admin_headers).json()[1]["id"]

    add = test_client.post(
        "/api/queue",
        headers=admin_headers,
        json={"patient_id": patient_id, "priority": 2},
    )
    assert add.status_code == 201, add.text
    entry = add.json()

    duplicate = test_client.post(
        "/api/queue",
        headers=admin_headers,
        json={"patient_id": patient_id, "priority": 3},
    )
    assert duplicate.status_code == 409

    auto = test_client.post(
        "/api/queue/auto-assign",
        headers=admin_headers,
        json={"queue_entry_id": entry["id"]},
    )
    assert auto.status_code == 200, auto.text
    auto_entry = auto.json()
    assert auto_entry["status"] == "called"
    assert auto_entry["room_id"]
    assert auto_entry["doctor_id"]

    in_room = test_client.patch(
        f"/api/queue/{entry['id']}",
        headers=admin_headers,
        json={"status": "in_room", "room_id": auto_entry["room_id"], "doctor_id": auto_entry["doctor_id"]},
    )
    assert in_room.status_code == 200

    done = test_client.patch(
        f"/api/queue/{entry['id']}",
        headers=admin_headers,
        json={"status": "done"},
    )
    assert done.status_code == 200

    with SessionLocal() as db:
        room = db.query(models.Room).filter(models.Room.id == auto_entry["room_id"]).first()
        assert room.status == models.RoomStatusEnum.idle
        assert room.current_patient_id is None


def test_visit_progress_approval_and_side_effects(client):
    test_client, SessionLocal = client
    admin_headers = _auth_headers(test_client, "super@clinic.com", "supersecure")
    patients = test_client.get("/api/patients", headers=admin_headers).json()
    rooms = test_client.get("/api/rooms", headers=admin_headers).json()
    doctors = test_client.get("/api/doctors", headers=admin_headers).json()

    patient_id = patients[0]["id"]
    room_id = rooms[0]["id"]
    doctor_id = doctors[0]["id"]

    appt = test_client.post(
        "/api/appointments",
        headers=admin_headers,
        json={
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "room_id": room_id,
            "scheduled_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
        },
    )
    assert appt.status_code == 201
    appt_id = appt.json()["id"]

    queue_entry = test_client.post(
        "/api/queue",
        headers=admin_headers,
        json={"patient_id": patient_id, "doctor_id": doctor_id, "room_id": room_id},
    )
    assert queue_entry.status_code == 201
    queue_id = queue_entry.json()["id"]

    test_client.patch(
        f"/api/queue/{queue_id}",
        headers=admin_headers,
        json={"status": "in_room", "doctor_id": doctor_id, "room_id": room_id},
    )

    create = test_client.post(
        "/api/visits",
        headers=admin_headers,
        json={
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "room_id": room_id,
            "appointment_id": appt_id,
            "chief_complaint": "cough",
        },
    )
    assert create.status_code == 201, create.text
    visit_id = create.json()["id"]

    progress = test_client.patch(
        f"/api/visits/{visit_id}/progress",
        headers=admin_headers,
        json={
            "transcript": "Patient reports cough for three days.",
            "dialogue": [{"speaker": "patient", "text": "Patient reports cough for three days."}],
            "status": "in_progress",
        },
    )
    assert progress.status_code == 200
    assert progress.json()["status"] == "in_progress"

    invalid_transition = test_client.patch(
        f"/api/visits/{visit_id}/status",
        headers=admin_headers,
        json={"status": "pending"},
    )
    assert invalid_transition.status_code == 400

    approve = test_client.patch(
        f"/api/visits/{visit_id}/approve",
        headers=admin_headers,
        json={
            "doctor_id": doctor_id,
            "summary": {
                "clinicalSnapshot": [
                    {"label": "cough", "category": "symptom"},
                    {"label": "asthma", "category": "symptom"},
                ],
                "doctorActions": [{"id": "1", "text": "Rest and fluids", "sourceFactIds": ["a"]}],
                "prescriptions": [{"name": "Amoxicillin", "dosage": "500mg", "frequency": "BID"}],
                "prescriptionDraft": {
                    "diagnoses": ["Upper respiratory infection"],
                    "medications": [
                        {
                            "name": "Amoxicillin",
                            "dosage": "500mg",
                            "frequency": "BID",
                            "duration": "5 days",
                            "route": "oral",
                            "instructions": "after food",
                        }
                    ],
                    "investigations": [
                        {"name": "Chest X-ray", "details": "if cough persists", "timing": "next week"}
                    ],
                    "advice": ["Increase oral fluids"],
                    "warnings": ["Return if shortness of breath worsens"],
                    "reportSummary": "No prior report findings discussed.",
                    "followUp": {"timeline": "1 week", "notes": "review cough response"},
                },
                "issuesParagraph": "Cough noted.",
                "actionsParagraph": "Medication prescribed.",
            },
        },
    )
    assert approve.status_code == 200, approve.text
    assert approve.json()["status"] == "completed"

    prescription = test_client.get(
        f"/api/visits/{visit_id}/prescription",
        headers=admin_headers,
    )
    assert prescription.status_code == 200
    assert prescription.headers["content-type"].startswith("text/html")
    assert "attachment;" in prescription.headers["content-disposition"]
    assert "Amoxicillin" in prescription.text
    assert "Upper respiratory infection" in prescription.text

    with SessionLocal() as db:
        visit = db.query(models.Visit).filter(models.Visit.id == visit_id).first()
        assert visit.status == models.VisitStatusEnum.completed
        assert visit.transcript == ""
        assert visit.dialogue == []
        assert visit.summary["prescriptionDraft"]["medications"][0]["instructions"] == "after food"
        assert visit.summary["prescriptionDraft"]["followUp"]["timeline"] == "1 week"

        appt_row = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
        assert appt_row.status == models.AppointmentStatusEnum.completed
        assert appt_row.visit_id == visit_id

        queue_row = db.query(models.WaitingQueue).filter(models.WaitingQueue.id == queue_id).first()
        assert queue_row.status == models.WaitingQueueStatusEnum.done

        room = db.query(models.Room).filter(models.Room.id == room_id).first()
        assert room.status == models.RoomStatusEnum.idle
        assert room.current_patient_id is None

        history = db.query(models.MedicalHistory).filter(models.MedicalHistory.patient_id == patient_id).first()
        assert "cough" in history.conditions
        assert history.conditions.count("asthma") == 1
        assert history.medications == [{"name": "Amoxicillin", "dosage": "500mg", "frequency": "BID"}]

    completed_conflict = test_client.patch(
        f"/api/visits/{visit_id}/progress",
        headers=admin_headers,
        json={"transcript": "should not save"},
    )
    assert completed_conflict.status_code == 409


def test_admin_users_and_audit_log_permissions(client):
    test_client, _ = client
    super_headers = _auth_headers(test_client, "super@clinic.com", "supersecure")
    admin_headers = _auth_headers(test_client, "ops@clinic.com", "opssecure")

    created_user = test_client.post(
        "/api/admin/users",
        headers=super_headers,
        json={
            "name": "New Admin",
            "email": "newadmin@clinic.com",
            "password": "password123",
            "role": "admin",
        },
    )
    assert created_user.status_code == 201, created_user.text
    user_id = created_user.json()["id"]

    duplicate = test_client.post(
        "/api/admin/users",
        headers=super_headers,
        json={
            "name": "Another Admin",
            "email": "newadmin@clinic.com",
            "password": "password123",
            "role": "admin",
        },
    )
    assert duplicate.status_code == 409

    admin_cannot_list_users = test_client.get("/api/admin/users", headers=admin_headers)
    assert admin_cannot_list_users.status_code == 403

    all_users = test_client.get("/api/admin/users", headers=super_headers)
    assert all_users.status_code == 200
    assert any(user["id"] == user_id for user in all_users.json())

    update_user = test_client.patch(
        f"/api/admin/users/{user_id}",
        headers=super_headers,
        json={"is_active": False, "name": "Renamed Admin"},
    )
    assert update_user.status_code == 200
    assert update_user.json()["is_active"] is False

    self_deactivate = test_client.get("/api/auth/me", headers=admin_headers)
    own_id = self_deactivate.json()["admin_id"]
    own_deactivate = test_client.patch(
        f"/api/admin/users/{own_id}",
        headers=admin_headers,
        json={"is_active": False},
    )
    assert own_deactivate.status_code == 403

    admin_cannot_read_audit = test_client.get("/api/audit-logs?limit=10", headers=admin_headers)
    assert admin_cannot_read_audit.status_code == 403

    audit_logs = test_client.get("/api/audit-logs?limit=10", headers=super_headers)
    assert audit_logs.status_code == 200
    assert isinstance(audit_logs.json(), list)


def test_invalid_inputs_and_not_found_cases(client):
    test_client, _ = client
    admin_headers = _auth_headers(test_client, "super@clinic.com", "supersecure")

    bad_patient = test_client.post(
        "/api/patients",
        headers=admin_headers,
        json={"first_name": "", "last_name": "X", "date_of_birth": "not-a-date"},
    )
    assert bad_patient.status_code == 422

    missing_visit = test_client.get("/api/visits/not-real", headers=admin_headers)
    assert missing_visit.status_code == 404

    bad_visit_status = test_client.get("/api/visits?status=nope", headers=admin_headers)
    assert bad_visit_status.status_code == 400

    missing_queue = test_client.patch(
        "/api/queue/not-real",
        headers=admin_headers,
        json={"status": "called"},
    )
    assert missing_queue.status_code == 404

    missing_room_login = test_client.post(
        "/api/auth/login",
        json={"mode": "room", "room_id": "missing", "pin": "1234"},
    )
    assert missing_room_login.status_code == 401
