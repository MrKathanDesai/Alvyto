'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getPatients, getQueue, getRoomsWithStatus } from '@/services/api';
import type { EMRPatient, QueueSummary, RoomStatus } from '@/types/emr';

import styles from './page.module.css';

function getStatusLabel(status: string): string {
  if (status === 'idle') return 'Idle';
  if (status === 'in_use') return 'In Use';
  if (status === 'cleaning') return 'Cleaning';
  if (status === 'offline') return 'Offline';
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getStatusTone(status: string): 'Idle' | 'InUse' | 'Cleaning' | 'Offline' {
  if (status === 'idle') return 'Idle';
  if (status === 'in_use') return 'InUse';
  if (status === 'cleaning') return 'Cleaning';
  return 'Offline';
}

function formatQueueStatus(status: string): string {
  return status
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getWaitMinutes(checkInTime: string): number {
  const elapsedMs = Date.now() - new Date(checkInTime).getTime();
  return Math.max(0, Math.floor(elapsedMs / 60000));
}

export default function AdminDashboard() {
  const [rooms, setRooms] = useState<RoomStatus[]>([]);
  const [queue, setQueue] = useState<QueueSummary | null>(null);
  const [patients, setPatients] = useState<EMRPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDashboardData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);

    try {
      setError(null);
      const [roomData, queueData, patientData] = await Promise.all([
        getRoomsWithStatus(),
        getQueue(),
        getPatients(),
      ]);
      setRooms(roomData);
      setQueue(queueData);
      setPatients(patientData);
      setLastUpdated(new Date());
    } catch (loadError) {
      console.error('Failed to refresh admin dashboard:', loadError);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
      if (!silent) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();

    const intervalId = setInterval(() => {
      loadDashboardData(true);
    }, 15000);

    return () => clearInterval(intervalId);
  }, [loadDashboardData]);

  const stats = useMemo(() => {
    const totalRooms = rooms.length;
    const inUseRooms = rooms.filter(
      (room) => room.room.status === 'in_use',
    ).length;
    const availableRooms = rooms.filter(
      (room) => room.room.status === 'idle',
    ).length;

    return {
      totalRooms,
      inUseRooms,
      availableRooms,
      waiting: queue?.totalWaiting ?? 0,
      inRoom: queue?.totalInRoom ?? 0,
    };
  }, [rooms, queue]);

  const queuePreview = useMemo(() => queue?.entries.slice(0, 8) ?? [], [queue]);

  const patientMap = useMemo(
    () =>
      patients.reduce<Record<string, EMRPatient>>((acc, patient) => {
        acc[patient.id] = patient;
        return acc;
      }, {}),
    [patients],
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Admin Dashboard</h1>
          <p className={styles.subtitle}>
            Live room utilization and queue flow overview
          </p>
        </div>

        <div>
          <button
            type="button"
            className={styles.refreshBtn}
            onClick={() => loadDashboardData()}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <p className={styles.subtitle}>
            Last updated:{' '}
            {lastUpdated
              ? lastUpdated.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
              : '—'}
          </p>
        </div>
      </header>

      {error ? (
        <button
          type="button"
          onClick={() => setError(null)}
          className={styles.errorBanner}
        >
          {error}
        </button>
      ) : null}

      <div className={styles.statsRow}>
        <div className={styles.stat}>
          <div className={styles.statNum}>{stats.totalRooms}</div>
          <div className={styles.statLabel}>Total Rooms</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statNum}>{stats.inUseRooms}</div>
          <div className={styles.statLabel}>In Use</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statNum}>{stats.availableRooms}</div>
          <div className={styles.statLabel}>Available</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statNum}>{stats.waiting}</div>
          <div className={styles.statLabel}>Waiting</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statNum}>{stats.inRoom}</div>
          <div className={styles.statLabel}>In Room</div>
        </div>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Rooms</h2>
          <Link href="/admin/rooms" className={styles.sectionLink}>
            Manage Rooms
          </Link>
        </div>

        {loading ? (
          <div className={styles.loadingGrid}>
            {Array.from({ length: 6 }).map((_, idx) => (
              <div key={idx} className={styles.roomCardSkeleton} />
            ))}
          </div>
        ) : (
          <div className={styles.roomGrid}>
            {rooms.map((roomStatus) => {
              const room = roomStatus.room;
              const statusTone = getStatusTone(room.status);
              const statusLabel = getStatusLabel(room.status);
              const patient = roomStatus.currentPatient;
              const doctor = roomStatus.assignedDoctor;

              return (
                <article key={room.id} className={styles.roomCard}>
                  <div className={styles.roomCardHeader}>
                    <div className={styles.roomNameRow}>
                      <span
                        className={`${styles.statusDot} ${styles[`statusDot${statusTone}`]}`}
                        aria-hidden="true"
                      />
                      <div>
                        <div className={styles.roomName}>{room.name}</div>
                        <div className={styles.roomFloor}>
                          {room.floor ? `Floor ${room.floor}` : 'Floor —'}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`${styles.statusBadge} ${styles[`statusBadge${statusTone}`]}`}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  {patient ? (
                    <div className={styles.roomPatient}>
                      <div className={styles.patientAvatar}>{patient.name.charAt(0)}</div>
                      <div className={styles.patientInfo}>
                        <div className={styles.patientName}>{patient.name}</div>
                        <div className={styles.patientMrn}>MRN: {patient.mrn}</div>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.roomEmpty}>No patient in room</div>
                  )}

                  <div className={styles.roomDoctor}>
                    <span className={styles.doctorDot} aria-hidden="true" />
                    <div>
                      <div className={styles.doctorName}>
                        {doctor ? doctor.name : 'No doctor assigned'}
                      </div>
                      <div className={styles.doctorSpec}>
                        {doctor?.specialty ?? 'Specialty unavailable'}
                      </div>
                    </div>
                  </div>

                  <div className={styles.roomFooter}>
                    {roomStatus.queueLength > 0 ? (
                      <span className={styles.queueBadge}>
                        {roomStatus.queueLength} waiting
                      </span>
                    ) : (
                      <span className={styles.queueBadge}>0 waiting</span>
                    )}
                    <span className={styles.nextPatient}>
                      Next: {roomStatus.nextPatient?.name ?? '—'}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Waiting Room</h2>
          <Link href="/admin/queue" className={styles.sectionLink}>
            Full Queue
          </Link>
        </div>

        {queuePreview.length === 0 ? (
          <div className={styles.emptyQueue}>No queue entries right now.</div>
        ) : (
          <div className={styles.queueList}>
            {queuePreview.map((entry, idx) => {
              const patient = patientMap[entry.patientId];
              const patientName =
                [patient?.firstName, patient?.lastName].filter(Boolean).join(' ') ||
                patient?.name ||
                'Unknown Patient';

              return (
                <div key={entry.id} className={styles.queueRow}>
                  <div className={styles.queuePos}>#{entry.position ?? idx + 1}</div>
                  <div className={styles.queuePatient}>{patientName}</div>
                  <div className={styles.queueStatus}>{formatQueueStatus(entry.status)}</div>
                  <div className={styles.queueWait}>{getWaitMinutes(entry.checkInTime)} min</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
