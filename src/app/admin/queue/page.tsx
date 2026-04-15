'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getQueue,
  getPatients,
  getDoctors,
  getRooms,
  addToQueue,
  updateQueueEntry,
  removeFromQueue,
  autoAssign,
} from '@/services/api';
import { QueueEntry, QueueSummary, EMRPatient, Doctor, Room } from '@/types/emr';
import styles from './page.module.css';

type CheckInFormState = {
  patientId: string;
  doctorId: string;
  roomId: string;
  priority: QueueEntry['priority'];
  notes: string;
  chiefComplaint: string;
};

const INITIAL_FORM: CheckInFormState = {
  patientId: '',
  doctorId: '',
  roomId: '',
  priority: 3,
  notes: '',
  chiefComplaint: '',
};

function getErrorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function getWaitTimeLabel(entry: QueueEntry): string {
  // Use createdAt (when entered queue) instead of checkInTime
  const waitSince = entry.createdAt;
  if (!waitSince) return '--';

  try {
    const waitDate = new Date(waitSince);
    if (Number.isNaN(waitDate.getTime())) return '--';
    
    const ms = Date.now() - waitDate.getTime();
    if (ms < 0) return '--';
    
    const minutes = Math.floor(ms / 60000);
    if (minutes === 0) return '<1m';
    return `${minutes}m`;
  } catch (err) {
    console.error('Error calculating wait time:', err);
    return '--';
  }
}
function getStatusLabel(status: QueueEntry['status']): string {
  switch (status) {
    case 'waiting':
      return 'Waiting';
    case 'called':
      return 'Called';
    case 'in_room':
      return 'In Room';
    case 'done':
      return 'Done';
    case 'left':
      return 'Left';
    default:
      return status;
  }
}

function getPriorityLabel(priority: QueueEntry['priority']): string {
  switch (priority) {
    case 1:
      return 'Urgent';
    case 2:
      return 'High';
    case 3:
      return 'Normal';
    case 4:
      return 'Low';
    default:
      return 'Normal';
  }
}

type AvailabilityTone = 'muted' | 'success' | 'warning' | 'accent' | 'danger';

function getPatientDisplayName(patient: EMRPatient | undefined): string {
  if (!patient) return 'Unknown Patient';
  if (patient.name) return patient.name;

  const firstName = (patient as EMRPatient & { firstName?: string }).firstName;
  const lastName = (patient as EMRPatient & { lastName?: string }).lastName;
  const fallbackName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return fallbackName || 'Unknown Patient';
}

