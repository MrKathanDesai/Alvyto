'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createDoctor, getDoctors, setDoctorAvailability, updateDoctor } from '@/services/api';
import type { Doctor } from '@/types/emr';
import styles from './page.module.css';

type DoctorStatus = NonNullable<Doctor['currentStatus']>;

const STATUS_OPTIONS: DoctorStatus[] = ['available', 'in_session', 'break', 'off_duty'];

interface DoctorFormState {
  name: string;
  specialty: string;
  licenseNumber: string;
  email: string;
  phone: string;
  isActive: boolean;
}

const INITIAL_FORM: DoctorFormState = {
  name: '',
  specialty: '',
  licenseNumber: '',
  email: '',
  phone: '',
  isActive: true,
};

function mapDoctorToForm(doctor: Doctor): DoctorFormState {
  return {
    name: doctor.name ?? '',
    specialty: doctor.specialty ?? '',
    licenseNumber: doctor.licenseNumber ?? '',
    email: doctor.email ?? '',
    phone: doctor.phone ?? '',
    isActive: doctor.isActive,
  };
}

export default function DoctorsPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
  const [form, setForm] = useState<DoctorFormState>(INITIAL_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [statusChangingId, setStatusChangingId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  useEffect(() => {
    void loadDoctors();
  }, []);

  const activeDoctors = useMemo(() => doctors.filter((doctor) => doctor.isActive), [doctors]);
  const inactiveDoctors = useMemo(() => doctors.filter((doctor) => !doctor.isActive), [doctors]);

  async function loadDoctors() {
    try {
      setLoading(true);
      setError(null);
      const data = await getDoctors(false);
      setDoctors(data);
    } catch (loadError) {
      console.error('Failed to load doctors:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load doctors.');
    } finally {
      setLoading(false);
    }
  }

  function openCreateModal() {
    setEditingDoctor(null);
    setForm(INITIAL_FORM);
    setIsModalOpen(true);
  }

  function openEditModal(doctor: Doctor) {
    setEditingDoctor(doctor);
    setForm(mapDoctorToForm(doctor));
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingDoctor(null);
    setForm(INITIAL_FORM);
  }

  async function handleSaveDoctor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!form.name.trim()) {
      setError('Doctor name is required.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      specialty: form.specialty.trim() || undefined,
      licenseNumber: form.licenseNumber.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
    };

    try {
      setIsSaving(true);
      setError(null);

      if (editingDoctor) {
        await updateDoctor(editingDoctor.id, payload);
      } else {
        await createDoctor(payload);
      }

      await loadDoctors();
      closeModal();
    } catch (saveError) {
      console.error('Failed to save doctor:', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Failed to save doctor.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStatusChange(doctor: Doctor, status: DoctorStatus) {
    try {
      setInlineError(null);
      setStatusChangingId(doctor.id);
      await setDoctorAvailability(doctor.id, status);
      await loadDoctors();
    } catch (statusError) {
      console.error('Failed to update doctor availability:', statusError);
      setInlineError(statusError instanceof Error ? statusError.message : 'Action failed');
    } finally {
      setStatusChangingId(null);
    }
  }

  async function handleDeactivate(doctor: Doctor) {
    try {
      setInlineError(null);
      setTogglingId(doctor.id);
      await updateDoctor(doctor.id, { isActive: false });
      await loadDoctors();
    } catch (deactivateError) {
      console.error('Failed to deactivate doctor:', deactivateError);
      setInlineError(deactivateError instanceof Error ? deactivateError.message : 'Action failed');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleReactivate(doctor: Doctor) {
    try {
      setInlineError(null);
      setTogglingId(doctor.id);
      await updateDoctor(doctor.id, { isActive: true });
      await loadDoctors();
    } catch (reactivateError) {
      console.error('Failed to reactivate doctor:', reactivateError);
      setInlineError(reactivateError instanceof Error ? reactivateError.message : 'Action failed');
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) {
    return <div className={styles.loading}>Loading doctors...</div>;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Doctors</h1>
          <p className={styles.subtitle}>
            {activeDoctors.length} active • {inactiveDoctors.length} inactive
          </p>
        </div>
        <button type="button" className={styles.addBtn} onClick={openCreateModal}>
          + Add Doctor
        </button>
      </header>

      {error ? (
        <div className="error-msg" role="alert">{error}</div>
      ) : null}

      {inlineError ? (
        <div className={`error-msg ${styles.inlineError}`} role="alert">
          <span>{inlineError}</span>
          <button type="button" onClick={() => setInlineError(null)} aria-label="Dismiss" className={styles.inlineErrorDismiss}>×</button>
        </div>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Active Staff</h2>
        <div className={styles.doctorGrid}>
          {activeDoctors.map((doctor) => {
            const status = doctor.currentStatus ?? 'available';
            return (
              <article key={doctor.id} className={styles.doctorCard}>
                <div className={styles.docHeader}>
                  <div className={styles.docAvatar}>{doctor.name.charAt(0).toUpperCase()}</div>
                  <div className={styles.docInfo}>
                    <h3 className={styles.docName}>{doctor.name}</h3>
                    <p className={styles.docSpec}>{doctor.specialty || 'General Medicine'}</p>
                    <p className={styles.docLicense}>License: {doctor.licenseNumber || 'N/A'}</p>
                  </div>
                  <span
                    className={styles.statusIndicator}
                    data-status={status}
                    aria-label={`${doctor.name} status indicator`}
                  />
                </div>

                <div className={styles.docContact}>
                  <div>{doctor.email || 'No email provided'}</div>
                  <div>{doctor.phone || 'No phone provided'}</div>
                </div>

                <div className={styles.docStatus}>
                  <label htmlFor={`status-${doctor.id}`} className={styles.statusLabel}>
                    Status
                  </label>
                  <select
                    id={`status-${doctor.id}`}
                    className={styles.statusSelect}
                    value={status}
                    onChange={(event) => void handleStatusChange(doctor, event.target.value as DoctorStatus)}
                    disabled={statusChangingId === doctor.id}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.docActions}>
                  <button type="button" className={styles.editBtn} onClick={() => openEditModal(doctor)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className={styles.deactivateBtn}
                    onClick={() => void handleDeactivate(doctor)}
                    disabled={togglingId === doctor.id}
                  >
                    {togglingId === doctor.id ? '…' : 'Deactivate'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Inactive Staff</h2>
        <div className={styles.inactiveList}>
          {inactiveDoctors.map((doctor) => (
            <div key={doctor.id} className={styles.inactiveRow}>
              <div>
                <div className={styles.inactiveName}>{doctor.name}</div>
                <div className={styles.inactiveSpec}>{doctor.specialty || 'General Medicine'}</div>
              </div>
              <button
                type="button"
                className={styles.reactivateBtn}
                onClick={() => void handleReactivate(doctor)}
                disabled={togglingId === doctor.id}
              >
                {togglingId === doctor.id ? '…' : 'Reactivate'}
              </button>
            </div>
          ))}
          {inactiveDoctors.length === 0 ? (
            <div className={styles.inactiveRow}>
              <div className={styles.inactiveSpec}>No inactive staff members.</div>
            </div>
          ) : null}
        </div>
      </section>

      {isModalOpen ? (
        <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div
            className={styles.modal}
            role="dialog"
            aria-modal="true"
            aria-labelledby="doctor-modal-title"
            onKeyDown={(e) => { if (e.key === 'Escape') closeModal(); }}
          >
            <h2 id="doctor-modal-title" className={styles.modalTitle}>{editingDoctor ? 'Edit Doctor' : 'Add Doctor'}</h2>
            <form onSubmit={handleSaveDoctor}>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label htmlFor="doctor-name" className={styles.label}>
                    Full Name
                  </label>
                  <input
                    id="doctor-name"
                    className={styles.input}
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="doctor-specialty" className={styles.label}>
                    Specialty
                  </label>
                  <input
                    id="doctor-specialty"
                    className={styles.input}
                    value={form.specialty}
                    onChange={(event) => setForm((prev) => ({ ...prev, specialty: event.target.value }))}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="doctor-license" className={styles.label}>
                    License Number
                  </label>
                  <input
                    id="doctor-license"
                    className={styles.input}
                    value={form.licenseNumber}
                    onChange={(event) => setForm((prev) => ({ ...prev, licenseNumber: event.target.value }))}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="doctor-email" className={styles.label}>
                    Email
                  </label>
                  <input
                    id="doctor-email"
                    type="email"
                    className={styles.input}
                    value={form.email}
                    onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="doctor-phone" className={styles.label}>
                    Phone
                  </label>
                  <input
                    id="doctor-phone"
                    className={styles.input}
                    value={form.phone}
                    onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                  />
                </div>
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={closeModal} disabled={isSaving}>
                  Cancel
                </button>
                <button type="submit" className={styles.saveBtn} disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
