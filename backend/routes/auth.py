from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session as DBSession
from backend.database import get_db
from backend import models
from backend.schemas import LoginRequest, LoginResponse
from backend.auth import (
    verify_password, create_access_token, create_session, revoke_session,
    ADMIN_TOKEN_EXPIRE_HOURS, ROOM_TOKEN_EXPIRE_HOURS,
    get_request_context, RequestContext, hash_password, audit
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest, request: Request, db: DBSession = Depends(get_db)):
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")

    if req.mode == "admin":
        if not req.email or not req.password:
            raise HTTPException(status_code=400, detail="Email and password required")
        user = db.query(models.AdminUser).filter(
            models.AdminUser.email == req.email,
            models.AdminUser.is_active == True,
        ).first()
        if not user or not verify_password(req.password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        token, expires_at = create_access_token(
            subject=user.id, role=user.role,
            expire_hours=ADMIN_TOKEN_EXPIRE_HOURS,
        )
        create_session(db, token, user.role, expires_at,
                       admin_user_id=user.id, ip_address=ip, user_agent=ua)
        user.last_login_at = datetime.utcnow()
        db.commit()
        login_ctx = RequestContext(sub=user.id, role=user.role, room_id=None, raw_token=token, ip=ip or "unknown")
        audit(db, login_ctx, "LOGIN", "admin_user", user.id, {"mode": "admin"})
        return LoginResponse(
            token=token, role=user.role,
            admin_id=user.id, name=user.name,
            expires_at=expires_at,
        )

    else:  # room
        if not req.room_id or not req.pin:
            raise HTTPException(status_code=400, detail="room_id and pin required")
        room = db.query(models.Room).filter(models.Room.id == req.room_id).first()
        if not room or not room.device_pin:
            raise HTTPException(status_code=401, detail="Invalid room credentials")
        verified = verify_password(req.pin, room.device_pin)
        if not verified and room.device_pin == req.pin:
            # Upgrade legacy plaintext room PINs in place after a successful login attempt.
            room.device_pin = hash_password(req.pin)
            db.commit()
            verified = True
        if not verified:
            raise HTTPException(status_code=401, detail="Invalid room credentials")
        token, expires_at = create_access_token(
            subject=room.id, role="room_device",
            expire_hours=ROOM_TOKEN_EXPIRE_HOURS,
            room_id=room.id,
        )
        create_session(db, token, "room_device", expires_at,
                       room_id=room.id, ip_address=ip, user_agent=ua)
        login_ctx = RequestContext(sub=room.id, role="room_device", room_id=room.id, raw_token=token, ip=ip or "unknown")
        audit(db, login_ctx, "LOGIN", "room", room.id, {"mode": "room"})
        return LoginResponse(
            token=token, role="room_device",
            room_id=room.id, name=room.name,
            expires_at=expires_at,
        )


@router.post("/logout")
def logout(
    ctx: RequestContext = Depends(get_request_context),
    db: DBSession = Depends(get_db),
):
    audit(db, ctx, "LOGOUT", "session", ctx.sub)
    revoke_session(db, ctx.raw_token)
    return {"message": "Logged out successfully"}


@router.get("/me")
def me(ctx: RequestContext = Depends(get_request_context), db: DBSession = Depends(get_db)):
    if ctx.is_room_device:
        room = db.query(models.Room).filter(models.Room.id == ctx.sub).first()
        return {"role": ctx.role, "room_id": ctx.room_id, "name": room.name if room else None}
    user = db.query(models.AdminUser).filter(models.AdminUser.id == ctx.sub).first()
    return {"role": ctx.role, "admin_id": ctx.sub, "name": user.name if user else None}
