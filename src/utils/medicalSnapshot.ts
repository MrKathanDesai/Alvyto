import type { MedicalHistoryRecord } from '@/types/emr';
import type { Prescription, VisitSummary } from '@/types';

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

function mapPrescriptionsToMedications(prescriptions: Prescription[]): MedicationRecord[] {
  return normalizeMedicationList(
    prescriptions.map((item) => ({
      name: item.name,
      dosage: item.dosage ?? '',
      frequency: item.frequency ?? '',
    }))
  );
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

function extractPrescriptionsFromTranscript(transcript: string): MedicationRecord[] {
  const pattern =
    /\b(?:prescribed|start|starting|begin|take|taking|continue|continuing)\s+([a-z][a-z0-9-]*(?:\s+[a-z0-9-]+){0,2})(?:\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)))?(?:\s+(once daily|twice daily|three times daily|daily|bid|tid|qid|as needed|prn))?/gi;

  const matches: MedicationRecord[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(transcript)) !== null) {
    const name = normalizeText(match[1]);
    if (!name || name.length < 3) continue;

    matches.push({
      name,
      dosage: normalizeText(match[2]),
      frequency: normalizeText(match[3]),
    });
  }

  return normalizeMedicationList(matches);
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
  const liveConditions = dedupeStrings(
    (summary?.clinicalSnapshot ?? [])
      .filter((item) => item.category === 'symptom')
      .map((item) => item.label)
  );
  const liveAllergies = extractAllergiesFromTranscript(safeTranscript);

  const summaryMeds = mapPrescriptionsToMedications(summary?.prescriptions ?? []);
  const transcriptMeds = extractPrescriptionsFromTranscript(safeTranscript);
  const replacementMeds = summaryMeds.length > 0 ? summaryMeds : transcriptMeds;

  const nextConditions = dedupeStrings([...baseHistory.conditions, ...liveConditions]);
  const nextAllergies = dedupeStrings([...baseHistory.allergies, ...liveAllergies]);
  const nextMedications = replacementMeds.length > 0 ? replacementMeds : normalizeMedicationList(baseHistory.medications);

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
