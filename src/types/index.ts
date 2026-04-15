// Patient Types
export interface Patient {
  id: string;
  name: string;
  age: number;
  sex: 'Male' | 'Female' | 'Other';
  patientId: string;
  createdAt: string;
}

export interface MedicalHistory {
  id: string;
  patientId: string;
  conditions: string[];
  allergies: string[];
  medications: Medication[];
  updatedAt: string;
}

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
}

export interface DialogueTurn {
  speaker: 'Doctor' | 'Patient' | 'Unknown' | string;
  text: string;
  start: number;
  end: number;
}

// Visit Types
export type VisitStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'ready_to_summarize' | 'draft' | 'approved' | 'recording' | 'scheduled';

export interface SummaryItem {
  id: string;
  text: string;
  sourceFactIds: string[];
  isEdited: boolean;
  isSupported?: boolean;
}

export type KeyFactCategory =
  | 'symptom'
  | 'duration'
  | 'timing'
  | 'medication'
  | 'action'
  | 'lifestyle'
  | 'warning'
  | 'negative';

export interface KeyFact {
  label: string;
  category: KeyFactCategory;
  isSupported?: boolean;
  confidence?: number;
  evidence?: string;
  status?: 'confirmed' | 'probable' | 'denied' | 'unclear';
}

export interface StructuredFinding {
  id: string;
  label: string;
  category: KeyFactCategory;
  status: 'confirmed' | 'probable' | 'denied' | 'unclear';
  confidence: number;
  evidence?: string;
}

export interface SummaryQuality {
  score: number;
  confidence: number;
  missingFields: string[];
  mode?: 'hybrid' | 'llm_only' | 'rule_only';
  generatedAt?: string;
}

export interface Prescription {
  name: string;
  dosage?: string;
  frequency?: string;
  isSupported?: boolean;
}

export interface PrescriptionMedicationDetail {
  name: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  route?: string;
  instructions?: string;
}

export interface PrescriptionInvestigation {
  name: string;
  details?: string;
  timing?: string;
}

export interface PrescriptionFollowUp {
  timeline?: string;
  notes?: string;
}

export interface PrescriptionDraft {
  diagnoses: string[];
  medications: PrescriptionMedicationDetail[];
  investigations: PrescriptionInvestigation[];
  advice: string[];
  warnings: string[];
  reportSummary: string;
  followUp?: PrescriptionFollowUp | null;
}

export interface VisitSummary {
  clinicalSnapshot: KeyFact[];
  doctorActions: SummaryItem[];
  prescriptions: Prescription[];
  prescriptionDraft?: PrescriptionDraft | null;
  issuesParagraph: string;
  actionsParagraph: string;
  chiefComplaint?: string;
  structuredFindings?: StructuredFinding[];
  quality?: SummaryQuality;
}
export interface Visit {
  id: string;
  patientId: string;
  doctorId?: string | null;
  roomId?: string | null;
  summary: VisitSummary | null;
  status: VisitStatus;
  createdAt: string;
  endedAt?: string | null;
  transcript?: string;
  dialogue?: Array<{ speaker: string; text: string; start?: number; end?: number }>;
}

// In-session only — never sent to or stored in the backend
export interface ActiveVisitSession {
  visitId: string;
  patientId: string;
  transcript: string;
  dialogue: DialogueTurn[];
  summary: VisitSummary;
  status: VisitStatus;
  createdAt: string;
}

// Atomic Fact Types (Medical AI Safety)
export type FactCategory =
  | 'patient_fact'
  | 'observation'
  | 'action'
  | 'advice'
  | 'follow_up';

export interface AtomicFact {
  id: string;
  category: FactCategory;
  key: string;
  value: string;
  sourceText: string;
  sourcePosition: number;
  confidence: number;
  isValid: boolean;
}

// Recording State
export interface RecordingState {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  audioLevel: number;
}

// UI State
export interface AppState {
  selectedPatientId: string | null;
  isHistoryExpanded: boolean;
  isLastVisitExpanded: boolean;
  recordingState: RecordingState;
  currentVisit: ActiveVisitSession | null;
}
