'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/services/api';
import { Patient, MedicalHistory, Visit } from '@/types';
import MedicalSnapshot from '@/components/MedicalSnapshot';
import PatientFormModal from '@/components/PatientFormModal';
import styles from './page.module.css';
import Link from 'next/link';

export default function PatientDetailPage() {
    const params = useParams();
    const router = useRouter();
    const id = params.id as string;

    const [patient, setPatient] = useState<Patient | null>(null);
    const [history, setHistory] = useState<MedicalHistory | null>(null);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [loading, setLoading] = useState(true);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);

    useEffect(() => {
        async function loadData() {
            try {
                const [p, h, v] = await Promise.all([
                    api.getPatient(id),
                    api.getMedicalHistory(id),
                    api.getPatientVisits(id)
                ]);
                setPatient(p);
                setHistory(h || null); // Handle undefined
                setVisits(v);
            } catch (error) {
                console.error("Failed to load patient detail", error);
            } finally {
                setLoading(false);
            }
        }
        if (id) {
            loadData();
        }
    }, [id]);

    const handleEditPatient = async (updates: any) => {
        if (!patient) return;
        try {
            const updatedPatient = await api.updatePatient(patient.id, updates);
            setPatient(updatedPatient);
            setIsEditModalOpen(false);
        } catch (error) {
            console.error("Failed to update patient", error);
            alert("Failed to update patient. Please try again.");
        }
    };

    if (loading) {
        return <div className={styles.loading}>Loading Patient Record...</div>;
    }

    if (!patient) {
        return <div className={styles.error}>Patient not found</div>;
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.headerTop}>
                    <Link href="/admin/patients" className={styles.backLink}>
                        ← Back to Patients
                    </Link>
                    <div className={styles.actions}>
                        <button className={styles.editButton} onClick={() => setIsEditModalOpen(true)}>Edit Details</button>
                    </div>
                </div>
                <div className={styles.profileHeader}>
                    <div className={styles.avatarLarge}>{patient.name.charAt(0)}</div>
                    <div className={styles.profileInfo}>
                        <h1 className={styles.name}>{patient.name}</h1>
                        <div className={styles.meta}>
                            <span>MRN: {patient.patientId}</span>
                            <span>•</span>
                            <span>{patient.age} yrs</span>
                            <span>•</span>
                            <span>{patient.sex}</span>
                        </div>
                    </div>
                </div>
            </header>

            <div className={styles.contentGrid}>
                {/* Left Column: Clinical Snapshot */}
                <div className={styles.clinicalColumn}>
                    <section className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <h2>Clinical Snapshot</h2>
                            <button className={styles.iconButton}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                            </button>
                        </div>
                        {history ? (
                            <MedicalSnapshot history={history} isRecording={false} />
                        ) : (
                            <div className={styles.emptyState}>No medical history recorded.</div>
                        )}
                    </section>
                </div>

                {/* Right Column: Visit History */}
                <div className={styles.historyColumn}>
                    <section className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <h2>Visit History</h2>
                            <button className={styles.addButtonSmall}>+ New Visit</button>
                        </div>

                        <div className={styles.visitsList}>
                            {visits.length === 0 ? (
                                <div className={styles.emptyState}>No past visits found.</div>
                            ) : (
                                visits.map(visit => (
                                    <div key={visit.id} className={styles.visitCard}>
                                        <div className={styles.visitHeader}>
                                            <span className={styles.visitDate}>
                                                {new Date(visit.createdAt).toLocaleDateString(undefined, {
                                                    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
                                                })}
                                            </span>
                                            <span className={`${styles.visitStatus} ${styles[visit.status]}`}>
                                                {visit.status}
                                            </span>
                                        </div>
                                        <p className={styles.visitTranscript}>
                                            {visit.transcript ? (
                                                visit.transcript.substring(0, 150) + (visit.transcript.length > 150 ? '...' : '')
                                            ) : (
                                                <span className={styles.noTranscript}>No transcript available</span>
                                            )}
                                        </p>
                                        <div className={styles.visitSummary}>
                                            <div className={styles.summaryCount}>
                                                <strong>{visit.summary.issuesIdentified.length}</strong> Issues
                                            </div>
                                            <div className={styles.summaryCount}>
                                                <strong>{visit.summary.actionsPlan.length}</strong> Actions
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>
                </div>
            </div>

            <PatientFormModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                onSave={handleEditPatient}
                initialData={patient}
            />
        </div>
    );
}
