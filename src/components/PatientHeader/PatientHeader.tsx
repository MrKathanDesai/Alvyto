'use client';

import { useState, useRef, useEffect } from 'react';
import styles from './PatientHeader.module.css';
import { Visit } from '@/types';
import type { EMRPatient } from '@/types/emr';

interface PatientHeaderProps {
    patient: EMRPatient;
    patients: EMRPatient[];
    visits?: Visit[];
    hasHistory: boolean;
    onPatientSelect: (patientId: string) => void;
    onHistoryToggle?: () => void;
    historyOpen?: boolean;
    readOnly?: boolean;
}

function getAgeFromDob(dateOfBirth: string): number {
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const monthDiff = today.getMonth() - dob.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
    }

    return age;
}

function getInitials(name: string): string {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

export default function PatientHeader({
    patient,
    patients,
    visits = [],
    hasHistory,
    onPatientSelect,
    onHistoryToggle,
    historyOpen = false,
    readOnly = false,
}: PatientHeaderProps) {
    const [isSwitchOpen, setIsSwitchOpen] = useState(false);
    const [switchSearch, setSwitchSearch] = useState('');
    const switchRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (switchRef.current && !switchRef.current.contains(e.target as Node)) {
                setIsSwitchOpen(false);
                setSwitchSearch('');
            }
        }

        function handleKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') {
                setIsSwitchOpen(false);
                setSwitchSearch('');
            }
        }

        document.addEventListener('mousedown', handleClick);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClick);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, []);

    const filteredSwitchPatients = switchSearch.trim() === ''
        ? patients
        : patients.filter((p) => {
            const name = (p.name ?? '').toLowerCase();
            const mrn = (p.mrn ?? '').toLowerCase();
            const q = switchSearch.toLowerCase();
            return name.includes(q) || mrn.includes(q);
        });

    return (
        <header className={styles.header}>
            <div className={styles.patientInfo}>
                <div className={styles.patientAvatar}>{getInitials(patient.name)}</div>

                <div className={styles.patientDetails}>
                    <div className={styles.nameRow}>
                        <h1 className={styles.patientName}>{patient.name}</h1>

                        {visits.length > 0 && onHistoryToggle && (
                            <button
                                className={[styles.historyTrigger, historyOpen ? styles.historyTriggerActive : ''].join(' ')}
                                onClick={onHistoryToggle}
                                title="View visit history"
                                aria-label={`${historyOpen ? 'Hide' : 'Show'} visit history (${visits.length} visits)`}
                                aria-expanded={historyOpen}
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M12 6v6l4 2" />
                                </svg>
                                History
                                <span className={styles.historyCount}>{visits.length}</span>
                                <svg
                                    className={[styles.chevronSm, historyOpen ? styles.chevronOpen : ''].join(' ')}
                                    width="11" height="11" viewBox="0 0 24 24"
                                    fill="none" stroke="currentColor" strokeWidth="2.5"
                                >
                                    <path d="M6 9l6 6 6-6" />
                                </svg>
                            </button>
                        )}
                    </div>

                    <div className={styles.patientMeta}>
                        <span>{getAgeFromDob(patient.dateOfBirth)} years</span>
                        <div className={styles.divider} />
                        <span>{patient.gender ?? '—'}</span>
                        <div className={styles.divider} />
                        <span>{patient.mrn}</span>
                    </div>
                </div>

                {hasHistory && (
                    <div className={styles.badges}>
                        <span className={styles.historyBadge}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Past History
                        </span>
                    </div>
                )}
            </div>

            {!readOnly && (
                <div className={styles.actions}>
                    <div className={styles.patientSelector} ref={switchRef}>
                        <button
                            className={styles.selectorBtn}
                            onClick={() => setIsSwitchOpen(o => !o)}
                            aria-label="Switch patient"
                            aria-expanded={isSwitchOpen}
                            aria-haspopup="listbox"
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" />
                            </svg>
                            Switch Patient
                            <svg
                                className={[styles.chevronIcon, isSwitchOpen ? styles.rotated : ''].join(' ')}
                                width="16" height="16" viewBox="0 0 24 24"
                                fill="none" stroke="currentColor" strokeWidth="2"
                            >
                                <path d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>

                        {isSwitchOpen && (
                            <div className={styles.dropdown} role="listbox" aria-label="Select patient">
                                <div className={styles.dropdownSearch}>
                                    <input
                                        type="text"
                                        placeholder="Search patients…"
                                        value={switchSearch}
                                        onChange={(e) => setSwitchSearch(e.target.value)}
                                        onClick={(e) => e.stopPropagation()}
                                        autoFocus
                                        autoComplete="off"
                                    />
                                </div>
                                {filteredSwitchPatients.length === 0 ? (
                                    <div style={{ padding: '12px', textAlign: 'center', fontSize: '0.8125rem', color: 'var(--text-3)' }}>
                                        No patients found
                                    </div>
                                ) : (
                                    filteredSwitchPatients.map((p) => (
                                        <div
                                            key={p.id}
                                            role="option"
                                            aria-selected={p.id === patient.id}
                                            tabIndex={0}
                                            className={[styles.dropdownItem, p.id === patient.id ? styles.selected : ''].join(' ')}
                                            onClick={() => { onPatientSelect(p.id); setIsSwitchOpen(false); setSwitchSearch(''); }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    onPatientSelect(p.id);
                                                    setIsSwitchOpen(false);
                                                    setSwitchSearch('');
                                                }
                                            }}
                                        >
                                            <div className={styles.dropdownAvatar}>{getInitials(p.name)}</div>
                                            <div className={styles.dropdownInfo}>
                                                <div className={styles.dropdownName}>{p.name}</div>
                                                <div className={styles.dropdownMeta}>{getAgeFromDob(p.dateOfBirth)}y · {p.gender ?? '—'} · {p.mrn}</div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </header>
    );
}
