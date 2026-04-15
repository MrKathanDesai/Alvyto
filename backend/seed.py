"""
backend/seed.py — Alvyto EMR Rich Seed Data
10 doctors, 25 patients, medical histories, appointments, queue entries, visits
Run: python -m backend.seed
"""

import uuid
from datetime import datetime, timedelta, timezone
from backend.database import SessionLocal, engine, Base
from backend.models import (
    AdminUser, Doctor, DoctorAvailability, DoctorAvailabilityStatusEnum,
    Patient, MedicalHistory, Room, RoomStatusEnum, AdminRoleEnum,
    Appointment, AppointmentStatusEnum, WaitingQueue, WaitingQueueStatusEnum,
    Visit, VisitStatusEnum,
)
from backend.auth import hash_password

# Re-create all tables
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

db = SessionLocal()


def uid(seed: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"alvyto-v2-{seed}"))


def utc(days_offset: int = 0, hours: int = 0, minutes: int = 0) -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=days_offset, hours=hours, minutes=minutes)


def seed_data():
    print("Seeding Alvyto EMR database with rich demo data...")

    # ─── Admin Users ───────────────────────────────────────────────────────────
    admin_id = uid("admin-super")
    admin2_id = uid("admin-ops")

    admins = [
        AdminUser(
            id=admin_id,
            name="Dr. Kathan Admin",
            email="admin@clinic.com",
            password_hash=hash_password("admin123"),
            role=AdminRoleEnum.super_admin,
            is_active=True,
        ),
        AdminUser(
            id=admin2_id,
            name="Operations Manager",
            email="ops@clinic.com",
            password_hash=hash_password("ops12345"),
            role=AdminRoleEnum.admin,
            is_active=True,
        ),
    ]
    db.add_all(admins)
    db.commit()
    print(f"  Added {len(admins)} admin users")

    # ─── Doctors ───────────────────────────────────────────────────────────────
    doctor_ids = {
        "sarah_mitchell": uid("dr-sarah-mitchell"),
        "james_chen": uid("dr-james-chen"),
        "emily_rodriguez": uid("dr-emily-rodriguez"),
        "michael_patel": uid("dr-michael-patel"),
        "jennifer_kim": uid("dr-jennifer-kim"),
        "david_okafor": uid("dr-david-okafor"),
        "lisa_harrington": uid("dr-lisa-harrington"),
        "robert_nguyen": uid("dr-robert-nguyen"),
        "amanda_flores": uid("dr-amanda-flores"),
        "christopher_black": uid("dr-christopher-black"),
    }

    doctors_data = [
        dict(id=doctor_ids["sarah_mitchell"], name="Dr. Sarah Mitchell", specialty="Family Medicine",
             email="s.mitchell@clinic.com", license_number="FM-2018-4421", phone="555-0101"),
        dict(id=doctor_ids["james_chen"], name="Dr. James Chen", specialty="Internal Medicine",
             email="j.chen@clinic.com", license_number="IM-2015-3309", phone="555-0102"),
        dict(id=doctor_ids["emily_rodriguez"], name="Dr. Emily Rodriguez", specialty="Pediatrics",
             email="e.rodriguez@clinic.com", license_number="PD-2019-5512", phone="555-0103"),
        dict(id=doctor_ids["michael_patel"], name="Dr. Michael Patel", specialty="Cardiology",
             email="m.patel@clinic.com", license_number="CA-2012-2203", phone="555-0104"),
        dict(id=doctor_ids["jennifer_kim"], name="Dr. Jennifer Kim", specialty="Neurology",
             email="j.kim@clinic.com", license_number="NR-2016-8844", phone="555-0105"),
        dict(id=doctor_ids["david_okafor"], name="Dr. David Okafor", specialty="Orthopedics",
             email="d.okafor@clinic.com", license_number="OR-2014-6631", phone="555-0106"),
        dict(id=doctor_ids["lisa_harrington"], name="Dr. Lisa Harrington", specialty="Dermatology",
             email="l.harrington@clinic.com", license_number="DM-2020-1172", phone="555-0107"),
        dict(id=doctor_ids["robert_nguyen"], name="Dr. Robert Nguyen", specialty="Gastroenterology",
             email="r.nguyen@clinic.com", license_number="GE-2013-9905", phone="555-0108"),
        dict(id=doctor_ids["amanda_flores"], name="Dr. Amanda Flores", specialty="Psychiatry",
             email="a.flores@clinic.com", license_number="PS-2017-3378", phone="555-0109"),
        dict(id=doctor_ids["christopher_black"], name="Dr. Christopher Black", specialty="Oncology",
             email="c.black@clinic.com", license_number="ON-2011-7743", phone="555-0110"),
    ]

    doctors = [Doctor(**d) for d in doctors_data]
    db.add_all(doctors)
    db.commit()
    print(f"  Added {len(doctors)} doctors")

    # Doctor availability for today
    today = datetime.now(timezone.utc).date().isoformat()
    avail_statuses = [
        (doctor_ids["sarah_mitchell"], "available"),
        (doctor_ids["james_chen"], "in_session"),
        (doctor_ids["emily_rodriguez"], "available"),
        (doctor_ids["michael_patel"], "break"),
        (doctor_ids["jennifer_kim"], "available"),
        (doctor_ids["david_okafor"], "in_session"),
        (doctor_ids["lisa_harrington"], "off_duty"),
        (doctor_ids["robert_nguyen"], "available"),
        (doctor_ids["amanda_flores"], "available"),
        (doctor_ids["christopher_black"], "off_duty"),
    ]
    db.add_all([
        DoctorAvailability(
            doctor_id=did, date=today,
            start_time="09:00", end_time="17:00",
            status=DoctorAvailabilityStatusEnum(stat),
        )
        for did, stat in avail_statuses
    ])
    db.commit()
    print("  Doctor availability set")

    # ─── Rooms ─────────────────────────────────────────────────────────────────
    room_ids = {
        "101": uid("room-101"),
        "102": uid("room-102"),
        "103": uid("room-103"),
        "104": uid("room-104"),
        "peds_a": uid("room-peds-a"),
        "cardiac_1": uid("room-cardiac-1"),
    }

    rooms_data = [
        dict(id=room_ids["101"], name="Room 101", floor="Floor 1", room_agent_port=8000,
             device_pin=hash_password("1234"), status=RoomStatusEnum.idle,
             assigned_doctor_id=doctor_ids["sarah_mitchell"]),
        dict(id=room_ids["102"], name="Room 102", floor="Floor 1", room_agent_port=8001,
             device_pin=hash_password("2345"), status=RoomStatusEnum.in_use,
             assigned_doctor_id=doctor_ids["james_chen"]),
        dict(id=room_ids["103"], name="Room 103", floor="Floor 1", room_agent_port=8002,
             device_pin=hash_password("3456"), status=RoomStatusEnum.idle,
             assigned_doctor_id=doctor_ids["emily_rodriguez"]),
        dict(id=room_ids["104"], name="Room 104 (Surgical Consult)", floor="Floor 2", room_agent_port=8003,
             device_pin=hash_password("4567"), status=RoomStatusEnum.cleaning,
             assigned_doctor_id=doctor_ids["david_okafor"]),
        dict(id=room_ids["peds_a"], name="Pediatrics Suite A", floor="Floor 2", room_agent_port=8004,
             device_pin=hash_password("5678"), status=RoomStatusEnum.idle,
             assigned_doctor_id=doctor_ids["emily_rodriguez"]),
        dict(id=room_ids["cardiac_1"], name="Cardiac Assessment 1", floor="Floor 3", room_agent_port=8005,
             device_pin=hash_password("6789"), status=RoomStatusEnum.offline,
             assigned_doctor_id=doctor_ids["michael_patel"]),
    ]

    rooms = [Room(**r) for r in rooms_data]
    db.add_all(rooms)
    db.commit()
    print(f"  Added {len(rooms)} rooms")

    # ─── Patients ──────────────────────────────────────────────────────────────
    pt = {
        "johnson": uid("pt-sarah-johnson"),
        "chen_m": uid("pt-michael-chen"),
        "patel_r": uid("pt-raj-patel"),
        "okonkwo": uid("pt-ada-okonkwo"),
        "martinez": uid("pt-carlos-martinez"),
        "lee": uid("pt-grace-lee"),
        "wilson": uid("pt-robert-wilson"),
        "garcia": uid("pt-maria-garcia"),
        "brown": uid("pt-james-brown"),
        "taylor": uid("pt-linda-taylor"),
        "nguyen_t": uid("pt-thanh-nguyen"),
        "anderson": uid("pt-lisa-anderson"),
        "thomas": uid("pt-henry-thomas"),
        "jackson": uid("pt-patricia-jackson"),
        "white": uid("pt-david-white"),
        "harris": uid("pt-barbara-harris"),
        "clark": uid("pt-richard-clark"),
        "lewis": uid("pt-susan-lewis"),
        "robinson": uid("pt-joseph-robinson"),
        "walker": uid("pt-helen-walker"),
        "hall": uid("pt-charles-hall"),
        "young": uid("pt-diana-young"),
        "allen": uid("pt-william-allen"),
        "king": uid("pt-alice-king"),
        "wright": uid("pt-george-wright"),
    }

    patients_data = [
        dict(id=pt["johnson"], mrn="MRN-2024-0001", name="Sarah Johnson",
             date_of_birth="1979-01-15", gender="Female", phone="555-1001",
             email="sarah.johnson@email.com", insurance_id="INS-44829",
             created_at=utc(-180)),
        dict(id=pt["chen_m"], mrn="MRN-2024-0002", name="Michael Chen",
             date_of_birth="1957-02-20", gender="Male", phone="555-1002",
             email="michael.chen@email.com", insurance_id="INS-33192",
             created_at=utc(-170)),
        dict(id=pt["patel_r"], mrn="MRN-2024-0003", name="Raj Patel",
             date_of_birth="1985-06-10", gender="Male", phone="555-1003",
             email="raj.patel@email.com", insurance_id="INS-58832",
             created_at=utc(-165)),
        dict(id=pt["okonkwo"], mrn="MRN-2024-0004", name="Ada Okonkwo",
             date_of_birth="1992-11-22", gender="Female", phone="555-1004",
             insurance_id="INS-72941", created_at=utc(-160)),
        dict(id=pt["martinez"], mrn="MRN-2024-0005", name="Carlos Martinez",
             date_of_birth="1966-03-18", gender="Male", phone="555-1005",
             email="cmartinez@email.com", insurance_id="INS-61033",
             created_at=utc(-155)),
        dict(id=pt["lee"], mrn="MRN-2024-0006", name="Grace Lee",
             date_of_birth="1990-09-05", gender="Female", phone="555-1006",
             insurance_id="INS-88412", created_at=utc(-150)),
        dict(id=pt["wilson"], mrn="MRN-2024-0007", name="Robert Wilson",
             date_of_birth="1952-12-01", gender="Male", phone="555-1007",
             email="rwilson@email.com", insurance_id="INS-29301",
             created_at=utc(-140)),
        dict(id=pt["garcia"], mrn="MRN-2024-0008", name="Maria Garcia",
             date_of_birth="1988-07-14", gender="Female", phone="555-1008",
             insurance_id="INS-64528", created_at=utc(-135)),
        dict(id=pt["brown"], mrn="MRN-2024-0009", name="James Brown",
             date_of_birth="1974-04-30", gender="Male", phone="555-1009",
             email="j.brown@email.com", insurance_id="INS-53771",
             created_at=utc(-130)),
        dict(id=pt["taylor"], mrn="MRN-2024-0010", name="Linda Taylor",
             date_of_birth="1960-08-22", gender="Female", phone="555-1010",
             insurance_id="INS-22859", created_at=utc(-125)),
        dict(id=pt["nguyen_t"], mrn="MRN-2024-0011", name="Thanh Nguyen",
             date_of_birth="1995-02-08", gender="Male", phone="555-1011",
             insurance_id="INS-39147", created_at=utc(-120)),
        dict(id=pt["anderson"], mrn="MRN-2024-0012", name="Lisa Anderson",
             date_of_birth="1983-10-17", gender="Female", phone="555-1012",
             insurance_id="INS-84620", created_at=utc(-115)),
        dict(id=pt["thomas"], mrn="MRN-2024-0013", name="Henry Thomas",
             date_of_birth="1948-05-25", gender="Male", phone="555-1013",
             insurance_id="INS-17395", created_at=utc(-110)),
        dict(id=pt["jackson"], mrn="MRN-2024-0014", name="Patricia Jackson",
             date_of_birth="1971-03-12", gender="Female", phone="555-1014",
             insurance_id="INS-56038", created_at=utc(-105)),
        dict(id=pt["white"], mrn="MRN-2024-0015", name="David White",
             date_of_birth="1980-11-08", gender="Male", phone="555-1015",
             insurance_id="INS-73294", created_at=utc(-100)),
        dict(id=pt["harris"], mrn="MRN-2025-0016", name="Barbara Harris",
             date_of_birth="1958-06-19", gender="Female", phone="555-1016",
             insurance_id="INS-88117", created_at=utc(-90)),
        dict(id=pt["clark"], mrn="MRN-2025-0017", name="Richard Clark",
             date_of_birth="1964-09-03", gender="Male", phone="555-1017",
             insurance_id="INS-43002", created_at=utc(-80)),
        dict(id=pt["lewis"], mrn="MRN-2025-0018", name="Susan Lewis",
             date_of_birth="1977-01-28", gender="Female", phone="555-1018",
             insurance_id="INS-62194", created_at=utc(-70)),
        dict(id=pt["robinson"], mrn="MRN-2025-0019", name="Joseph Robinson",
             date_of_birth="1991-04-14", gender="Male", phone="555-1019",
             insurance_id="INS-91834", created_at=utc(-60)),
        dict(id=pt["walker"], mrn="MRN-2025-0020", name="Helen Walker",
             date_of_birth="1969-12-31", gender="Female", phone="555-1020",
             insurance_id="INS-34571", created_at=utc(-50)),
        dict(id=pt["hall"], mrn="MRN-2025-0021", name="Charles Hall",
             date_of_birth="1955-08-07", gender="Male", phone="555-1021",
             insurance_id="INS-79023", created_at=utc(-40)),
        dict(id=pt["young"], mrn="MRN-2025-0022", name="Diana Young",
             date_of_birth="2001-02-20", gender="Female", phone="555-1022",
             insurance_id="INS-21688", created_at=utc(-30)),
        dict(id=pt["allen"], mrn="MRN-2025-0023", name="William Allen",
             date_of_birth="1972-07-11", gender="Male", phone="555-1023",
             insurance_id="INS-56800", created_at=utc(-20)),
        dict(id=pt["king"], mrn="MRN-2025-0024", name="Alice King",
             date_of_birth="1986-05-03", gender="Female", phone="555-1024",
             insurance_id="INS-13479", created_at=utc(-10)),
        dict(id=pt["wright"], mrn="MRN-2025-0025", name="George Wright",
             date_of_birth="1943-11-14", gender="Male", phone="555-1025",
             insurance_id="INS-90254", created_at=utc(-5)),
    ]

    patients = [Patient(**p) for p in patients_data]
    db.add_all(patients)
    db.commit()
    print(f"  Added {len(patients)} patients")

    # ─── Medical Histories ─────────────────────────────────────────────────────
    histories = [
        MedicalHistory(patient_id=pt["johnson"],
                       conditions=["Type 2 Diabetes", "Hypertension"],
                       allergies=["Penicillin", "Sulfa drugs"],
                       medications=[{"name": "Metformin", "dosage": "500mg", "frequency": "twice daily"},
                                    {"name": "Lisinopril", "dosage": "10mg", "frequency": "once daily"}],
                       notes="Patient monitors blood sugar daily. Well-controlled."),
        MedicalHistory(patient_id=pt["chen_m"],
                       conditions=["Coronary Artery Disease", "Atrial Fibrillation"],
                       allergies=["Aspirin", "Ibuprofen"],
                       medications=[{"name": "Warfarin", "dosage": "5mg", "frequency": "once daily"},
                                    {"name": "Atorvastatin", "dosage": "40mg", "frequency": "once daily"}],
                       notes="History of MI in 2021. INR monitored monthly."),
        MedicalHistory(patient_id=pt["patel_r"],
                       conditions=["Asthma", "Seasonal Allergies"],
                       allergies=["Latex", "Shellfish"],
                       medications=[{"name": "Albuterol", "dosage": "90mcg", "frequency": "as needed"},
                                    {"name": "Fluticasone", "dosage": "110mcg", "frequency": "twice daily"}],
                       notes="Well-controlled asthma. Carries rescue inhaler."),
        MedicalHistory(patient_id=pt["okonkwo"],
                       conditions=["Hypothyroidism"],
                       allergies=[],
                       medications=[{"name": "Levothyroxine", "dosage": "75mcg", "frequency": "once daily"}],
                       notes="Annual TSH check due next month."),
        MedicalHistory(patient_id=pt["martinez"],
                       conditions=["COPD", "Type 2 Diabetes", "Hypertension"],
                       allergies=["Penicillin"],
                       medications=[{"name": "Tiotropium", "dosage": "18mcg", "frequency": "once daily"},
                                    {"name": "Metformin", "dosage": "1000mg", "frequency": "twice daily"},
                                    {"name": "Amlodipine", "dosage": "5mg", "frequency": "once daily"}],
                       notes="Former smoker. COPD exacerbation 3 months ago."),
        MedicalHistory(patient_id=pt["lee"],
                       conditions=["Migraine", "Anxiety"],
                       allergies=["Codeine"],
                       medications=[{"name": "Sumatriptan", "dosage": "50mg", "frequency": "as needed"},
                                    {"name": "Sertraline", "dosage": "100mg", "frequency": "once daily"}],
                       notes="Migraines triggered by stress. Responds well to sumatriptan."),
        MedicalHistory(patient_id=pt["wilson"],
                       conditions=["Osteoarthritis", "Hypertension", "BPH"],
                       allergies=["Sulfa drugs", "Tramadol"],
                       medications=[{"name": "Celecoxib", "dosage": "200mg", "frequency": "once daily"},
                                    {"name": "Tamsulosin", "dosage": "0.4mg", "frequency": "once daily"}],
                       notes="Bilateral knee OA. Considering knee replacement."),
        MedicalHistory(patient_id=pt["garcia"],
                       conditions=["Gestational Diabetes History", "PCOS"],
                       allergies=[],
                       medications=[{"name": "Metformin", "dosage": "500mg", "frequency": "once daily"}],
                       notes="Monitoring for T2DM development post-pregnancy."),
        MedicalHistory(patient_id=pt["brown"],
                       conditions=["Hyperlipidemia", "Obesity"],
                       allergies=["Statins (myopathy)"],
                       medications=[{"name": "Ezetimibe", "dosage": "10mg", "frequency": "once daily"}],
                       notes="Statin intolerance. On alternative therapy."),
        MedicalHistory(patient_id=pt["taylor"],
                       conditions=["Osteoporosis", "Hypothyroidism", "Hypertension"],
                       allergies=["Aspirin"],
                       medications=[{"name": "Alendronate", "dosage": "70mg", "frequency": "weekly"},
                                    {"name": "Levothyroxine", "dosage": "100mcg", "frequency": "once daily"},
                                    {"name": "Hydrochlorothiazide", "dosage": "25mg", "frequency": "once daily"}],
                       notes="DEXA scan last year showed T-score -2.8."),
        MedicalHistory(patient_id=pt["nguyen_t"], conditions=[], allergies=["Sulfa drugs"],
                       medications=[], notes="Generally healthy. Annual physical."),
        MedicalHistory(patient_id=pt["anderson"],
                       conditions=["Depression", "Insomnia"],
                       allergies=["Bupropion (seizure history)"],
                       medications=[{"name": "Escitalopram", "dosage": "20mg", "frequency": "once daily"},
                                    {"name": "Melatonin", "dosage": "5mg", "frequency": "at bedtime"}],
                       notes="Responding well to current therapy."),
        MedicalHistory(patient_id=pt["thomas"],
                       conditions=["Heart Failure (HFrEF)", "Hypertension", "CKD Stage 3"],
                       allergies=["ACE Inhibitors (cough)", "NSAIDs"],
                       medications=[{"name": "Carvedilol", "dosage": "25mg", "frequency": "twice daily"},
                                    {"name": "Furosemide", "dosage": "40mg", "frequency": "once daily"},
                                    {"name": "Sacubitril/Valsartan", "dosage": "97/103mg", "frequency": "twice daily"}],
                       notes="EF 30-35%. Monitored closely. Electrolytes checked monthly."),
        MedicalHistory(patient_id=pt["jackson"],
                       conditions=["Fibromyalgia", "IBS"],
                       allergies=["Opioids (sensitivity)"],
                       medications=[{"name": "Duloxetine", "dosage": "60mg", "frequency": "once daily"},
                                    {"name": "Pregabalin", "dosage": "75mg", "frequency": "twice daily"}],
                       notes="Pain management ongoing. CBT also initiated."),
        MedicalHistory(patient_id=pt["white"],
                       conditions=["Crohn's Disease"],
                       allergies=[],
                       medications=[{"name": "Adalimumab", "dosage": "40mg", "frequency": "every 2 weeks"},
                                    {"name": "Azathioprine", "dosage": "100mg", "frequency": "once daily"}],
                       notes="In remission. Colonoscopy due in 6 months."),
        MedicalHistory(patient_id=pt["harris"], conditions=["Hypothyroidism", "Hypertension"],
                       allergies=["Penicillin"],
                       medications=[{"name": "Levothyroxine", "dosage": "50mcg", "frequency": "once daily"},
                                    {"name": "Lisinopril", "dosage": "5mg", "frequency": "once daily"}],
                       notes=""),
        MedicalHistory(patient_id=pt["clark"], conditions=["Gout", "Hypertension"],
                       allergies=[],
                       medications=[{"name": "Allopurinol", "dosage": "300mg", "frequency": "once daily"},
                                    {"name": "Colchicine", "dosage": "0.6mg", "frequency": "as needed"}],
                       notes="Gout flare last month managed."),
        MedicalHistory(patient_id=pt["lewis"], conditions=["Rheumatoid Arthritis"],
                       allergies=["Aspirin"],
                       medications=[{"name": "Methotrexate", "dosage": "15mg", "frequency": "weekly"},
                                    {"name": "Folic Acid", "dosage": "1mg", "frequency": "daily"}],
                       notes="DAS28 score improving."),
        MedicalHistory(patient_id=pt["robinson"], conditions=[], allergies=[],
                       medications=[], notes="Young healthy patient. Routine visit."),
        MedicalHistory(patient_id=pt["walker"],
                       conditions=["Type 2 Diabetes", "CKD Stage 2"],
                       allergies=["IV Contrast dye"],
                       medications=[{"name": "Semaglutide", "dosage": "0.5mg", "frequency": "weekly"},
                                    {"name": "Empagliflozin", "dosage": "10mg", "frequency": "once daily"}],
                       notes="GFR 72. Monitoring annually."),
        MedicalHistory(patient_id=pt["hall"],
                       conditions=["COPD", "Lung Cancer (Stage 2, remission)"],
                       allergies=["Penicillin", "Aspirin"],
                       medications=[{"name": "Tiotropium", "dosage": "18mcg", "frequency": "once daily"},
                                    {"name": "Carboplatin", "dosage": "varies", "frequency": "cycle-based"}],
                       notes="Oncology follow-up required."),
        MedicalHistory(patient_id=pt["young"], conditions=["Eating Disorder (History)", "Depression"],
                       allergies=[],
                       medications=[{"name": "Fluoxetine", "dosage": "40mg", "frequency": "once daily"}],
                       notes="Psychiatry co-management."),
        MedicalHistory(patient_id=pt["allen"], conditions=["Back Pain (Chronic)", "Sleep Apnea"],
                       allergies=["Opioids"],
                       medications=[{"name": "Cyclobenzaprine", "dosage": "5mg", "frequency": "as needed"}],
                       notes="CPAP compliant. Physical therapy ongoing."),
        MedicalHistory(patient_id=pt["king"], conditions=["Polycystic Ovary Syndrome", "Acne"],
                       allergies=[],
                       medications=[{"name": "Spironolactone", "dosage": "100mg", "frequency": "once daily"},
                                    {"name": "Tretinoin", "dosage": "0.05%", "frequency": "nightly"}],
                       notes=""),
        MedicalHistory(patient_id=pt["wright"],
                       conditions=["Dementia (mild)", "Hypertension", "Atrial Fibrillation"],
                       allergies=["Warfarin (bleeding risk)"],
                       medications=[{"name": "Donepezil", "dosage": "10mg", "frequency": "once daily"},
                                    {"name": "Apixaban", "dosage": "5mg", "frequency": "twice daily"},
                                    {"name": "Lisinopril", "dosage": "10mg", "frequency": "once daily"}],
                       notes="Cognitive decline slow. Family caregiver involved."),
    ]
    db.add_all(histories)
    db.commit()
    print(f"  Added {len(histories)} medical histories")

    # ─── Assign current patients to rooms ────────────────────────────────────
    room_102 = next(r for r in rooms if r.id == room_ids["102"])
    room_102.current_patient_id = pt["johnson"]
    db.commit()

    # ─── Appointments ──────────────────────────────────────────────────────────
    appt_ids = {
        "a1": uid("appt-1"), "a2": uid("appt-2"), "a3": uid("appt-3"),
        "a4": uid("appt-4"), "a5": uid("appt-5"), "a6": uid("appt-6"),
        "a7": uid("appt-7"), "a8": uid("appt-8"), "a9": uid("appt-9"),
        "a10": uid("appt-10"), "a11": uid("appt-11"), "a12": uid("appt-12"),
    }

    appointments_data = [
        # Today's appointments
        dict(id=appt_ids["a1"], patient_id=pt["johnson"], doctor_id=doctor_ids["sarah_mitchell"],
             room_id=room_ids["102"], scheduled_at=utc(hours=-1),
             appointment_type="Follow-up", chief_complaint="Diabetes management",
             status=AppointmentStatusEnum.in_progress, started_at=utc(hours=-1)),
        dict(id=appt_ids["a2"], patient_id=pt["patel_r"], doctor_id=doctor_ids["james_chen"],
             room_id=room_ids["101"], scheduled_at=utc(hours=1),
             appointment_type="New Patient", chief_complaint="Chest discomfort",
             status=AppointmentStatusEnum.checked_in, checked_in_at=utc(minutes=-20)),
        dict(id=appt_ids["a3"], patient_id=pt["okonkwo"], doctor_id=doctor_ids["emily_rodriguez"],
             room_id=room_ids["103"], scheduled_at=utc(hours=2),
             appointment_type="Follow-up", chief_complaint="Thyroid levels",
             status=AppointmentStatusEnum.scheduled),
        dict(id=appt_ids["a4"], patient_id=pt["martinez"], doctor_id=doctor_ids["james_chen"],
             scheduled_at=utc(hours=3),
             appointment_type="Urgent", chief_complaint="Shortness of breath",
             status=AppointmentStatusEnum.scheduled),
        dict(id=appt_ids["a5"], patient_id=pt["lee"], doctor_id=doctor_ids["jennifer_kim"],
             scheduled_at=utc(hours=4),
             appointment_type="Follow-up", chief_complaint="Migraine recurrence",
             status=AppointmentStatusEnum.scheduled),
        # Past completed
        dict(id=appt_ids["a6"], patient_id=pt["wilson"], doctor_id=doctor_ids["david_okafor"],
             room_id=room_ids["104"], scheduled_at=utc(-1),
             appointment_type="Consultation", chief_complaint="Knee pain",
             status=AppointmentStatusEnum.completed,
             checked_in_at=utc(-1, minutes=-30), started_at=utc(-1), completed_at=utc(-1, hours=1)),
        dict(id=appt_ids["a7"], patient_id=pt["garcia"], doctor_id=doctor_ids["sarah_mitchell"],
             room_id=room_ids["101"], scheduled_at=utc(-2),
             appointment_type="Annual Physical", chief_complaint="Annual check-up",
             status=AppointmentStatusEnum.completed,
             started_at=utc(-2), completed_at=utc(-2, hours=1)),
        dict(id=appt_ids["a8"], patient_id=pt["brown"], doctor_id=doctor_ids["robert_nguyen"],
             room_id=room_ids["103"], scheduled_at=utc(-3),
             appointment_type="Follow-up", chief_complaint="Cholesterol recheck",
             status=AppointmentStatusEnum.completed,
             started_at=utc(-3), completed_at=utc(-3, hours=1)),
        dict(id=appt_ids["a9"], patient_id=pt["taylor"], doctor_id=doctor_ids["jennifer_kim"],
             scheduled_at=utc(-1), appointment_type="New Patient",
             chief_complaint="Memory concerns", status=AppointmentStatusEnum.no_show),
        dict(id=appt_ids["a10"], patient_id=pt["nguyen_t"], doctor_id=doctor_ids["lisa_harrington"],
             scheduled_at=utc(1, hours=2), appointment_type="Follow-up",
             chief_complaint="Skin rash evaluation", status=AppointmentStatusEnum.scheduled),
        dict(id=appt_ids["a11"], patient_id=pt["thomas"], doctor_id=doctor_ids["michael_patel"],
             scheduled_at=utc(2), appointment_type="Urgent",
             chief_complaint="Increased leg swelling", status=AppointmentStatusEnum.scheduled),
        dict(id=appt_ids["a12"], patient_id=pt["chen_m"], doctor_id=doctor_ids["michael_patel"],
             scheduled_at=utc(-5), appointment_type="Follow-up",
             chief_complaint="Cardiac check-up", status=AppointmentStatusEnum.cancelled),
    ]

    appointments = [Appointment(**a) for a in appointments_data]
    db.add_all(appointments)
    db.commit()
    print(f"  Added {len(appointments)} appointments")

    # ─── Queue Entries ─────────────────────────────────────────────────────────
    queue_entries = [
        WaitingQueue(patient_id=pt["patel_r"], doctor_id=doctor_ids["james_chen"],
                     room_id=room_ids["101"], appointment_id=appt_ids["a2"],
                     priority=2, status=WaitingQueueStatusEnum.called,
                     check_in_time=utc(minutes=-25), called_at=utc(minutes=-5), position=1),
        WaitingQueue(patient_id=pt["johnson"], doctor_id=doctor_ids["sarah_mitchell"],
                     room_id=room_ids["102"], appointment_id=appt_ids["a1"],
                     priority=1, status=WaitingQueueStatusEnum.in_room,
                     check_in_time=utc(hours=-1, minutes=-10), in_room_at=utc(hours=-1), position=None),
        WaitingQueue(patient_id=pt["okonkwo"], doctor_id=doctor_ids["emily_rodriguez"],
                     appointment_id=appt_ids["a3"],
                     priority=3, status=WaitingQueueStatusEnum.waiting,
                     check_in_time=utc(minutes=-10), position=2),
        WaitingQueue(patient_id=pt["martinez"], appointment_id=appt_ids["a4"],
                     priority=1, status=WaitingQueueStatusEnum.waiting,
                     check_in_time=utc(minutes=-5), position=3,
                     notes="Urgent - breathing difficulty"),
        WaitingQueue(patient_id=pt["garcia"], priority=4,
                     status=WaitingQueueStatusEnum.waiting,
                     check_in_time=utc(minutes=-3), position=4),
        WaitingQueue(patient_id=pt["white"], priority=3,
                     status=WaitingQueueStatusEnum.waiting,
                     check_in_time=utc(minutes=-2), position=5),
        WaitingQueue(patient_id=pt["anderson"], priority=3,
                     status=WaitingQueueStatusEnum.waiting,
                     check_in_time=utc(minutes=-1), position=6),
        # Done today
        WaitingQueue(patient_id=pt["wilson"], doctor_id=doctor_ids["david_okafor"],
                     appointment_id=appt_ids["a6"],
                     priority=3, status=WaitingQueueStatusEnum.done,
                     check_in_time=utc(-1, minutes=-30), in_room_at=utc(-1), done_at=utc(-1, hours=1)),
    ]
    db.add_all(queue_entries)
    db.commit()
    print(f"  Added {len(queue_entries)} queue entries")

    # ─── Visits (completed with summaries) ────────────────────────────────────
    visits_data = [
        Visit(
            id=uid("visit-wilson-1"), patient_id=pt["wilson"],
            doctor_id=doctor_ids["david_okafor"], room_id=room_ids["104"],
            appointment_id=appt_ids["a6"],
            status=VisitStatusEnum.approved,
            chief_complaint="Bilateral knee pain worsening over 3 months",
            created_at=utc(-1), ended_at=utc(-1, hours=1), approved_at=utc(-1, hours=1),
            approved_by=doctor_ids["david_okafor"],
            transcript="",
            dialogue=[],
            summary={
                "clinicalSnapshot": [
                    {"label": "Bilateral knee OA", "category": "condition"},
                    {"label": "VAS pain 7/10", "category": "symptom"},
                    {"label": "Celecoxib 200mg", "category": "medication"},
                    {"label": "Considering TKR", "category": "action"},
                ],
                "doctorActions": [
                    {"id": "da1", "text": "Order weight-bearing X-rays of bilateral knees", "sourceFactIds": [], "isEdited": False},
                    {"id": "da2", "text": "Refer to physiotherapy for strengthening exercises", "sourceFactIds": [], "isEdited": False},
                    {"id": "da3", "text": "Discuss total knee replacement candidacy at next visit", "sourceFactIds": [], "isEdited": False},
                ],
                "issuesParagraph": "Patient presents with chronic bilateral knee pain consistent with advanced osteoarthritis. Pain is 7/10 on VAS, worse with stairs and prolonged standing. Celecoxib provides partial relief.",
                "actionsParagraph": "X-rays ordered to assess joint space narrowing. Physiotherapy referral placed. Patient counselled on knee replacement as potential option if conservative measures fail.",
            },
        ),
        Visit(
            id=uid("visit-garcia-1"), patient_id=pt["garcia"],
            doctor_id=doctor_ids["sarah_mitchell"], room_id=room_ids["101"],
            appointment_id=appt_ids["a7"],
            status=VisitStatusEnum.approved,
            chief_complaint="Annual check-up, PCOS management",
            created_at=utc(-2), ended_at=utc(-2, hours=1), approved_at=utc(-2, hours=1),
            approved_by=doctor_ids["sarah_mitchell"],
            transcript="", dialogue=[],
            summary={
                "clinicalSnapshot": [
                    {"label": "PCOS", "category": "condition"},
                    {"label": "Metformin 500mg", "category": "medication"},
                    {"label": "BMI 27.4", "category": "warning"},
                    {"label": "HbA1c 5.9%", "category": "result"},
                ],
                "doctorActions": [
                    {"id": "da1", "text": "Continue Metformin 500mg daily", "sourceFactIds": [], "isEdited": False},
                    {"id": "da2", "text": "Repeat HbA1c in 6 months", "sourceFactIds": [], "isEdited": False},
                    {"id": "da3", "text": "Recommend dietary consult for weight management", "sourceFactIds": [], "isEdited": False},
                ],
                "issuesParagraph": "Annual physical for PCOS management. HbA1c borderline at 5.9%. Patient tolerating Metformin well. Weight stable.",
                "actionsParagraph": "Continue current regimen. HbA1c recheck in 6 months. Dietary referral placed.",
            },
        ),
        Visit(
            id=uid("visit-brown-1"), patient_id=pt["brown"],
            doctor_id=doctor_ids["robert_nguyen"], room_id=room_ids["103"],
            appointment_id=appt_ids["a8"],
            status=VisitStatusEnum.approved,
            chief_complaint="Cholesterol management follow-up",
            created_at=utc(-3), ended_at=utc(-3, hours=1), approved_at=utc(-3, hours=1),
            approved_by=doctor_ids["robert_nguyen"],
            transcript="", dialogue=[],
            summary={
                "clinicalSnapshot": [
                    {"label": "Hyperlipidemia", "category": "condition"},
                    {"label": "LDL 148 mg/dL", "category": "result"},
                    {"label": "Ezetimibe 10mg", "category": "medication"},
                    {"label": "Statin intolerance", "category": "warning"},
                ],
                "doctorActions": [
                    {"id": "da1", "text": "Increase Ezetimibe counselling on diet modifications", "sourceFactIds": [], "isEdited": False},
                    {"id": "da2", "text": "Consider adding omega-3 supplements", "sourceFactIds": [], "isEdited": False},
                    {"id": "da3", "text": "Recheck lipid panel in 3 months", "sourceFactIds": [], "isEdited": False},
                ],
                "issuesParagraph": "LDL remains elevated at 148 mg/dL despite Ezetimibe. Patient unable to tolerate statins. Diet adherence moderate.",
                "actionsParagraph": "Reinforced dietary advice. Added omega-3 supplementation 2g daily. Lipid recheck planned in 3 months.",
            },
        ),
        # Draft visit (in progress - today)
        Visit(
            id=uid("visit-johnson-today"), patient_id=pt["johnson"],
            doctor_id=doctor_ids["sarah_mitchell"], room_id=room_ids["102"],
            appointment_id=appt_ids["a1"],
            status=VisitStatusEnum.draft,
            chief_complaint="Diabetes management - quarterly review",
            created_at=utc(hours=-1),
            transcript="",
            dialogue=[
                {"speaker": "Doctor", "text": "How has your blood sugar been tracking this month?", "start": 0, "end": 8},
                {"speaker": "Patient", "text": "It has been between 120 and 145 mostly. A bit high after dinner.", "start": 9, "end": 18},
                {"speaker": "Doctor", "text": "That post-prandial spike suggests we may need to adjust your evening dose.", "start": 19, "end": 26},
            ],
            summary={
                "clinicalSnapshot": [
                    {"label": "Type 2 Diabetes", "category": "condition"},
                    {"label": "Post-prandial hyperglycemia", "category": "symptom"},
                    {"label": "Metformin 500mg", "category": "medication"},
                ],
                "doctorActions": [
                    {"id": "da1", "text": "Adjust evening Metformin dose to 1000mg", "sourceFactIds": [], "isEdited": False},
                    {"id": "da2", "text": "Request HbA1c and fasting glucose labs", "sourceFactIds": [], "isEdited": False},
                ],
                "issuesParagraph": "Patient reports blood glucose 120-145 mg/dL with post-prandial spikes. Current Metformin dose may be insufficient.",
                "actionsParagraph": "Adjusting evening Metformin to 1000mg. Labs ordered. Follow-up in 6 weeks.",
            },
        ),
        # More historical visits
        Visit(
            id=uid("visit-martinez-old"), patient_id=pt["martinez"],
            doctor_id=doctor_ids["james_chen"],
            status=VisitStatusEnum.approved,
            chief_complaint="COPD and diabetes follow-up",
            created_at=utc(-10), ended_at=utc(-10, hours=1), approved_at=utc(-10, hours=1),
            approved_by=doctor_ids["james_chen"],
            transcript="", dialogue=[],
            summary={"clinicalSnapshot": [{"label": "COPD stable", "category": "condition"}, {"label": "HbA1c 7.8%", "category": "result"}], "doctorActions": [{"id": "da1", "text": "Continue current inhalers", "sourceFactIds": [], "isEdited": False}], "issuesParagraph": "COPD stable. HbA1c improved.", "actionsParagraph": "Continue regimen. Recheck in 3 months."},
        ),
        Visit(
            id=uid("visit-chen-old"), patient_id=pt["chen_m"],
            doctor_id=doctor_ids["michael_patel"],
            status=VisitStatusEnum.approved,
            chief_complaint="AF management and cardiac review",
            created_at=utc(-30), ended_at=utc(-30, hours=1), approved_at=utc(-30, hours=1),
            approved_by=doctor_ids["michael_patel"],
            transcript="", dialogue=[],
            summary={"clinicalSnapshot": [{"label": "Atrial Fibrillation", "category": "condition"}, {"label": "INR 2.4 (therapeutic)", "category": "result"}], "doctorActions": [{"id": "da1", "text": "Continue Warfarin. INR in 4 weeks.", "sourceFactIds": [], "isEdited": False}], "issuesParagraph": "AF stable. INR therapeutic.", "actionsParagraph": "Continue Warfarin. Monthly INR monitoring."},
        ),
        Visit(
            id=uid("visit-lee-old"), patient_id=pt["lee"],
            doctor_id=doctor_ids["jennifer_kim"],
            status=VisitStatusEnum.approved,
            chief_complaint="Migraine management",
            created_at=utc(-15), ended_at=utc(-15, hours=1), approved_at=utc(-15, hours=1),
            approved_by=doctor_ids["jennifer_kim"],
            transcript="", dialogue=[],
            summary={"clinicalSnapshot": [{"label": "Migraine with aura", "category": "condition"}, {"label": "3 attacks this month", "category": "symptom"}], "doctorActions": [{"id": "da1", "text": "Consider prophylactic therapy with topiramate", "sourceFactIds": [], "isEdited": False}], "issuesParagraph": "Increasing migraine frequency. Current abortive therapy adequate.", "actionsParagraph": "Initiated prophylaxis discussion. Follow-up in 6 weeks."},
        ),
    ]

    db.add_all(visits_data)
    db.commit()
    print(f"  Added {len(visits_data)} visits")

    print("\nSeed complete!")
    print(f"  Admin: admin@clinic.com / admin123")
    print(f"  Room 101 PIN: 1234, Room 102 PIN: 2345")
    print(f"  Total: {len(doctors)} doctors, {len(patients)} patients, {len(appointments)} appointments, {len(visits_data)} visits")

    db.close()


if __name__ == "__main__":
    seed_data()
