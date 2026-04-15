'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Calendar as BigCalendar, dateFnsLocalizer, SlotInfo } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import {
  getAppointments,
  getPatients,
  getDoctors,
  getRooms,
  createAppointment,
  checkInAppointment,
  updateAppointment,
} from '@/services/api';
import { Appointment, EMRPatient, Doctor, Room } from '@/types/emr';
import styles from './page.module.css';
import 'react-big-calendar/lib/css/react-big-calendar.css';

const locales = { 'en-US': enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek,
  getDay,
  locales,
});

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  appointment: Appointment;
  status: string;
  patientName: string;
  doctorName: string;
  roomName: string;
  complaint: string;
}

const APPOINTMENT_TYPES = [
  'Consultation', 'Follow-up', 'Examination', 'Cleaning', 
  'Extraction', 'Filling', 'X-Ray', 'Other'
];

type CalendarView = 'month' | 'week' | 'day' | 'agenda';

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  checked_in: 'Checked In',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
};

const APPOINTMENT_STATUS_STYLES: Record<string, { backgroundColor: string; color: string; borderColor: string; borderWidth?: number }> = {
  scheduled: { backgroundColor: 'var(--surface)', color: 'var(--text-2)', borderColor: 'var(--border-2)' },
  checked_in: { backgroundColor: 'var(--blue-bg)', color: 'var(--blue)', borderColor: 'var(--blue-primary)' },
  in_progress: { backgroundColor: 'var(--violet-bg)', color: 'var(--violet)', borderColor: 'var(--violet)' },
  completed: { backgroundColor: 'var(--green-bg)', color: 'var(--green)', borderColor: 'var(--green)' },
  cancelled: { backgroundColor: 'var(--red-bg)', color: 'var(--red)', borderColor: 'var(--red)' },
  no_show: { backgroundColor: 'var(--amber-bg)', color: 'var(--amber)', borderColor: 'var(--amber)' },
};

