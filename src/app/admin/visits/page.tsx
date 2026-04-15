'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { getVisits, getDoctors, getPatients, approveVisit, getRooms, updateVisitStatus, downloadVisitPrescription, deleteVisit, updateVisitPrescription } from '@/services/api';
import type { Visit, PrescriptionDraft } from '@/types/index';
import type { Doctor, EMRPatient, Room } from '@/types/emr';
import { PrescriptionModal } from '@/components/PrescriptionModal';
import { PrescriptionPreview } from '@/components/PrescriptionPreview';
import styles from './page.module.css';

const STATUS_OPTIONS = ['all', 'pending', 'in_progress', 'completed', 'cancelled'] as const;

type StatusFilter = typeof STATUS_OPTIONS[number];

const STATUS_LABELS: Record<Exclude<StatusFilter, 'all'>, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function VisitsPage() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [patients, setPatients] = useState<EMRPatient[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [patientFilter] = useState<string>('all');
  const [roomFilter] = useState<string>('all');
  const [patientSearch, setPatientSearch] = useState<string>('');
  const [roomSearch, setRoomSearch] = useState<string>('');
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedTab, setExpandedTab] = useState<'details' | 'prescription'>('details');

  const [prescriptionModalOpen, setPrescriptionModalOpen] = useState(false);
  const [editingPrescriptionVisit, setEditingPrescriptionVisit] = useState<Visit | null>(null);
  const [savingPrescription, setSavingPrescription] = useState(false);

  const patientsMap = useMemo(
    () => patients.reduce((acc, p) => ({ ...acc, [p.id]: p }), {} as Record<string, EMRPatient>),
    [patients],
  );

  const doctorsMap = useMemo(
    () => doctors.reduce((acc, d) => ({ ...acc, [d.id]: d }), {} as Record<string, Doctor>),
    [doctors],
  );

  const loadVisits = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const visitParams: { status?: string; patientId?: string; limit?: number } = { limit: 100 };
      if (statusFilter !== 'all') {
        visitParams.status = statusFilter;
      }
      if (patientFilter !== 'all') {
        visitParams.patientId = patientFilter;
      }

      const [visitsData, doctorsData, patientsData, roomsData] = await Promise.all([
        getVisits(visitParams),
        getDoctors(false),
        getPatients(),
        getRooms(),
      ]);

      setVisits(visitsData);
      setDoctors(doctorsData);
      setPatients(patientsData);
      setRooms(roomsData);
    } catch (loadError) {
      console.error('Failed to load visits:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load visits.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, patientFilter]);

  useEffect(() => {
    void loadVisits();
  }, [loadVisits]);

  const filtered = useMemo(() => {
    let result = visits;
    // Room filter by name search
    if (roomSearch.trim() !== '') {
      const q = roomSearch.toLowerCase();
      result = result.filter((v) => {
        const room = rooms.find(r => r.id === v.roomId);
        return room ? room.name.toLowerCase().includes(q) : false;
      });
    } else if (roomFilter !== 'all') {
      result = result.filter((v) => v.roomId === roomFilter);
    }
    // Patient filter by name search (client-side supplement to API filter)
    if (patientSearch.trim() !== '') {
      const q = patientSearch.toLowerCase();
      result = result.filter((v) => {
        const patient = patientsMap[v.patientId];
        return patient ? patient.name.toLowerCase().includes(q) : false;
      });
    }
    return result;
  }, [visits, roomFilter, roomSearch, patientSearch, rooms, patientsMap]);
  function getDoctorName(doctorId: string | null | undefined) {
    if (!doctorId) return '—';
    return doctorsMap[doctorId]?.name ?? `${doctorId.slice(0, 8)}…`;
  }

  function getPatientName(patientId: string) {
    return patientsMap[patientId]?.name ?? '—';
  }

  function getStatusBadgeClass(status: string) {
    switch (status) {
      case 'pending':
        return styles.statusPending;
      case 'in_progress':
        return styles.statusInProgress;
      case 'completed':
        return styles.statusCompleted;
      case 'cancelled':
        return styles.statusCancelled;
      default:
        return styles.statusNeutral;
    }
  }


  async function handleApprove(visit: Visit) {
    if (!visit.summary) {
      setError('Visit cannot be approved until a summary is available.');
      return;
    }

    setApprovingId(visit.id);
    setError(null);

    try {
      await approveVisit(visit.id, visit.summary);
      await loadVisits();
    } catch (approveError) {
      console.error('Failed to approve visit:', approveError);
      setError(approveError instanceof Error ? approveError.message : 'Failed to approve visit.');
    } finally {
      setApprovingId(null);
    }
  }

  async function handleCancelVisit(visitId: string) {
    setApprovingId(visitId);
    setError(null);

    try {
      await updateVisitStatus(visitId, 'cancelled');
      await loadVisits();
    } catch (cancelError) {
      console.error('Failed to cancel visit:', cancelError);
      setError(cancelError instanceof Error ? cancelError.message : 'Failed to cancel visit.');
    } finally {
      setApprovingId(null);
    }
  }

  async function handleDeleteVisit(visitId: string) {
    if (!window.confirm('Are you sure you want to delete this visit? This action cannot be undone.')) {
      return;
    }

    setApprovingId(visitId);
    setError(null);

    try {
      await deleteVisit(visitId);
      await loadVisits();
    } catch (deleteError) {
      console.error('Failed to delete visit:', deleteError);
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete visit.');
    } finally {
      setApprovingId(null);
    }
  }

  function handleEditPrescription(visit: Visit) {
    setEditingPrescriptionVisit(visit);
    setPrescriptionModalOpen(true);
  }

  async function handleSavePrescription(prescriptionDraft: PrescriptionDraft) {
    if (!editingPrescriptionVisit) return;

    setSavingPrescription(true);
    setError(null);

    try {
      await updateVisitPrescription(editingPrescriptionVisit.id, prescriptionDraft);
      // Update the local visit state
      setVisits(prev =>
        prev.map(v =>
          v.id === editingPrescriptionVisit.id && v.summary
            ? {
                ...v,
                summary: {
                  ...v.summary,
                  prescriptionDraft,
                },
              }
            : v
        )
      );
    } catch (saveError) {
      console.error('Failed to save prescription:', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Failed to save prescription.');
      throw saveError;
    } finally {
      setSavingPrescription(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Visit Records</h1>
          <p className={styles.subtitle}>{filtered.length} visits in current view</p>
        </div>
        <button type="button" className={styles.refreshBtn} onClick={() => void loadVisits()}>
          Refresh
        </button>
      </header>

      {error ? (
        <div className="error-msg" role="alert">{error}</div>
      ) : null}

      <div className={styles.filterRow}>
        <select
          className={styles.filterTab}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
        >
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {status === 'all' ? 'All statuses' : STATUS_LABELS[status]}
            </option>
          ))}
        </select>

        <div className={styles.searchFilter}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.searchFilterIcon}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className={styles.searchFilterInput}
            placeholder="Filter by patient…"
            value={patientSearch}
            onChange={(e) => setPatientSearch(e.target.value)}
          />
          {patientSearch && (
            <button className={styles.searchFilterClear} onClick={() => setPatientSearch('')} aria-label="Clear patient filter">✕</button>
          )}
        </div>

        <div className={styles.searchFilter}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.searchFilterIcon}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            className={styles.searchFilterInput}
            placeholder="Filter by room…"
            value={roomSearch}
            onChange={(e) => setRoomSearch(e.target.value)}
          />
          {roomSearch && (
            <button className={styles.searchFilterClear} onClick={() => setRoomSearch('')} aria-label="Clear room filter">✕</button>
          )}
        </div>
      </div>
      {loading ? (
        <div className={styles.loading}>Loading visits…</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>No visits found for this filter.</div>
      ) : (
        <div className={styles.visitList}>
          {filtered.map((visit) => {
            const isExpanded = expandedId === visit.id;

            return (
              <article key={visit.id} className={styles.visitCard}>
                <div className={styles.visitRow} onClick={() => setExpandedId(isExpanded ? null : visit.id)}>
                  <div className={styles.visitLeft}>
                    <div className={styles.patientAvatar}>{getPatientName(visit.patientId).charAt(0)}</div>
                    <div>
                      <div className={styles.patientName}>{getPatientName(visit.patientId)}</div>
                      <div className={styles.visitMeta}>
                        <span>{getDoctorName(visit.doctorId)}</span>
                      </div>
                      {visit.summary?.clinicalSnapshot?.length ? (
                        <div className={styles.factChips}>
                          {visit.summary.clinicalSnapshot.slice(0, 3).map((fact, idx) => (
                            <span key={idx} className={styles.factChip}>
                              {fact.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className={styles.visitRight}>
                    <div className={styles.visitDate}>
                      {new Date(visit.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                    <span
                      className={`${styles.statusBadge} ${getStatusBadgeClass(visit.status)}`}
                    >
                      {STATUS_LABELS[visit.status as Exclude<StatusFilter, 'all'>] ?? visit.status}
                    </span>
                    {visit.status === 'in_progress' && visit.summary && (
                      <>
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.actionBtnAccent}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditPrescription(visit);
                          }}
                        >
                          ✎ Edit Rx
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.actionBtnSuccess}`}
                          disabled={approvingId === visit.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleApprove(visit);
                          }}
                        >
                          {approvingId === visit.id ? 'Approving…' : '✓ Approve'}
                        </button>
                      </>
                    )}
                    {visit.status === 'completed' && visit.summary && (
                      <>
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.actionBtnAccent}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditPrescription(visit);
                          }}
                        >
                          ✎ Edit Rx
                        </button>
                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.actionBtnSecondary}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void downloadVisitPrescription(visit.id, {
                              visit,
                              patient: patientsMap[visit.patientId] ?? null,
                              doctor: visit.doctorId ? doctorsMap[visit.doctorId] ?? null : null,
                              allergies: patientsMap[visit.patientId]?.medicalHistory?.allergies ?? [],
                            });
                          }}
                        >
                          Download Rx
                        </button>
                      </>
                    )}
                    {visit.status === 'in_progress' && (
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.actionBtnWarning}`}
                        disabled={approvingId === visit.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleCancelVisit(visit.id);
                        }}
                      >
                        {approvingId === visit.id ? 'Cancelling…' : 'Cancel Visit'}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                      disabled={approvingId === visit.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteVisit(visit.id);
                      }}
                    >
                      {approvingId === visit.id ? 'Deleting…' : 'Delete'}
                    </button>
                    <svg
                      className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </div>
                </div>

                {isExpanded && visit.summary && (
                  <div className={styles.visitDetail}>
                    {/* Tabs */}
                    <div className={styles.detailTabs}>
                      <button
                        className={`${styles.detailTab} ${expandedTab === 'details' && expandedId === visit.id ? styles.detailTabActive : ''}`}
                        onClick={() => {
                          setExpandedTab('details');
                        }}
                      >
                        Clinical Details
                      </button>
                      {visit.summary.prescriptionDraft && (
                        <button
                          className={`${styles.detailTab} ${expandedTab === 'prescription' && expandedId === visit.id ? styles.detailTabActive : ''}`}
                          onClick={() => {
                            setExpandedTab('prescription');
                          }}
                        >
                          Prescription
                        </button>
                      )}
                    </div>

                    {/* Clinical Details Tab */}
                    {expandedTab === 'details' && (
                      <>
                        {visit.summary.clinicalSnapshot?.length > 0 && (
                          <div className={styles.detailSection}>
                            <div className={styles.factChips}>
                              {visit.summary.clinicalSnapshot.map((fact, idx) => (
                                <span key={idx} className={styles.factChip}>
                                  {fact.label}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {visit.summary.doctorActions?.length > 0 && (
                          <div className={styles.detailSection}>
                            <div className={styles.detailLabel}>Doctor Actions</div>
                            <ul className={styles.actionList}>
                              {visit.summary.doctorActions.map((a, i) => (
                                <li key={i}>{a.text}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}

                    {/* Prescription Tab */}
                    {expandedTab === 'prescription' && visit.summary.prescriptionDraft && (
                      <div className={styles.detailSection}>
                        <PrescriptionPreview
                          draft={visit.summary.prescriptionDraft}
                          patientName={getPatientName(visit.patientId)}
                          doctorName={visit.doctorId ? getDoctorName(visit.doctorId) : undefined}
                          allergies={patientsMap[visit.patientId]?.medicalHistory?.allergies}
                        />
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <PrescriptionModal
        isOpen={prescriptionModalOpen}
        draft={editingPrescriptionVisit?.summary?.prescriptionDraft ?? null}
        patientName={editingPrescriptionVisit ? getPatientName(editingPrescriptionVisit.patientId) : ''}
        onSave={handleSavePrescription}
        onClose={() => {
          setPrescriptionModalOpen(false);
          setEditingPrescriptionVisit(null);
        }}
        isLoading={savingPrescription}
      />
    </div>
  );
}
