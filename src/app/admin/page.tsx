'use client';

import { useEffect, useState } from 'react';

import { useRooms } from '@/contexts/RoomContext';
import { api } from '@/services/api';
// Use concise Patient type (has 'name') matching API return
import { Patient } from '@/types';
// Use Doctor type matching RoomContext/API
import { Doctor } from '@/types/emr';
import styles from './page.module.css';
import Link from 'next/link';

export default function AdminDashboard() {
    const { rooms } = useRooms();
    const [patients, setPatients] = useState<Record<string, Patient>>({});
    const [doctors, setDoctors] = useState<Record<string, Doctor>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadData() {
            try {
                const [patientsData, doctorsData] = await Promise.all([
                    api.getPatients(),
                    api.getDoctors()
                ]);

                // Index by ID
                const patientsMap = patientsData.reduce((acc, p) => {
                    acc[p.id] = p;
                    return acc;
                }, {} as Record<string, Patient>);

                const doctorsMap = doctorsData.reduce((acc, d) => {
                    acc[d.id] = d;
                    return acc;
                }, {} as Record<string, Doctor>);

                setPatients(patientsMap);
                setDoctors(doctorsMap);
            } catch (error) {
                console.error("Failed to load dashboard data", error);
            } finally {
                setLoading(false);
            }
        }

        loadData();
    }, []);

    // Calculate stats
    const totalRooms = rooms.length;
    const occupiedRooms = rooms.filter(r => r.status === 'occupied').length;
    const availableRooms = rooms.filter(r => r.status === 'free').length;
    const offlineRooms = rooms.filter(r => r.status === 'offline').length;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.title}>Dashboard Overview</h1>
                    <p className={styles.subtitle}>Welcome back, Dr. Admin</p>
                </div>
                <div className={styles.date}>
                    {new Date().toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })}
                </div>
            </header>

            {/* Quick Stats */}
            <div className={styles.statsGrid}>
                <div className={styles.statCard}>
                    <div className={styles.statIcon} style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" />
                            <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
                        </svg>
                    </div>
                    <div className={styles.statInfo}>
                        <span className={styles.statLabel}>Total Rooms</span>
                        <span className={styles.statValue}>{totalRooms}</span>
                    </div>
                </div>

                <div className={styles.statCard}>
                    <div className={styles.statIcon} style={{ background: 'var(--color-warning-light)', color: 'var(--color-warning)' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 00-3-3.87" />
                            <path d="M16 3.13a4 4 0 010 7.75" />
                        </svg>
                    </div>
                    <div className={styles.statInfo}>
                        <span className={styles.statLabel}>Occupied</span>
                        <span className={styles.statValue}>{occupiedRooms}</span>
                    </div>
                </div>

                <div className={styles.statCard}>
                    <div className={styles.statIcon} style={{ background: 'var(--color-success-light)', color: 'var(--color-success)' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                            <path d="M22 4L12 14.01l-3-3" />
                        </svg>
                    </div>
                    <div className={styles.statInfo}>
                        <span className={styles.statLabel}>Available</span>
                        <span className={styles.statValue}>{availableRooms}</span>
                    </div>
                </div>

                <div className={styles.statCard}>
                    <div className={styles.statIcon} style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                    </div>
                    <div className={styles.statInfo}>
                        <span className={styles.statLabel}>Offline</span>
                        <span className={styles.statValue}>{offlineRooms}</span>
                    </div>
                </div>
            </div>

            {/* Room Status Grid */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Room Status</h2>
                    <Link href="/admin/rooms" className={styles.viewAll}>View All</Link>
                </div>

                <div className={styles.roomsGrid}>
                    {rooms.map(room => {
                        const patient = room.currentPatientId ? patients[room.currentPatientId] : null;
                        const doctor = room.assignedDoctorId ? doctors[room.assignedDoctorId] : null;

                        return (
                            <div key={room.id} className={`${styles.roomCard} ${styles[room.status]}`}>
                                <div className={styles.roomHeader}>
                                    <h3 className={styles.roomName}>{room.name}</h3>
                                    <span className={`${styles.statusBadge} ${styles[room.status]}`}>
                                        {room.status}
                                    </span>
                                </div>
                                <div className={styles.roomDetails}>
                                    <div className={styles.detailRow}>
                                        <span className={styles.detailLabel}>Doctor</span>
                                        <span className={styles.detailValue}>{doctor?.name || 'Unassigned'}</span>
                                    </div>
                                    <div className={styles.detailRow}>
                                        <span className={styles.detailLabel}>Patient</span>
                                        <span className={styles.detailValue}>{patient?.name || 'Empty'}</span>
                                    </div>
                                </div>
                                <div className={styles.roomFooter}>
                                    <Link href={`/admin/rooms`} className={styles.manageButton}>
                                        Manage
                                    </Link>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        </div>
    );
}
