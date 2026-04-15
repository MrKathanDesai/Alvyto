from datetime import datetime
from html import escape
import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from fastapi.responses import Response
from sqlalchemy.orm import Session as DBSession
from sqlalchemy.orm.attributes import flag_modified
from backend.database import get_db
from backend import models
from backend.schemas import VisitCreate, VisitApprove, VisitOut
from backend.auth import require_any_auth, require_admin, audit, RequestContext

router = APIRouter(prefix="/api/visits", tags=["visits"])


ALLOWED_TRANSITIONS = {
    models.VisitStatusEnum.pending: [models.VisitStatusEnum.in_progress, models.VisitStatusEnum.cancelled],
    models.VisitStatusEnum.in_progress: [models.VisitStatusEnum.completed, models.VisitStatusEnum.cancelled],
    models.VisitStatusEnum.completed: [],
    models.VisitStatusEnum.cancelled: [],
}


class UpdateVisitStatusBody(BaseModel):
    status: str


class SaveProgressBody(BaseModel):
    transcript: Optional[str] = None
    dialogue: Optional[list] = None
    status: Optional[str] = None


class UpdatePrescriptionDraftBody(BaseModel):
    prescriptionDraft: dict  # Contains diagnoses, medications, investigations, advice, warnings, reportSummary, followUp


CONDITION_STOP_TERMS = {
    "have", "having", "pain", "fever", "cough", "cold", "nausea", "vomiting", "headache", "dizziness",
    "symptom", "issue", "problem", "feels", "feeling", "patient", "reports", "reported", "since", "days",
}

CONDITION_HINT_TERMS = {
    "pharyngitis", "gastritis", "tonsillitis", "sinusitis", "bronchitis", "pneumonia", "hypertension",
    "diabetes", "migraine", "asthma", "dermatitis", "arthritis", "infection", "uti", "cystitis",
    "anemia", "rhinitis", "otitis", "sprain", "strain", "reflux", "gerd", "copd",
}


def _normalize_condition_label(label: str) -> str:
    return re.sub(r"\s+", " ", (label or "").strip())


def _looks_like_condition(label: str) -> bool:
    value = _normalize_condition_label(label).lower()
    if not value:
        return False

    tokens = [token for token in re.findall(r"\b[a-zA-Z][a-zA-Z0-9_-]*\b", value) if len(token) > 2]
    if not tokens:
        return False
    if len(tokens) == 1 and tokens[0] in CONDITION_STOP_TERMS:
        return False
    if any(token in CONDITION_HINT_TERMS for token in tokens):
        return True
    if any(value.endswith(suffix) for suffix in ("itis", "osis", "emia", "pathy", "oma")):
        return True
    if len(tokens) >= 2 and all(token not in CONDITION_STOP_TERMS for token in tokens):
        return True
    return False


