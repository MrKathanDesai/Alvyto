'use client';

import { useState, useEffect } from 'react';
import styles from './MedicalSnapshot.module.css';
import { MedicalHistory } from '@/types';

interface MedicalSnapshotProps {
    history: MedicalHistory;
    isRecording: boolean;
}

export default function MedicalSnapshot({ history, isRecording }: MedicalSnapshotProps) {
    const [isExpanded, setIsExpanded] = useState(false);

    // Auto-collapse when recording starts
    useEffect(() => {
        if (isRecording && isExpanded) {
            setIsExpanded(false);
        }
    }, [isRecording, isExpanded]);

    return (
        <div className={styles.snapshot}>
            <div
                className={styles.snapshotHeader}
                onClick={() => setIsExpanded(!isExpanded)}
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
                <button className={styles.expandBtn}>
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

            {isExpanded && (
                <div className={styles.snapshotContent}>
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
                                    <span className={styles.emptyState}>No conditions on record</span>
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
                                    <span className={styles.emptyState}>No known allergies</span>
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
                                            <span className={styles.medicationName}>{med.name}</span>
                                            <span className={styles.medicationDetails}>
                                                {med.dosage} • {med.frequency}
                                            </span>
                                        </div>
                                    ))
                                ) : (
                                    <span className={styles.emptyState}>No current medications</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
