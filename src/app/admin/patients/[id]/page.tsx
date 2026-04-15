'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getPatient, getPatientVisits, updatePatient, updateMedicalHistory, updateVisitPrescription, downloadVisitPrescription } from '@/services/api';
import { PrescriptionMedicationDetail, Visit } from '@/types';
import { EMRPatient, MedicalHistoryRecord } from '@/types/emr';
import MedicalSnapshot from '@/components/MedicalSnapshot';
import MedicationEditor from '@/components/MedicationEditor/MedicationEditor';
import PatientFormModal, { PatientFormValues } from '@/components/PatientFormModal';
import styles from './page.module.css';

function createEmptyHistory(patientId: string): MedicalHistoryRecord {
    return {
        id: '',
        patientId,
        conditions: [],
        allergies: [],
        medications: [],
        notes: null,
        updatedAt: '',
    };
}

function sanitizeMedication(medication: PrescriptionMedicationDetail): PrescriptionMedicationDetail {
    return {
        name: medication.name?.trim() ?? '',
        dosage: medication.dosage?.trim() || undefined,
        frequency: medication.frequency?.trim() || undefined,
        duration: medication.duration?.trim() || undefined,
        route: medication.route?.trim() || undefined,
        instructions: medication.instructions?.trim() || undefined,
    };
}

function deriveVisitMedications(visit: Visit): PrescriptionMedicationDetail[] {
    const summary = visit.summary;
    if (!summary) return [];

    if (summary.prescriptionDraft?.medications?.length) {
        return summary.prescriptionDraft.medications
            .map(sanitizeMedication)
            .filter((medication) => medication.name.length > 0);
    }

    if (summary.prescriptions?.length) {
        return summary.prescriptions
            .map((prescription) => sanitizeMedication({
                name: prescription.name,
                dosage: prescription.dosage,
                frequency: prescription.frequency,
                route: 'Oral',
            }))
            .filter((medication) => medication.name.length > 0);
    }

    return (summary.clinicalSnapshot ?? [])
        .filter((fact) => fact.category === 'medication')
        .map((fact) => sanitizeMedication({ name: fact.label }))
        .filter((medication) => medication.name.length > 0);
}