def _extract_condition_candidates(summary) -> list[str]:
    candidates: list[str] = []

    draft = summary.prescriptionDraft
    if draft and draft.diagnoses:
        for diagnosis in draft.diagnoses:
            normalized = _normalize_condition_label(diagnosis)
            if normalized and _looks_like_condition(normalized):
                candidates.append(normalized)

    # Do not infer long-term conditions from symptoms/snapshot directly.
    # Only doctor-facing structured diagnoses should be merged into history.

    deduped: list[str] = []
    seen = set()
    for item in candidates:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _extract_medication_candidates(summary) -> list[dict]:
    meds: list[dict] = []

    draft = summary.prescriptionDraft
    if draft and draft.medications:
        for med in draft.medications:
            name = str(med.name or "").strip()
            if not name:
                continue
            meds.append({
                "name": name,
                "dosage": med.dosage,
                "frequency": med.frequency,
            })

    if not meds and summary.prescriptions:
        for rx in summary.prescriptions:
            name = str(rx.name or "").strip()
            if not name:
                continue
            meds.append({
                "name": name,
                "dosage": rx.dosage,
                "frequency": rx.frequency,
            })

    deduped: list[dict] = []
    seen = set()
    for item in meds:
        key = str(item.get("name") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _normalize_quality_payload(summary: dict | None) -> dict | None:
    data = summary or {}
    quality = data.get("quality") or data.get("summary_quality")
    if not isinstance(quality, dict):
        return None

    score = float(quality.get("score") or 0)
    confidence = float(quality.get("confidence") or 0)
    missing_fields = quality.get("missingFields") or quality.get("missing_fields") or []

    return {
        "score": max(0.0, min(100.0, score)),
        "confidence": max(0.0, min(1.0, confidence)),
        "missingFields": [str(item).strip() for item in missing_fields if str(item).strip()],
        "mode": str(quality.get("mode") or "hybrid").strip() or "hybrid",
        "generatedAt": str(quality.get("generatedAt") or quality.get("generated_at") or "").strip() or None,
    }


def _normalize_structured_findings_payload(summary: dict | None) -> list[dict]:
    data = summary or {}
    findings = data.get("structuredFindings") or data.get("structured_findings") or []
    if not isinstance(findings, list):
        return []

    normalized = []
    for index, item in enumerate(findings):
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()
        if not label:
            continue
        category = str(item.get("category") or "symptom").strip() or "symptom"
        status = str(item.get("status") or "confirmed").strip() or "confirmed"
        confidence = float(item.get("confidence") or 0)
        evidence = str(item.get("evidence") or "").strip() or None

        normalized.append({
            "id": str(item.get("id") or f"f-{index}"),
            "label": label,
            "category": category,
            "status": status,
            "confidence": max(0.0, min(1.0, confidence)),
            "evidence": evidence,
        })

    return normalized


def _normalize_prescription_payload(summary: dict | None) -> dict:
    data = summary or {}
    draft = data.get("prescriptionDraft") or data.get("prescription_draft") or {}

    diagnoses = [str(item).strip() for item in draft.get("diagnoses", []) if str(item).strip()]
    medications = [
        item for item in draft.get("medications", [])
        if isinstance(item, dict) and str(item.get("name", "")).strip()
    ]
    investigations = [
        item for item in draft.get("investigations", [])
        if isinstance(item, dict) and str(item.get("name", "")).strip()
    ]
    advice = [str(item).strip() for item in draft.get("advice", []) if str(item).strip()]
    warnings = [str(item).strip() for item in draft.get("warnings", []) if str(item).strip()]
    report_summary = str(draft.get("reportSummary") or draft.get("report_summary") or "").strip()
    follow_up = draft.get("followUp") or draft.get("follow_up")

    if not medications:
        for item in data.get("prescriptions", []) or data.get("prescription_list", []) or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            medications.append({
                "name": name,
                "dosage": str(item.get("dosage") or "").strip() or None,
                "frequency": str(item.get("frequency") or "").strip() or None,
                "duration": None,
                "route": None,
                "instructions": None,
            })

    if not medications:
        for item in data.get("clinicalSnapshot", []) or data.get("clinical_snapshot", []) or []:
            if not isinstance(item, dict):
                continue
            if str(item.get("category", "")).strip().lower() != "medication":
                continue
            label = str(item.get("label", "")).strip()
            if not label:
                continue
            # Strip leading verbs
            clean = re.sub(r'^(prescribing|prescribed|taking|take|administer|administering|give|giving|start|starting|use|using|apply|applying)\s+', '', label, flags=re.IGNORECASE).strip()
            # Take only the first 1-2 words (drug name, not frequency/route)
            words = clean.split()
            # Frequency/dosage words that should not be part of the drug name
            FREQ_WORDS = {"daily","twice","once","thrice","weekly","hourly","mg","ml","mcg","g","tablet","tablets","capsule","capsules","drop","drops","patch","injection","oral","iv","im"}
            if len(words) >= 2 and words[1].lower().rstrip(".,;") in FREQ_WORDS:
                clean = words[0]
            elif len(words) > 2:
                clean = " ".join(words[:2])
            medications.append({
                "name": clean,
                "dosage": None,
                "frequency": None,
                "duration": None,
                "route": None,
                "instructions": None,
            })

    if not diagnoses:
        diagnoses = []
    if not advice:
        advice = [
            str(item.get("text", "")).strip()
            for item in data.get("doctorActions", []) or data.get("doctor_actions", []) or []
            if isinstance(item, dict) and str(item.get("text", "")).strip()
        ][:5]

    return {
        "diagnoses": diagnoses,
        "medications": medications,
        "investigations": investigations,
        "advice": advice,
        "warnings": warnings,
        "report_summary": report_summary,
        "follow_up": follow_up if isinstance(follow_up, dict) else None,
    }


def _sanitize_summary_for_response(summary: dict | None) -> dict:
    data = summary if isinstance(summary, dict) else {}
    normalized = _normalize_prescription_payload(data)

    return {
        "clinicalSnapshot": data.get("clinicalSnapshot") or data.get("clinical_snapshot") or [],
        "doctorActions": data.get("doctorActions") or data.get("doctor_actions") or [],
        "prescriptions": data.get("prescriptions") or data.get("prescription_list") or [],
        "prescriptionDraft": {
            "diagnoses": normalized["diagnoses"],
            "medications": normalized["medications"],
            "investigations": normalized["investigations"],
            "advice": normalized["advice"],
            "warnings": normalized["warnings"],
            "reportSummary": normalized["report_summary"],
            "followUp": normalized["follow_up"],
        } if (
            normalized["diagnoses"]
            or normalized["medications"]
            or normalized["investigations"]
            or normalized["advice"]
            or normalized["warnings"]
            or normalized["report_summary"]
            or normalized["follow_up"]
        ) else None,
        "issuesParagraph": str(data.get("issuesParagraph") or data.get("issues_paragraph") or ""),
        "actionsParagraph": str(data.get("actionsParagraph") or data.get("actions_paragraph") or ""),
        "chiefComplaint": str(data.get("chiefComplaint") or data.get("chief_complaint") or ""),
        "structuredFindings": data.get("structuredFindings") or data.get("structured_findings") or [],
        "quality": data.get("quality") or data.get("summary_quality") or None,
    }


def _format_medication_line(item: dict) -> str:
    parts = [
        str(item.get("dosage") or "").strip(),
        str(item.get("frequency") or "").strip(),
        str(item.get("duration") or "").strip(),
        str(item.get("route") or "").strip(),
        str(item.get("instructions") or "").strip(),
    ]
    details = " • ".join(part for part in parts if part)
    return f"{escape(str(item.get('name', '')).strip())}{f' — {escape(details)}' if details else ''}"


def _render_list(items: list[str]) -> str:
    return "".join(f"<li>{escape(item)}</li>" for item in items if item)


def _build_prescription_html(visit: models.Visit) -> str:
    patient = visit.patient
    doctor = visit.doctor
    history = getattr(patient, "medical_history", None) if patient else None
    summary = visit.summary if isinstance(visit.summary, dict) else {}
    prescription = _normalize_prescription_payload(summary)

    patient_name = escape(getattr(patient, "name", "Patient") or "Patient")
    patient_mrn  = escape(getattr(patient, "mrn", "") or "N/A")
    raw_dob = getattr(patient, "date_of_birth", "") or ""
    patient_dob  = escape(str(raw_dob).split("T")[0] if raw_dob else "N/A")
    patient_sex  = escape(getattr(patient, "sex", "") or getattr(patient, "gender", "") or "N/A")
    doctor_name  = escape(getattr(doctor, "name", "") or "Attending Physician")
    doctor_specialty = escape(getattr(doctor, "specialty", "") or "General Medicine")
    allergies    = [str(a).strip() for a in (getattr(history, "allergies", None) or []) if str(a).strip()]
    visit_date   = (visit.created_at or datetime.utcnow()).strftime("%B %d, %Y")
    ref_no       = f"RX-{visit.id[:8].upper()}"

    medication_items  = prescription["medications"]
    if not medication_items:
        for item in summary.get("prescriptions", []) or []:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            medication_items.append({
                "name": name,
                "dosage": str(item.get("dosage") or "").strip() or None,
                "frequency": str(item.get("frequency") or "").strip() or None,
                "duration": None,
                "route": None,
                "instructions": None,
            })
    diagnoses         = prescription["diagnoses"]
    advice            = prescription["advice"]
    warnings          = prescription["warnings"]
    investigations    = prescription["investigations"]
    report_summary    = prescription["report_summary"]
    follow_up         = prescription["follow_up"] or {}
    follow_up_timeline = str(follow_up.get("timeline") or "").strip()
    follow_up_notes    = str(follow_up.get("notes") or "").strip()

    def med_rows(items):
        rows = []
        for item in items:
            name  = escape(str(item.get("name", "")).strip())
            dose  = escape(str(item.get("dosage") or "").strip())
            freq  = escape(str(item.get("frequency") or "").strip())
            dur   = escape(str(item.get("duration") or "").strip())
            route = escape(str(item.get("route") or "").strip())
            instr = escape(str(item.get("instructions") or "").strip())
            rows.append(
                f"<tr>"
                f"<td class=\"med-name\">{name}</td>"
                f"<td>{dose or '—'}</td>"
                f"<td>{freq or '—'}</td>"
                f"<td>{dur or '—'}</td>"
                f"<td>{route or '—'}</td>"
                f"<td class=\"instr\">{instr or '—'}</td>"
                f"</tr>"
            )
        return "".join(rows)

    def list_items(items):
        return "".join(f"<li>{escape(str(i))}</li>" for i in items if str(i).strip())

    allergies_str = escape(", ".join(allergies)) if allergies else "None on file"

    med_section = f"""
      <table class="med-table">
        <thead>
          <tr>
            <th>Medicine</th><th>Dose</th><th>Frequency</th>
            <th>Duration</th><th>Route</th><th>Instructions</th>
          </tr>
        </thead>
        <tbody>{med_rows(medication_items)}</tbody>
      </table>""" if medication_items else "<p class=\"empty\">No medications documented for this visit.</p>"

    inv_section = ""
    if investigations:
        inv_items = "".join(
            f"<li><strong>{escape(str(item.get('name','')))}:</strong> "
            f"{escape(str(item.get('details','') or item.get('timing','') or '—'))}</li>"
            for item in investigations
        )
        inv_section = f"<ul>{inv_items}</ul>"
    elif report_summary:
        inv_section = f"<p>{escape(report_summary)}</p>"
    else:
        inv_section = "<p class=\"empty\">No investigations ordered.</p>"

    adv_section = f"<ul>{list_items(advice)}</ul>" if advice else "<p class=\"empty\">No specific advice documented.</p>"
    warn_section = f"<ul>{list_items(warnings)}</ul>" if warnings else "<p class=\"empty\">No specific warnings documented.</p>"

    diag_section = f"<ul>{list_items(diagnoses)}</ul>" if diagnoses else "<p class=\"empty\">No structured assessment captured.</p>"

    follow_up_html = ""
    if follow_up_timeline or follow_up_notes:
        parts = [p for p in [follow_up_timeline, follow_up_notes] if p]
        follow_up_html = f"<p class=\"followup-note\"><strong>Follow-up:</strong> {escape(' — '.join(parts))}</p>"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Prescription — {patient_name}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      margin: 0; padding: 32px;
      background: #f1f5f9;
      color: #0f172a;
      font-size: 14px;
      line-height: 1.5;
    }}
    .page {{
      max-width: 860px;
      margin: 0 auto;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      overflow: hidden;
    }}
    /* ── Header ── */
    .header {{
      background: #0f172a;
      color: #fff;
      padding: 28px 36px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
    }}
    .header-left h1 {{
      margin: 0 0 4px;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.3px;
    }}
    .header-left p {{ margin: 0; font-size: 13px; color: #94a3b8; }}
    .header-right {{ text-align: right; flex-shrink: 0; }}
    .header-right .clinic {{ font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }}
    .header-right .doctor-name {{ font-size: 17px; font-weight: 700; color: #fff; margin: 0 0 2px; }}
    .header-right .specialty {{ font-size: 13px; color: #94a3b8; margin: 0; }}
    .ref-badge {{
      display: inline-block;
      margin-top: 8px;
      padding: 3px 10px;
      background: rgba(255,255,255,0.1);
      border: 1px solid rgba(255,255,255,0.2);
      border-radius: 6px;
      font-size: 11px;
      color: #cbd5e1;
      font-family: monospace;
      word-break: break-all;
      max-width: 200px;
    }}
    /* ── Patient Info Bar ── */
    .patient-bar {{
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      padding: 16px 36px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
    }}
    .patient-bar .info-item label {{
      display: block;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: #94a3b8;
      margin-bottom: 3px;
    }}
    .patient-bar .info-item span {{
      font-size: 14px;
      font-weight: 600;
      color: #0f172a;
    }}
    .allergy-flag {{
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 12px;
      font-weight: 600;
      color: #dc2626;
    }}
    /* ── Body ── */
    .body {{ padding: 28px 36px; }}
    .section {{ margin-bottom: 28px; }}
    .section:last-child {{ margin-bottom: 0; }}
    .section-title {{
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: #64748b;
      margin: 0 0 12px;
      padding-bottom: 8px;
      border-bottom: 2px solid #f1f5f9;
    }}
    ul {{ margin: 0; padding-left: 18px; }}
    li {{ margin-bottom: 5px; color: #1e293b; }}
    p {{ margin: 0; color: #1e293b; }}
    .empty {{ color: #94a3b8; font-style: italic; }}
    /* ── Medication Table ── */
    .med-table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }}
    .med-table th {{
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 8px 10px;
      text-align: left;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
    }}
    .med-table td {{
      border: 1px solid #e2e8f0;
      padding: 10px;
      vertical-align: top;
      color: #1e293b;
    }}
    .med-table tr:nth-child(even) td {{ background: #f8fafc; }}
    .med-table td.med-name {{ font-weight: 600; color: #0f172a; }}
    .med-table td.instr {{ font-size: 12px; color: #475569; }}
    /* ── Follow-up ── */
    .followup-note {{
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 8px;
      padding: 10px 14px;
      color: #166534;
      margin-top: 8px;
    }}
    /* ── Signature ── */
    .signature-bar {{
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px dashed #e2e8f0;
      display: flex;
      justify-content: flex-end;
    }}
    .sig-block {{ text-align: center; }}
    .sig-line {{ width: 180px; border-top: 1px solid #0f172a; margin-bottom: 6px; }}
    .sig-label {{ font-size: 12px; color: #475569; }}
    .sig-name {{ font-size: 14px; font-weight: 700; color: #0f172a; }}
    /* ── Footer ── */
    .footer {{
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 12px 36px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }}
    .footer p {{ font-size: 11px; color: #94a3b8; margin: 0; }}
    @media print {{
      body {{ background: #fff; padding: 0; }}
      .page {{ box-shadow: none; border-radius: 0; }}
    }}
  </style>
</head>
<body>
  <div class="page">

    <div class="header">
      <div class="header-left">
        <h1>Clinical Prescription</h1>
        <p>Generated on {escape(visit_date)}</p>
      </div>
      <div class="header-right">
        <p class="clinic">Alvyto Health</p>
        <p class="doctor-name">{doctor_name}</p>
        <p class="specialty">{doctor_specialty}</p>
        <span class="ref-badge">{escape(ref_no)}</span>
      </div>
    </div>

    <div class="patient-bar">
      <div class="info-item">
        <label>Patient</label>
        <span>{patient_name}</span>
      </div>
      <div class="info-item">
        <label>MRN</label>
        <span>{patient_mrn}</span>
      </div>
      <div class="info-item">
        <label>Date of Birth</label>
        <span>{patient_dob}</span>
      </div>
      <div class="info-item">
        <label>Sex / Allergies</label>
        <span>{'<span class="allergy-flag">⚠ ' + allergies_str + '</span>' if allergies else patient_sex + ' / None'}</span>
      </div>
    </div>

    <div class="body">

      <div class="section">
        <p class="section-title">Assessment / Diagnosis</p>
        {diag_section}
      </div>

      <div class="section">
        <p class="section-title">Medications Prescribed</p>
        {med_section}
      </div>

      <div class="section">
        <p class="section-title">Investigations & Reports</p>
        {inv_section}
      </div>

      <div class="section">
        <p class="section-title">Advice & Instructions</p>
        {adv_section}
      </div>

      <div class="section">
        <p class="section-title">Warnings & Precautions</p>
        {warn_section}
        {follow_up_html}
      </div>

      <div class="signature-bar">
        <div class="sig-block">
          <div class="sig-line"></div>
          <p class="sig-name">{doctor_name}</p>
          <p class="sig-label">{doctor_specialty}</p>
        </div>
      </div>

    </div>

    <div class="footer">
      <p>This prescription was generated by Alvyto Health — {escape(visit_date)}</p>
      <p>Ref: {escape(ref_no)}</p>
    </div>

  </div>
</body>
</html>"""

@router.get("", response_model=List[VisitOut])
@router.get("/", response_model=List[VisitOut])
def list_visits(
    status: Optional[str] = Query(None),
    doctor_id: Optional[str] = Query(None),
    patient_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    """List visits with optional filters — admin only. Excludes soft-deleted visits."""
    q = db.query(models.Visit).filter(models.Visit.is_deleted == False)
    if status:
        try:
            status_enum = models.VisitStatusEnum(status)
        except ValueError as exc:
            raise HTTPException(400, "Invalid visit status") from exc
        q = q.filter(models.Visit.status == status_enum)
    if doctor_id:
        q = q.filter(models.Visit.doctor_id == doctor_id)
    if patient_id:
        q = q.filter(models.Visit.patient_id == patient_id)
    q = q.order_by(models.Visit.created_at.desc())
    visits = q.offset(offset).limit(limit).all()
    for visit in visits:
        visit.summary = _sanitize_summary_for_response(visit.summary)
    return visits


@router.post("", response_model=VisitOut, status_code=201)
@router.post("/", response_model=VisitOut, status_code=201)
def create_visit(
    body: VisitCreate,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    # Room devices can only create visits for their assigned room
    if ctx.is_room_device and body.room_id and body.room_id != ctx.room_id:
        raise HTTPException(403, "Room device can only create visits for its own room")

    patient = db.query(models.Patient).filter(models.Patient.id == body.patient_id).first()
    if not patient:
        raise HTTPException(404, "Patient not found")

    if body.doctor_id:
        doctor = db.query(models.Doctor).filter(models.Doctor.id == body.doctor_id, models.Doctor.is_active == True).first()
        if not doctor:
            raise HTTPException(404, "Doctor not found")

    if body.room_id:
        room = db.query(models.Room).filter(models.Room.id == body.room_id).first()
        if not room:
            raise HTTPException(404, "Room not found")

    if body.appointment_id:
        appt = db.query(models.Appointment).filter(models.Appointment.id == body.appointment_id).first()
        if not appt:
            raise HTTPException(404, "Appointment not found")
        if appt.patient_id != body.patient_id:
            raise HTTPException(400, "Appointment does not belong to patient")
        if body.doctor_id and appt.doctor_id and appt.doctor_id != body.doctor_id:
            raise HTTPException(400, "Appointment doctor mismatch")

    visit = models.Visit(**body.model_dump())
    visit.status = models.VisitStatusEnum.pending
    if ctx.is_room_device:
        visit.room_id = ctx.room_id
    db.add(visit)

    # Mark appointment in_progress if linked
    if body.appointment_id:
        appt = db.query(models.Appointment).filter(models.Appointment.id == body.appointment_id).first()
        if appt:
            appt.status = models.AppointmentStatusEnum.in_progress
            appt.started_at = datetime.utcnow()

    # Mark room in_use
    if visit.room_id:
        room = db.query(models.Room).filter(models.Room.id == visit.room_id).first()
        if room:
            room.status = models.RoomStatusEnum.in_use
            room.current_patient_id = visit.patient_id

    db.commit()
    db.refresh(visit)
    audit(db, ctx, "CREATE_VISIT", "visit", visit.id, {"patient_id": visit.patient_id})
    return visit


@router.get("/{visit_id}", response_model=VisitOut)
def get_visit(
    visit_id: str,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    visit = db.query(models.Visit).filter(models.Visit.id == visit_id, models.Visit.is_deleted == False).first()
    if not visit:
        raise HTTPException(404, "Visit not found")
    if ctx.is_room_device and visit.room_id != ctx.room_id:
        raise HTTPException(403, "Access denied")
    visit.summary = _sanitize_summary_for_response(visit.summary)
    audit(db, ctx, "VIEW_VISIT", "visit", visit_id)
    return visit


@router.get("/{visit_id}/prescription")
def download_visit_prescription(
    visit_id: str,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    visit = db.query(models.Visit).filter(models.Visit.id == visit_id, models.Visit.is_deleted == False).first()
    if not visit:
        raise HTTPException(404, "Visit not found")
    if ctx.is_room_device and visit.room_id != ctx.room_id:
        raise HTTPException(403, "Access denied")
    if visit.status not in {models.VisitStatusEnum.completed}:
        raise HTTPException(409, "Prescription export is only available for completed visits")

    html = _build_prescription_html(visit)
    patient_name = (getattr(visit.patient, "name", None) or "patient").strip().lower().replace(" ", "-")
    filename = f"prescription-{patient_name or 'patient'}-{visit_id[:8]}.html"
    audit(db, ctx, "DOWNLOAD_PRESCRIPTION", "visit", visit_id, {"patient_id": visit.patient_id})
    return Response(
        content=html,
        media_type="text/html; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.patch("/{visit_id}/status")
def update_visit_status(
    visit_id: str,
    body: UpdateVisitStatusBody,
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    visit = db.query(models.Visit).filter(models.Visit.id == visit_id, models.Visit.is_deleted == False).first()
    if not visit:
        raise HTTPException(404, "Visit not found")
    if ctx.is_room_device and visit.room_id != ctx.room_id:
        raise HTTPException(403, "Access denied")

    if body.status is None:
        raise HTTPException(400, "Missing required field: status")

    try:
        new_status = models.VisitStatusEnum(body.status)
    except ValueError as exc:
        raise HTTPException(400, "Invalid visit status") from exc

    try:
        current_status = visit.status if isinstance(visit.status, models.VisitStatusEnum) else models.VisitStatusEnum(str(visit.status))
    except ValueError as exc:
        raise HTTPException(400, f"Invalid current visit status: {visit.status}") from exc

    if current_status not in ALLOWED_TRANSITIONS:
        raise HTTPException(400, f"Invalid current visit status: {current_status.value}")
    if new_status not in ALLOWED_TRANSITIONS[current_status]:
        raise HTTPException(400, f"Invalid status transition: {current_status.value} -> {new_status.value}")
    visit.status = new_status
    db.commit()
    audit(
        db,
        ctx,
        "UPDATE_VISIT_STATUS",
        "visit",
        visit.id,
        {"from_status": current_status.value, "to_status": new_status.value},
    )
    return {"id": visit.id, "status": visit.status.value}


@router.patch("/{visit_id}/progress")
def save_visit_progress(
    visit_id: str,
    body: "SaveProgressBody",
    ctx: RequestContext = Depends(require_any_auth),
    db: DBSession = Depends(get_db),
):
    """Save transcript + dialogue mid-session without changing visit status.
    Called periodically during recording and when pipeline finishes.
    Idempotent — safe to call many times."""
    visit = db.query(models.Visit).filter(models.Visit.id == visit_id, models.Visit.is_deleted == False).first()
    if not visit:
        raise HTTPException(404, "Visit not found")
    if ctx.is_room_device and visit.room_id != ctx.room_id:
        raise HTTPException(403, "Access denied")
    if visit.status == models.VisitStatusEnum.completed:
        raise HTTPException(409, "Visit already completed")
    if visit.status == models.VisitStatusEnum.cancelled:
        raise HTTPException(409, "Visit was cancelled")

    if body.transcript is not None:
        visit.transcript = body.transcript
    if body.dialogue is not None:
        visit.dialogue = body.dialogue
    if body.status is not None:
        try:
            visit.status = models.VisitStatusEnum(body.status)
        except ValueError as exc:
            raise HTTPException(400, "Invalid visit status") from exc

    db.commit()
    return {"id": visit.id, "status": visit.status.value}


@router.patch("/{visit_id}/prescription-draft")
def update_prescription_draft(
    visit_id: str,
    body: UpdatePrescriptionDraftBody,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    """Update the prescription draft for a visit without approving it.
    This allows doctors to edit prescriptions before final approval."""
    visit = db.query(models.Visit).filter(models.Visit.id == visit_id, models.Visit.is_deleted == False).first()
    if not visit:
        raise HTTPException(404, "Visit not found")
    if ctx.is_room_device and visit.room_id != ctx.room_id:
        raise HTTPException(403, "Access denied")
    
    # Only allow updating prescription draft for pending or in_progress visits
    if visit.status not in (models.VisitStatusEnum.pending, models.VisitStatusEnum.in_progress, models.VisitStatusEnum.completed):
        raise HTTPException(409, f"Cannot edit prescription for visit with status: {visit.status.value}")
    
    # Initialize summary if it doesn't exist
    if not visit.summary:
        visit.summary = {}
    
    # Update the prescription draft
    visit.summary['prescriptionDraft'] = body.prescriptionDraft

    if not visit.summary.get('quality'):
        visit.summary['quality'] = {
            'score': 55.0,
            'confidence': 0.55,
            'missingFields': [],
            'mode': 'hybrid',
            'generatedAt': datetime.utcnow().isoformat(),
        }

    if not visit.summary.get('chiefComplaint'):
        snapshot = visit.summary.get('clinicalSnapshot') or []
        if isinstance(snapshot, list):
            for item in snapshot:
                if not isinstance(item, dict):
                    continue
                label = str(item.get('label') or '').strip()
                category = str(item.get('category') or '').strip().lower()
                status = str(item.get('status') or 'confirmed').strip().lower()
                if label and category == 'symptom' and status != 'denied':
                    visit.summary['chiefComplaint'] = label
                    break
    flag_modified(visit, 'summary')

    db.commit()
    return {"id": visit.id, "prescriptionDraft": visit.summary.get('prescriptionDraft')}


@router.patch("/{visit_id}/approve")
def approve_visit(
    visit_id: str,
    body: VisitApprove,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    visit = db.query(models.Visit).filter(models.Visit.id == visit_id, models.Visit.is_deleted == False).first()
    if not visit:
        raise HTTPException(404, "Visit not found")
    if ctx.is_room_device and visit.room_id != ctx.room_id:
        raise HTTPException(403, "Access denied")

    if body.doctor_id:
        doctor = db.query(models.Doctor).filter(models.Doctor.id == body.doctor_id, models.Doctor.is_active == True).first()
        if not doctor:
            raise HTTPException(404, "Doctor not found")

    now = datetime.utcnow()

    visit.summary = body.summary.model_dump()

    normalized_quality = _normalize_quality_payload(visit.summary)
    if normalized_quality is not None:
        visit.summary["quality"] = normalized_quality

    structured_findings = _normalize_structured_findings_payload(visit.summary)
    if structured_findings:
        visit.summary["structuredFindings"] = structured_findings

    chief_complaint = str(visit.summary.get("chiefComplaint") or visit.summary.get("chief_complaint") or "").strip()
    if not chief_complaint:
        snapshot = visit.summary.get("clinicalSnapshot") or []
        if isinstance(snapshot, list):
            for item in snapshot:
                if not isinstance(item, dict):
                    continue
                label = str(item.get("label") or "").strip()
                category = str(item.get("category") or "").strip().lower()
                status = str(item.get("status") or "confirmed").strip().lower()
                if label and category == "symptom" and status != "denied":
                    chief_complaint = label
                    break
    if chief_complaint:
        chief_complaint = chief_complaint[:500]
        visit.summary["chiefComplaint"] = chief_complaint

    # ── Merge visit findings into patient's ongoing medical history ──────────
    # Extract symptom-category facts → conditions
    # Extract medication-category facts → medications
    # Only merge facts that are not already present (case-insensitive dedup).
    if body.summary.clinicalSnapshot or body.summary.prescriptions or body.summary.prescriptionDraft or body.summary.structuredFindings:
        med_history = (
            db.query(models.MedicalHistory)
            .filter(models.MedicalHistory.patient_id == visit.patient_id)
            .first()
        )
        if not med_history:
            med_history = models.MedicalHistory(patient_id=visit.patient_id, conditions=[], allergies=[], medications=[])
            db.add(med_history)

        existing_conditions = {str(c).strip().lower() for c in (med_history.conditions or []) if str(c).strip()}
        new_conditions = list(med_history.conditions or [])

        for condition in _extract_condition_candidates(body.summary):
            key = condition.lower()
            if key in existing_conditions:
                continue
            existing_conditions.add(key)
            new_conditions.append(condition)

        new_medications = _extract_medication_candidates(body.summary)

        med_history.conditions = new_conditions
        if new_medications:
            # Replace only when a structured medication list is present.
            med_history.medications = new_medications
        med_history.updated_by  = body.doctor_id or ctx.sub
        flag_modified(med_history, "conditions")
        if new_medications:
            flag_modified(med_history, "medications")
    # ── End medical history merge ─────────────────────────────────────────────
    visit.status = models.VisitStatusEnum.completed
    visit.ended_at = now
    visit.approved_at = now
    visit.approved_by = body.doctor_id or ctx.sub
    if hasattr(visit, "completed_at"):
        setattr(visit, "completed_at", now)

    # Clear PHI transcript + dialogue on approval
    visit.transcript = ""
    visit.dialogue = []

    if body.doctor_id:
        visit.doctor_id = body.doctor_id

    # Complete linked appointment
    if visit.appointment_id:
        appt = db.query(models.Appointment).filter(models.Appointment.id == visit.appointment_id).first()
        if appt:
            appt.status = models.AppointmentStatusEnum.completed
            appt.completed_at = now
            appt.visit_id = visit.id

    # Mark active queue entry done
    queue_entry = (
        db.query(models.WaitingQueue)
        .filter(
            models.WaitingQueue.patient_id == visit.patient_id,
            models.WaitingQueue.status.in_([models.WaitingQueueStatusEnum.in_room, models.WaitingQueueStatusEnum.called]),
        )
        .first()
    )
    if queue_entry:
        queue_entry.status = models.WaitingQueueStatusEnum.done
        queue_entry.done_at = now

    # Release linked room
    if visit.room_id:
        room = db.query(models.Room).filter(models.Room.id == visit.room_id).first()
        if room:
            room.status = models.RoomStatusEnum.idle
            room.current_patient_id = None
            room.assigned_doctor_id = None
            if hasattr(room, "current_doctor_id"):
                setattr(room, "current_doctor_id", None)

    flag_modified(visit, "summary")
    db.commit()
    audit(db, ctx, "APPROVE_VISIT", "visit", visit_id, {"patient_id": visit.patient_id, "status": visit.status.value})
    return {"id": visit.id, "status": visit.status.value}


@router.delete("/{visit_id}", status_code=204)
def delete_visit(
    visit_id: str,
    ctx: RequestContext = Depends(require_admin),
    db: DBSession = Depends(get_db),
):
    """Soft-delete a visit. Marks as deleted but keeps in audit trail.
    Only admin can delete. Visit remains queryable by audit system."""
    visit = db.query(models.Visit).filter(models.Visit.id == visit_id).first()
    if not visit:
        raise HTTPException(404, "Visit not found")
    if visit.is_deleted:
        raise HTTPException(409, "Visit already deleted")

    visit.is_deleted = True
    visit.deleted_at = datetime.utcnow()
    db.commit()
    audit(db, ctx, "DELETE_VISIT", "visit", visit_id, {"patient_id": visit.patient_id, "deleted_at": visit.deleted_at.isoformat()})
