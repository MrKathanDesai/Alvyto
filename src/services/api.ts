import type {
  Room, Doctor, EMRPatient, MedicalHistoryRecord,
  Appointment, QueueEntry, QueueSummary, AutoAssignRequest,
  RoomStatus
} from '@/types/emr';
import type { Visit, VisitSummary, KeyFactCategory, PrescriptionDraft } from '@/types/index';
import { triggerPrescriptionDownload } from '@/utils/prescriptionExport';

const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Separate localStorage keys for admin panel vs room panel so logging into
// one panel never invalidates the other's session.
const ADMIN_TOKEN_KEY = 'alvyto_admin_token';
const ROOM_TOKEN_KEY  = 'alvyto_token';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  const isAdminPanel = window.location.pathname.startsWith('/admin');
  return localStorage.getItem(isAdminPanel ? ADMIN_TOKEN_KEY : ROOM_TOKEN_KEY);
}

export function storeToken(token: string, mode?: 'admin' | 'room'): void {
  localStorage.setItem(mode === 'admin' ? ADMIN_TOKEN_KEY : ROOM_TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(ROOM_TOKEN_KEY);
}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string | null,
): Promise<T> {
  const t = token ?? getStoredToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t) headers['Authorization'] = 'Bearer ' + t;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as unknown as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data?.detail || data?.message || 'Request failed';
    console.error(`[API] ${method} ${path} failed: ${res.status} - ${errorMsg}`, { data, token: t ? 'present' : 'missing' });
    throw new Error(errorMsg);
  }
  return data as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface LoginPayload {
  token: string;
  role: string;
  roomId?: string;
  adminId?: string;
  name?: string;
  expiresAt: string;
}

export async function login(params: {
  mode: 'admin' | 'room';
  email?: string;
  password?: string;
  roomId?: string;
  pin?: string;
}): Promise<LoginPayload> {
  const raw = await req<{
    token: string; role: string; room_id?: string; admin_id?: string;
    name?: string; expires_at: string;
  }>('POST', '/api/auth/login', {
    mode: params.mode,
    email: params.email,
    password: params.password,
    room_id: params.roomId,
    pin: params.pin,
  }, null);
  return {
    token: raw.token,
    role: raw.role,
    roomId: raw.room_id,
    adminId: raw.admin_id,
    name: raw.name,
    expiresAt: raw.expires_at,
  };
}

export async function logout(): Promise<void> {
  await req('POST', '/api/auth/logout').catch(() => {});
  clearToken();
}

export async function getMe(): Promise<{ role: string; name: string | null; adminId?: string; roomId?: string }> {
  const raw = await req<{ role: string; name: string | null; admin_id?: string; room_id?: string }>('GET', '/api/auth/me');
  return { role: raw.role, name: raw.name, adminId: raw.admin_id, roomId: raw.room_id };
}

// ── Patients ──────────────────────────────────────────────────────────────────

function mapPatient(r: Record<string, unknown>): EMRPatient {
  const hist = r.medical_history as Record<string, unknown> | null;
  const fallbackName = ((r.name as string) ?? '').trim();
  const fallbackParts = fallbackName ? fallbackName.split(/\s+/, 2) : [];
  const fallbackFirst = fallbackParts.length > 0 ? fallbackParts[0] : '';
  const fallbackLast = fallbackParts.length > 1 ? fallbackParts[1] : '';
  const firstName = ((r.first_name as string) ?? fallbackFirst ?? '').trim();
  const lastName = ((r.last_name as string) ?? fallbackLast ?? '').trim();

  return {
    id: r.id as string,
    mrn: ((r.mrn as string) ?? (r.medical_record_number as string) ?? '') as string,
    firstName,
    lastName,
    name: fallbackName || [firstName, lastName].filter(Boolean).join(' ').trim(),
    dateOfBirth: r.date_of_birth as string,
    sex: (r.sex as string) ?? (r.gender as string) ?? null,
    gender: (r.gender as string) ?? (r.sex as string) ?? null,
    phone: (r.phone as string) ?? null,
    email: (r.email as string) ?? null,
    address: (r.address as string) ?? null,
    insuranceId: (r.insurance_id as string) ?? null,
    createdAt: r.created_at as string,
    medicalHistory: hist
      ? {
          id: hist.id as string,
          patientId: hist.patient_id as string,
          conditions: (hist.conditions as string[]) ?? [],
          allergies: (hist.allergies as string[]) ?? [],
          medications: (hist.medications as Record<string, unknown>[]) ?? [],
          notes: (hist.notes as string) ?? null,
          updatedAt: hist.updated_at as string,
        }
      : null,
  };
}
export async function getPatients(search?: string): Promise<EMRPatient[]> {
  const qs = search ? '?search=' + encodeURIComponent(search) : '';
  const raw = await req<Record<string, unknown>[]>('GET', '/api/patients' + qs);
  return raw.map(mapPatient);
}