export default function PatientDetailPage() {
    const params = useParams();
    const id = params.id as string;

    const [patient, setPatient] = useState<EMRPatient | null>(null);
    const [history, setHistory] = useState<MedicalHistoryRecord | null>(null);
    const [visits, setVisits] = useState<Visit[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [savingPatient, setSavingPatient] = useState(false);
    const [savingHistory, setSavingHistory] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [expandedVisitId, setExpandedVisitId] = useState<string | null>(null);
    const [editingMedsVisitId, setEditingMedsVisitId] = useState<string | null>(null);
    const [editingMeds, setEditingMeds] = useState<PrescriptionMedicationDetail[]>([]);
    const [savingMeds, setSavingMeds] = useState(false);
    const [downloadingVisitId, setDownloadingVisitId] = useState<string | null>(null);

    useEffect(() => {
        async function loadData() {
            try {
                setLoading(true);
                setError(null);

                const [p, v] = await Promise.all([
                    getPatient(id),
                    getPatientVisits(id, { status: 'completed' }),
                ]);

                setPatient(p);
                setHistory(p.medicalHistory ?? createEmptyHistory(p.id));
                setVisits(v);
            } catch (err) {
                console.error('Failed to load patient detail', err);
                setError('Failed to load patient details. Please refresh and try again.');
            } finally {
                setLoading(false);
            }
        }

        if (id) {
            void loadData();
        }
    }, [id]);

    const handleEditPatient = async (updates: PatientFormValues) => {
        if (!patient) return;

        try {
            setSavingPatient(true);
            setError(null);

            await updatePatient(patient.id, {
                firstName: updates.firstName,
                lastName: updates.lastName,
                mrn: updates.mrn,
                dateOfBirth: updates.dateOfBirth,
                sex: updates.sex,
            });

            const refreshed = await getPatient(patient.id);
            setPatient(refreshed);
            setHistory(refreshed.medicalHistory ?? createEmptyHistory(refreshed.id));
            setIsEditModalOpen(false);
        } catch (err) {
            console.error('Failed to update patient', err);
            setError('Failed to update patient details. Please try again.');
            throw err;
        } finally {
            setSavingPatient(false);
        }
    };

    const handleSaveMedicalHistory = async (data: {
        conditions: string[];
        allergies: string[];
        medications: Record<string, unknown>[];
        notes?: string;
    }) => {
        if (!patient) return;

        try {
            setSavingHistory(true);
            setError(null);

            const updatedHistory = await updateMedicalHistory(patient.id, {
                conditions: data.conditions,
                allergies: data.allergies,
                medications: data.medications,
                notes: data.notes,
            });

            setHistory(updatedHistory);
        } catch (err) {
            console.error('Failed to update medical history', err);
            setError('Failed to update medical history. Please try again.');
        } finally {
            setSavingHistory(false);
        }
    };

    const handleStartEditMeds = (visit: Visit) => {
        if (!visit.summary) return;
        setEditingMedsVisitId(visit.id);
        setEditingMeds(deriveVisitMedications(visit));
    };

    const handleCancelEditMeds = () => {
        setEditingMedsVisitId(null);
        setEditingMeds([]);
        setSavingMeds(false);
    };

    const handleSaveVisitMeds = async (visit: Visit) => {
        if (!visit.summary) return;

        const cleanedMeds = editingMeds
            .map(sanitizeMedication)
            .filter((medication) => medication.name.length > 0);

        const existingDraft = visit.summary.prescriptionDraft;
        const updatedDraft = {
            diagnoses: existingDraft?.diagnoses ?? [],
            medications: cleanedMeds,
            investigations: existingDraft?.investigations ?? [],
            advice: existingDraft?.advice ?? [],
            warnings: existingDraft?.warnings ?? [],
            reportSummary: existingDraft?.reportSummary ?? '',
            followUp: existingDraft?.followUp ?? null,
        };

        try {
            setSavingMeds(true);
            setError(null);
            await updateVisitPrescription(visit.id, updatedDraft);

            setVisits((previous) =>
                previous.map((item) =>
                    item.id === visit.id && item.summary
                        ? {
                            ...item,
                            summary: {
                                ...item.summary,
                                prescriptionDraft: updatedDraft,
                            },
                        }
                        : item
                )
            );

            setEditingMedsVisitId(null);
            setEditingMeds([]);
        } catch (err) {
            console.error('Failed to update visit medicines', err);
            setError('Failed to update medicines. Please try again.');
        } finally {
            setSavingMeds(false);
        }
    };

    const handleDownloadPrescription = async (visit: Visit) => {
        if (!patient) return;
        try {
            setDownloadingVisitId(visit.id);
            await downloadVisitPrescription(visit.id, {
                visit,
                patient,
                doctor: null,
                allergies: patient.medicalHistory?.allergies ?? [],
            });
        } catch (err) {
            console.error('Failed to download prescription', err);
        } finally {
            setDownloadingVisitId(null);
        }
    };

    if (loading) {
        return <div className={styles.loading}>Loading Patient Record...</div>;
    }

    if (error && !patient) {
        return <div className={styles.error}>{error}</div>;
    }

    if (!patient) {
        return <div className={styles.error}>Patient not found</div>;
    }

    const displayName = `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim() || patient.name;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.headerTop}>
                    <Link href="/admin/patients" className={styles.backLink}>
                        ← Back to Patients
                    </Link>
                    <div className={styles.actions}>
                        <button
                            className={styles.editButton}
                            onClick={() => setIsEditModalOpen(true)}
                            disabled={savingPatient || savingHistory}
                        >
                            Edit Details
                        </button>
                    </div>
                </div>
                <div className={styles.profileHeader}>
                    <div className={styles.avatarLarge}>{displayName.charAt(0)}</div>
                    <div className={styles.profileInfo}>
                        <h1 className={styles.name}>{displayName}</h1>
                        <div className={styles.meta}>
                            <span>MRN: {patient.mrn}</span>
                            <span>•</span>
                            <span>{new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear()} yrs</span>
                            <span>•</span>
                            <span>{patient.sex ?? patient.gender ?? '—'}</span>
                        </div>
                    </div>
                </div>
            </header>

            {error && <div className={`${styles.error} ${styles.errorInline}`}>{error}</div>}

            <div className={styles.contentGrid}>
                <div className={styles.clinicalColumn}>
                    <section className={styles.section}>
                        {history ? (
                            <MedicalSnapshot
                                history={history}
                                isRecording={false}
                                editable
                                saving={savingHistory}
                                onSave={handleSaveMedicalHistory}
                            />
                        ) : (
                            <div className={styles.emptyState}>No medical history recorded.</div>
                        )}
                    </section>
                </div>

                <div className={styles.historyColumn}>
                    <section className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <h2>Visit History</h2>
                            <span className={styles.visitCount}>{visits.length} visit{visits.length !== 1 ? 's' : ''}</span>
                        </div>

                        <div className={styles.visitsList}>
                            {visits.length === 0 ? (
                                <div className={styles.emptyState}>
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={styles.emptyIcon}>
                                        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                                        <rect x="9" y="3" width="6" height="4" rx="1" />
                                    </svg>
                                    <p>No approved visits yet.</p>
                                    <p className={styles.emptyHelper}>Visit summaries appear here after they are approved in the exam room.</p>
                                </div>
                            ) : (
                                visits.map(visit => {
                                    const isExpanded = expandedVisitId === visit.id;
                                    const isEditingMeds = editingMedsVisitId === visit.id;

                                    return (
                                        <div
                                            key={visit.id}
                                            className={styles.visitCard}
                                            onClick={() => setExpandedVisitId(isExpanded ? null : visit.id)}
                                        >
                                            <div className={styles.visitHeader}>
                                                <div className={styles.visitHeaderLeft}>
                                                    <span className={styles.visitDate}>
                                                        {new Date(visit.createdAt).toLocaleDateString(undefined, {
                                                            weekday: 'short',
                                                            month: 'short',
                                                            day: 'numeric',
                                                            year: 'numeric',
                                                        })}
                                                    </span>
                                                    {visit.endedAt && (
                                                        <span className={styles.visitTime}>
                                                            {new Date(visit.endedAt).toLocaleTimeString(undefined, {
                                                                hour: '2-digit',
                                                                minute: '2-digit',
                                                            })}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className={styles.visitHeaderRight}>
                                                    {visit.summary && (
                                                        <button
                                                            type="button"
                                                            className={styles.downloadRxBtn}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                void handleDownloadPrescription(visit);
                                                            }}
                                                            disabled={downloadingVisitId === visit.id}
                                                            title="Download Prescription"
                                                        >
                                                            {downloadingVisitId === visit.id ? '...' : '↓ Rx'}
                                                        </button>
                                                    )}
                                                    <svg
                                                        className={isExpanded ? styles.chevronOpen : styles.chevron}
                                                        width="16" height="16" viewBox="0 0 24 24"
                                                        fill="none" stroke="currentColor" strokeWidth="2"
                                                    >
                                                        <path d="M6 9l6 6 6-6" />
                                                    </svg>
                                                </div>
                                            </div>
                                            {isExpanded && visit.summary && (
                                                <div className={styles.visitBody}>
                                                    {visit.summary.issuesParagraph && (
                                                        <p className={styles.visitSummaryText}>{visit.summary.issuesParagraph}</p>
                                                    )}
                                                    {visit.summary.clinicalSnapshot && visit.summary.clinicalSnapshot.length > 0 && (
                                                        <div className={styles.visitFacts}>
                                                            {visit.summary.clinicalSnapshot.slice(0, 5).map((fact, i) => (
                                                                <span key={i} className={styles.factChip}>{fact.label}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {visit.summary.prescriptions && visit.summary.prescriptions.length > 0 && (
                                                        <div className={styles.visitRx}>
                                                            <strong>Prescriptions:</strong> {visit.summary.prescriptions.map(rx => rx.name).join(', ')}
                                                        </div>
                                                    )}

                                                    <button
                                                        type="button"
                                                        className={styles.editMedsBtn}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            if (isEditingMeds) {
                                                                handleCancelEditMeds();
                                                            } else {
                                                                handleStartEditMeds(visit);
                                                            }
                                                        }}
                                                        disabled={savingMeds && isEditingMeds}
                                                    >
                                                        {isEditingMeds ? 'Close Editor' : 'Edit Medicines'}
                                                    </button>

                                                    {isEditingMeds && (
                                                        <div onClick={(event) => event.stopPropagation()}>
                                                            <MedicationEditor
                                                                medications={editingMeds}
                                                                onChange={setEditingMeds}
                                                                compact
                                                                disabled={savingMeds}
                                                            />

                                                            <div className={styles.medsEditActions}>
                                                                <button
                                                                    type="button"
                                                                    className={styles.saveMedsBtn}
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        void handleSaveVisitMeds(visit);
                                                                    }}
                                                                    disabled={savingMeds}
                                                                >
                                                                    {savingMeds ? 'Saving...' : 'Save'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className={styles.cancelMedsBtn}
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        handleCancelEditMeds();
                                                                    }}
                                                                    disabled={savingMeds}
                                                                >
                                                                    Cancel
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </section>
                </div>
            </div>

            <PatientFormModal
                isOpen={isEditModalOpen}
                onClose={() => {
                    if (savingPatient) return;
                    setIsEditModalOpen(false);
                }}
                onSave={handleEditPatient}
                initialData={patient}
            />
        </div>
    );
}
