"""
Exam Room EMR - Production Backend API

Features:
- Pure Data API (Patients, Rooms, Visits, Doctors, Auth)
- Transcription is handled by valid 'room-agent' service on port 8000
- Runs on Port 8080
"""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Database & Routes
from .database import engine, Base
from .routes import patients, rooms, visits, doctors, auth

# Create tables
Base.metadata.create_all(bind=engine)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Exam Room EMR - Data Backend",
    description="Data management API for Exam Room EMR",
    version="3.1.0"
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    # Allow localhost:3000 (Next.js) and other local devs
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(patients.router)
app.include_router(rooms.router)
app.include_router(visits.router)
app.include_router(doctors.router)
app.include_router(auth.router)

@app.get("/health")
async def health_check():
    """Health check."""
    return {
        "status": "healthy",
        "service": "backend-data-api",
        "version": "3.1.0"
    }

if __name__ == "__main__":
    import uvicorn
    
    print("\n" + "="*60)
    print("  Exam Room EMR - Data Backend v3.1")
    print("="*60)
    print("  Port: 8080")
    print("  Transcription: Delegated to Room Agent (:8000)")
    print("  API docs: http://localhost:8080/docs")
    print("="*60 + "\n")
    
    uvicorn.run(
        "backend.server:app",
        host="0.0.0.0",
        port=8080,
        reload=True,
        log_level="info"
    )
