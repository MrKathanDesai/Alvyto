'use client';

import { useState } from 'react';
import styles from './MedicalSnapshot.module.css';
import { MedicalHistoryRecord } from '@/types/emr';

interface MedicalSnapshotProps {
    history: MedicalHistoryRecord;
    isRecording: boolean;
    editable?: boolean;
    saving?: boolean;
    isLive?: boolean;
    liveLabel?: string;
    onSave?: (data: {
        conditions: string[];
        allergies: string[];
        medications: Record<string, unknown>[];
        notes?: string;
    }) => Promise<void> | void;
}

function normalizeList(value: string): string[] {
    return value
        .split('\n')
        .flatMap((line) => line.split(','))
        .map((item) => item.trim())
        .filter(Boolean);
}

function formatMedication(med: Record<string, unknown>): string {
    const name = String(med.name ?? '').trim();
    const dosage = String(med.dosage ?? '').trim();
    const frequency = String(med.frequency ?? '').trim();

    if (!name && !dosage && !frequency) return '';
    if (!dosage && !frequency) return name;
    return `${name} | ${dosage} | ${frequency}`.trim();
}

function parseMedications(value: string): Record<string, unknown>[] {
    return value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const [name = '', dosage = '', frequency = ''] = line.split('|').map((part) => part.trim());
            return {
                name,
                dosage,
                frequency,
            };
        })
        .filter((med) => String(med.name ?? '').trim().length > 0);
}

export default function MedicalSnapshot({
    history,
    isRecording,
    editable = false,
    saving = false,
    isLive = false,
    liveLabel = 'Live updates from current visit',
    onSave,
}: MedicalSnapshotProps) {
    const [isExpanded, setIsExpanded] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [conditionsText, setConditionsText] = useState('');
    const [allergiesText, setAllergiesText] = useState('');
    const [medicationsText, setMedicationsText] = useState('');
    const [notesText, setNotesText] = useState('');

    const syncEditorStateFromHistory = () => {
        setConditionsText(history.conditions.join('\n'));
        setAllergiesText(history.allergies.join('\n'));
        setMedicationsText(history.medications.map((med) => formatMedication(med)).filter(Boolean).join('\n'));
        setNotesText(history.notes ?? '');
    };

    const handleCancelEdit = () => {
        syncEditorStateFromHistory();
        setIsEditing(false);
    };

    const handleSave = async () => {
        if (!onSave) return;

        await onSave({
            conditions: normalizeList(conditionsText),
            allergies: normalizeList(allergiesText),
            medications: parseMedications(medicationsText),
            notes: notesText.trim() || undefined,
        });
        setIsEditing(false);
    };

    return (
        <div className={styles.snapshot}>
            <div
                className={styles.snapshotHeader}
                onClick={() => setIsExpanded((open) => !open)}
            >
                <h2 className={styles.snapshotTitle}>
                    <svg
                        className={styles.snapshotIcon}
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    Medical Snapshot
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {editable && !isEditing && (
                        <button
                            type="button"
                            className={styles.editBtn}
                            onClick={(e) => {
                                e.stopPropagation();
                                syncEditorStateFromHistory();
                                setIsEditing(true);
                                setIsExpanded(true);
                            }}
                        >
                            Edit
                        </button>
                    )}
                    <button type="button" className={styles.expandBtn}>
                        {isExpanded ? 'Collapse' : 'Expand'}
                        <svg
                            className={`${styles.chevronIcon} ${isExpanded ? styles.rotated : ''}`}
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                        >
                            <path d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                </div>
            </div>

            {isExpanded && !isRecording && (
                <div className={styles.snapshotContent}>
                    {editable && (isEditing || isLive) && (
                        <div className={styles.editorHeader}>
                            {isLive && !isEditing ? (
                                <span className={styles.liveBadge}>{liveLabel}</span>
                            ) : null}
                            {isEditing ? (
                                <div className={styles.editorActions}>
                                    <button type="button" className={styles.cancelBtn} onClick={handleCancelEdit} disabled={saving}>
                                        Cancel
                                    </button>
                                    <button type="button" className={styles.saveBtn} onClick={() => void handleSave()} disabled={saving}>
                                        {saving ? 'Saving…' : 'Save Changes'}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    )}

                    {isEditing ? (
                        <div className={styles.editorGrid}>
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Medical Conditions</h3>
                                <textarea
                                    className={styles.textarea}
                                    rows={5}
                                    value={conditionsText}
                                    onChange={(e) => setConditionsText(e.target.value)}
                                    placeholder="One condition per line"
                                />
                            </div>

                            <div className={styles.section}>
                                <h3 className={`${styles.sectionTitle} ${styles.danger}`}>
                                    ⚠️ Allergies
                                </h3>
                                <textarea
                                    className={styles.textarea}
                                    rows={5}
                                    value={allergiesText}
                                    onChange={(e) => setAllergiesText(e.target.value)}
                                    placeholder="One allergy per line"
                                />
                            </div>

                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Current Medications</h3>
                                <textarea
                                    className={styles.textarea}
                                    rows={5}
                                    value={medicationsText}
                                    onChange={(e) => setMedicationsText(e.target.value)}
                                    placeholder="Format: Name | Dosage | Frequency"
                                />
                            </div>

                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Notes</h3>
                                <textarea
                                    className={styles.textarea}
                                    rows={4}
                                    value={notesText}
                                    onChange={(e) => setNotesText(e.target.value)}
                                    placeholder="Additional clinical notes"
                                />
                            </div>
                        </div>
                    ) : (
                        <div className={styles.snapshotGrid}>
                            {/* Conditions */}
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Medical Conditions</h3>
                                <div className={styles.chips}>
                                    {history.conditions.length > 0 ? (
                                        history.conditions.map((condition, idx) => (
                                            <span key={idx} className={`${styles.chip} ${styles.chipCondition}`}>
                                                {condition}
                                            </span>
                                        ))
                                    ) : (
                                        <span className={styles.emptyState}>No medical conditions documented</span>
                                    )}
                                </div>
                            </div>

                            {/* Allergies */}
                            <div className={styles.section}>
                                <h3 className={`${styles.sectionTitle} ${styles.danger}`}>
                                    ⚠️ Allergies
                                </h3>
                                <div className={styles.chips}>
                                    {history.allergies.length > 0 ? (
                                        history.allergies.map((allergy, idx) => (
                                            <span key={idx} className={`${styles.chip} ${styles.chipAllergy}`}>
                                                <svg
                                                    className={styles.allergyIcon}
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="2"
                                                >
                                                    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                </svg>
                                                {allergy}
                                            </span>
                                        ))
                                    ) : (
                                        <span className={styles.emptyState}>No allergies reported</span>
                                    )}
                                </div>
                            </div>

                            {/* Medications */}
                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Current Medications</h3>
                                <div className={styles.medicationList}>
                                    {history.medications.length > 0 ? (
                                        history.medications.map((med, idx) => (
                                            <div key={idx} className={styles.medicationItem}>
                                                <span className={styles.medicationName}>{String(med.name ?? 'Medication')}</span>
                                                <span className={styles.medicationDetails}>
                                                    {String(med.dosage ?? 'N/A')} • {String(med.frequency ?? 'N/A')}
                                                </span>
                                            </div>
                                        ))
                                    ) : (
                                        <span className={styles.emptyState}>No medications documented</span>
                                    )}
                                </div>
                            </div>

                            <div className={styles.section}>
                                <h3 className={styles.sectionTitle}>Notes</h3>
                                <div className={styles.notesText}>{history.notes || 'No notes documented'}</div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
