"""backend/routes/admin_users.py — Admin user management endpoints."""

from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session as DBSession

from backend.database import get_db
from backend import models
from backend.schemas import AdminUserCreate, AdminUserOut
from backend.auth import require_super_admin, audit, hash_password, RequestContext

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])


@router.get("", response_model=List[AdminUserOut])
@router.get("/", response_model=List[AdminUserOut])
def list_admin_users(
    ctx: RequestContext = Depends(require_super_admin),
    db: DBSession = Depends(get_db),
):
    """List all admin users."""
    users = db.query(models.AdminUser).order_by(models.AdminUser.name).all()
    return users


@router.post("", response_model=AdminUserOut, status_code=201)
@router.post("/", response_model=AdminUserOut, status_code=201)
def create_admin_user(
    body: AdminUserCreate,
    ctx: RequestContext = Depends(require_super_admin),
    db: DBSession = Depends(get_db),
):
    """Create a new admin user."""
    existing = db.query(models.AdminUser).filter(models.AdminUser.email == body.email).first()
    if existing:
        raise HTTPException(409, "Email already in use")
    user = models.AdminUser(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        role=models.AdminRoleEnum(body.role),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    audit(db, ctx, "CREATE_ADMIN_USER", "admin_user", user.id, {"name": user.name, "role": user.role})
    return user


@router.patch("/{user_id}", response_model=AdminUserOut)
def update_admin_user(
    user_id: str,
    body: dict,
    ctx: RequestContext = Depends(require_super_admin),
    db: DBSession = Depends(get_db),
):
    """Update admin user — activate/deactivate or change role."""
    user = db.query(models.AdminUser).filter(models.AdminUser.id == user_id).first()
    if not user:
        raise HTTPException(404, "Admin user not found")
    # Prevent self-deactivation
    if user_id == ctx.sub and body.get("is_active") is False:
        raise HTTPException(400, "Cannot deactivate your own account")
    allowed = {"is_active", "role", "name"}
    for k, v in body.items():
        if k in allowed:
            setattr(user, k, v)
    db.commit()
    db.refresh(user)
    audit(db, ctx, "UPDATE_ADMIN_USER", "admin_user", user_id, body)
    return user
