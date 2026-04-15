'use client';

import { useState, useEffect, useCallback } from 'react';
import type { EMRPatient } from '@/types/emr';
import styles from './PatientFormModal.module.css';

export interface PatientFormValues {
    firstName: string;
    lastName: string;
    mrn: string;
    dateOfBirth: string;
    sex: 'Male' | 'Female' | 'Other';
}

interface PatientFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (patient: PatientFormValues) => Promise<unknown> | unknown;
    initialData?: EMRPatient | null;
}

const DEFAULT_FORM_DATA: PatientFormValues = {
    firstName: '',
    lastName: '',
    mrn: '',
    sex: 'Male',
    dateOfBirth: '',
};

export default function PatientFormModal({ isOpen, onClose, onSave, initialData }: PatientFormModalProps) {
    const [formData, setFormData] = useState<PatientFormValues>(DEFAULT_FORM_DATA);
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState<
        Partial<Record<'firstName' | 'lastName' | 'dateOfBirth' | 'sex', string>>
    >({});

    useEffect(() => {
        if (isOpen && initialData) {
            setFormData({
                firstName: initialData.firstName ?? '',
                lastName: initialData.lastName ?? '',
                mrn: initialData.mrn,
                sex: (initialData.sex as 'Male' | 'Female' | 'Other') ?? 'Male',
                dateOfBirth: initialData.dateOfBirth?.split('T')[0] ?? '',
            });
            setErrors({});
            return;
        }

        if (isOpen && !initialData) {
            setFormData(DEFAULT_FORM_DATA);
            setErrors({});
            return;
        }

        if (!isOpen) {
            setFormData(DEFAULT_FORM_DATA);
            setErrors({});
            setLoading(false);
        }
    }, [initialData, isOpen]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const nextErrors: Partial<Record<'firstName' | 'lastName' | 'dateOfBirth' | 'sex', string>> = {};
        if (!formData.firstName.trim()) nextErrors.firstName = 'First name is required.';
        if (!formData.lastName.trim()) nextErrors.lastName = 'Last name is required.';
        if (!formData.dateOfBirth) nextErrors.dateOfBirth = 'Date of birth is required.';
        if (!formData.sex) nextErrors.sex = 'Sex is required.';

        if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
        }

        setErrors({});
        setLoading(true);

        try {
            const generatedMrn = !initialData && !formData.mrn.trim()
                ? 'MRN-' + Date.now().toString().slice(-6)
                : formData.mrn.trim();

            await onSave({
                firstName: formData.firstName.trim(),
                lastName: formData.lastName.trim(),
                mrn: generatedMrn,
                dateOfBirth: formData.dateOfBirth,
                sex: formData.sex,
            });

            onClose();
        } catch (error) {
            console.error('Failed to save patient', error);
        } finally {
            setLoading(false);
        }
    };

    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') onClose();
    }, [onClose]);

    if (!isOpen) return null;

    const titleId = 'patient-modal-title';

    return (
        <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onKeyDown={handleKeyDown}
            >
                <div className={styles.header}>
                    <h2 id={titleId}>{initialData ? 'Edit Patient' : 'Add New Patient'}</h2>
                    <button className={styles.closeButton} onClick={onClose} aria-label="Close dialog">&times;</button>
                </div>
                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.fieldRow}>
                        <div className={styles.field}>
                            <label>First Name</label>
                            <input
                                type="text"
                                required
                                value={formData.firstName}
                                onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                            />
                            {errors.firstName && <small className={styles.errorText}>{errors.firstName}</small>}
                        </div>

                        <div className={styles.field}>
                            <label>Last Name</label>
                            <input
                                type="text"
                                required
                                value={formData.lastName}
                                onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                            />
                            {errors.lastName && <small className={styles.errorText}>{errors.lastName}</small>}
                        </div>
                    </div>

                    <div className={styles.field}>
                        <label>MRN (Medical Record Number)</label>
                        <input
                            type="text"
                            value={formData.mrn}
                            onChange={e => setFormData({ ...formData, mrn: e.target.value })}
                            placeholder={!initialData ? 'Auto-generated if left blank' : ''}
                        />
                    </div>

                    <div className={styles.fieldRow}>
                        <div className={styles.field}>
                            <label>Date of Birth</label>
                            <input
                                type="date"
                                required
                                value={formData.dateOfBirth}
                                onChange={e => setFormData({ ...formData, dateOfBirth: e.target.value })}
                            />
                            {errors.dateOfBirth && <small className={styles.errorText}>{errors.dateOfBirth}</small>}
                        </div>
                        <div className={styles.field}>
                            <label>Sex</label>
                            <select
                                value={formData.sex}
                                onChange={e => setFormData({ ...formData, sex: e.target.value as 'Male' | 'Female' | 'Other' })}
                            >
                                <option value="Male">Male</option>
                                <option value="Female">Female</option>
                                <option value="Other">Other</option>
                            </select>
                            {errors.sex && <small className={styles.errorText}>{errors.sex}</small>}
                        </div>
                    </div>

                    <div className={styles.actions}>
                        <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={loading}>Cancel</button>
                        <button type="submit" className={styles.submitBtn} disabled={loading}>
                            {loading ? 'Saving...' : 'Save Patient'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
