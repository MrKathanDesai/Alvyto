"""
backend/migrate.py — Database migration for Alvyto EMR.

Safely migrates the existing emr.db to the new production schema.
- Preserves all existing patient, doctor, room, and visit data
- Renames 'admin_users' ← 'admins' if old table existed
- Adds all new columns with safe defaults
- Creates new tables: appointments, waiting_queues, audit_logs, sessions
- Run with: python3 -m backend.migrate

Safe to run multiple times (idempotent).
"""

import sqlite3
import uuid
import os
from datetime import datetime

DB_PATH = os.environ.get("DATABASE_URL", "emr.db").replace("sqlite:///", "")


def utcnow_str() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


def column_exists(cur: sqlite3.Cursor, table: str, column: str) -> bool:
    cur.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cur.fetchall())


def table_exists(cur: sqlite3.Cursor, table: str) -> bool:
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cur.fetchone() is not None


def run_migration() -> None:
    print(f"Running migration on: {DB_PATH}")
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    # ── 1. Rename old 'admins' table to 'admin_users' if needed ──────────────
    if table_exists(cur, "admins") and not table_exists(cur, "admin_users"):
        print("  Renaming 'admins' → 'admin_users'")
        cur.execute("ALTER TABLE admins RENAME TO admin_users")

    # ── 2. Ensure admin_users has new columns ─────────────────────────────────
    if table_exists(cur, "admin_users"):
        if not column_exists(cur, "admin_users", "role"):
            cur.execute("ALTER TABLE admin_users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'")
            print("  admin_users: added 'role'")
        if not column_exists(cur, "admin_users", "is_active"):
            cur.execute("ALTER TABLE admin_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1")
            print("  admin_users: added 'is_active'")
        if not column_exists(cur, "admin_users", "last_login_at"):
            cur.execute("ALTER TABLE admin_users ADD COLUMN last_login_at TEXT")
            print("  admin_users: added 'last_login_at'")

    # ── 3. Ensure doctors has new columns ────────────────────────────────────
    if table_exists(cur, "doctors"):
        for col, defn in [
            ("license_number", "TEXT"),
            ("phone", "TEXT"),
            ("is_active", "INTEGER NOT NULL DEFAULT 1"),
        ]:
            if not column_exists(cur, "doctors", col):
                cur.execute(f"ALTER TABLE doctors ADD COLUMN {col} {defn}")
                print(f"  doctors: added '{col}'")

    # ── 4. Ensure rooms has new columns ──────────────────────────────────────
    if table_exists(cur, "rooms"):
        for col, defn in [
            ("room_agent_port", "INTEGER"),
            ("updated_at", f"TEXT NOT NULL DEFAULT '{utcnow_str()}'"),
        ]:
            if not column_exists(cur, "rooms", col):
                cur.execute(f"ALTER TABLE rooms ADD COLUMN {col} {defn}")
                print(f"  rooms: added '{col}'")

    # ── 5. Ensure patients has new columns ───────────────────────────────────
    if table_exists(cur, "patients"):
        for col, defn in [
            ("phone", "TEXT"),
            ("email", "TEXT"),
            ("address", "TEXT"),
            ("insurance_id", "TEXT"),
            ("updated_at", f"TEXT NOT NULL DEFAULT '{utcnow_str()}'"),
        ]:
            if not column_exists(cur, "patients", col):
                cur.execute(f"ALTER TABLE patients ADD COLUMN {col} {defn}")
                print(f"  patients: added '{col}'")
        # Ensure MRN exists — backfill existing patients
        if not column_exists(cur, "patients", "mrn"):
            cur.execute("ALTER TABLE patients ADD COLUMN mrn TEXT")
            print("  patients: added 'mrn'")
            cur.execute("SELECT id FROM patients WHERE mrn IS NULL")
            rows = cur.fetchall()
            for (pid,) in rows:
                mrn = "MRN-" + str(uuid.uuid4())[:8].upper()
                cur.execute("UPDATE patients SET mrn = ? WHERE id = ?", (mrn, pid))
            print(f"  patients: backfilled {len(rows)} MRN values")

    # ── 6. Ensure medical_history has notes + updated_by ─────────────────────
    if table_exists(cur, "medical_history"):
        for col, defn in [
            ("notes", "TEXT"),
            ("updated_by", "TEXT"),
        ]:
            if not column_exists(cur, "medical_history", col):
                cur.execute(f"ALTER TABLE medical_history ADD COLUMN {col} {defn}")
                print(f"  medical_history: added '{col}'")

    # ── 7. Ensure visits has new columns ─────────────────────────────────────
    if table_exists(cur, "visits"):
        for col, defn in [
            ("appointment_id", "TEXT"),
            ("chief_complaint", "TEXT"),
            ("approved_at", "TEXT"),
            ("approved_by", "TEXT"),
        ]:
            if not column_exists(cur, "visits", col):
                cur.execute(f"ALTER TABLE visits ADD COLUMN {col} {defn}")
                print(f"  visits: added '{col}'")

    # ── 8. Create sessions table ──────────────────────────────────────────────
    if not table_exists(cur, "sessions"):
        cur.execute("""
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                admin_user_id TEXT REFERENCES admin_users(id),
                room_id TEXT REFERENCES rooms(id),
                token_hash TEXT NOT NULL UNIQUE,
                role TEXT NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked_at TEXT,
                revoked INTEGER NOT NULL DEFAULT 0
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_sessions_token_hash ON sessions(token_hash)")
        print("  Created table: sessions")

    # ── 9. Create appointments table ─────────────────────────────────────────
    if not table_exists(cur, "appointments"):
        cur.execute("""
            CREATE TABLE appointments (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL REFERENCES patients(id),
                doctor_id TEXT REFERENCES doctors(id),
                room_id TEXT REFERENCES rooms(id),
                scheduled_at TEXT NOT NULL,
                duration_minutes INTEGER NOT NULL DEFAULT 30,
                appointment_type TEXT,
                chief_complaint TEXT,
                notes TEXT,
                status TEXT NOT NULL DEFAULT 'scheduled',
                checked_in_at TEXT,
                started_at TEXT,
                completed_at TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT,
                visit_id TEXT REFERENCES visits(id)
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_appt_patient ON appointments(patient_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_appt_scheduled_at ON appointments(scheduled_at)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_appt_status ON appointments(status)")
        print("  Created table: appointments")

    # ── 10. Create waiting_queues table ───────────────────────────────────────
    if not table_exists(cur, "waiting_queues"):
        cur.execute("""
            CREATE TABLE waiting_queues (
                id TEXT PRIMARY KEY,
                patient_id TEXT NOT NULL REFERENCES patients(id),
                appointment_id TEXT REFERENCES appointments(id),
                room_id TEXT REFERENCES rooms(id),
                doctor_id TEXT REFERENCES doctors(id),
                priority INTEGER NOT NULL DEFAULT 3,
                status TEXT NOT NULL DEFAULT 'waiting',
                check_in_time TEXT NOT NULL,
                called_at TEXT,
                in_room_at TEXT,
                done_at TEXT,
                notes TEXT,
                position INTEGER
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_queue_patient ON waiting_queues(patient_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_queue_status_checkin ON waiting_queues(status, check_in_time)")
        print("  Created table: waiting_queues")

    # ── 11. Create doctor_availabilities table ────────────────────────────────
    if not table_exists(cur, "doctor_availabilities"):
        cur.execute("""
            CREATE TABLE doctor_availabilities (
                id TEXT PRIMARY KEY,
                doctor_id TEXT NOT NULL REFERENCES doctors(id),
                date TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'available',
                updated_at TEXT NOT NULL
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_doc_avail_date_doctor ON doctor_availabilities(date, doctor_id)")
        print("  Created table: doctor_availabilities")

    # ── 12. Create audit_logs table ───────────────────────────────────────────
    if not table_exists(cur, "audit_logs"):
        cur.execute("""
            CREATE TABLE audit_logs (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                actor_id TEXT,
                actor_role TEXT,
                actor_ip TEXT,
                action TEXT NOT NULL,
                resource_type TEXT,
                resource_id TEXT,
                detail TEXT,
                success INTEGER NOT NULL DEFAULT 1,
                error_detail TEXT
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS ix_audit_timestamp ON audit_logs(timestamp)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_audit_actor ON audit_logs(actor_id, timestamp)")
        cur.execute("CREATE INDEX IF NOT EXISTS ix_audit_resource ON audit_logs(resource_type, resource_id)")
        print("  Created table: audit_logs")

    con.commit()
    con.close()
    print("Migration complete.")


if __name__ == "__main__":
    run_migration()