export default function QueuePage() {
  const [queueSummary, setQueueSummary] = useState<QueueSummary | null>(null);
  const [patients, setPatients] = useState<EMRPatient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formState, setFormState] = useState<CheckInFormState>(INITIAL_FORM);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [submittingCheckIn, setSubmittingCheckIn] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [doctorSearch, setDoctorSearch] = useState('');
  const [editingEntry, setEditingEntry] = useState<QueueEntry | null>(null);
  const [editDoctorId, setEditDoctorId] = useState('');
  const [editRoomId, setEditRoomId] = useState('');
  const [editDoctorSearch, setEditDoctorSearch] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const refreshData = useCallback(async () => {
    try {
      const [queueData, patientData, doctorData, roomData] = await Promise.all([
        getQueue(),
        getPatients(),
        getDoctors(),
        getRooms(),
      ]);
      setQueueSummary(queueData);
      setPatients(patientData);
      setDoctors(doctorData);
      setRooms(roomData);
    } catch (error) {
      console.error('Failed to load queue data', error);
      setErrorMessage(getErrorText(error, 'Failed to load queue data. Please refresh and try again.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshData();
    const interval = setInterval(() => {
      void refreshData();
    }, 15000);

    return () => clearInterval(interval);
  }, [refreshData]);

  const patientMap = useMemo<Record<string, EMRPatient>>(
    () =>
      patients.reduce((acc, p) => {
        acc[p.id] = p;
        return acc;
      }, {} as Record<string, EMRPatient>),
    [patients],
  );

  const doctorMap = useMemo<Record<string, Doctor>>(
    () =>
      doctors.reduce((acc, doctor) => {
        acc[doctor.id] = doctor;
        return acc;
      }, {} as Record<string, Doctor>),
    [doctors],
  );

  const roomMap = useMemo<Record<string, Room>>(
    () =>
      rooms.reduce((acc, room) => {
        acc[room.id] = room;
        return acc;
      }, {} as Record<string, Room>),
    [rooms],
  );

  const idleRooms = useMemo(() => rooms.filter((room) => room.status === 'idle'), [rooms]);

  const activeEntries = useMemo(
    () => (queueSummary?.entries ?? []).filter((entry) => entry.status !== 'done' && entry.status !== 'left'),
    [queueSummary],
  );

  const filteredPatients = useMemo(
    () =>
      patientSearch.trim() === ''
        ? patients
        : patients.filter((p) => {
            const name = getPatientDisplayName(p).toLowerCase();
            const mrn = (p.mrn ?? '').toLowerCase();
            const q = patientSearch.toLowerCase();
            return name.includes(q) || mrn.includes(q);
          }),
    [patients, patientSearch],
  );

  const filteredDoctors = useMemo(
    () => {
      const searched = doctorSearch.trim() === ''
        ? doctors
        : doctors.filter((d) => d.name.toLowerCase().includes(doctorSearch.toLowerCase()));
      // Show active doctors first, then inactive
      return searched.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    },
    [doctors, doctorSearch],
  );

  const getAvailabilityBadge = (doctor: Doctor): { label: string; tone: AvailabilityTone } => {
    if (!doctor.isActive) return { label: 'Inactive', tone: 'muted' };
    switch (doctor.currentStatus) {
      case 'available':
        return { label: 'Available', tone: 'success' };
      case 'in_session':
        return { label: 'In Session', tone: 'warning' };
      case 'break':
        return { label: 'On Break', tone: 'accent' };
      case 'off_duty':
        return { label: 'Off Duty', tone: 'danger' };
      default:
        return { label: 'Unknown', tone: 'muted' };
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setFormState(INITIAL_FORM);
    setPatientSearch('');
    setDoctorSearch('');
  };
  const handleCheckIn = async () => {
    if (!formState.patientId) return;

    setSubmittingCheckIn(true);
    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      await addToQueue({
        patientId: formState.patientId,
        priority: formState.priority,
        notes: [formState.chiefComplaint, formState.notes].filter(Boolean).join(' | ') || undefined,
        doctorId: formState.doctorId || undefined,
        roomId: formState.roomId || undefined,
      });
      closeModal();
      setSuccessMessage('Patient checked into queue.');
      await refreshData();
    } catch (error) {
      console.error('Failed to check in patient', error);
      setErrorMessage(getErrorText(error, 'Failed to check in patient. Please try again.'));
    } finally {
      setSubmittingCheckIn(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingEntry) return;
    setSavingEdit(true);
    try {
      setErrorMessage(null);
      await updateQueueEntry(editingEntry.id, {
        doctorId: editDoctorId || undefined,
        roomId: editRoomId || undefined,
      });
      setSuccessMessage('Queue entry updated.');
      setEditingEntry(null);
      await refreshData();
    } catch (error) {
      setErrorMessage(getErrorText(error, 'Failed to update queue entry.'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleAutoAssign = async (entry: QueueEntry) => {
    setActioningId(entry.id);
    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      const updatedEntry = await autoAssign({ queueEntryId: entry.id });
      const assignedRoomName = updatedEntry.roomId ? roomMap[updatedEntry.roomId]?.name ?? updatedEntry.roomId : 'Unassigned';
      const assignedDoctorName = updatedEntry.doctorId ? doctorMap[updatedEntry.doctorId]?.name ?? updatedEntry.doctorId : 'Unassigned';
      setSuccessMessage(`Auto-assigned to ${assignedRoomName} with Dr. ${assignedDoctorName}.`);
      await refreshData();
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (msg.toLowerCase().includes('no available doctors')) {
        setErrorMessage('No doctors are marked available today. Mark a doctor as available or assign one manually using the Edit button.');
      } else if (msg.toLowerCase().includes('no available rooms')) {
        setErrorMessage('No idle rooms available. Free up a room or assign one manually using the Edit button.');
      } else {
        setErrorMessage(getErrorText(error, 'Auto-assign failed. Please try again or assign manually.'));
      }
    } finally {
      setActioningId(null);
    }
  };
  const handleCall = async (entryId: string) => {
    setActioningId(entryId);
    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      await updateQueueEntry(entryId, { status: 'called' });
      await refreshData();
    } catch (error) {
      console.error('Failed to call queue entry', error);
      setErrorMessage(getErrorText(error, 'Failed to call patient. Please try again.'));
    } finally {
      setActioningId(null);
    }
  };

  const handleInRoom = async (entryId: string) => {
    setActioningId(entryId);
    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      await updateQueueEntry(entryId, { status: 'in_room' });
      await refreshData();
    } catch (error) {
      console.error('Failed to move queue entry in room', error);
      setErrorMessage(getErrorText(error, 'Failed to mark patient as in room. Please try again.'));
    } finally {
      setActioningId(null);
    }
  };

  const handleDone = async (entryId: string) => {
    setActioningId(entryId);
    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      await updateQueueEntry(entryId, { status: 'done' });
      await refreshData();
    } catch (error) {
      console.error('Failed to mark queue entry as done', error);
      setErrorMessage(getErrorText(error, 'Failed to mark queue entry as done. Please try again.'));
    } finally {
      setActioningId(null);
    }
  };

  const handleRemove = async (entryId: string) => {
    setActioningId(entryId);
    try {
      setErrorMessage(null);
      setSuccessMessage(null);
      await removeFromQueue(entryId);
      await refreshData();
    } catch (error) {
      console.error('Failed to remove queue entry', error);
      setErrorMessage(getErrorText(error, 'Failed to remove queue entry. Please try again.'));
    } finally {
      setActioningId(null);
    }
  };
  if (loading) {
    return <div className={styles.loading}>Loading queue...</div>;
  }

  return (
    <div className={styles.page}>
      {errorMessage && (
        <div className={styles.errorBanner}>
          <span>{errorMessage}</span>
          <button type="button" className={styles.actionBtn} onClick={() => setErrorMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      {successMessage && (
        <div className={`${styles.errorBanner} ${styles.successBanner}`}>
          <span>{successMessage}</span>
          <button type="button" className={`${styles.actionBtn} ${styles.successDismissBtn}`} onClick={() => setSuccessMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Waiting Room Queue</h1>
          <p className={styles.subtitle}>
            {queueSummary?.totalWaiting ?? 0} waiting • {queueSummary?.totalInRoom ?? 0} in room
          </p>
        </div>
        <button className={styles.addBtn} onClick={() => setIsModalOpen(true)}>
          + Check In Patient
        </button>
      </header>

      {activeEntries.length === 0 ? (
        <div className={styles.emptyState}>No active queue entries right now.</div>
      ) : (
        <div className={styles.queueTable}>
          <table>
            <thead className={styles.tableHeader}>
              <tr>
                <th>Patient</th>
                <th>Priority</th>
                <th>Doctor</th>
                <th>Room</th>
                <th>Status</th>
                <th>Wait</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeEntries.map((entry) => {
                const patient = patientMap[entry.patientId];
                const doctor = entry.doctorId ? doctorMap[entry.doctorId] : null;
                const room = entry.roomId ? roomMap[entry.roomId] : null;
                const patientName = entry.patient_name?.trim() || getPatientDisplayName(patient);
                const canAutoAssign = entry.status === 'waiting' || entry.status === 'called';
                const canEdit = entry.status === 'waiting' || entry.status === 'called' || entry.status === 'in_room';
                const isActioningRow = actioningId === entry.id;
                return (
                  <tr key={entry.id} className={styles.tableRow} data-status={entry.status}>
                    <td>
                      <div className={styles.patientCell}>
                        <div className={styles.patientAvatar}>{patientName.charAt(0).toUpperCase() || '?'}</div>
                        <div>
                          <div className={styles.patientName}>{patientName}</div>
                          <div className={styles.patientMrn}>{patient?.mrn ?? 'MRN unavailable'}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={styles.priorityBadge} data-priority={entry.priority}>
                        {getPriorityLabel(entry.priority)}
                      </span>
                    </td>
                    <td className={styles.assignCell}>{doctor?.name ?? 'Unassigned'}</td>
                    <td className={styles.assignCell}>{room?.name ?? 'Unassigned'}</td>
                    <td>
                      <span className={styles.statusBadge} data-status={entry.status}>
                        {getStatusLabel(entry.status)}
                      </span>
                    </td>
                    <td>
                      <span className={styles.waitTime}>{getWaitTimeLabel(entry)}</span>
                    </td>
                    <td className={styles.actionsCell}>
                      <div className={styles.actions}>
                        {canEdit && (
                          <button
                            className={styles.actionBtn}
                            onClick={() => {
                              setEditingEntry(entry);
                              setEditDoctorId(entry.doctorId ?? '');
                              setEditRoomId(entry.roomId ?? '');
                              setEditDoctorSearch(entry.doctorId ? (doctorMap[entry.doctorId]?.name ?? '') : '');
                            }}
                            disabled={isActioningRow}
                          >
                            Edit
                          </button>
                        )}
                        {canAutoAssign && (
                          <button
                            className={styles.actionBtn}
                            onClick={() => void handleAutoAssign(entry)}
                            disabled={isActioningRow}
                          >
                            {isActioningRow ? 'Auto-Assign…' : 'Auto-Assign'}
                          </button>
                        )}
                        {entry.status === 'waiting' && (
                          <button className={styles.actionBtn} onClick={() => void handleCall(entry.id)} disabled={isActioningRow}>
                            {isActioningRow ? 'Calling…' : 'Call'}
                          </button>
                        )}
                        {entry.status === 'called' && (
                          <button className={styles.actionBtn} onClick={() => void handleInRoom(entry.id)} disabled={isActioningRow}>
                            {isActioningRow ? 'Updating…' : 'In Room'}
                          </button>
                        )}
                        {entry.status === 'in_room' && (
                          <button className={styles.actionBtn} onClick={() => void handleDone(entry.id)} disabled={isActioningRow}>
                            {isActioningRow ? 'Completing…' : 'Complete'}
                          </button>
                        )}
                        <button className={styles.removeBtn} onClick={() => void handleRemove(entry.id)} disabled={isActioningRow}>
                          {isActioningRow ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {isModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h2 className={styles.modalTitle}>Check In Patient</h2>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="patientSearch">
                Patient
              </label>
              <input
                id="patientSearch"
                className={styles.input}
                type="text"
                placeholder="Search by name or MRN…"
                value={patientSearch}
                onChange={(e) => {
                  setPatientSearch(e.target.value);
                  setFormState((prev) => ({ ...prev, patientId: '' }));
                }}
                autoComplete="off"
              />
              {patientSearch.trim() !== '' && !formState.patientId && (
                <div className={styles.searchDropdown}>
                  {filteredPatients.length === 0 ? (
                    <div className={styles.searchDropdownEmpty}>No patients found</div>
                  ) : (
                    filteredPatients.map((patient) => (
                      <div
                        key={patient.id}
                        className={[styles.searchDropdownItem, formState.patientId === patient.id ? styles.searchDropdownItemSelected : ''].join(' ')}
                        onClick={() => {
                          setFormState((prev) => ({ ...prev, patientId: patient.id }));
                          setPatientSearch(getPatientDisplayName(patient) + ' — ' + patient.mrn);
                        }}
                      >
                        <span className={styles.searchDropdownName}>{getPatientDisplayName(patient)}</span>
                        <span className={styles.searchDropdownMeta}>{patient.mrn}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
              {formState.patientId && (
                <div className={styles.selectedBadge}>
                  ✓ {getPatientDisplayName(patients.find((p) => p.id === formState.patientId))} selected
                </div>
              )}
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="doctorSearch">
                Doctor (optional)
              </label>
              <input
                id="doctorSearch"
                className={styles.input}
                type="text"
                placeholder="Search by name…"
                value={doctorSearch}
                onChange={(e) => {
                  setDoctorSearch(e.target.value);
                  setFormState((prev) => ({ ...prev, doctorId: '' }));
                }}
                autoComplete="off"
              />
              {doctorSearch.trim() !== '' && (
                <div className={styles.searchDropdown}>
                  <div
                    className={[styles.searchDropdownItem, !formState.doctorId ? styles.searchDropdownItemSelected : ''].join(' ')}
                    onClick={() => {
                      setFormState((prev) => ({ ...prev, doctorId: '' }));
                      setDoctorSearch('');
                    }}
                  >
                    <span className={styles.searchDropdownName}>Unassigned</span>
                  </div>
                  {filteredDoctors.length === 0 ? (
                    <div className={styles.searchDropdownEmpty}>No doctors found</div>
                   ) : (
                     filteredDoctors.map((doctor) => {
                       const badge = getAvailabilityBadge(doctor);
                       return (
                        <div
                          key={doctor.id}
                          className={[styles.searchDropdownItem, formState.doctorId === doctor.id ? styles.searchDropdownItemSelected : ''].join(' ')}
                         onClick={() => {
                           setFormState((prev) => ({ ...prev, doctorId: doctor.id }));
                           setDoctorSearch(doctor.name);
                         }}
                          data-dim={doctor.isActive && doctor.currentStatus === 'available' ? 'false' : 'true'}
                        >
                          <span className={styles.searchDropdownName}>{doctor.name}</span>
                          <span className={styles.searchDropdownMeta}>
                            {doctor.specialty && `${doctor.specialty} • `}
                            <span className={`${styles.availabilityBadge} ${styles[`availability${badge.tone.charAt(0).toUpperCase()}${badge.tone.slice(1)}`]}`}>
                              {badge.label}
                            </span>
                          </span>
                        </div>
                       );
                     })
                   )}
                </div>
              )}
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="roomId">
                Room (idle only)
              </label>
              <select
                id="roomId"
                className={styles.select}
                value={formState.roomId}
                onChange={(e) => setFormState((prev) => ({ ...prev, roomId: e.target.value }))}
              >
                <option value="">Unassigned</option>
                {idleRooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="priority">
                Priority
              </label>
              <select
                id="priority"
                className={styles.select}
                value={String(formState.priority)}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, priority: Number(e.target.value) as QueueEntry['priority'] }))
                }
              >
                <option value="1">1 — Urgent</option>
                <option value="2">2 — High</option>
                <option value="3">3 — Normal</option>
                <option value="4">4 — Low</option>
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="chiefComplaint">
                Chief Complaint
              </label>
              <input
                id="chiefComplaint"
                className={styles.input}
                value={formState.chiefComplaint}
                onChange={(e) => setFormState((prev) => ({ ...prev, chiefComplaint: e.target.value }))}
                placeholder="Primary reason for visit"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="notes">
                Notes
              </label>
              <input
                id="notes"
                className={styles.input}
                value={formState.notes}
                onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Optional notes"
              />
            </div>

            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={closeModal}>
                Cancel
              </button>
              <button
                className={styles.saveBtn}
                onClick={() => void handleCheckIn()}
                disabled={submittingCheckIn || !formState.patientId}
              >
                {submittingCheckIn ? 'Checking in…' : 'Check In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingEntry && (
        <div className={styles.modalOverlay}>
          <div className={styles.modal}>
            <h2 className={styles.modalTitle}>Edit Queue Entry</h2>
            <p className={styles.editEntryHint}>
              {editingEntry.patient_name ?? getPatientDisplayName(patientMap[editingEntry.patientId])}
            </p>

            <div className={styles.field}>
              <label className={styles.label}>Doctor</label>
              <input
                className={styles.input}
                type="text"
                placeholder="Search by name…"
                value={editDoctorSearch}
                onChange={(e) => {
                  setEditDoctorSearch(e.target.value);
                  setEditDoctorId('');
                }}
                autoComplete="off"
              />
              {editDoctorSearch.trim() !== '' && (
                <div className={styles.searchDropdown}>
                  <div
                    className={[styles.searchDropdownItem, !editDoctorId ? styles.searchDropdownItemSelected : ''].join(' ')}
                    onClick={() => {
                      setEditDoctorId('');
                      setEditDoctorSearch('');
                    }}
                  >
                    <span className={styles.searchDropdownName}>Unassigned</span>
                  </div>
                   {doctors
                     .filter((d) => d.name.toLowerCase().includes(editDoctorSearch.toLowerCase()))
                     .map((doctor) => {
                       const badge = getAvailabilityBadge(doctor);
                       return (
                        <div
                          key={doctor.id}
                          className={[styles.searchDropdownItem, editDoctorId === doctor.id ? styles.searchDropdownItemSelected : ''].join(' ')}
                         onClick={() => {
                           setEditDoctorId(doctor.id);
                           setEditDoctorSearch(doctor.name);
                         }}
                          data-dim={doctor.isActive && doctor.currentStatus === 'available' ? 'false' : 'true'}
                        >
                          <span className={styles.searchDropdownName}>{doctor.name}</span>
                          <span className={styles.searchDropdownMeta}>
                            {doctor.specialty && `${doctor.specialty} • `}
                            <span className={`${styles.availabilityBadge} ${styles[`availability${badge.tone.charAt(0).toUpperCase()}${badge.tone.slice(1)}`]}`}>
                              {badge.label}
                            </span>
                          </span>
                        </div>
                       );
                     })}
                </div>
              )}
              {editDoctorId && <div className={styles.selectedBadge}>✓ {doctorMap[editDoctorId]?.name} selected</div>}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="editRoomId">
                Room
              </label>
              <select id="editRoomId" className={styles.select} value={editRoomId} onChange={(e) => setEditRoomId(e.target.value)}>
                <option value="">Unassigned</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                    {room.status !== 'idle' ? ` (${room.status})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={() => setEditingEntry(null)}>
                Cancel
              </button>
              <button className={styles.saveBtn} onClick={() => void handleSaveEdit()} disabled={savingEdit}>
                {savingEdit ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