export async function getPatient(id: string): Promise<EMRPatient> {
  const raw = await req<Record<string, unknown>>('GET', '/api/patients/' + id);
  return mapPatient(raw);
}

export async function createPatient(data: {
  firstName: string;
  lastName: string;
  mrn: string;
  dateOfBirth: string;
  sex?: string;
  phone?: string;
  email?: string;
  address?: string;
  insuranceId?: string;
}): Promise<EMRPatient> {
  const raw = await req<Record<string, unknown>>('POST', '/api/patients', {
    first_name: data.firstName,
    last_name: data.lastName,
    mrn: data.mrn,
    date_of_birth: data.dateOfBirth,
    sex: data.sex,
    phone: data.phone,
    email: data.email,
    address: data.address,
    insurance_id: data.insuranceId,
  });
  return mapPatient(raw);
}

export async function updatePatient(id: string, data: Partial<{
  firstName: string;
  lastName: string;
  mrn: string;
  dateOfBirth: string;
  sex: string;
  phone: string;
  email: string;
  address: string;
  insuranceId: string;
}>): Promise<EMRPatient> {
  const payload: Record<string, unknown> = {};
  if (data.firstName !== undefined) payload.first_name = data.firstName;
  if (data.lastName !== undefined) payload.last_name = data.lastName;
  if (data.mrn !== undefined) payload.mrn = data.mrn;
  if (data.dateOfBirth !== undefined) payload.date_of_birth = data.dateOfBirth;
  if (data.sex !== undefined) payload.sex = data.sex;
  if (data.phone !== undefined) payload.phone = data.phone;
  if (data.email !== undefined) payload.email = data.email;
  if (data.address !== undefined) payload.address = data.address;
  if (data.insuranceId !== undefined) payload.insurance_id = data.insuranceId;
  const raw = await req<Record<string, unknown>>('PATCH', '/api/patients/' + id, payload);
  return mapPatient(raw);
}

export async function getPatientVisits(
  patientId: string,
  params?: { status?: string },
): Promise<Visit[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const raw = await req<Record<string, unknown>[]>('GET', '/api/patients/' + patientId + '/visits' + suffix);
  return raw.map(mapVisit);
}

export async function updateMedicalHistory(patientId: string, data: {
  conditions?: string[]; allergies?: string[]; medications?: Record<string, unknown>[]; notes?: string;
}): Promise<MedicalHistoryRecord> {
  const raw = await req<Record<string, unknown>>('PUT', '/api/patients/' + patientId + '/history', data);
  return {    id: raw.id as string,
    patientId: raw.patient_id as string,
    conditions: (raw.conditions as string[]) ?? [],
    allergies: (raw.allergies as string[]) ?? [],
    medications: (raw.medications as Record<string, unknown>[]) ?? [],
    notes: (raw.notes as string) ?? null,
    updatedAt: raw.updated_at as string,
  };
}

// ── Rooms ─────────────────────────────────────────────────────────────────────

function mapRoom(r: Record<string, unknown>): Room {
  const room = {
    id: r.id as string,
    name: r.name as string,
    floor: (r.floor as string) ?? null,
    roomAgentPort: (r.room_agent_port as number) ?? null,
    status: r.status as Room['status'],
    currentPatientId: (r.current_patient_id as string) ?? null,
    assignedDoctorId: (r.assigned_doctor_id as string) ?? null,
    activeVisitId: (r.active_visit_id as string) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  } as Room & { devicePin?: string | null };

  room.devicePin = (r.device_pin ?? r.devicePin) as string | null;
  return room;
}
export async function getRooms(): Promise<Room[]> {
  const raw = await req<Record<string, unknown>[]>('GET', '/api/rooms');
  return raw.map(mapRoom);
}

