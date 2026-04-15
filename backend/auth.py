"""
backend/auth.py — JWT authentication, RBAC, and request context for Alvyto EMR.

JWT Strategy:
- HS256 signed tokens
- 8-hour expiry for admin sessions, 24-hour for room devices
- Server-side session tracking in sessions table for revocation
- Token hash stored (SHA-256) — raw token never stored

RBAC:
  super_admin  → full access including user management, audit logs
  admin        → all clinical data, queue, assignments; no user management
  room_device  → own room data, create/read visits for assigned patient only
"""

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Optional, Tuple

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
import bcrypt as _bcrypt
from sqlalchemy.orm import Session as DBSession

from backend.database import get_db
from backend import models

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY = os.environ.get("JWT_SECRET_KEY", secrets.token_hex(32))
ALGORITHM = "HS256"
ADMIN_TOKEN_EXPIRE_HOURS = 8
ROOM_TOKEN_EXPIRE_HOURS = 24

bearer_scheme = HTTPBearer(auto_error=False)


# ── Password helpers ──────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode("utf-8"), _bcrypt.gensalt(rounds=12)).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def hash_token(token: str) -> str:
    """SHA-256 of raw JWT — stored in sessions table instead of raw token."""
    return hashlib.sha256(token.encode()).hexdigest()

# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_access_token(
    subject: str,
    role: str,
    expire_hours: int,
    room_id: Optional[str] = None,
) -> Tuple[str, datetime]:
    expire = datetime.now(timezone.utc) + timedelta(hours=expire_hours)
    payload = {
        "sub": subject,
        "role": role,
        "exp": int(expire.timestamp()),
    }
    if room_id:
        payload["room_id"] = room_id
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return token, expire.replace(tzinfo=None)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# ── Session management ────────────────────────────────────────────────────────

def create_session(
    db: DBSession,
    token: str,
    role: str,
    expires_at: datetime,
    admin_user_id: Optional[str] = None,
    room_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> models.Session:
    session = models.Session(
        admin_user_id=admin_user_id,
        room_id=room_id,
        token_hash=hash_token(token),
        role=role,
        ip_address=ip_address,
        user_agent=user_agent,
        expires_at=expires_at,
    )
    db.add(session)
    db.commit()
    return session


def revoke_session(db: DBSession, token: str) -> bool:
    th = hash_token(token)
    session = db.query(models.Session).filter(
        models.Session.token_hash == th,
        models.Session.revoked == False,
    ).first()
    if not session:
        return False
    session.revoked = True
    session.revoked_at = datetime.utcnow()
    db.commit()
    return True


def is_session_valid(db: DBSession, token: str) -> bool:
    th = hash_token(token)
    session = db.query(models.Session).filter(
        models.Session.token_hash == th,
        models.Session.revoked == False,
    ).first()
    if not session:
        return False
    if session.expires_at < datetime.utcnow():
        return False
    return True


# ── Request context ───────────────────────────────────────────────────────────

class RequestContext:
    """Parsed auth context attached to every authenticated request."""
    def __init__(self, sub: str, role: str, room_id: Optional[str], raw_token: str, ip: str):
        self.sub = sub
        self.role = role
        self.room_id = room_id
        self.raw_token = raw_token
        self.ip = ip

    @property
    def is_admin(self) -> bool:
        return self.role in ("admin", "super_admin")

    @property
    def is_super_admin(self) -> bool:
        return self.role == "super_admin"

    @property
    def is_room_device(self) -> bool:
        return self.role == "room_device"


def get_request_context(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: DBSession = Depends(get_db),
) -> RequestContext:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials
    if not is_session_valid(db, token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or revoked",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    ip = request.client.host if request.client else "unknown"
    return RequestContext(
        sub=payload["sub"],
        role=payload["role"],
        room_id=payload.get("room_id"),
        raw_token=token,
        ip=ip,
    )


# Convenience dependency aliases
def require_admin(ctx: RequestContext = Depends(get_request_context)) -> RequestContext:
    if not ctx.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return ctx

def require_super_admin(ctx: RequestContext = Depends(get_request_context)) -> RequestContext:
    if not ctx.is_super_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin access required")
    return ctx

def require_any_auth(ctx: RequestContext = Depends(get_request_context)) -> RequestContext:
    return ctx


# ── Audit logging helper ──────────────────────────────────────────────────────

def audit(
    db: DBSession,
    ctx: RequestContext,
    action: str,
    resource_type: Optional[str] = None,
    resource_id: Optional[str] = None,
    detail: Optional[dict] = None,
    success: bool = True,
    error_detail: Optional[str] = None,
) -> None:
    """Write one immutable audit log entry. Call from every route that touches PHI."""
    entry = models.AuditLog(
        actor_id=ctx.sub,
        actor_role=ctx.role,
        actor_ip=ctx.ip,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        detail=detail,
        success=success,
        error_detail=error_detail,
    )
    db.add(entry)
    db.commit()
