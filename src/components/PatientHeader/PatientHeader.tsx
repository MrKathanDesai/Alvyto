'use client';

import { useState } from 'react';
import styles from './PatientHeader.module.css';
import { Patient, Visit } from '@/types';

interface PatientHeaderProps {
    patient: Patient;
    patients: Patient[];
    lastVisit?: Visit;
    hasHistory: boolean;
    onPatientSelect: (patientId: string) => void;
    readOnly?: boolean;
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

function formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

export default function PatientHeader({
    patient,
    patients,
    lastVisit,
    hasHistory,
    onPatientSelect,
    readOnly = false,
}: PatientHeaderProps) {
    const [isLastVisitExpanded, setIsLastVisitExpanded] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);

    return (
        <>
            <header className={styles.header}>
                <div className={styles.patientInfo}>
                    <div className={styles.patientAvatar}>
                        {getInitials(patient.name)}
                    </div>

                    <div className={styles.patientDetails}>
                        <h1 className={styles.patientName}>{patient.name}</h1>
                        <div className={styles.patientMeta}>
                            <span>{patient.age} years</span>
                            <div className={styles.divider} />
                            <span>{patient.sex}</span>
                            <div className={styles.divider} />
                            <span>{patient.patientId}</span>
                        </div>
                    </div>

                    {hasHistory && (
                        <div className={styles.badges}>
                            <span className={styles.historyBadge}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                Past History Available
                            </span>
                        </div>
                    )}
                </div>

                <div className={styles.actions}>
                    {lastVisit && (
                        <button
                            className={`${styles.lastVisitBtn} ${isLastVisitExpanded ? styles.active : ''}`}
                            onClick={() => setIsLastVisitExpanded(!isLastVisitExpanded)}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            View Last Visit
                            <svg
                                className={`${styles.chevronIcon} ${isLastVisitExpanded ? styles.rotated : ''}`}
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
                                <path d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                    )}

                    {!readOnly && (
                        <div className={styles.patientSelector}>
                            <button
                                className={styles.selectorBtn}
                                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                                    <circle cx="9" cy="7" r="4" />
                                    <path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" />
                                </svg>
                                Switch Patient
                                <svg
                                    className={`${styles.chevronIcon} ${isDropdownOpen ? styles.rotated : ''}`}
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <path d="M19 9l-7 7-7-7" />
                                </svg>
                            </button>

                            {isDropdownOpen && (
                                <div className={styles.dropdown}>
                                    {patients.map((p) => (
                                        <div
                                            key={p.id}
                                            className={`${styles.dropdownItem} ${p.id === patient.id ? styles.selected : ''}`}
                                            onClick={() => {
                                                onPatientSelect(p.id);
                                                setIsDropdownOpen(false);
                                            }}
                                        >
                                            <div className={styles.dropdownAvatar}>
                                                {getInitials(p.name)}
                                            </div>
                                            <div className={styles.dropdownInfo}>
                                                <div className={styles.dropdownName}>{p.name}</div>
                                                <div className={styles.dropdownMeta}>
                                                    {p.age}y • {p.sex} • {p.patientId}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </header>

            {isLastVisitExpanded && lastVisit && (
                <div className={styles.lastVisitPanel}>
                    <div className={styles.lastVisitContent}>
                        <div className={styles.lastVisitHeader}>
                            <span className={styles.lastVisitTitle}>Previous Visit Summary</span>
                            <span className={styles.lastVisitDate}>
                                {formatDate(lastVisit.createdAt)}
                            </span>
                        </div>

                        <div className={styles.lastVisitGrid}>
                            <div className={styles.lastVisitSection}>
                                <h3 className={styles.lastVisitSectionTitle}>Issues Identified</h3>
                                <ul className={styles.lastVisitList}>
                                    {lastVisit.summary.issuesIdentified.map((issue) => (
                                        <li key={issue.id} className={styles.lastVisitItem}>
                                            <span className={styles.lastVisitBullet}>•</span>
                                            {issue.text}
                                        </li>
                                    ))}
                                </ul>
                            </div>

                            <div className={styles.lastVisitSection}>
                                <h3 className={styles.lastVisitSectionTitle}>Actions / Plan</h3>
                                <ul className={styles.lastVisitList}>
                                    {lastVisit.summary.actionsPlan.map((action) => (
                                        <li key={action.id} className={styles.lastVisitItem}>
                                            <span className={styles.lastVisitBullet}>•</span>
                                            {action.text}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