export async function getRoomsWithStatus(): Promise<RoomStatus[]> {
  const raw = await req<Record<string, unknown>[]>('GET', '/api/rooms/status');
  return raw.map((r) => ({
    room: mapRoom(r.room as Record<string, unknown>),
    currentPatient: r.current_patient ? mapPatient(r.current_patient as Record<string, unknown>) : null,
    assignedDoctor: r.assigned_doctor ? mapDoctor(r.assigned_doctor as Record<string, unknown>) : null,
    activeVisitId: (r.active_visit_id as string) ?? null,
    chiefComplaint: (r.chief_complaint as string) ?? null,
    queueLength: (r.queue_length as number) ?? 0,
    nextPatient: r.next_patient ? mapPatient(r.next_patient as Record<string, unknown>) : null,
  }));
}

export async function createRoom(data: {
  name: string; floor?: string; roomAgentPort?: number; devicePin: string;
}): Promise<Room> {
  const raw = await req<Record<string, unknown>>('POST', '/api/rooms', {
    name: data.name, floor: data.floor,
    room_agent_port: data.roomAgentPort, device_pin: data.devicePin,
  });
  return mapRoom(raw);
}

export async function updateRoom(id: string, data: Partial<{
  name: string; floor: string; roomAgentPort: number; devicePin: string;
  status: Room['status']; currentPatientId: string | null; assignedDoctorId: string | null;
}>): Promise<Room> {
  const payload: Record<string, unknown> = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.floor !== undefined) payload.floor = data.floor;
  if (data.roomAgentPort !== undefined) payload.room_agent_port = data.roomAgentPort;
  if (data.devicePin !== undefined) payload.device_pin = data.devicePin;
  if (data.status !== undefined) payload.status = data.status;
  if (data.currentPatientId !== undefined) payload.current_patient_id = data.currentPatientId;
  if (data.assignedDoctorId !== undefined) payload.assigned_doctor_id = data.assignedDoctorId;
  const raw = await req<Record<string, unknown>>('PATCH', '/api/rooms/' + id, payload);
  return mapRoom(raw);
}

export async function deleteRoom(id: string): Promise<void> {
  await req('DELETE', '/api/rooms/' + id);
}

// ── Doctors ───────────────────────────────────────────────────────────────────

function mapDoctor(r: Record<string, unknown>): Doctor {
  return {
    id: r.id as string,
    name: r.name as string,
    specialty: (r.specialty as string) ?? null,
    email: (r.email as string) ?? null,
    licenseNumber: (r.license_number as string) ?? null,
    phone: (r.phone as string) ?? null,
    isActive: r.is_active as boolean,
    createdAt: r.created_at as string,
    currentStatus: (r.current_status as Doctor['currentStatus']) ?? 'available',
  };
}

export async function getDoctors(activeOnly = true): Promise<Doctor[]> {
  const raw = await req<Record<string, unknown>[]>('GET', '/api/doctors?active_only=' + activeOnly);
  return raw.map(mapDoctor);
}

export async function createDoctor(data: {
  name: string; specialty?: string; email?: string; licenseNumber?: string; phone?: string;
}): Promise<Doctor> {
  const raw = await req<Record<string, unknown>>('POST', '/api/doctors', {
    name: data.name, specialty: data.specialty, email: data.email,
    license_number: data.licenseNumber, phone: data.phone,
  });
  return mapDoctor(raw);
}

export async function updateDoctor(id: string, data: Partial<{
  name: string; specialty: string; email: string; licenseNumber: string; phone: string; isActive: boolean;
}>): Promise<Doctor> {
  const payload: Record<string, unknown> = {};
  if (data.name !== undefined) payload.name = data.name;
  if (data.specialty !== undefined) payload.specialty = data.specialty;
  if (data.email !== undefined) payload.email = data.email;
  if (data.licenseNumber !== undefined) payload.license_number = data.licenseNumber;
  if (data.phone !== undefined) payload.phone = data.phone;
  if (data.isActive !== undefined) payload.is_active = data.isActive;
  const raw = await req<Record<string, unknown>>('PATCH', '/api/doctors/' + id, payload);
  return mapDoctor(raw);
}

