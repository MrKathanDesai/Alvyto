from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from .. import crud, models, schemas
from ..database import get_db

router = APIRouter(
    prefix="/api/visits",
    tags=["visits"],
    responses={404: {"description": "Not found"}},
)

@router.post("/", response_model=schemas.Visit)
def create_visit(visit: schemas.VisitCreate, db: Session = Depends(get_db)):
    return crud.create_visit(db=db, visit=visit)

@router.get("/", response_model=List[schemas.Visit])
def read_visits(skip: int = 0, limit: int = 100, room_id: str = None, status: str = None, db: Session = Depends(get_db)):
    visits = crud.get_visits(db, skip=skip, limit=limit, room_id=room_id, status=status)
    return visits

@router.get("/{visit_id}", response_model=schemas.Visit)
def read_visit(visit_id: str, db: Session = Depends(get_db)):
    db_visit = crud.read_visit(db, visit_id=visit_id)
    if db_visit is None:
        raise HTTPException(status_code=404, detail="Visit not found")
    return db_visit

@router.patch("/{visit_id}", response_model=schemas.Visit)
def update_visit(visit_id: str, updates: schemas.VisitUpdate, db: Session = Depends(get_db)):
    db_visit = crud.update_visit(db, visit_id=visit_id, updates=updates)
    if db_visit is None:
        raise HTTPException(status_code=404, detail="Visit not found")
    return db_visit
