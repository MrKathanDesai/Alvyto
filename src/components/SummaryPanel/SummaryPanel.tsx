'use client';

import { useState, useCallback, useRef } from 'react';
import styles from './SummaryPanel.module.css';
import { SummaryItem, VisitStatus, KeyFact, KeyFactCategory, VisitSummary, PrescriptionMedicationDetail } from '@/types';
import { v4 as uuidv4 } from 'uuid';
import { getRoomAgentHeaders } from '@/utils/roomAgentAuth';

interface SummaryPanelProps {
    summary: VisitSummary;
    isSummarizing?: boolean;
    isExpanding?: boolean;
    status: VisitStatus;
    whisperEndpoint?: string;
    transcript?: string;
    onUpdateSnapshot: (items: KeyFact[]) => void;
    onUpdateDoctorActions: (items: SummaryItem[]) => void;
    onUpdateParagraphs: (issues: string, actions: string) => void;
}

const CATEGORY_CONFIG: Record<KeyFactCategory, { label: string; className: string }> = {
    symptom:   { label: 'Symptom',   className: styles.chipSymptom },
    duration:  { label: 'Duration',  className: styles.chipDuration },
    timing:    { label: 'Timing',    className: styles.chipTiming },
    medication:{ label: 'Med',       className: styles.chipMedication },
    action:    { label: 'Action',    className: styles.chipAction },
    lifestyle: { label: 'Lifestyle', className: styles.chipLifestyle },
    warning:   { label: 'Warning',   className: styles.chipWarning },
    negative:  { label: 'Negative',  className: styles.chipNegative },
};

const CATEGORY_ORDER: KeyFactCategory[] = [
    'symptom','duration','timing','negative','lifestyle','medication','action','warning',
];

const WHISPER_ENDPOINT = process.env.NEXT_PUBLIC_WHISPER_ENDPOINT || 'http://localhost:8000';

// Patterns that indicate a chip is conversational noise, not clinical data
const JUNK_CHIP_RE = [
    /\?$/,                                                                          // questions
    /^(what|how|do|does|did|are|is|was|were|have|has|can|could|would|should|will)\b/i,
    /^(you'?ll|take care|feel better|no worries|don'?t worry|see you|get well|stay well|hope you)/i,
    /^(ok(ay)?|yes|no|sure|right|alright|of course|absolutely|exactly)\b/i,
    /^(i'?m|i am|we'?re|i see|i think|i believe)\b/i,
    /\s?(inquiry|question|asked?)$/i,                                               // meta-label suffix
];

// Single-word meta-labels the AI extracts as categories instead of values
// These are clinical category names, NOT actual clinical findings
const GENERIC_CHIP_TERMS = new Set([
    'complaint', 'duration', 'timing', 'symptom', 'symptoms', 'issue', 'issues',
    'finding', 'findings', 'history', 'inquiry', 'question', 'condition',
    'examination', 'assessment', 'diagnosis', 'treatment', 'prescription',
    'location', 'trigger food drink', 'trigger food/drink', 'weight loss',
    'night symptoms', 'frequency', 'frequency of symptom', 'medication use',
]);

function isJunkChip(label: string): boolean {
    const text = label.trim();
    if (!text) return true;
    if (text.split(/\s+/).length > 8) return true;
    const normalized = normalizeText(text);
    if (GENERIC_CHIP_TERMS.has(text.toLowerCase()) || GENERIC_CHIP_TERMS.has(normalized)) return true;
    if (text.includes(' - ')) {
        const [left = '', right = ''] = text.split(' - ', 2).map((part) => normalizeText(part));
        if (!left || !right) return true;
        if (left === right) return true;
        if (GENERIC_CHIP_TERMS.has(left) && GENERIC_CHIP_TERMS.has(right)) return true;
    }
    return JUNK_CHIP_RE.some(re => re.test(text));
}