export async function deleteDoctor(id: string): Promise<void> {
  await req<void>('DELETE', '/api/doctors/' + id);
}

export async function setDoctorAvailability(doctorId: string, availabilityStatus: Doctor['currentStatus']): Promise<void> {
  await req('PATCH', '/api/doctors/' + doctorId + '/availability', { status: availabilityStatus });
}
// ── Visits ─────────────────────────────────────────────────────────────────────

function normalizePrescriptionDraft(raw: unknown): PrescriptionDraft | null {
  if (!raw || typeof raw !== 'object') return null;

  const value = raw as Record<string, unknown>;
  const diagnoses = Array.isArray(value.diagnoses) ? value.diagnoses.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const medications = Array.isArray(value.medications)
    ? value.medications
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
          name: String(item.name ?? '').trim(),
          dosage: String(item.dosage ?? '').trim() || undefined,
          frequency: String(item.frequency ?? '').trim() || undefined,
          duration: String(item.duration ?? '').trim() || undefined,
          route: String(item.route ?? '').trim() || undefined,
          instructions: String(item.instructions ?? '').trim() || undefined,
        }))
        .filter((item) => item.name.length > 0)
    : [];
  const investigations = Array.isArray(value.investigations)
    ? value.investigations
        .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        .map((item) => ({
          name: String(item.name ?? '').trim(),
          details: String(item.details ?? '').trim() || undefined,
          timing: String(item.timing ?? '').trim() || undefined,
        }))
        .filter((item) => item.name.length > 0)
    : [];
  const advice = Array.isArray(value.advice) ? value.advice.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const warnings = Array.isArray(value.warnings) ? value.warnings.map(String).map((item) => item.trim()).filter(Boolean) : [];
  const reportSummary = String(value.reportSummary ?? value.report_summary ?? '').trim();
  const followUpRaw = value.followUp ?? value.follow_up;
  const followUp = followUpRaw && typeof followUpRaw === 'object'
    ? {
        timeline: String((followUpRaw as Record<string, unknown>).timeline ?? '').trim() || undefined,
        notes: String((followUpRaw as Record<string, unknown>).notes ?? '').trim() || undefined,
      }
    : null;

  if (!diagnoses.length && !medications.length && !investigations.length && !advice.length && !warnings.length && !reportSummary && !followUp) {
    return null;
  }

  return {
    diagnoses,
    medications,
    investigations,
    advice,
    warnings,
    reportSummary,
    followUp,
  };
}

