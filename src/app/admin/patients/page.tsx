'use client';

import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import { Patient } from '@/types';
import styles from './page.module.css';
import Link from 'next/link';
import PatientFormModal from '@/components/PatientFormModal';

export default function PatientsPage() {
    const [patients, setPatients] = useState<Patient[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);

    const loadPatients = async () => {
        try {
            setLoading(true); // Optional: only if full reload needed
            const data = await api.getPatients();
            setPatients(data);
        } catch (error) {
            console.error("Failed to load patients", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPatients();
    }, []);

    const handleCreatePatient = async (patientData: any) => {
        try {
            await api.createPatient(patientData);
            await loadPatients(); // Reload list
            setIsModalOpen(false);
        } catch (error) {
            console.error("Failed to create patient", error);
            alert("Failed to create patient. Please try again.");
        }
    };

    const filteredPatients = patients.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.patientId.toLowerCase().includes(searchTerm.toLowerCase())
    );

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
                <button className={styles.addButton} onClick={() => setIsModalOpen(true)}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add Patient
                </button>
            </header>

            {/* Filters */}
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
                    />
                </div>
            </div>

            {/* Patients Table */}
            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>MRN</th>
                            <th>Name</th>
                            <th>Age/Gender</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredPatients.map(patient => (
                            <tr key={patient.id}>
                                <td>
                                    <code className={styles.mrn}>{patient.patientId}</code>
                                </td>
                                <td>
                                    <div className={styles.personInfo}>
                                        <div className={`${styles.avatar} ${styles.patient}`}>{patient.name.charAt(0)}</div>
                                        <span>{patient.name}</span>
                                    </div>
                                </td>
                                <td>
                                    {patient.age} / {patient.sex}
                                </td>
                                <td>
                                    {new Date(patient.createdAt).toLocaleDateString()}
                                </td>
                                <td>
                                    <Link href={`/admin/patients/${patient.id}`} className={styles.actionButton}>
                                        View History
                                    </Link>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <PatientFormModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSave={handleCreatePatient} // Wait, onSave in modal definition asks for Patient object, but handleCreatePatient takes 'any' or Partial.
            // PatientFormModal props: onSave: (patient: Patient) => void.
            // But handleCreatePatient calls createPatient which returns Promise<Patient>.
            // The modal handles the submission logic internally in my previous implementation?
            // Let's check PatientFormModal implementation. 
            // It does NOT call onSave with data. It just logs.
            // I need to update PatientFormModal to call onSave with the form data.
            // Or updates it to call API directly?
            // My handleCreatePatient assumes it receives data.
            />
        </div>
    );
}