// Patterns for notes/advice that are social closings, not clinical guidance
const JUNK_NOTE_RE = [
    /^(take care|you'?ll be (fine|ok(ay)?)|feel better|get well|no worries|don'?t worry|see you|bye|goodbye)\b/i,
    /^(good (morning|afternoon|evening|bye))\b/i,
    /^(thank you|thanks)\b/i,
];

function coerceParagraphText(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (value && typeof value === 'object') {
        const maybeText = (value as { text?: unknown }).text;
        if (typeof maybeText === 'string') return maybeText.trim();
    }
    return '';
}

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenSimilarity(a: string, b: string): number {
    const aTokens = new Set(normalizeText(a).split(' ').filter((t) => t.length > 2));
    const bTokens = new Set(normalizeText(b).split(' ').filter((t) => t.length > 2));
    if (aTokens.size === 0 || bTokens.size === 0) return 0;
    let overlap = 0;
    aTokens.forEach((token) => {
        if (bTokens.has(token)) overlap += 1;
    });
    return overlap / Math.max(aTokens.size, bTokens.size);
}

function dedupeStrings(values: string[], threshold = 0.72): string[] {
    const out: string[] = [];
    values.forEach((value) => {
        const text = value.trim();
        if (!text) return;
        const duplicate = out.some((existing) => tokenSimilarity(existing, text) >= threshold);
        if (!duplicate) out.push(text);
    });
    return out;
}