function mapVisit(r: Record<string, unknown>): Visit {
  const s = r.summary as Record<string, unknown> | null;
  const rawStructured = (s?.structuredFindings ?? s?.structured_findings) as unknown;

  const normalizedStructuredFindings = Array.isArray(rawStructured)
    ? (rawStructured as Record<string, unknown>[]).map((item, index) => {
        const obj = item as Record<string, unknown>;
        return {
          id: String(obj.id ?? `f-${index}`),
          label: String(obj.label ?? '').trim(),
          category: (String(obj.category ?? 'symptom') as KeyFactCategory),
          status: (String(obj.status ?? 'confirmed') as 'confirmed' | 'probable' | 'denied' | 'unclear'),
          confidence: Number(obj.confidence ?? 0.7),
          evidence: String(obj.evidence ?? '').trim() || undefined,
        };
      }).filter((item) => item.label.length > 0)
    : [];

  const rawQuality = (s?.quality ?? s?.summary_quality) as Record<string, unknown> | undefined;
  const normalizedQuality = rawQuality
    ? {
        score: Number(rawQuality.score ?? 0),
        confidence: Number(rawQuality.confidence ?? 0),
        missingFields: Array.isArray(rawQuality.missingFields)
          ? rawQuality.missingFields.map(String)
          : Array.isArray(rawQuality.missing_fields)
            ? (rawQuality.missing_fields as unknown[]).map(String)
            : [],
        mode: (rawQuality.mode as 'hybrid' | 'llm_only' | 'rule_only' | undefined) ?? undefined,
        generatedAt: (rawQuality.generatedAt as string | undefined) ?? (rawQuality.generated_at as string | undefined),
      }
    : undefined;

  const normalizedSummary: VisitSummary | null = s
    ? {
        clinicalSnapshot: (((s.clinicalSnapshot ?? s.clinical_snapshot) as { label: string; category: string }[]) ?? []).map((item) => ({
          label: item.label,
          category: (item.category as KeyFactCategory) ?? 'condition',
          isSupported: (item as { isSupported?: boolean }).isSupported,
          confidence: Number((item as { confidence?: number }).confidence ?? 0.8),
          evidence: (item as { evidence?: string }).evidence,
          status: (item as { status?: 'confirmed' | 'probable' | 'denied' | 'unclear' }).status,
        })),
        doctorActions: ((s.doctorActions ?? s.doctor_actions) as { id: string; text: string; sourceFactIds: string[]; isEdited: boolean }[]) ?? [],
        prescriptions: ((s.prescriptions ?? s.prescription_list) as { name: string; dosage?: string; frequency?: string; isSupported?: boolean }[]) ?? [],
        prescriptionDraft: normalizePrescriptionDraft(s.prescriptionDraft ?? s.prescription_draft),
        issuesParagraph: ((s.issuesParagraph ?? s.issues_paragraph ?? s.issuesIdentified ?? s.issues_identified) as string) ?? '',
        actionsParagraph: ((s.actionsParagraph ?? s.actions_paragraph ?? s.actionPlan ?? s.action_plan) as string) ?? '',
        chiefComplaint: String((s.chiefComplaint ?? s.chief_complaint) as string ?? '').trim(),
        structuredFindings: normalizedStructuredFindings,
        quality: normalizedQuality,
      }
    : null;

  const visit = {
    id: r.id as string,
    patientId: (r.patient_id ?? r.patientId) as string,
    roomId: (r.room_id ?? r.roomId ?? null) as string | null,
    doctorId: (r.doctor_id ?? r.doctorId ?? null) as string | null,
    summary: normalizedSummary,
    status: r.status as Visit['status'],
    createdAt: (r.created_at ?? r.createdAt) as string,
    endedAt: (r.ended_at ?? r.endedAt ?? r.completed_at ?? r.completedAt) as string | null,
    transcript: (r.transcript as string) ?? "",
    dialogue: (r.dialogue as Array<{speaker: string; text: string; start?: number; end?: number}>) ?? [],
  } as Visit & {
    appointmentId?: string | null;
    completedAt?: string | null;
    approvedBy?: string | null;
  };

  visit.appointmentId = (r.appointment_id ?? r.appointmentId) as string | null;
  visit.completedAt = (r.completed_at ?? r.completedAt ?? r.ended_at ?? r.endedAt) as string | null;
  visit.approvedBy = (r.approved_by ?? r.approvedBy) as string | null;

  return visit;
}
export async function createVisit(data: {
  patientId: string; doctorId?: string; roomId?: string;
  appointmentId?: string; chiefComplaint?: string;
}): Promise<Visit> {
  const raw = await req<Record<string, unknown>>('POST', '/api/visits', {
    patient_id: data.patientId, doctor_id: data.doctorId, room_id: data.roomId,
    appointment_id: data.appointmentId, chief_complaint: data.chiefComplaint,
  });
  return mapVisit(raw);
}

export async function approveVisit(visitId: string, summary: VisitSummary, doctorId?: string): Promise<void> {
  await req('PATCH', '/api/visits/' + visitId + '/approve', {
    summary: {
      clinicalSnapshot: summary.clinicalSnapshot,
      doctorActions: summary.doctorActions,
      prescriptions: summary.prescriptions ?? [],
      prescriptionDraft: summary.prescriptionDraft ?? null,
      issuesParagraph: summary.issuesParagraph,
      actionsParagraph: summary.actionsParagraph,
      chiefComplaint: summary.chiefComplaint ?? '',
      structuredFindings: summary.structuredFindings ?? [],
      quality: summary.quality ?? null,
    },
    doctor_id: doctorId ?? null,
  });
}

