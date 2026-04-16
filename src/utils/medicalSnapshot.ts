import type { MedicalHistoryRecord } from '@/types/emr';
import type { VisitSummary } from '@/types';

type MedicationRecord = Record<string, unknown>;

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;

    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function looksLikeClinicalCondition(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(symptom|issue|location of pain|associated symptom with food\/drink|lifestyle factor related to symptoms|symptom relief attempts)$/i.test(normalized)) {
    return false;
  }
  return true;
}

function normalizeMedicationList(items: MedicationRecord[]): MedicationRecord[] {
  const seen = new Set<string>();
  const result: MedicationRecord[] = [];

  for (const item of items) {
    const name = normalizeText(item.name);
    const dosage = normalizeText(item.dosage);
    const frequency = normalizeText(item.frequency);
    if (!name) continue;

    const key = [name.toLowerCase(), dosage.toLowerCase(), frequency.toLowerCase()].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name, dosage, frequency });
  }

  return result;
}

function extractAllergiesFromTranscript(transcript: string): string[] {
  const patterns = [
    /\ballergic to ([a-z0-9\s-]+?)(?:[,.]| and\b| but\b|$)/gi,
    /\ballergy to ([a-z0-9\s-]+?)(?:[,.]| and\b| but\b|$)/gi,
  ];

  const matches: string[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(transcript)) !== null) {
      const candidate = match[1]?.trim();
      if (candidate) matches.push(candidate);
    }
  }

  return dedupeStrings(matches);
}

export function createEmptyMedicalHistory(patientId: string): MedicalHistoryRecord {
  return {
    id: `draft-${patientId}`,
    patientId,
    conditions: [],
    allergies: [],
    medications: [],
    notes: null,
    updatedAt: new Date().toISOString(),
  };
}

export function deriveMedicalSnapshot(
  baseHistory: MedicalHistoryRecord,
  summary?: VisitSummary | null,
  transcript?: string | null,
): { history: MedicalHistoryRecord; hasLiveUpdates: boolean } {
  const safeTranscript = normalizeText(transcript);
  // Clinical snapshot chip labels are AI observation tags ("location of pain",
  // "symptom relief attempts"), NOT medical diagnoses. Never inject them into
  // Medical Conditions — only the backend approve flow merges confirmed diagnoses.
  const liveAllergies = extractAllergiesFromTranscript(safeTranscript);

  // Conditions come only from the stored patient record — never from live AI chips.
  const nextConditions = dedupeStrings([...baseHistory.conditions]).filter(looksLikeClinicalCondition);
  const nextAllergies = dedupeStrings([...baseHistory.allergies, ...liveAllergies]);
  // Longitudinal medications should only come from the persisted chart, never
  // directly from live transcript/summary heuristics for the current visit.
  const nextMedications = normalizeMedicationList(baseHistory.medications);

  const nextNotes = dedupeStrings([
    normalizeText(baseHistory.notes),
    normalizeText(summary?.issuesParagraph),
    normalizeText(summary?.actionsParagraph),
  ]).join('\n\n') || null;

  const hasLiveUpdates =
    nextConditions.join('|') !== baseHistory.conditions.join('|') ||
    nextAllergies.join('|') !== baseHistory.allergies.join('|') ||
    JSON.stringify(nextMedications) !== JSON.stringify(normalizeMedicationList(baseHistory.medications)) ||
    normalizeText(nextNotes) !== normalizeText(baseHistory.notes);

  return {
    history: {
      ...baseHistory,
      conditions: nextConditions,
      allergies: nextAllergies,
      medications: nextMedications,
      notes: nextNotes,
      updatedAt: hasLiveUpdates ? new Date().toISOString() : baseHistory.updatedAt,
    },
    hasLiveUpdates,
  };
}
