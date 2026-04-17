'use client';

import { useState, useCallback } from 'react';
import type { PrescriptionDraft, PrescriptionInvestigation } from '@/types/index';
import MedicationEditor from './MedicationEditor/MedicationEditor';
import styles from './PrescriptionEditor.module.css';

interface PrescriptionEditorProps {
  draft: PrescriptionDraft | null;
  onSave: (updated: PrescriptionDraft) => void;
  onCancel: () => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function PrescriptionEditor({
  draft,
  onSave,
  onCancel,
  disabled = false,
  isLoading = false,
}: PrescriptionEditorProps) {
  const [editing, setEditing] = useState<PrescriptionDraft>(
    draft || {
      diagnoses: [],
      medications: [],
      investigations: [],
      advice: [],
      warnings: [],
      reportSummary: '',
      followUp: null,
    }
  );

  const [activeTab, setActiveTab] = useState<'medications' | 'diagnoses' | 'investigations' | 'advice' | 'warnings' | 'followup'>('medications');


  const handleAddDiagnosis = useCallback(() => {
    setEditing(prev => ({
      ...prev,
      diagnoses: [...prev.diagnoses, ''],
    }));
  }, []);

  const handleRemoveDiagnosis = useCallback((index: number) => {
    setEditing(prev => ({
      ...prev,
      diagnoses: prev.diagnoses.filter((_, i) => i !== index),
    }));
  }, []);

  const handleUpdateDiagnosis = useCallback((index: number, value: string) => {
    setEditing(prev => ({
      ...prev,
      diagnoses: prev.diagnoses.map((d, i) => (i === index ? value : d)),
    }));
  }, []);

  const handleAddInvestigation = useCallback(() => {
    setEditing(prev => ({
      ...prev,
      investigations: [
        ...prev.investigations,
        {
          name: '',
          details: '',
          timing: '',
        },
      ],
    }));
  }, []);

  const handleRemoveInvestigation = useCallback((index: number) => {
    setEditing(prev => ({
      ...prev,
      investigations: prev.investigations.filter((_, i) => i !== index),
    }));
  }, []);

  const handleUpdateInvestigation = useCallback((index: number, field: keyof PrescriptionInvestigation, value: string) => {
    setEditing(prev => ({
      ...prev,
      investigations: prev.investigations.map((inv, i) =>
        i === index ? { ...inv, [field]: value } : inv
      ),
    }));
  }, []);

  const handleAddAdvice = useCallback(() => {
    setEditing(prev => ({
      ...prev,
      advice: [...prev.advice, ''],
    }));
  }, []);

  const handleRemoveAdvice = useCallback((index: number) => {
    setEditing(prev => ({
      ...prev,
      advice: prev.advice.filter((_, i) => i !== index),
    }));
  }, []);

  const handleUpdateAdvice = useCallback((index: number, value: string) => {
    setEditing(prev => ({
      ...prev,
      advice: prev.advice.map((a, i) => (i === index ? value : a)),
    }));
  }, []);

  const handleAddWarning = useCallback(() => {
    setEditing(prev => ({
      ...prev,
      warnings: [...prev.warnings, ''],
    }));
  }, []);

  const handleRemoveWarning = useCallback((index: number) => {
    setEditing(prev => ({
      ...prev,
      warnings: prev.warnings.filter((_, i) => i !== index),
    }));
  }, []);

  const handleUpdateWarning = useCallback((index: number, value: string) => {
    setEditing(prev => ({
      ...prev,
      warnings: prev.warnings.map((w, i) => (i === index ? value : w)),
    }));
  }, []);

  const handleUpdateReportSummary = useCallback((value: string) => {
    setEditing(prev => ({
      ...prev,
      reportSummary: value,
    }));
  }, []);

  const handleUpdateFollowUp = useCallback((field: 'timeline' | 'notes', value: string) => {
    setEditing(prev => ({
      ...prev,
      followUp: {
        ...prev.followUp,
        [field]: value,
      } as typeof prev.followUp,
    }));
  }, []);

  const handleSave = useCallback(() => {
    onSave(editing);
  }, [editing, onSave]);

  if (!draft && !editing.medications.length) {
    return (
      <div className={styles.emptyState}>
        <p>No prescription draft available. The doctor will need to create one first.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.tabs}>
        {(['medications', 'diagnoses', 'investigations', 'advice', 'warnings', 'followup'] as const).map(tab => (
          <button
            key={tab}
            className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab)}
            disabled={disabled}
          >
            {tab === 'medications' && `Medications (${editing.medications.length})`}
            {tab === 'diagnoses' && `Diagnoses (${editing.diagnoses.length})`}
            {tab === 'investigations' && `Investigations (${editing.investigations.length})`}
            {tab === 'advice' && `Advice (${editing.advice.length})`}
            {tab === 'warnings' && `Warnings (${editing.warnings.length})`}
            {tab === 'followup' && 'Follow-up'}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {/* Medications Tab */}
        {activeTab === 'medications' && (
          <div className={styles.section}>
            <h3>Medications</h3>
            <MedicationEditor
              medications={editing.medications}
              onChange={(medications) => {
                setEditing((prev) => ({
                  ...prev,
                  medications,
                }));
              }}
              disabled={disabled}
            />
          </div>
        )}

        {/* Diagnoses Tab */}
        {activeTab === 'diagnoses' && (
          <div className={styles.section}>
            <h3>Diagnoses</h3>
            {editing.diagnoses.length === 0 ? (
              <p className={styles.placeholder}>No diagnoses added yet.</p>
            ) : (
              <div className={styles.itemList}>
                {editing.diagnoses.map((diagnosis, idx) => (
                  <div key={idx} className={styles.listItem}>
                    <input
                      type="text"
                      placeholder="Diagnosis"
                      value={diagnosis}
                      onChange={e => handleUpdateDiagnosis(idx, e.target.value)}
                      disabled={disabled}
                      className={styles.input}
                    />
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => handleRemoveDiagnosis(idx)}
                      disabled={disabled}
                      aria-label="Remove diagnosis"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className={styles.addBtn}
              onClick={handleAddDiagnosis}
              disabled={disabled}
            >
              + Add Diagnosis
            </button>
          </div>
        )}

        {/* Investigations Tab */}
        {activeTab === 'investigations' && (
          <div className={styles.section}>
            <h3>Investigations/Tests</h3>
            {editing.investigations.length === 0 ? (
              <p className={styles.placeholder}>No investigations added yet.</p>
            ) : (
              <div className={styles.itemList}>
                {editing.investigations.map((inv, idx) => (
                  <div key={idx} className={styles.investigationItem}>
                    <div className={styles.investigationGrid}>
                      <input
                        type="text"
                        placeholder="Test name"
                        value={inv.name}
                        onChange={e => handleUpdateInvestigation(idx, 'name', e.target.value)}
                        disabled={disabled}
                        className={styles.input}
                      />
                      <input
                        type="text"
                        placeholder="Details (optional)"
                        value={inv.details || ''}
                        onChange={e => handleUpdateInvestigation(idx, 'details', e.target.value)}
                        disabled={disabled}
                        className={styles.input}
                      />
                      <input
                        type="text"
                        placeholder="Timing (e.g., within 3 days)"
                        value={inv.timing || ''}
                        onChange={e => handleUpdateInvestigation(idx, 'timing', e.target.value)}
                        disabled={disabled}
                        className={styles.input}
                      />
                    </div>
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => handleRemoveInvestigation(idx)}
                      disabled={disabled}
                      aria-label="Remove investigation"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className={styles.addBtn}
              onClick={handleAddInvestigation}
              disabled={disabled}
            >
              + Add Investigation
            </button>
          </div>
        )}

        {/* Advice Tab */}
        {activeTab === 'advice' && (
          <div className={styles.section}>
            <h3>Doctor Advice</h3>
            {editing.advice.length === 0 ? (
              <p className={styles.placeholder}>No advice added yet.</p>
            ) : (
              <div className={styles.itemList}>
                {editing.advice.map((advice, idx) => (
                  <div key={idx} className={styles.listItem}>
                    <textarea
                      placeholder="Advice"
                      value={advice}
                      onChange={e => handleUpdateAdvice(idx, e.target.value)}
                      disabled={disabled}
                      className={styles.textarea}
                      rows={2}
                    />
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => handleRemoveAdvice(idx)}
                      disabled={disabled}
                      aria-label="Remove advice"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className={styles.addBtn}
              onClick={handleAddAdvice}
              disabled={disabled}
            >
              + Add Advice
            </button>
          </div>
        )}

        {/* Warnings Tab */}
        {activeTab === 'warnings' && (
          <div className={styles.section}>
            <h3>Warnings & Allergies</h3>
            {editing.warnings.length === 0 ? (
              <p className={styles.placeholder}>No warnings added yet.</p>
            ) : (
              <div className={styles.itemList}>
                {editing.warnings.map((warning, idx) => (
                  <div key={idx} className={styles.listItem}>
                    <textarea
                      placeholder="Warning"
                      value={warning}
                      onChange={e => handleUpdateWarning(idx, e.target.value)}
                      disabled={disabled}
                      className={styles.textarea}
                      rows={2}
                    />
                    <button
                      type="button"
                      className={styles.removeBtn}
                      onClick={() => handleRemoveWarning(idx)}
                      disabled={disabled}
                      aria-label="Remove warning"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className={styles.addBtn}
              onClick={handleAddWarning}
              disabled={disabled}
            >
              + Add Warning
            </button>
          </div>
        )}

        {/* Follow-up Tab */}
        {activeTab === 'followup' && (
          <div className={styles.section}>
            <h3>Follow-up</h3>
            <div className={styles.followupGrid}>
              <div>
                <label>Follow-up Timeline</label>
                <input
                  type="text"
                  placeholder="e.g., 7 days"
                  value={editing.followUp?.timeline || ''}
                  onChange={e => handleUpdateFollowUp('timeline', e.target.value)}
                  disabled={disabled}
                  className={styles.input}
                />
              </div>
              <div>
                <label>Follow-up Notes</label>
                <textarea
                  placeholder="Additional notes for follow-up"
                  value={editing.followUp?.notes || ''}
                  onChange={e => handleUpdateFollowUp('notes', e.target.value)}
                  disabled={disabled}
                  className={styles.textarea}
                  rows={3}
                />
              </div>
            </div>
            <div className={styles.section}>
              <h4>Clinical Report Summary</h4>
              <textarea
                placeholder="Enter clinical findings and report summary"
                value={editing.reportSummary}
                onChange={e => handleUpdateReportSummary(e.target.value)}
                disabled={disabled}
                className={styles.textarea}
                rows={4}
              />
            </div>
          </div>
        )}
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.cancelBtn}
          onClick={onCancel}
          disabled={disabled || isLoading}
        >
          Cancel
        </button>
        <button
          type="button"
          className={styles.saveBtn}
          onClick={handleSave}
          disabled={disabled || isLoading}
        >
          {isLoading ? 'Saving...' : 'Save Prescription'}
        </button>
      </div>
    </div>
  );
}