export async function validateVisitSummary(
  visitId: string,
  summary: VisitSummary,
): Promise<{
  ok: boolean;
  missingFields: Array<{ field: string; message: string; severity: string }>;
  warnings: string[];
  normalizedSummary: VisitSummary;
}> {
  return req('POST', '/api/visits/' + visitId + '/validate-summary', {
    summary: {
      clinicalSnapshot: summary.clinicalSnapshot,
      doctorActions: summary.doctorActions,
      prescriptions: summary.prescriptions ?? [],
      prescriptionDraft: summary.prescriptionDraft ?? null,
      issuesParagraph: summary.issuesParagraph,
      actionsParagraph: summary.actionsParagraph,
      chiefComplaint: summary.chiefComplaint ?? '',
      structuredFindings: summary.structuredFindings ?? [],
      quality: summary.quality ?? null,
    },
  });
}

export async function saveVisitProgress(
  visitId: string,
  data: { transcript?: string; dialogue?: Array<{speaker: string; text: string; start?: number; end?: number}>; status?: string }
): Promise<void> {
  await req('PATCH', '/api/visits/' + visitId + '/progress', {
    transcript: data.transcript,
    dialogue: data.dialogue,
    status: data.status,
  });
}
export async function updateVisitStatus(visitId: string, status: string): Promise<void> {
  await req('PATCH', '/api/visits/' + visitId + '/status', { status });
}

export async function updateVisitPrescription(visitId: string, prescriptionDraft: unknown): Promise<void> {
  await req('PATCH', '/api/visits/' + visitId + '/prescription-draft', {
    prescriptionDraft,
  });
}

export async function deleteVisit(visitId: string): Promise<void> {
  await req('DELETE', '/api/visits/' + visitId);
}

// ── Appointments ──────────────────────────────────────────────────────────────

function mapAppointment(r: Record<string, unknown>): Appointment {
  return {
    id: r.id as string,
    patientId: r.patient_id as string,
    doctorId: (r.doctor_id as string) ?? null,
    roomId: (r.room_id as string) ?? null,
    scheduledAt: r.scheduled_at as string,
    durationMinutes: r.duration_minutes as number,
    appointmentType: (r.appointment_type as string) ?? null,
    chiefComplaint: (r.chief_complaint as string) ?? null,
    notes: (r.notes as string) ?? null,
    status: r.status as Appointment['status'],
    checkedInAt: (r.checked_in_at as string) ?? null,
    startedAt: (r.started_at as string) ?? null,
    completedAt: (r.completed_at as string) ?? null,
    createdAt: r.created_at as string,
    visitId: (r.visit_id as string) ?? null,
  };
}

export async function getAppointments(params?: {
  date?: string; patientId?: string; doctorId?: string; status?: string;
}): Promise<Appointment[]> {
  const qs = new URLSearchParams();
  if (params?.date) qs.set('date', params.date);
  if (params?.patientId) qs.set('patient_id', params.patientId);
  if (params?.doctorId) qs.set('doctor_id', params.doctorId);
  if (params?.status) qs.set('status', params.status);
  const raw = await req<Record<string, unknown>[]>('GET', '/api/appointments?' + qs.toString());
  return raw.map(mapAppointment);
}

export async function createAppointment(data: {
  patientId: string; doctorId?: string; roomId?: string;
  scheduledAt: string; durationMinutes?: number;
  appointmentType?: string; chiefComplaint?: string; notes?: string;
}): Promise<Appointment> {
  const raw = await req<Record<string, unknown>>('POST', '/api/appointments', {
    patient_id: data.patientId, doctor_id: data.doctorId, room_id: data.roomId,
    scheduled_at: data.scheduledAt, duration_minutes: data.durationMinutes ?? 30,
    appointment_type: data.appointmentType, chief_complaint: data.chiefComplaint,
    notes: data.notes,
  });
  return mapAppointment(raw);
}

export async function updateAppointment(id: string, data: Partial<{
  doctorId: string; roomId: string; scheduledAt: string;
  durationMinutes: number; appointmentType: string;
  chiefComplaint: string; notes: string; status: Appointment['status'];
}>): Promise<Appointment> {
  const payload: Record<string, unknown> = {};
  if (data.doctorId !== undefined) payload.doctor_id = data.doctorId;
  if (data.roomId !== undefined) payload.room_id = data.roomId;
  if (data.scheduledAt !== undefined) payload.scheduled_at = data.scheduledAt;
  if (data.durationMinutes !== undefined) payload.duration_minutes = data.durationMinutes;
  if (data.appointmentType !== undefined) payload.appointment_type = data.appointmentType;
  if (data.chiefComplaint !== undefined) payload.chief_complaint = data.chiefComplaint;
  if (data.notes !== undefined) payload.notes = data.notes;
  if (data.status !== undefined) payload.status = data.status;
  const raw = await req<Record<string, unknown>>('PATCH', '/api/appointments/' + id, payload);
  return mapAppointment(raw);
}

