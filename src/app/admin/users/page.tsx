'use client';

import { useState, useEffect, useCallback, FormEvent } from 'react';
import { getAdminUsers, createAdminUser, updateAdminUser } from '@/services/api';
import type { AdminUser } from '@/services/api';
import styles from './page.module.css';

interface CreateForm {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'super_admin';
}

const INITIAL_FORM: CreateForm = { name: '', email: '', password: '', role: 'admin' };

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState<CreateForm>(INITIAL_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [roleChangingId, setRoleChangingId] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAdminUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to load admin users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) return;
    setSaving(true);
    setError('');
    try {
      const created = await createAdminUser(form);
      setUsers((prev) => [...prev, created]);
      setIsModalOpen(false);
      setForm(INITIAL_FORM);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(user: AdminUser) {
    try {
      setInlineError(null);
      setTogglingId(user.id);
      const updated = await updateAdminUser(user.id, { isActive: !user.isActive });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      console.error('Failed to update admin user:', err);
      setInlineError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setTogglingId(null);
    }
  }

  async function handleRoleChange(user: AdminUser, role: 'admin' | 'super_admin') {
    try {
      setInlineError(null);
      setRoleChangingId(user.id);
      const updated = await updateAdminUser(user.id, { role });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
    } catch (err) {
      console.error('Failed to change role:', err);
      setInlineError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setRoleChangingId(null);
    }
  }

  const activeUsers = users.filter((u) => u.isActive);
  const inactiveUsers = users.filter((u) => !u.isActive);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Admin Users</h1>
          <p className={styles.subtitle}>
            {activeUsers.length} active · {inactiveUsers.length} inactive
          </p>
        </div>
        <button type="button" className={styles.addBtn} onClick={() => setIsModalOpen(true)}>
          + Add Admin User
        </button>
      </header>

      {inlineError ? (
        <div className={`error-msg ${styles.inlineError}`} role="alert">
          <span>{inlineError}</span>
          <button type="button" onClick={() => setInlineError(null)} aria-label="Dismiss" className={styles.inlineErrorDismiss}>×</button>
        </div>
      ) : null}

      {loading ? (
        <div className={styles.loading}>Loading users…</div>
      ) : (
        <div className={styles.userGrid}>
          {users.map((user) => (
            <div key={user.id} className={`${styles.userCard} ${!user.isActive ? styles.inactiveCard : ''}`}>
              <div className={styles.userCardTop}>
                <div
                  className={styles.userAvatar}
                  data-role={user.role}
                >
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className={styles.userInfo}>
                  <div className={styles.userName}>{user.name}</div>
                  <div className={styles.userEmail}>{user.email}</div>
                </div>
                <span
                  className={styles.statusPill}
                  data-state={user.isActive ? 'active' : 'inactive'}
                >
                  {user.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className={styles.userMeta}>
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Role</span>
                  <select
                    className={styles.roleSelect}
                    value={user.role}
                    onChange={(e) => handleRoleChange(user, e.target.value as 'admin' | 'super_admin')}
                    disabled={!user.isActive || roleChangingId === user.id}
                  >
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
                <div className={styles.metaRow}>
                  <span className={styles.metaLabel}>Joined</span>
                  <span className={styles.metaValue}>
                    {new Date(user.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                {user.lastLoginAt && (
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Last Login</span>
                    <span className={styles.metaValue}>{new Date(user.lastLoginAt).toLocaleDateString()}</span>
                  </div>
                )}
              </div>

              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={`${styles.toggleBtn} ${user.isActive ? styles.deactivate : styles.activate}`}
                  onClick={() => handleToggleActive(user)}
                  disabled={togglingId === user.id}
                >
                  {user.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {isModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsModalOpen(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>Add Admin User</h2>
              <button type="button" className={styles.closeBtn} onClick={() => setIsModalOpen(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label className={styles.label}>Full Name *</label>
                  <input
                    className={styles.input}
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Dr. Jane Smith"
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Email *</label>
                  <input
                    type="email"
                    className={styles.input}
                    value={form.email}
                    onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                    placeholder="jane@clinic.com"
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Password *</label>
                  <input
                    type="password"
                    className={styles.input}
                    value={form.password}
                    onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))}
                    placeholder="Min. 8 characters"
                    minLength={8}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label}>Role</label>
                  <select
                    className={styles.input}
                    value={form.role}
                    onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as 'admin' | 'super_admin' }))}
                  >
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
              </div>
              {error && <div className={styles.formError}>{error}</div>}
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.saveBtn} disabled={saving}>
                  {saving ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
