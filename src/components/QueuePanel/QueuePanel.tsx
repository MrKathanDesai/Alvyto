import React from 'react';
import { QueueEntry } from '@/types/emr';
import { useRoomQueue } from '@/hooks/useRoomQueue';
import styles from './QueuePanel.module.css';

type QueuePatient = {
    id: string;
    name?: string;
    firstName?: string;
    lastName?: string;
};

interface QueuePanelProps {
    roomId: string;
    onStartVisit: (entry: QueueEntry) => void;
    patients?: QueuePatient[] | Record<string, string> | Map<string, string>;
}

function getPatientNameFromObject(patient: QueuePatient | undefined): string | null {
    if (!patient) return null;
    if (patient.name?.trim()) return patient.name.trim();
    const fallbackName = [patient.firstName, patient.lastName].filter(Boolean).join(' ').trim();
    return fallbackName || null;
}

function resolvePatientName(entry: QueueEntry, patients?: QueuePanelProps['patients']): string {
    if (Array.isArray(patients)) {
        const patient = patients.find((p) => p.id === entry.patientId);
        return getPatientNameFromObject(patient) ?? 'Unknown Patient';
    }
    if (patients instanceof Map) {
        const mappedName = patients.get(entry.patientId);
        if (mappedName?.trim()) return mappedName.trim();
    }
    if (patients && typeof patients === 'object') {
        const mappedName = (patients as Record<string, string>)[entry.patientId];
        if (mappedName?.trim()) return mappedName.trim();
    }
    return 'Unknown Patient';
}

function getPriorityLabel(priority: QueueEntry['priority']): string {
    switch (priority) {
        case 1: return 'Urgent';
        case 2: return 'High';
        case 3: return 'Normal';
        case 4: return 'Low';
        default: return 'Normal';
    }
}

export function QueuePanel({ roomId, onStartVisit, patients }: QueuePanelProps) {
    const { queue, loading, error, refreshQueue } = useRoomQueue(roomId);

    if (loading && queue.length === 0) {
        return <div className={styles.loading}>Loading queue...</div>;
    }

    if (error) {
        return <div className={styles.error}>Error: {error}</div>;
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h3 className={styles.title}>Patient Queue</h3>
                <button className={styles.refreshButton} onClick={refreshQueue} title="Refresh Queue">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M23 4v6h-6M1 20v-6h6" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                </button>
            </div>

            {queue.length === 0 ? (
                <div className={styles.empty}>No patients waiting for this room.</div>
            ) : (
                <ul className={styles.list}>
                    {queue.map((entry) => {
                        const patientName = resolvePatientName(entry, patients);
                        const priorityLabel = getPriorityLabel(entry.priority);
                        const timeLabel = entry.checkInTime
                            ? new Date(entry.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : 'Walk-in';

                        return (
                            <li key={entry.id} className={styles.item} data-status={entry.status} data-priority={entry.priority}>
                                <div className={styles.info}>
                                    <span className={styles.patientName}>{patientName}</span>
                                    <div className={styles.meta}>
                                        <span className={styles.time}>{timeLabel}</span>
                                        {entry.priority <= 2 && (
                                            <span className={styles.priorityBadge} data-priority={entry.priority}>
                                                {priorityLabel}
                                            </span>
                                        )}
                                        {entry.status === 'called' && (
                                            <span className={styles.statusBadge}>Called</span>
                                        )}
                                    </div>
                                    {entry.notes && (
                                        <span className={styles.notes}>{entry.notes}</span>
                                    )}
                                </div>
                                <button
                                    className={styles.startButton}
                                    onClick={() => onStartVisit(entry)}
                                >
                                    Start Visit
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
