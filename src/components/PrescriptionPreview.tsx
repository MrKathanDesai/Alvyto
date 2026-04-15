'use client';

import type { PrescriptionDraft } from '@/types/index';
import styles from './PrescriptionPreview.module.css';

interface PrescriptionPreviewProps {
  draft: PrescriptionDraft | null;
  patientName: string;
  doctorName?: string;
  allergies?: string[];
}

export function PrescriptionPreview({
  draft,
  patientName,
  doctorName,
  allergies,
}: PrescriptionPreviewProps) {
  if (!draft) {
    return (
      <div className={styles.emptyState}>
        <p>No prescription data available.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <h2>Prescription</h2>
        <div className={styles.headerInfo}>
          <div className={styles.infoItem}>
            <span className={styles.label}>Patient:</span>
            <span className={styles.value}>{patientName}</span>
          </div>
          {doctorName && (
            <div className={styles.infoItem}>
              <span className={styles.label}>Doctor:</span>
              <span className={styles.value}>{doctorName}</span>
            </div>
          )}
          <div className={styles.infoItem}>
            <span className={styles.label}>Date:</span>
            <span className={styles.value}>{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
          </div>
        </div>
      </div>

      {/* Allergies Warning */}
      {allergies && allergies.length > 0 && (
        <div className={styles.alertBox}>
          <div className={styles.alertTitle}>⚠️ Known Allergies</div>
          <ul className={styles.alertList}>
            {allergies.map((allergy, idx) => (
              <li key={idx}>{allergy}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Diagnoses */}
      {draft.diagnoses && draft.diagnoses.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Diagnoses / Assessment</h3>
          <ul className={styles.list}>
            {draft.diagnoses.map((diagnosis, idx) => (
              <li key={idx}>{diagnosis}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Medications */}
      {draft.medications && draft.medications.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>💊 Medications</h3>
          <table className={styles.medicationsTable}>
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Dosage</th>
                <th>Frequency</th>
                <th>Duration</th>
                <th>Route</th>
                <th>Instructions</th>
              </tr>
            </thead>
            <tbody>
              {draft.medications.map((med, idx) => (
                <tr key={idx}>
                  <td className={styles.medicineName}>{med.name}</td>
                  <td>{med.dosage || '—'}</td>
                  <td>{med.frequency || '—'}</td>
                  <td>{med.duration || '—'}</td>
                  <td>{med.route || '—'}</td>
                  <td className={styles.instructions}>{med.instructions || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Investigations */}
      {draft.investigations && draft.investigations.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>🧪 Investigations / Tests</h3>
          <div className={styles.investigationsList}>
            {draft.investigations.map((investigation, idx) => (
              <div key={idx} className={styles.investigationItem}>
                <div className={styles.investigationName}>{investigation.name}</div>
                {investigation.details && (
                  <div className={styles.investigationDetail}>
                    <strong>Details:</strong> {investigation.details}
                  </div>
                )}
                {investigation.timing && (
                  <div className={styles.investigationDetail}>
                    <strong>Timing:</strong> {investigation.timing}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Advice */}
      {draft.advice && draft.advice.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>📋 Doctor Advice</h3>
          <ul className={styles.adviceList}>
            {draft.advice.map((adviceItem, idx) => (
              <li key={idx} className={styles.adviceItem}>{adviceItem}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {draft.warnings && draft.warnings.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>⚠️ Warnings & Precautions</h3>
          <ul className={styles.warningsList}>
            {draft.warnings.map((warning, idx) => (
              <li key={idx} className={styles.warningItem}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Report Summary */}
      {draft.reportSummary && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Clinical Report Summary</h3>
          <div className={styles.reportSummary}>
            {draft.reportSummary}
          </div>
        </div>
      )}

      {/* Follow-up */}
      {draft.followUp && (draft.followUp.timeline || draft.followUp.notes) && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>📅 Follow-up</h3>
          {draft.followUp.timeline && (
            <div className={styles.followUpItem}>
              <strong>Timeline:</strong> {draft.followUp.timeline}
            </div>
          )}
          {draft.followUp.notes && (
            <div className={styles.followUpItem}>
              <strong>Notes:</strong> {draft.followUp.notes}
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {(!draft.diagnoses || draft.diagnoses.length === 0) &&
        (!draft.medications || draft.medications.length === 0) &&
        (!draft.investigations || draft.investigations.length === 0) &&
        (!draft.advice || draft.advice.length === 0) &&
        (!draft.warnings || draft.warnings.length === 0) &&
        !draft.reportSummary && (
          <div className={styles.emptyState}>
            <p>No prescription details available yet.</p>
          </div>
        )}
    </div>
  );
}
