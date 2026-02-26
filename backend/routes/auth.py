from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import bcrypt
from backend.database import get_db
from backend import crud, models

router = APIRouter(prefix="/api/auth", tags=["auth"])

class LoginRequest(BaseModel):
    mode: str  # 'admin' or 'room'
    # Admin fields
    email: Optional[str] = None
    password: Optional[str] = None
    # Room fields
    roomId: Optional[str] = None
    pin: Optional[str] = None

class LoginResponse(BaseModel):
    success: bool
    user: dict

@router.post("/login", response_model=LoginResponse)
def login(request: LoginRequest, db: Session = Depends(get_db)):
    if request.mode == "admin":
        if not request.email or not request.password:
            raise HTTPException(status_code=400, detail="Email and password required")
        
        admin = crud.get_admin_by_email(db, request.email)
        if not admin:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        
        # Verify password with bcrypt
        # Database hash is stored as string, encode to bytes for bcrypt
        valid = bcrypt.checkpw(
            request.password.encode('utf-8'), 
            admin.password_hash.encode('utf-8')
        )

        if not valid:
            raise HTTPException(status_code=401, detail="Invalid credentials")
            
        return {
            "success": True,
            "user": {
                "id": admin.id,
                "name": admin.name,
                "email": admin.email,
                "role": "admin"
            }
        }
        
    elif request.mode == "room":
        if not request.roomId or not request.pin:
            raise HTTPException(status_code=400, detail="Room ID and PIN required")
            
        room = crud.get_room(db, request.roomId)
        if not room:
            raise HTTPException(status_code=401, detail="Room not found")
            
        if room.device_pin != request.pin:
             raise HTTPException(status_code=401, detail="Invalid PIN")
             
        return {
            "success": True,
            "user": {
                "id": f"room-{room.id}",
                "name": room.name,
                "roomId": room.id,
                "role": "room"
            }
        }
        
    else:
        raise HTTPException(status_code=400, detail="Invalid login mode")
