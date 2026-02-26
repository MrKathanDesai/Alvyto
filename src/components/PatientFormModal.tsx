'use client';

import { useState, useEffect } from 'react';
import { api } from '@/services/api';
import { Patient } from '@/types';
import styles from './PatientFormModal.module.css';

interface PatientFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (patient: Patient) => void;
    initialData?: Patient | null;
}

export default function PatientFormModal({ isOpen, onClose, onSave, initialData }: PatientFormModalProps) {
    const [formData, setFormData] = useState({
        name: '',
        patientId: '',
        age: 0,
        sex: 'Male' as 'Male' | 'Female' | 'Other',
        dateOfBirth: ''
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (initialData) {
            setFormData({
                name: initialData.name,
                patientId: initialData.patientId,
                age: initialData.age,
                sex: initialData.sex,
                dateOfBirth: ''
            });
        } else {
            setFormData({
                name: '',
                patientId: '',
                age: 0,
                sex: 'Male',
                dateOfBirth: ''
            });
        }
    }, [initialData, isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        try {
            await onSave(formData as any);
        } catch (error) {
            console.error("Failed to save patient", error);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className={styles.overlay}>
            <div className={styles.modal}>
                <div className={styles.header}>
                    <h2>{initialData ? 'Edit Patient' : 'Add New Patient'}</h2>
                    <button className={styles.closeButton} onClick={onClose}>&times;</button>
                </div>
                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.field}>
                        <label>Full Name</label>
                        <input
                            type="text"
                            required
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>

                    <div className={styles.field}>
                        <label>MRN (Medical Record Number)</label>
                        <input
                            type="text"
                            required
                            value={formData.patientId}
                            onChange={e => setFormData({ ...formData, patientId: e.target.value })}
                        />
                    </div>

                    <div className={styles.row}>
                        <div className={styles.field}>
                            <label>Date of Birth</label>
                            <input
                                type="date"
                                required
                                value={formData.dateOfBirth}
                                onChange={e => {
                                    const dob = new Date(e.target.value);
                                    const ageDiff = Date.now() - dob.getTime();
                                    const ageDate = new Date(ageDiff);
                                    const calculatedAge = Math.abs(ageDate.getUTCFullYear() - 1970);

                                    setFormData({
                                        ...formData,
                                        dateOfBirth: e.target.value,
                                        age: calculatedAge
                                    })
                                }}
                            />
                        </div>
                        <div className={styles.field}>
                            <label>Sex</label>
                            <select
                                value={formData.sex}
                                onChange={e => setFormData({ ...formData, sex: e.target.value as any })}
                            >
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                    </div>

                    <div className={styles.field}>
                        <label>Age (Auto-calculated)</label>
                        <input type="number" disabled value={formData.age} />
                    </div>

                    <div className={styles.footer}>
                        <button type="button" className={styles.cancelButton} onClick={onClose}>Cancel</button>
                        <button type="submit" className={styles.saveButton} disabled={loading}>
                            {loading ? 'Saving...' : 'Save Patient'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
