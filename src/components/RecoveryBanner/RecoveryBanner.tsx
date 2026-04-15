'use client';

import { useMemo } from 'react';

interface RecoveryBannerProps {
  patientName: string;
  savedAt: string;
  onRecover: () => void;
  onDismiss: () => void;
}

function formatRelativeTime(isoDate: string): string {
  const savedTs = new Date(isoDate).getTime();
  if (Number.isNaN(savedTs)) return 'recently';

  const diffMs = Date.now() - savedTs;
  const diffSec = Math.max(1, Math.floor(diffMs / 1000));

  if (diffSec < 60) return `${diffSec} second${diffSec === 1 ? '' : 's'} ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
}

export default function RecoveryBanner({ patientName, savedAt, onRecover, onDismiss }: RecoveryBannerProps) {
  const relativeTime = useMemo(() => formatRelativeTime(savedAt), [savedAt]);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 20px',
        backgroundColor: '#FFFBEB',
        color: 'var(--amber)',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-medium)',
        borderBottom: '1px solid #FDE68A',
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        style={{ opacity: 0.85, flexShrink: 0 }}
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>

      <span style={{ color: 'var(--amber)', lineHeight: 1.3 }}>
        Unsaved recording session found for <strong>{patientName}</strong> — saved {relativeTime}
      </span>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          type="button"
          onClick={onRecover}
          style={{
            border: '1px solid #D97706',
            backgroundColor: '#F59E0B',
            color: '#FFFFFF',
            fontWeight: 600,
            fontSize: '11px',
            borderRadius: '8px',
            padding: '6px 10px',
            cursor: 'pointer',
            fontFamily: 'var(--font-family)',
          }}
        >
          Recover Session
        </button>

        <button
          type="button"
          onClick={onDismiss}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--amber)',
            fontWeight: 500,
            fontSize: '11px',
            padding: '4px 6px',
            cursor: 'pointer',
            fontFamily: 'var(--font-family)',
            opacity: 0.85,
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
