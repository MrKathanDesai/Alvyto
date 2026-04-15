'use client';

import { useState, useEffect, useCallback } from 'react';
import { getAuditLogs } from '@/services/api';
import type { AuditLog } from '@/services/api';
import styles from './page.module.css';

const ACTION_OPTIONS = ['', 'CREATE', 'UPDATE', 'VIEW', 'APPROVE', 'LIST', 'LOGIN', 'LOGOUT', 'CHECK_IN', 'CANCEL', 'DELETE', 'AUTO_ASSIGN'];
const ROLE_OPTIONS = ['', 'admin', 'super_admin', 'room_device'];
const RESOURCE_OPTIONS = ['', 'patient', 'doctor', 'visit', 'room', 'admin_user'];

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getAuditLogs({
        action: actionFilter || undefined,
        actorRole: roleFilter || undefined,
        resourceType: resourceFilter || undefined,
        limit: LIMIT,
        offset,
      });
      setLogs(data);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  }, [actionFilter, roleFilter, resourceFilter, offset]);

  useEffect(() => { void loadLogs(); }, [loadLogs]);

  function formatAction(action: string) {
    return action.replace(/_/g, ' ');
  }

  function formatTime(ts: string) {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  const handleFilterChange = () => { setOffset(0); };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Audit Log</h1>
          <p className={styles.subtitle}>All admin and room actions recorded for compliance</p>
        </div>
        <button type="button" className={styles.refreshBtn} onClick={loadLogs}>Refresh</button>
      </header>

      {/* Filters */}
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Action Type</label>
          <select
            className={styles.filterSelect}
            value={actionFilter}
            onChange={e => { setActionFilter(e.target.value); handleFilterChange(); }}
          >
            {ACTION_OPTIONS.map(a => (
              <option key={a} value={a}>{a || 'All Actions'}</option>
            ))}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Role</label>
          <select
            className={styles.filterSelect}
            value={roleFilter}
            onChange={e => { setRoleFilter(e.target.value); handleFilterChange(); }}
          >
            {ROLE_OPTIONS.map(r => (
              <option key={r} value={r}>{r || 'All Roles'}</option>
            ))}
          </select>
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Resource</label>
          <select
            className={styles.filterSelect}
            value={resourceFilter}
            onChange={e => { setResourceFilter(e.target.value); handleFilterChange(); }}
          >
            {RESOURCE_OPTIONS.map(r => (
              <option key={r} value={r}>{r || 'All Resources'}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className={styles.loading}>Loading audit logs…</div>
      ) : (
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Role</th>
                <th>Resource</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={5} className={styles.emptyCell}>No log entries found.</td>
                </tr>
              ) : logs.map(log => (
                <tr key={log.id} className={!log.success ? styles.failedRow : ''}>
                  <td className={styles.timeCell}>{formatTime(log.timestamp)}</td>
                  <td>
                    <span className={styles.actionChip}>{formatAction(log.action)}</span>
                  </td>
                  <td>
                    <span className={`${styles.roleBadge} ${log.actorRole === 'super_admin' ? styles.superAdmin : ''}`}>
                      {log.actorRole ?? '—'}
                    </span>
                  </td>
                  <td className={styles.resourceCell}>
                    {log.resourceType && <span className={styles.resourceType}>{log.resourceType}</span>}
                    {log.resourceId && (
                      <code className={styles.resourceId}>{log.resourceId.slice(0, 8)}…</code>
                    )}
                  </td>
                  <td>
                    <span className={log.success ? styles.successDot : styles.failDot}>
                      {log.success ? '✓ OK' : '✗ Failed'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <div className={styles.pagination}>
        <button
          type="button"
          className={styles.pageBtn}
          disabled={offset === 0}
          onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
        >
          ← Previous
        </button>
        <span className={styles.pageInfo}>
          {logs.length === 0 ? 'No entries' : `${offset + 1}–${offset + logs.length} entries`}
        </span>
        <button
          type="button"
          className={styles.pageBtn}
          disabled={logs.length < LIMIT}
          onClick={() => setOffset(o => o + LIMIT)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
