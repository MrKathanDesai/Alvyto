import json
from datetime import datetime
from backend.database import SessionLocal, engine, Base
from backend import models
import bcrypt

# Re-create tables
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

db = SessionLocal()

def seed_data():
    print("Seeding database for Production...")


    password = "admin123"
    hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
    
    admin = models.Admin(
        id='admin1',
        name='System Administrator',
        email='admin@clinic.com',
        password_hash=hashed
    )
    db.add(admin)
    db.commit()
    print("Added Admin user")


    doctors = [
        models.Doctor(id='d1', name='Dr. Sarah Mitchell', specialty='Family Medicine', email='mitchell@clinic.com'),
        models.Doctor(id='d2', name='Dr. James Chen', specialty='Internal Medicine', email='chen@clinic.com'),
        models.Doctor(id='d3', name='Dr. Emily Rodriguez', specialty='Pediatrics', email='rodriguez@clinic.com'),
    ]
    db.add_all(doctors)
    db.commit()
    print(f"Added {len(doctors)} doctors")


    rooms = [
        models.Room(id='room1', name='Room 101', floor='1st Floor', status='free', device_pin='1234', assigned_doctor_id='d1'),
        models.Room(id='room2', name='Room 102', floor='1st Floor', status='occupied', device_pin='2345', assigned_doctor_id='d1'),
        models.Room(id='room3', name='Room 103', floor='1st Floor', status='free', device_pin='3456', assigned_doctor_id='d2'),
        models.Room(id='room4', name='Pediatrics A', floor='2nd Floor', status='offline', device_pin='4567', assigned_doctor_id='d3'),
    ]
    db.add_all(rooms)
    db.commit()
    print(f"Added {len(rooms)} rooms")


    patients = [
        models.Patient(
            id='p1', name='Sarah Johnson', mrn='MRN-2024-0001', 
            date_of_birth='1979-01-15', gender='Female',
            created_at=datetime.fromisoformat('2024-01-15T10:00:00')
        ),
        models.Patient(
            id='p2', name='Michael Chen', mrn='MRN-2024-0002', 
            date_of_birth='1957-02-20', gender='Male',
            created_at=datetime.fromisoformat('2024-02-20T14:30:00')
        ),
    ]
    db.add_all(patients)
    db.commit()
    
    # Assign p1 to Room 102
    room2 = rooms[1]
    room2.current_patient_id = 'p1'
    db.add(room2)
    db.commit()
    
    print(f"Added {len(patients)} patients")

    print("Seeding complete!")
    db.close()

if __name__ == "__main__":
    seed_data()
