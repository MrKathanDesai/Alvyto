"""backend/routes/audit_logs.py — Audit log read endpoint."""

from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session as DBSession

from backend.database import get_db
from backend import models
from backend.schemas import AuditLogOut
from backend.auth import require_super_admin, RequestContext

router = APIRouter(prefix="/api/audit-logs", tags=["audit-logs"])


@router.get("", response_model=List[AuditLogOut])
@router.get("/", response_model=List[AuditLogOut])
def list_audit_logs(
    action: Optional[str] = Query(None),
    actor_role: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    ctx: RequestContext = Depends(require_super_admin),
    db: DBSession = Depends(get_db),
):
    """Paginated audit log — super_admin only for sensitive entries."""
    q = db.query(models.AuditLog)
    if action:
        q = q.filter(models.AuditLog.action.ilike(f"%{action}%"))
    if actor_role:
        q = q.filter(models.AuditLog.actor_role == actor_role)
    if resource_type:
        q = q.filter(models.AuditLog.resource_type == resource_type)
    q = q.order_by(models.AuditLog.timestamp.desc())
    return q.offset(offset).limit(limit).all()