export async function checkInAppointment(id: string): Promise<Appointment> {
  const raw = await req<Record<string, unknown>>('POST', '/api/appointments/' + id + '/check-in');
  return mapAppointment(raw);
}

export async function cancelAppointment(id: string): Promise<void> {
  await req('DELETE', '/api/appointments/' + id);
}

// ── Queue ─────────────────────────────────────────────────────────────────────

function mapQueueEntry(r: Record<string, unknown>): QueueEntry {
  const entry = {
    id: r.id as string,
    patientId: (r.patient_id ?? r.patientId) as string,
    appointmentId: (r.appointment_id ?? r.appointmentId) as string | null,
    roomId: (r.room_id ?? r.roomId) as string | null,
    doctorId: (r.doctor_id ?? r.doctorId) as string | null,
    priority: (r.priority as 1 | 2 | 3 | 4) ?? 3,
    status: r.status as QueueEntry['status'],
    checkInTime: (r.check_in_time ?? r.checkInTime) as string,
    calledAt: (r.called_at ?? r.calledAt) as string | null,
    inRoomAt: (r.in_room_at ?? r.inRoomAt) as string | null,
    doneAt: (r.done_at ?? r.doneAt) as string | null,
    createdAt: (r.created_at ?? r.createdAt) as string,
    notes: (r.notes as string) ?? null,
    position: (r.position as number) ?? null,
  } as QueueEntry & { waitingSince?: string | null };

  entry.waitingSince = (r.waiting_since ?? r.created_at ?? r.createdAt ?? r.check_in_time) as string | null;
  return entry;
}

export async function getQueue(): Promise<QueueSummary> {
  const raw = await req<{
    total_waiting: number; total_in_room: number;
    entries: Record<string, unknown>[];
  }>('GET', '/api/queue');
  return {
    totalWaiting: raw.total_waiting,
    totalInRoom: raw.total_in_room,
    entries: raw.entries.map(mapQueueEntry),
  };
}

export async function addToQueue(data: {
  patientId: string; appointmentId?: string; doctorId?: string;
  roomId?: string; priority?: number; notes?: string;
}): Promise<QueueEntry> {
  const raw = await req<Record<string, unknown>>('POST', '/api/queue', {
    patient_id: data.patientId, appointment_id: data.appointmentId,
    doctor_id: data.doctorId, room_id: data.roomId,
    priority: data.priority ?? 3, notes: data.notes,
  });
  return mapQueueEntry(raw);
}
export async function updateQueueEntry(id: string, data: Partial<{
  roomId: string; doctorId: string; priority: number;
  status: QueueEntry['status']; notes: string; position: number;
}>): Promise<QueueEntry> {
  const payload: Record<string, unknown> = {};
  if (data.roomId !== undefined) payload.room_id = data.roomId;
  if (data.doctorId !== undefined) payload.doctor_id = data.doctorId;
  if (data.priority !== undefined) payload.priority = data.priority;
  if (data.status !== undefined) payload.status = data.status;
  if (data.notes !== undefined) payload.notes = data.notes;
  if (data.position !== undefined) payload.position = data.position;
  const raw = await req<Record<string, unknown>>('PATCH', '/api/queue/' + id, payload);
  return mapQueueEntry(raw);
}

export async function removeFromQueue(id: string): Promise<void> {
  await req('DELETE', '/api/queue/' + id);
}

export async function autoAssign(data: AutoAssignRequest): Promise<QueueEntry> {
  const raw = await req<Record<string, unknown>>('POST', '/api/queue/auto-assign', {
    queue_entry_id: data.queueEntryId,
    preferred_doctor_id: data.preferredDoctorId,
    preferred_room_id: data.preferredRoomId,
  });
  return mapQueueEntry(raw);
}

// ── Visits (Admin list) ───────────────────────────────────────────────────────

