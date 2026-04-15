// src/types/emr.ts — Production EMR types matching backend schemas

export type UserRole = 'super_admin' | 'admin' | 'room_device';

export interface AuthState {
  token: string | null;
  role: UserRole | null;
  adminId: string | null;
  roomId: string | null;
  name: string | null;
  expiresAt: string | null;
  isAuthenticated: boolean;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
  email: string | null;
  licenseNumber: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  currentStatus: 'available' | 'in_session' | 'break' | 'off_duty' | null;
}

export interface Room {
  id: string;
  name: string;
  floor: string | null;
  roomAgentPort: number | null;
  status: 'idle' | 'in_use' | 'cleaning' | 'offline';
  currentPatientId: string | null;
  assignedDoctorId: string | null;
  activeVisitId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoomStatus {
  room: Room;
  currentPatient: EMRPatient | null;
  assignedDoctor: Doctor | null;
  activeVisitId: string | null;
  chiefComplaint: string | null;
  queueLength: number;
  nextPatient: EMRPatient | null;
}

export interface EMRPatient {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
  name: string;
  dateOfBirth: string;
  sex: string | null;
  gender: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  insuranceId: string | null;
  createdAt: string;
  medicalHistory?: MedicalHistoryRecord | null;
}
export interface MedicalHistoryRecord {
  id: string;
  patientId: string;
  conditions: string[];
  allergies: string[];
  medications: Record<string, unknown>[];
  notes: string | null;
  updatedAt: string;
}

export type AppointmentStatus =
  | 'scheduled'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export interface Appointment {
  id: string;
  patientId: string;
  doctorId: string | null;
  roomId: string | null;
  scheduledAt: string;
  durationMinutes: number;
  appointmentType: string | null;
  chiefComplaint: string | null;
  notes: string | null;
  status: AppointmentStatus;
  checkedInAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  visitId: string | null;
}

export type QueueStatus = 'waiting' | 'called' | 'in_room' | 'done' | 'left';

export interface QueueEntry {
  id: string;
  patientId: string;
  patient_name?: string;
  appointmentId: string | null;
  roomId: string | null;
  doctorId: string | null;
  priority: 1 | 2 | 3 | 4;
  status: QueueStatus;
  checkInTime: string;
  calledAt: string | null;
  inRoomAt: string | null;
  doneAt: string | null;
  createdAt: string;
  notes: string | null;
  position: number | null;
}

export interface QueueSummary {
  totalWaiting: number;
  totalInRoom: number;
  entries: QueueEntry[];
}

export interface AutoAssignRequest {
  queueEntryId: string;
  preferredDoctorId?: string;
  preferredRoomId?: string;
}

export interface AutoAssignResponse {
  queueEntryId: string;
  assignedRoomId: string | null;
  assignedDoctorId: string | null;
  message: string;
}

export interface AuditLogEntry {
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