export default function SchedulePage() {
  const [view, setView] = useState<CalendarView>('day');
  const [date, setDate] = useState(new Date());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patients, setPatients] = useState<EMRPatient[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modal states
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [checkingIn, setCheckingIn] = useState(false);

  // Form states
  const [formData, setFormData] = useState({
    patientId: '',
    doctorId: '',
    roomId: '',
    date: '',
    time: '09:00',
    duration: '30',
    type: 'Consultation',
    notes: ''
  });
  const [apptPatientSearch, setApptPatientSearch] = useState('');
  const [apptDoctorSearch, setApptDoctorSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pts, drs, rms, apts] = await Promise.all([
        getPatients(),
        getDoctors(),
        getRooms(),
        getAppointments({})
      ]);
      setPatients(pts);
      setDoctors(drs);
      setRooms(rms);
      setAppointments(apts);
    } catch (err) {
      console.error('Failed to load schedule data', err);
      setError('Failed to load schedule data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { 
    void loadData(); 
  }, [loadData]);

  const filteredApptPatients = useMemo(
    () =>
      apptPatientSearch.trim() === ''
        ? patients
        : patients.filter((p) =>
            (p.name ?? '').toLowerCase().includes(apptPatientSearch.toLowerCase())
          ),
    [patients, apptPatientSearch],
  );

  const filteredApptDoctors = useMemo(
    () =>
      apptDoctorSearch.trim() === ''
        ? doctors
        : doctors.filter((d) =>
            d.name.toLowerCase().includes(apptDoctorSearch.toLowerCase())
          ),
    [doctors, apptDoctorSearch],
  );

  const addMinutes = (date: Date, minutes: number) => {
    return new Date(date.getTime() + minutes * 60000);
  };

  const patientNameById = useMemo(() => {
    const map = new Map<string, string>();
    patients.forEach((p) => {
      const name = `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || p.name || 'Unknown Patient';
      map.set(p.id, name);
    });
    return map;
  }, [patients]);

  const doctorNameById = useMemo(() => {
    const map = new Map<string, string>();
    doctors.forEach((d) => map.set(d.id, d.name || 'Unassigned Doctor'));
    return map;
  }, [doctors]);

  const roomNameById = useMemo(() => {
    const map = new Map<string, string>();
    rooms.forEach((r) => map.set(r.id, r.name || 'Unassigned Room'));
    return map;
  }, [rooms]);

  // Convert appointments to calendar events
  const events: CalendarEvent[] = useMemo(
    () =>
      appointments.map((apt) => ({
        id: apt.id,
        title: `${patientNameById.get(apt.patientId) ?? 'Unknown Patient'} - ${apt.appointmentType || 'Appointment'}`,
        start: new Date(apt.scheduledAt),
        end: addMinutes(new Date(apt.scheduledAt), apt.durationMinutes),
        appointment: apt,
        status: apt.status,
        patientName: patientNameById.get(apt.patientId) ?? 'Unknown Patient',
        doctorName: apt.doctorId ? (doctorNameById.get(apt.doctorId) ?? 'Unassigned Doctor') : 'Unassigned Doctor',
        roomName: apt.roomId ? (roomNameById.get(apt.roomId) ?? 'No Room') : 'No Room',
        complaint: apt.chiefComplaint || apt.notes || '',
      })),
    [appointments, patientNameById, doctorNameById, roomNameById],
  );

  const visibleRoster = useMemo(() => {
    return events
      .filter((event) => format(event.start, 'yyyy-MM-dd') === format(date, 'yyyy-MM-dd'))
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [events, date]);

  const EventCard = ({ event }: { event: CalendarEvent }) => {
    return (
      <div className={styles.eventCard} title={`${event.patientName} • ${event.doctorName} • ${event.roomName}`}>
        <div className={styles.eventPatient}>{event.patientName}</div>
        <div className={styles.eventMeta}>
          <span className={styles.eventDoctor}>{event.doctorName}</span>
          <span className={styles.eventDivider}>•</span>
          <span>{event.roomName}</span>
        </div>
      </div>
    );
  };

  const handleSelectSlot = (slotInfo: SlotInfo) => {
    setFormData(prev => ({
      ...prev,
      date: format(slotInfo.start, 'yyyy-MM-dd'),
      time: format(slotInfo.start, 'HH:mm'),
    }));
    setShowCreate(true);
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    setSelectedEvent(event);
  };

  const handleCreate = async () => {
    setCreateError(null);

    if (!formData.patientId || !formData.doctorId || !formData.date || !formData.time) {
      setCreateError('Please select patient, doctor, date, and time.');
      return;
    }

    setCreating(true);
    try {
      await createAppointment({
        patientId: formData.patientId,
        doctorId: formData.doctorId,
        roomId: formData.roomId || undefined,
        scheduledAt: `${formData.date}T${formData.time}:00`,
        durationMinutes: parseInt(formData.duration) || 30,
        appointmentType: formData.type,
        chiefComplaint: formData.notes || undefined,
      });
      setShowCreate(false);
      setApptPatientSearch('');
      setApptDoctorSearch('');
      setFormData({
        patientId: '',
        doctorId: '',
        roomId: '',
        date: '',
        time: '09:00',
        duration: '30',
        type: 'Consultation',
        notes: ''
      });
      await loadData();
    } catch (err) {
      console.error('Failed to create appointment', err);
      setCreateError('Failed to create appointment. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleCheckIn = async () => {
    if (!selectedEvent) return;

    setCheckingIn(true);
    setError(null);
    try {
      await checkInAppointment(selectedEvent.appointment.id);
      await loadData();
      setSelectedEvent(null);
    } catch (err) {
      console.error('Failed to check in appointment', err);
      setError('Failed to check in appointment. Please try again.');
    } finally {
      setCheckingIn(false);
    }
  };

  const handleMarkNoShow = async () => {
    if (!selectedEvent) return;
    setCheckingIn(true);
    setError(null);
    try {
      await updateAppointment(selectedEvent.appointment.id, { status: 'no_show' });
      await loadData();
      setSelectedEvent(null);
    } catch (err) {
      console.error('Failed to mark no-show', err);
      setError('Failed to mark appointment as no-show. Please try again.');
    } finally {
      setCheckingIn(false);
    }
  };

  const eventStyleGetter = (event: CalendarEvent) => {
    const style = APPOINTMENT_STATUS_STYLES[event.status] ?? APPOINTMENT_STATUS_STYLES.scheduled;

    return {
      style: {
        backgroundColor: style.backgroundColor,
        borderRadius: '6px',
        color: style.color,
        border: `${style.borderWidth ?? 1}px solid ${style.borderColor}`,
        display: 'block',
        fontSize: '0.75rem',
        padding: '2px 4px',
      }
    };
  };
  if (loading && appointments.length === 0) {
    return <div className={styles.loading}>Loading Schedule...</div>;
  }

  return (
    <div className={styles.container}>
      {error && (
        <div className="error-msg" role="alert">{error}</div>
      )}

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Appointment Schedule</h1>
          <p className={styles.subtitle}>Manage clinic appointments and availability</p>
        </div>
        <button 
          className={styles.addButton}
          onClick={() => {
            setFormData({
              patientId: '',
              doctorId: '',
              roomId: '',
              date: format(new Date(), 'yyyy-MM-dd'),
              time: '09:00',
              duration: '30',
              type: 'Consultation',
              notes: ''
            });
            setShowCreate(true);
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Appointment
        </button>
      </header>

      <div className={styles.calendarWrapper}>
        <div className={styles.rosterBar}>
          <div>
            <h2 className={styles.rosterTitle}>Daily Roster</h2>
            <p className={styles.rosterSubtitle}>{format(date, 'EEEE, MMM d')}</p>
          </div>
          <div className={styles.rosterCount}>{visibleRoster.length} appointments</div>
        </div>

        <div className={styles.rosterList}>
          {visibleRoster.length === 0 ? (
            <div className={styles.rosterEmpty}>No appointments on this date.</div>
          ) : (
            visibleRoster.map((event) => (
              <button
                key={event.id}
                type="button"
                className={styles.rosterItem}
                onClick={() => handleSelectEvent(event)}
              >
                <div className={styles.rosterTime}>
                  <span>{format(event.start, 'HH:mm')}</span>
                  <span className={styles.rosterDuration}>{event.appointment.durationMinutes}m</span>
                </div>
                <div className={styles.rosterDetails}>
                  <div className={styles.rosterPatient}>{event.patientName}</div>
                  <div className={styles.rosterMeta}>{event.doctorName} • {event.roomName}</div>
                  {event.complaint && <div className={styles.rosterComplaint}>{event.complaint}</div>}
                </div>
                <span className={styles.rosterStatus} data-status={event.status}>
                  {APPOINTMENT_STATUS_LABELS[event.status] ?? event.status}
                </span>
              </button>
            ))
          )}
        </div>

        <BigCalendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          view={view}
          onView={(v) => setView(v as CalendarView)}
          date={date}
          onNavigate={setDate}
          onSelectSlot={handleSelectSlot}
          onSelectEvent={handleSelectEvent}
          selectable
          popup
          eventPropGetter={eventStyleGetter}
          components={{ event: EventCard }}
          tooltipAccessor={(event) => `${event.patientName}\n${event.doctorName} • ${event.roomName}`}
          views={['month', 'week', 'day', 'agenda'] as const}
          step={30}
          dayLayoutAlgorithm="no-overlap"
          showMultiDayTimes
          defaultDate={new Date()}
        />
      </div>

      {/* Create/Edit Modal */}
      {showCreate && (
        <div className={styles.modalOverlay} onClick={() => {
          setShowCreate(false);
          setCreateError(null);
        }}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>New Appointment</h2>
              <button 
                className={styles.closeButton}
                onClick={() => {
                  setShowCreate(false);
                  setCreateError(null);
                  setApptPatientSearch('');
                  setApptDoctorSearch('');
                }}
              >
                ×
              </button>
            </div>
            <div className={styles.modalBody}>
              <form className={styles.formGrid}>
                <div className={styles.fieldFull}>
                  <label className={styles.label}>Patient</label>
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="Search patient by name…"
                    value={apptPatientSearch}
                    onChange={(e) => {
                      setApptPatientSearch(e.target.value);
                      setFormData(prev => ({ ...prev, patientId: '' }));
                    }}
                    autoComplete="off"
                  />
                  {apptPatientSearch.trim() !== '' && !formData.patientId && (
                    <div className={styles.comboDropdown}>
                      {filteredApptPatients.length === 0 ? (
                        <div className={styles.comboEmpty}>No patients found</div>
                      ) : (
                        filteredApptPatients.map((p) => (
                          <div
                            key={p.id}
                            className={styles.comboItem}
                            onClick={() => {
                              setFormData(prev => ({ ...prev, patientId: p.id }));
                              setApptPatientSearch(p.name);
                            }}
                          >
                            <span className={styles.comboName}>{p.name}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  {formData.patientId && (
                    <div className={styles.selectedIndicator}>
                      ✓ {patients.find(p => p.id === formData.patientId)?.name} selected
                    </div>
                  )}
                </div>
                <div>
                  <label className={styles.label}>Doctor</label>
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="Search doctor by name…"
                    value={apptDoctorSearch}
                    onChange={(e) => {
                      setApptDoctorSearch(e.target.value);
                      setFormData(prev => ({ ...prev, doctorId: '' }));
                    }}
                    autoComplete="off"
                  />
                  {apptDoctorSearch.trim() !== '' && !formData.doctorId && (
                    <div className={styles.comboDropdown}>
                      {filteredApptDoctors.length === 0 ? (
                        <div className={styles.comboEmpty}>No doctors found</div>
                      ) : (
                        filteredApptDoctors.map((d) => (
                          <div
                            key={d.id}
                            className={styles.comboItem}
                            onClick={() => {
                              setFormData(prev => ({ ...prev, doctorId: d.id }));
                              setApptDoctorSearch(d.name);
                            }}
                          >
                            <span className={styles.comboName}>{d.name}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  {formData.doctorId && (
                    <div className={styles.selectedIndicator}>
                      ✓ {doctors.find(d => d.id === formData.doctorId)?.name} selected
                    </div>
                  )}
                </div>
                <div>
                  <label className={styles.label}>Room</label>
                  <select className={styles.select} value={formData.roomId} onChange={e => setFormData({...formData, roomId: e.target.value})}>
                    <option value="">None</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={styles.label}>Date</label>
                  <input type="date" className={styles.input} value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} />
                </div>
                <div>
                  <label className={styles.label}>Time</label>
                  <input type="time" className={styles.input} value={formData.time} onChange={e => setFormData({...formData, time: e.target.value})} />
                </div>
                <div>
                  <label className={styles.label}>Duration (min)</label>
                  <input type="number" step="5" className={styles.input} value={formData.duration} onChange={e => setFormData({...formData, duration: e.target.value})} />
                </div>
                <div>
                  <label className={styles.label}>Type</label>
                  <select className={styles.select} value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
                    {APPOINTMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className={styles.fieldFull}>
                  <label className={styles.label}>Notes / Chief Complaint</label>
                  <textarea className={styles.textarea} rows={3} value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} placeholder="Reason for visit..." />
                </div>
              </form>
            </div>
            {createError && (
              <div className={`error-msg ${styles.modalError}`} role="alert">{createError}</div>
            )}
            <div className={styles.modalFooter}>
              <button className={styles.secondaryBtn} onClick={() => {
                setShowCreate(false);
                setCreateError(null);
                setApptPatientSearch('');
                setApptDoctorSearch('');
              }} disabled={creating}>Cancel</button>
              <button className={styles.primaryBtn} onClick={() => void handleCreate()} disabled={creating}>
                {creating ? 'Creating…' : 'Create Appointment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event Details Modal */}
      {selectedEvent && (
        <div className={styles.modalOverlay} onClick={() => setSelectedEvent(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Appointment Details</h2>
              <button className={styles.closeButton} onClick={() => setSelectedEvent(null)}>×</button>
            </div>
            <div className={styles.modalBody}>
                <div className={styles.formGrid}>
                  <div>
                    <label className={styles.label}>Patient</label>
                    <div className={styles.detailValue}>{(() => { const pt = patients.find(p => p.id === selectedEvent.appointment.patientId); return pt ? (`${pt.firstName ?? ''} ${pt.lastName ?? ''}`.trim() || pt.name || 'Unknown') : 'Unknown'; })()}</div>
                  </div>
                  <div>
                    <label className={styles.label}>Status</label>
                    <div className={styles.statusBadge}>
                      {APPOINTMENT_STATUS_LABELS[selectedEvent.appointment.status] ?? selectedEvent.appointment.status}
                    </div>
                  </div>
                  <div>
                    <label className={styles.label}>Time & Duration</label>
                    <div className={styles.detailValue}>
                      {format(selectedEvent.start, 'HH:mm')} ({selectedEvent.appointment.durationMinutes} min)
                    </div>
                    <div className={styles.detailMeta}>{format(selectedEvent.start, 'MMM d, yyyy')}</div>
                  </div>
                  <div>
                    <label className={styles.label}>Provider & Room</label>
                    <div className={styles.detailValue}>{doctors.find(d => d.id === selectedEvent.appointment.doctorId)?.name || 'Not assigned'}</div>
                    <div className={styles.detailMeta}>{rooms.find(r => r.id === selectedEvent.appointment.roomId)?.name || 'No room assigned'}</div>
                  </div>
                  <div className={styles.fieldFull}>
                    <label className={styles.label}>Chief Complaint / Notes</label>
                    <div className={styles.detailNote}>
                      {selectedEvent.appointment.chiefComplaint || selectedEvent.appointment.notes || 'No notes provided.'}
                    </div>
                  </div>
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.dangerBtn}
                onClick={() => void handleMarkNoShow()}
                disabled={!['scheduled', 'checked_in'].includes(selectedEvent.appointment.status) || checkingIn}
                data-align="left"
              >
                No Show
              </button>
              <button className={styles.secondaryBtn} onClick={() => setSelectedEvent(null)} disabled={checkingIn}>Close</button>
              <button
                className={styles.primaryBtn}
                onClick={() => void handleCheckIn()}
                disabled={selectedEvent.appointment.status !== 'scheduled' || checkingIn}
              >
                {checkingIn ? 'Checking in...' : 'Check In'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
