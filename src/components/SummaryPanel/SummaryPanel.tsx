'use client';

import { useState } from 'react';
import styles from './SummaryPanel.module.css';
import { SummaryItem, VisitStatus } from '@/types';
import { v4 as uuidv4 } from 'uuid';

interface SummaryPanelProps {
    issuesIdentified: SummaryItem[];
    actionsPlan: SummaryItem[];
    status: VisitStatus;
    onUpdateIssues: (items: SummaryItem[]) => void;
    onUpdateActions: (items: SummaryItem[]) => void;
}

export default function SummaryPanel({
    issuesIdentified,
    actionsPlan,
    status,
    onUpdateIssues,
    onUpdateActions,
}: SummaryPanelProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState('');

    const isLocked = status === 'approved';
    const isDraft = status === 'draft';
    const isEmpty = issuesIdentified.length === 0 && actionsPlan.length === 0;

    const handleStartEdit = (item: SummaryItem) => {
        if (isLocked) return;
        setEditingId(item.id);
        setEditingText(item.text);
    };

    const handleSaveEdit = (items: SummaryItem[], updateFn: (items: SummaryItem[]) => void) => {
        const updated = items.map(item =>
            item.id === editingId
                ? { ...item, text: editingText, isEdited: true }
                : item
        );
        updateFn(updated);
        setEditingId(null);
        setEditingText('');
    };

    const handleDelete = (id: string, items: SummaryItem[], updateFn: (items: SummaryItem[]) => void) => {
        updateFn(items.filter(item => item.id !== id));
    };

    const handleAddItem = (items: SummaryItem[], updateFn: (items: SummaryItem[]) => void) => {
        const newItem: SummaryItem = {
            id: uuidv4(),
            text: 'New item',
            sourceFactIds: [],
            isEdited: true,
        };
        updateFn([...items, newItem]);
        setEditingId(newItem.id);
        setEditingText('New item');
    };

    const renderBulletItem = (
        item: SummaryItem,
        items: SummaryItem[],
        updateFn: (items: SummaryItem[]) => void
    ) => {
        const isEditing = editingId === item.id;

        return (
            <li key={item.id} className={`${styles.bulletItem} ${!isLocked ? styles.editable : ''}`}>
                <span className={styles.bulletMarker} />

                {isEditing ? (
                    <input
                        type="text"
                        className={styles.bulletInput}
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        onBlur={() => handleSaveEdit(items, updateFn)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit(items, updateFn);
                            if (e.key === 'Escape') {
                                setEditingId(null);
                                setEditingText('');
                            }
                        }}
                        autoFocus
                    />
                ) : (
                    <span
                        className={styles.bulletText}
                        onClick={() => handleStartEdit(item)}
                    >
                        {item.text}
                    </span>
                )}

                {!isLocked && !isEditing && (
                    <div className={styles.bulletActions}>
                        <button
                            className={styles.bulletBtn}
                            onClick={() => handleStartEdit(item)}
                            title="Edit"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                        </button>
                        <button
                            className={`${styles.bulletBtn} ${styles.delete}`}
                            onClick={() => handleDelete(item.id, items, updateFn)}
                            title="Delete"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </div>
                )}
            </li>
        );
    };

    return (
        <div className={`${styles.panel} ${isLocked ? styles.locked : ''}`}>
            <div className={styles.header}>
                <div className={styles.headerLeft}>
                    <h2 className={styles.title}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        Visit Summary
                    </h2>
                    {isDraft && (
                        <span className={styles.draftBadge}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                            Draft
                        </span>
                    )}
                    {isLocked && (
                        <span className={styles.approvedBadge}>
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M5 13l4 4L19 7" />
                            </svg>
                            Approved
                        </span>
                    )}
                </div>
            </div>

            <div className={styles.content}>
                {status === 'recording' ? (
                    <div className={styles.placeholder}>
                        <svg
                            className={styles.placeholderIcon}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                        >
                            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        <h3 className={styles.placeholderTitle}>Recording in progress</h3>
                        <p className={styles.placeholderText}>
                            The AI summary will be generated automatically when you stop recording.
                        </p>
                    </div>
                ) : isEmpty && status === 'draft' ? (
                    <div className={styles.placeholder}>
                        <svg
                            className={styles.placeholderIcon}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                        >
                            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <h3 className={styles.placeholderTitle}>No summary yet</h3>
                        <p className={styles.placeholderText}>
                            Start a recording to generate an AI-powered visit summary.
                        </p>
                    </div>
                ) : (
                    <div className={styles.sections}>
                        {/* Warning Banner */}
                        {isDraft && (issuesIdentified.length === 0 || actionsPlan.length === 0) && (
                            <div className={styles.warningBanner}>
                                <svg className={styles.warningIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span className={styles.warningText}>
                                    {issuesIdentified.length === 0 ? 'No issues identified.' : ''}
                                    {actionsPlan.length === 0 ? 'No actions captured.' : ''}
                                    Review before approving.
                                </span>
                            </div>
                        )}

                        {/* Issues Identified */}
                        <div className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <svg className={styles.sectionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <h3 className={styles.sectionTitle}>Issues Identified</h3>
                            </div>

                            {issuesIdentified.length > 0 ? (
                                <ul className={styles.bulletList}>
                                    {issuesIdentified.map(item => renderBulletItem(item, issuesIdentified, onUpdateIssues))}
                                </ul>
                            ) : (
                                <div className={styles.emptySection}>No issues identified</div>
                            )}

                            {!isLocked && (
                                <button
                                    className={styles.addItemBtn}
                                    onClick={() => handleAddItem(issuesIdentified, onUpdateIssues)}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 5v14m-7-7h14" />
                                    </svg>
                                    Add item
                                </button>
                            )}
                        </div>

                        {/* Actions / Plan */}
                        <div className={styles.section}>
                            <div className={styles.sectionHeader}>
                                <svg className={styles.sectionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                <h3 className={styles.sectionTitle}>Actions / Plan</h3>
                            </div>

                            {actionsPlan.length > 0 ? (
                                <ul className={styles.bulletList}>
                                    {actionsPlan.map(item => renderBulletItem(item, actionsPlan, onUpdateActions))}
                                </ul>
                            ) : (
                                <div className={styles.emptySection}>No actions captured</div>
                            )}

                            {!isLocked && (
                                <button
                                    className={styles.addItemBtn}
                                    onClick={() => handleAddItem(actionsPlan, onUpdateActions)}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M12 5v14m-7-7h14" />
                                    </svg>
                                    Add item
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
