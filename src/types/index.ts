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
export type VisitStatus = 'recording' | 'ready_to_summarize' | 'draft' | 'approved';

export interface Visit {
  id: string;
  patientId: string;
  transcript: string;
  atomicFacts: AtomicFact[];
  summary: VisitSummary;
  dialogue?: DialogueTurn[];
  status: VisitStatus;
  approvedAt?: string;
  createdAt: string;
}

// Atomic Fact Types (Medical AI Safety)
export type FactCategory =
  | 'patient_fact'      // symptoms, duration, history
  | 'observation'       // exam findings if spoken
  | 'action'            // meds, tests, referrals
  | 'advice'            // lifestyle, precautions
  | 'follow_up';        // timelines, next visit

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

export interface VisitSummary {
  issuesIdentified: SummaryItem[];
  actionsPlan: SummaryItem[];
  keyFacts?: KeyFact[];
}

export interface SummaryItem {
  id: string;
  text: string;
  sourceFactIds: string[];
  isEdited: boolean;
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
  currentVisit: Visit | null;
}
