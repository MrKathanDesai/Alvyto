'use client';

import { useCallback } from 'react';
import type { PrescriptionDraft } from '@/types/index';
import { PrescriptionEditor } from './PrescriptionEditor';
import styles from './PrescriptionModal.module.css';

interface PrescriptionModalProps {
  isOpen: boolean;
  draft: PrescriptionDraft | null;
  patientName: string;
  onSave: (updated: PrescriptionDraft) => Promise<void>;
  onClose: () => void;
  isLoading?: boolean;
}

export function PrescriptionModal({
  isOpen,
  draft,
  patientName,
  onSave,
  onClose,
  isLoading = false,
}: PrescriptionModalProps) {
  const handleSave = useCallback(
    async (updated: PrescriptionDraft) => {
      await onSave(updated);
      onClose();
    },
    [onSave, onClose]
  );

  if (!isOpen) return null;

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.modal}>
        <div className={styles.header}>
          <h2>Edit Prescription</h2>
          <p className={styles.subtitle}>Patient: {patientName}</p>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close modal"
            disabled={isLoading}
          >
            ✕
          </button>
        </div>

        <div className={styles.body}>
          <PrescriptionEditor
            draft={draft}
            onSave={handleSave}
            onCancel={onClose}
            disabled={isLoading}
            isLoading={isLoading}
          />
        </div>
      </div>
    </>
  );
}
