from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from .. import crud, models, schemas
from ..database import get_db

router = APIRouter(
    prefix="/api/patients",
    tags=["patients"],
    responses={404: {"description": "Not found"}},
)

@router.get("/", response_model=List[schemas.Patient])
def read_patients(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    patients = crud.get_patients(db, skip=skip, limit=limit)
    return patients

@router.post("/", response_model=schemas.Patient)
def create_patient(patient: schemas.PatientCreate, db: Session = Depends(get_db)):
    return crud.create_patient(db=db, patient=patient)

@router.get("/{patient_id}", response_model=schemas.Patient)
def read_patient(patient_id: str, db: Session = Depends(get_db)):
    db_patient = crud.get_patient(db, patient_id=patient_id)
    if db_patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    return db_patient

@router.put("/{patient_id}/history", response_model=schemas.MedicalHistory)
def update_patient_history(
    patient_id: str, 
    history: schemas.MedicalHistoryCreate, 
    db: Session = Depends(get_db)
):
    db_patient = crud.get_patient(db, patient_id=patient_id)
    if db_patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    
    return crud.update_patient_history(db=db, patient_id=patient_id, history=history)

@router.get("/{patient_id}/visits", response_model=List[schemas.Visit])
def read_patient_visits(patient_id: str, db: Session = Depends(get_db)):
     db_patient = crud.get_patient(db, patient_id=patient_id)
     if db_patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
     
     return crud.get_patient_visits(db, patient_id=patient_id)
