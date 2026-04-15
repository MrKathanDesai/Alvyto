'use client';

import styles from './PrescriptionPreview.module.css';
import { PrescriptionDraft } from '@/types';
import { EMRPatient } from '@/types/emr';

interface PrescriptionPreviewProps {
  patient: EMRPatient;
  doctorName?: string | null;
  visitDate?: string | null;
  draft: PrescriptionDraft;
  allergies?: string[];
}

function formatDate(value?: string | null): string {
  if (!value) return 'Today';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Today';
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function patientAge(dateOfBirth?: string | null): string | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const birthdayPassed =
    now.getMonth() > dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!birthdayPassed) age -= 1;
  return age >= 0 ? `${age}y` : null;
}

function compactParts(parts: Array<string | undefined | null>): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join(' • ');
}

export default function PrescriptionPreview({
  patient,
  doctorName,
  visitDate,
  draft,
  allergies = [],
}: PrescriptionPreviewProps) {
  const age = patientAge(patient.dateOfBirth);
  const headerMeta = compactParts([
    patient.mrn ? `MRN ${patient.mrn}` : null,
    age,
    patient.sex ?? patient.gender ?? null,
  ]);

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Generated Prescription Draft</p>
          <h3 className={styles.title}>Conversation to prescription preview</h3>
        </div>
        <div className={styles.dateBadge}>{formatDate(visitDate)}</div>
      </div>

      <div className={styles.metaGrid}>
        <div className={styles.metaBlock}>
          <span className={styles.metaLabel}>Patient</span>
          <strong className={styles.metaValue}>{patient.name}</strong>
          {headerMeta && <span className={styles.metaHint}>{headerMeta}</span>}
        </div>
        <div className={styles.metaBlock}>
          <span className={styles.metaLabel}>Prescriber</span>
          <strong className={styles.metaValue}>{doctorName || 'Assigned doctor'}</strong>
          {patient.phone && <span className={styles.metaHint}>{patient.phone}</span>}
        </div>
        <div className={styles.metaBlock}>
          <span className={styles.metaLabel}>Allergies</span>
          <strong className={styles.metaValue}>
            {allergies.length > 0 ? allergies.join(', ') : 'No allergies on file'}
          </strong>
        </div>
      </div>

      {draft.diagnoses.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Assessment</h4>
          <div className={styles.chips}>
            {draft.diagnoses.map((item) => (
              <span key={item} className={styles.chip}>{item}</span>
            ))}
          </div>
        </div>
      )}

      {draft.medications.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Medications</h4>
          <div className={styles.stack}>
            {draft.medications.map((medication, index) => (
              <article key={`${medication.name}-${index}`} className={styles.medicationCard}>
                <div className={styles.medicationHeader}>
                  <strong>{medication.name}</strong>
                  <span>{compactParts([medication.dosage, medication.route]) || 'Dose not specified'}</span>
                </div>
                <p className={styles.medicationMeta}>
                  {compactParts([medication.frequency, medication.duration, medication.instructions]) || 'No administration details captured.'}
                </p>
              </article>
            ))}
          </div>
        </div>
      )}

      {(draft.investigations.length > 0 || draft.reportSummary) && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Reports and investigations</h4>
          {draft.reportSummary && <p className={styles.paragraph}>{draft.reportSummary}</p>}
          {draft.investigations.length > 0 && (
            <ul className={styles.list}>
              {draft.investigations.map((item, index) => (
                <li key={`${item.name}-${index}`}>
                  <strong>{item.name}</strong>
                  {compactParts([item.details, item.timing]) ? ` — ${compactParts([item.details, item.timing])}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {draft.advice.length > 0 && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Advice</h4>
          <ul className={styles.list}>
            {draft.advice.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
          </ul>
        </div>
      )}

      {(draft.warnings.length > 0 || draft.followUp) && (
        <div className={styles.section}>
          <h4 className={styles.sectionTitle}>Safety and follow-up</h4>
          {draft.warnings.length > 0 && (
            <ul className={styles.list}>
              {draft.warnings.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
            </ul>
          )}
          {draft.followUp && (
            <p className={styles.paragraph}>
              <strong>Follow-up:</strong> {compactParts([draft.followUp.timeline, draft.followUp.notes])}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