export async function getVisits(params?: {
  status?: string; doctorId?: string; patientId?: string; limit?: number; offset?: number;
}): Promise<Visit[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.doctorId) qs.set('doctor_id', params.doctorId);
  if (params?.patientId) qs.set('patient_id', params.patientId);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const raw = await req<Record<string, unknown>[]>('GET', '/api/visits?' + qs.toString());
  return raw.map(mapVisit);
}

export async function getVisit(visitId: string): Promise<Visit> {
  const raw = await req<Record<string, unknown>>('GET', '/api/visits/' + visitId);
  return mapVisit(raw);
}

export async function downloadVisitPrescription(
  visitId: string,
  fallback?: {
    visit: Visit;
    patient?: EMRPatient | null;
    doctor?: Doctor | null;
    allergies?: string[];
  }
): Promise<void> {
  try {
    if (fallback) {
      const patientName = (fallback.patient?.name || `patient-${visitId.slice(0, 8)}`).toLowerCase().replace(/\s+/g, '-');
      await triggerPrescriptionDownload(`prescription-${patientName}-${visitId.slice(0, 8)}.pdf`, fallback);
      return;
    }

    const t = getStoredToken();
    const headers: Record<string, string> = {};
    if (t) headers.Authorization = 'Bearer ' + t;

    const res = await fetch(BASE + '/api/visits/' + visitId + '/prescription', {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      let message = 'Download failed';
      try {
        const data = await res.json();
        message = data?.detail || data?.message || message;
      } catch {
        // noop
      }
      console.error(`[API] Download prescription failed for visit ${visitId}: ${res.status} - ${message}`);
      throw new Error(message);
    }

    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || `prescription-${visitId}.pdf`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(`[API] Prescription download error for visit ${visitId}:`, err);
    throw err;
  }
}

// ── Audit Logs ────────────────────────────────────────────────────────────────

export interface AuditLog {
  id: string;
  timestamp: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  detail: Record<string, unknown> | null;
  success: boolean;
}

function mapAuditLog(r: Record<string, unknown>): AuditLog {
  return {
    id: r.id as string,
    timestamp: r.timestamp as string,
    actorId: (r.actor_id as string) ?? null,
    actorRole: (r.actor_role as string) ?? null,
    action: r.action as string,
    resourceType: (r.resource_type as string) ?? null,
    resourceId: (r.resource_id as string) ?? null,
    detail: (r.detail as Record<string, unknown>) ?? null,
    success: r.success as boolean,
  };
}

export async function getAuditLogs(params?: {
  action?: string; actorRole?: string; resourceType?: string; limit?: number; offset?: number;
}): Promise<AuditLog[]> {
  const qs = new URLSearchParams();
  if (params?.action) qs.set('action', params.action);
  if (params?.actorRole) qs.set('actor_role', params.actorRole);
  if (params?.resourceType) qs.set('resource_type', params.resourceType);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const raw = await req<Record<string, unknown>[]>('GET', '/api/audit-logs?' + qs.toString());
  return raw.map(mapAuditLog);
}

// ── Admin Users ───────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'super_admin';
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

function mapAdminUser(r: Record<string, unknown>): AdminUser {
  return {
    id: r.id as string,
    name: r.name as string,
    email: r.email as string,
    role: r.role as 'admin' | 'super_admin',
    isActive: r.is_active as boolean,
    createdAt: r.created_at as string,
    lastLoginAt: (r.last_login_at as string) ?? null,
  };
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  const raw = await req<Record<string, unknown>[]>('GET', '/api/admin/users');
  return raw.map(mapAdminUser);
}

export async function createAdminUser(data: {
  name: string; email: string; password: string; role: 'admin' | 'super_admin';
}): Promise<AdminUser> {
  const raw = await req<Record<string, unknown>>('POST', '/api/admin/users', data);
  return mapAdminUser(raw);
}

export async function updateAdminUser(id: string, data: {
  isActive?: boolean; role?: 'admin' | 'super_admin'; name?: string;
}): Promise<AdminUser> {
  const payload: Record<string, unknown> = {};
  if (data.isActive !== undefined) payload.is_active = data.isActive;
  if (data.role !== undefined) payload.role = data.role;
  if (data.name !== undefined) payload.name = data.name;
  const raw = await req<Record<string, unknown>>('PATCH', '/api/admin/users/' + id, payload);
  return mapAdminUser(raw);
}
