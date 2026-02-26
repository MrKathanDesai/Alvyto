import React from 'react';
import { Visit } from '@/types';
import { useRoomQueue } from '@/hooks/useRoomQueue';
import styles from './QueuePanel.module.css';

interface QueuePanelProps {
    roomId: string;
    onStartVisit: (visit: Visit) => void;
}

export function QueuePanel({ roomId, onStartVisit }: QueuePanelProps) {
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
                <div className={styles.empty}>No patients scheduled for this room.</div>
            ) : (
                <ul className={styles.list}>
                    {queue.map((visit) => (
                        <li key={visit.id} className={styles.item}>
                            <div className={styles.info}>
                                {/* We might need patient Name here, currently Visit has patientId. 
                                    Ideally backend returns joined data or we fetch patient. 
                                    For MVP, we might just show ID or fetch patient name?
                                    Actually, backend visit response doesn't have patient name currently.
                                    We should probably update backend to return patient name or fetch it.
                                    Let's assume for now we just show ID or "Patient" and fix later.
                                */}
                                <span className={styles.patientName}>Patient ({visit.patientId})</span>
                                <span className={styles.time}>
                                    {visit.createdAt ? new Date(visit.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Scheduled'}
                                </span>
                            </div>
                            <button
                                className={styles.startButton}
                                onClick={() => onStartVisit(visit)}
                            >
                                Start Visit
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
