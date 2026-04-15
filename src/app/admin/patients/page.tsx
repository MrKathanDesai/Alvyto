'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { getPatients, createPatient, updatePatient } from '@/services/api';
import { EMRPatient } from '@/types/emr';
import PatientFormModal, { PatientFormValues } from '@/components/PatientFormModal';
import styles from './page.module.css';

export default function PatientsPage() {
    const [patients, setPatients] = useState<EMRPatient[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingPatient, setEditingPatient] = useState<EMRPatient | null>(null);

    const loadPatients = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await getPatients();
            setPatients(data);
        } catch (err) {
            console.error('Failed to load patients', err);
            setError('Failed to load patients. Please refresh and try again.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadPatients();
    }, []);

    const openCreateModal = () => {
        setEditingPatient(null);
        setIsModalOpen(true);
    };

    const openEditModal = (patient: EMRPatient) => {
        setEditingPatient(patient);
        setIsModalOpen(true);
    };

    const handleSavePatient = async (patientData: PatientFormValues) => {
        try {
            setSaving(true);
            setError(null);

            if (editingPatient) {
                await updatePatient(editingPatient.id, {
                    firstName: patientData.firstName,
                    lastName: patientData.lastName,
                    mrn: patientData.mrn,
                    dateOfBirth: patientData.dateOfBirth,
                    sex: patientData.sex,
                });
            } else {
                await createPatient({
                    firstName: patientData.firstName,
                    lastName: patientData.lastName,
                    mrn: patientData.mrn,
                    dateOfBirth: patientData.dateOfBirth,
                    sex: patientData.sex,
                });
            }

            await loadPatients();
            setIsModalOpen(false);
            setEditingPatient(null);
        } catch (err) {
            console.error('Failed to save patient', err);
            setError('Failed to save patient. Please try again.');
            throw err;
        } finally {
            setSaving(false);
        }
    };

    const filteredPatients = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) return patients;

        return patients.filter((p) => {
            const fullName = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim().toLowerCase();
            const legacyName = p.name?.toLowerCase() ?? '';
            const mrn = p.mrn?.toLowerCase() ?? '';
            return fullName.includes(term) || legacyName.includes(term) || mrn.includes(term);
        });
    }, [patients, searchTerm]);

    if (loading && patients.length === 0) {
        return <div className={styles.loading}>Loading Patients...</div>;
    }

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.title}>Patient Management</h1>
                    <p className={styles.subtitle}>View and manage patient records</p>
                </div>
                <button
                    className={styles.addButton}
                    onClick={openCreateModal}
                    disabled={saving || loading}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add Patient
                </button>
            </header>

            {error && (
                <div className="error-msg" role="alert">{error}</div>
            )}

            <div className={styles.filters}>
                <div className={styles.searchBox}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.searchIcon}>
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search by name or MRN..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={styles.searchInput}
                        disabled={loading}
                    />
                </div>
            </div>

            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>MRN</th>
                            <th>Name</th>
                            <th>Age/Sex</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredPatients.map((patient) => {
                            const displayName = `${patient.firstName ?? ''} ${patient.lastName ?? ''}`.trim() || patient.name;
                            const age = new Date().getFullYear() - new Date(patient.dateOfBirth).getFullYear();

                            return (
                                <tr key={patient.id}>
                                    <td>
                                        <code className={styles.mrn}>{patient.mrn}</code>
                                    </td>
                                    <td>
                                        <div className={styles.personInfo}>
                                            <div className={`${styles.avatar} ${styles.patient}`}>{displayName.charAt(0)}</div>
                                            <span>{displayName}</span>
                                        </div>
                                    </td>
                                    <td>
                                        {age} / {patient.sex ?? patient.gender ?? '—'}
                                    </td>
                                    <td>
                                        {new Date(patient.createdAt).toLocaleDateString()}
                                    </td>
                                     <td>
                                         <div className={styles.actionGroup}>
                                             <button
                                                 type="button"
                                                 className={styles.actionButton}
                                                 onClick={() => openEditModal(patient)}
                                                 disabled={saving || loading}
                                             >
                                                 Edit
                                             </button>
                                             <Link href={`/admin/patients/${patient.id}`} className={styles.actionButton}>
                                                 View
                                             </Link>
                                         </div>
                                     </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <PatientFormModal
                isOpen={isModalOpen}
                onClose={() => {
                    if (saving) return;
                    setIsModalOpen(false);
                    setEditingPatient(null);
                }}
                onSave={handleSavePatient}
                initialData={editingPatient}
            />
        </div>
    );
}