export default function SummaryPanel({
    summary,
    isSummarizing = false,
    isExpanding: isExpandingProp = false,
    status,
    transcript = '',
    onUpdateSnapshot,
    onUpdateDoctorActions,
    onUpdateParagraphs,
}: SummaryPanelProps) {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingText, setEditingText] = useState('');
    const [addingChip, setAddingChip] = useState(false);
    const [newChipText, setNewChipText] = useState('');
    const [isExpandingLocal, setIsExpandingLocal] = useState(false);
    const [expandError, setExpandError] = useState<string | null>(null);
    const expandDebounceRef = useRef<NodeJS.Timeout | null>(null);

    const isExpanding = isExpandingProp || isExpandingLocal;
    const isLocked = status === 'approved';
    const isDraft = status === 'draft';

    const {
        clinicalSnapshot,
        doctorActions,
        issuesParagraph,
        actionsParagraph,
    } = summary;

    const dedupedDoctorActions = dedupeStrings(doctorActions.map((item) => item.text))
        .filter((text) => !JUNK_NOTE_RE.some(re => re.test(text.trim())))
        .map((text, index) => doctorActions.find((item) => item.text === text) ?? {
            id: `deduped-${index}`,
            text,
            sourceFactIds: [],
            isEdited: false,
            isSupported: true,
        });

    const dedupedClinicalSnapshot = [...clinicalSnapshot].filter((fact, index, arr) => {
        const first = arr.findIndex((candidate) => tokenSimilarity(candidate.label, fact.label) >= 0.8);
        return first === index;
    });

    // Filter out conversational noise from clinical snapshot chips
    const filteredClinicalSnapshot = dedupedClinicalSnapshot.filter(
        (fact) => !isJunkChip(fact.label)
    );

    const uniqueAdvice = dedupeStrings(summary.prescriptionDraft?.advice ?? [])
        .filter((text) => !dedupedDoctorActions.some((action) => tokenSimilarity(action.text, text) >= 0.7))
        .filter((text) => !JUNK_NOTE_RE.some(re => re.test(text.trim())));

    const safeIssuesParagraph = coerceParagraphText(issuesParagraph);
    const safeActionsParagraph = coerceParagraphText(actionsParagraph);
    const mergedNarrative = dedupeStrings([safeIssuesParagraph, safeActionsParagraph], 0.55).join('\n\n').trim();

    const prescriptionMeds: PrescriptionMedicationDetail[] = summary.prescriptionDraft?.medications ?? [];

    const isEmpty = filteredClinicalSnapshot.length === 0 && dedupedDoctorActions.length === 0 && prescriptionMeds.length === 0 && !mergedNarrative;

    // ── Trigger /expand after any edit ────────────────────────────────────
    const triggerExpand = useCallback(async (
        snapshot: KeyFact[],
        actions: SummaryItem[]
    ) => {
        if (!transcript) return;

        if (expandDebounceRef.current) clearTimeout(expandDebounceRef.current);
        expandDebounceRef.current = setTimeout(async () => {
            setIsExpandingLocal(true);
            setExpandError(null);
            try {
                const resp = await fetch(`${WHISPER_ENDPOINT}/expand`, {
                    method: 'POST',
                    headers: getRoomAgentHeaders({ 'Content-Type': 'application/json' }),
                    body: JSON.stringify({
                        clinical_snapshot: snapshot,
                        doctor_actions: actions.map(a => a.text),
                        transcript,
                    }),
                });
                if (resp.ok) {
                    const data = await resp.json();
                    const nextIssues = coerceParagraphText(data.issuesParagraph ?? '');
                    const nextActions = coerceParagraphText(data.actionsParagraph ?? '');
                    onUpdateParagraphs(
                        nextIssues,
                        nextActions
                    );
                } else {
                    setExpandError('Failed to regenerate narrative — room agent may be unavailable.');
                }
            } catch (e) {
                console.error('expand failed', e);
                setExpandError('Failed to regenerate narrative — room agent may be unavailable.');
            } finally {
                setIsExpandingLocal(false);
            }
        }, 900);
    }, [transcript, onUpdateParagraphs]);

    // ── Clinical snapshot chip editing ─────────────────────────────────────
    const handleDeleteChip = useCallback((idx: number) => {
        if (isLocked) return;
        const updated = clinicalSnapshot.filter((_, i) => i !== idx);
        onUpdateSnapshot(updated);
        triggerExpand(updated, doctorActions);
    }, [isLocked, clinicalSnapshot, doctorActions, onUpdateSnapshot, triggerExpand]);

    const handleAddChip = useCallback(() => {
        const label = newChipText.trim().split(/\s+/).slice(0, 4).join(' ').toLowerCase().replace(/[.,;]$/, '');
        if (!label) { setAddingChip(false); setNewChipText(''); return; }
        const newFact: KeyFact = { label, category: 'symptom' };
        const updated = [...clinicalSnapshot, newFact];
        onUpdateSnapshot(updated);
        triggerExpand(updated, doctorActions);
        setAddingChip(false);
        setNewChipText('');
    }, [newChipText, clinicalSnapshot, doctorActions, onUpdateSnapshot, triggerExpand]);

    // ── Doctor actions bullet editing ──────────────────────────────────────
    const handleStartEdit = useCallback((item: SummaryItem) => {
        if (isLocked) return;
        setEditingId(item.id);
        setEditingText(item.text);
    }, [isLocked]);

    const handleSaveEdit = useCallback((items: SummaryItem[]) => {
        const updated = items.map(item =>
            item.id === editingId
                ? { ...item, text: editingText, isEdited: true }
                : item
        );
        onUpdateDoctorActions(updated);
        triggerExpand(clinicalSnapshot, updated);
        setEditingId(null);
        setEditingText('');
    }, [editingId, editingText, clinicalSnapshot, onUpdateDoctorActions, triggerExpand]);

    const handleDeleteAction = useCallback((id: string) => {
        const updated = doctorActions.filter(item => item.id !== id);
        onUpdateDoctorActions(updated);
        triggerExpand(clinicalSnapshot, updated);
    }, [doctorActions, clinicalSnapshot, onUpdateDoctorActions, triggerExpand]);

    const handleAddAction = useCallback(() => {
        const newItem: SummaryItem = {
            id: uuidv4(),
            text: 'New item',
            sourceFactIds: [],
            isEdited: true,
        };
        const updated = [...doctorActions, newItem];
        onUpdateDoctorActions(updated);
        setEditingId(newItem.id);
        setEditingText('New item');
    }, [doctorActions, onUpdateDoctorActions]);

    const renderActionBullet = (item: SummaryItem) => {
        const isEditing = editingId === item.id;
        return (
            <li key={item.id} className={`${styles.bulletItem} ${!isLocked ? styles.editable : ''}`}>
                <span className={styles.bulletMarker} />
                {isEditing ? (
                    <input
                        type="text"
                        className={styles.bulletInput}
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        onBlur={() => handleSaveEdit(doctorActions)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') handleSaveEdit(doctorActions);
                            if (e.key === 'Escape') { setEditingId(null); setEditingText(''); }
                        }}
                        autoFocus
                    />
                ) : (
                    <span className={styles.bulletText} onClick={() => handleStartEdit(item)}>
                        {item.text}
                    </span>
                )}
                {!isLocked && !isEditing && (
                    <div className={styles.bulletActions}>
                        <button className={styles.bulletBtn} onClick={() => handleStartEdit(item)} title="Edit">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                        </button>
                        <button className={`${styles.bulletBtn} ${styles.delete}`} onClick={() => handleDeleteAction(item.id)} title="Delete">
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
            {/* ── Header ──────────────────────────────────────────────────── */}
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
                    {isExpanding && (
                        <span className={styles.expandingBadge}>
                            <span className={styles.generatingDot} />
                            Updating…
                        </span>
                    )}
                    {expandError && !isExpanding && (
                        <span className={styles.expandError} title={expandError}>
                            Narrative update failed
                        </span>
                    )}
                </div>
            </div>

            <div className={styles.content}>
                {status === 'recording' ? (
                    <div className={styles.placeholder}>
                        <svg className={styles.placeholderIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        <h3 className={styles.placeholderTitle}>Recording in progress</h3>
                        <p className={styles.placeholderText}>Summary will be generated when you stop recording.</p>
                    </div>
                ) : (
                    <div className={styles.sections}>

                        {/* ── Clinical Snapshot ───────────────────────────── */}
                        {(filteredClinicalSnapshot.length > 0 || isSummarizing) && (
                            <div className={styles.snapshotSection}>
                                <div className={styles.snapshotHeader}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="3" />
                                        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
                                    </svg>
                                    <span className={styles.snapshotTitle}>Clinical Snapshot</span>
                                    {isSummarizing && (
                                        <span className={styles.generatingLabel}>
                                            <span className={styles.generatingDot} />
                                            Generating…
                                        </span>
                                    )}
                                </div>

                                {isSummarizing && filteredClinicalSnapshot.length === 0 ? (
                                    <div className={styles.shimmerStrip}>
                                        {[80,60,90,55,70,65].map((w,i) => (
                                            <div key={i} className={styles.shimmerChip} style={{ width: w }} />
                                        ))}
                                    </div>
                                ) : (
                                    <div className={styles.chipStrip}>
                                        {[...filteredClinicalSnapshot]
                                            .sort((a,b) =>
                                                CATEGORY_ORDER.indexOf(a.category as KeyFactCategory) -
                                                CATEGORY_ORDER.indexOf(b.category as KeyFactCategory)
                                            )
                                            .map((fact, i) => {
                                                const config = CATEGORY_CONFIG[fact.category as KeyFactCategory] ?? CATEGORY_CONFIG.symptom;
                                                return (
                                                    <span
                                                        key={i}
                                                        className={`${styles.chip} ${config.className}`}
                                                        title={config.label}
                                                    >
                                                        {fact.label}
                                                        {!isLocked && (
                                                            <button
                                                                className={styles.chipDelete}
                                                                onClick={() => handleDeleteChip(clinicalSnapshot.findIndex((item) => item.label === fact.label && item.category === fact.category))}
                                                                title="Remove"
                                                            >×</button>
                                                        )}
                                                    </span>
                                                );
                                            })}

                                        {!isLocked && (
                                            addingChip ? (
                                                <input
                                                    className={styles.addChipInput}
                                                    placeholder="Type symptom…"
                                                    value={newChipText}
                                                    onChange={e => setNewChipText(e.target.value)}
                                                    onBlur={handleAddChip}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter') handleAddChip();
                                                        if (e.key === 'Escape') { setAddingChip(false); setNewChipText(''); }
                                                    }}
                                                    autoFocus
                                                />
                                            ) : (
                                                <button
                                                    className={styles.addChipBtn}
                                                    onClick={() => setAddingChip(true)}
                                                    title="Add chip"
                                                >
                                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                                        <path d="M12 5v14m-7-7h14" />
                                                    </svg>
                                                </button>
                                            )
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Doctor's Notes ───────────────────────────────── */}
                        {(dedupedDoctorActions.length > 0 || uniqueAdvice.length > 0 || isSummarizing || isDraft) && (
                            <div className={styles.section}>
                                <div className={styles.sectionHeader}>
                                    <svg className={styles.sectionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                    </svg>
                                    <h3 className={styles.sectionTitle}>Doctor Notes</h3>
                                    {(dedupedDoctorActions.length + uniqueAdvice.length) > 0 && (
                                        <span className={styles.countBadge}>{dedupedDoctorActions.length + uniqueAdvice.length}</span>
                                    )}
                                </div>

                                {isSummarizing && dedupedDoctorActions.length === 0 && uniqueAdvice.length === 0 ? (
                                    <div className={styles.shimmerList}>
                                        {[200,160,220].map((w,i) => (
                                            <div key={i} className={styles.shimmerLine} style={{ width: w }} />
                                        ))}
                                    </div>
                                ) : (dedupedDoctorActions.length > 0 || uniqueAdvice.length > 0) ? (
                                    <ul className={styles.bulletList}>
                                        {dedupedDoctorActions.map(item => renderActionBullet(item))}
                                        {uniqueAdvice.map((text, index) => (
                                            <li key={`advice-${index}`} className={styles.bulletItem}>
                                                <span className={styles.bulletMarker} />
                                                <span className={styles.bulletText}>{text}</span>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <div className={styles.emptySection}>No notes captured</div>
                                )}

                                {!isLocked && (
                                    <button className={styles.addItemBtn} onClick={handleAddAction}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M12 5v14m-7-7h14" />
                                        </svg>
                                        Add note
                                    </button>
                                )}
                            </div>
                        )}

                        {/* ── Prescription ─────────────────────────────────── */}
                        {prescriptionMeds.length > 0 && (
                            <div className={styles.section}>
                                <div className={styles.sectionHeader}>
                                    <svg className={styles.sectionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                                    </svg>
                                    <h3 className={styles.sectionTitle}>Prescription</h3>
                                    <span className={styles.countBadge}>{prescriptionMeds.length}</span>
                                </div>
                                <ul className={styles.medList}>
                                    {prescriptionMeds.map((med, index) => (
                                        <li key={index} className={styles.medItem}>
                                            <span className={styles.medName}>{med.name}</span>
                                            <span className={styles.medMeta}>
                                                {[med.dosage, med.frequency, med.duration].filter(Boolean).join(' · ')}
                                            </span>
                                            {med.instructions && (
                                                <span className={styles.medInstructions}>{med.instructions}</span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* ── Clinical Summary ──────────────────────────────── */}
                        {(mergedNarrative || isSummarizing) && (
                            <div className={styles.sectionCompact}>
                                <div className={styles.sectionHeader}>
                                    <h3 className={styles.sectionTitle}>Clinical Summary</h3>
                                </div>
                                {isSummarizing && !mergedNarrative ? (
                                    <div className={styles.shimmerParagraph}>
                                        {[100,85,95,70,88].map((w,i) => (
                                            <div key={i} className={styles.shimmerLine} style={{ width: `${w}%` }} />
                                        ))}
                                    </div>
                                ) : (
                                    <p className={`${styles.paragraphText} ${isExpanding ? styles.paragraphUpdating : ''}`}>
                                        {mergedNarrative || 'No summary generated yet.'}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Warning if draft and empty */}
                        {isDraft && isEmpty && (
                            <div className={styles.warningBanner}>
                                <svg className={styles.warningIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <span className={styles.warningText}>No summary generated yet. Review before approving.</span>
                            </div>
                        )}

                    </div>
                )}
            </div>
        </div>
    );
}
