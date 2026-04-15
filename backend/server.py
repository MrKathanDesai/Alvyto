"""
backend/server.py — Alvyto EMR Data API
Production FastAPI server with JWT auth, RBAC, and audit logging.
Port: 8080
"""

import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from backend.database import engine, Base, get_db
from backend import models
from backend.routes import auth, patients, visits, rooms, doctors, appointments, queue, audit_logs, admin_users

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger("EMR")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all tables on startup (migration should have run first)
    Base.metadata.create_all(bind=engine)
    logger.info("EMR API started — all tables verified.")
    yield
    logger.info("EMR API shutting down.")


app = FastAPI(
    title="Alvyto EMR API",
    version="4.0.0",
    description="Local dental clinic EMR — no data leaves the clinic network.",
    lifespan=lifespan,
    redirect_slashes=False,
)

# CORS — allow all clinic LAN origins
# In production, tighten to specific room device IPs
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    response = await call_next(request)
    logger.info("%s %s %s", request.method, request.url.path, response.status_code)
    return response


# Register all routers
app.include_router(auth.router)
app.include_router(patients.router)
app.include_router(visits.router)
app.include_router(rooms.router)
app.include_router(doctors.router)
app.include_router(appointments.router)
app.include_router(queue.router)
app.include_router(audit_logs.router)
app.include_router(admin_users.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "EMR", "version": "4.0.0"}


@app.get("/api/health")
def api_health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("BACKEND_PORT", 8080))
    uvicorn.run("backend.server:app", host="127.0.0.1", port=port, reload=False)
