'use client';

import { useState, useCallback, useRef } from 'react';
import styles from './SummaryPanel.module.css';
import { SummaryItem, VisitStatus, KeyFact, KeyFactCategory, VisitSummary } from '@/types';
import { v4 as uuidv4 } from 'uuid';

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

function inferChiefComplaint(summary: VisitSummary): string {
    const explicit = summary.chiefComplaint?.trim();
    if (explicit) return explicit;
    const symptom = summary.clinicalSnapshot.find((item) => item.category === 'symptom' && (item.status ?? 'confirmed') !== 'denied')?.label;
    if (symptom) return symptom;
    const issueLead = summary.issuesParagraph.split(/[.!?]/).map((s) => s.trim()).find(Boolean);
    return issueLead ?? '';
}

function deriveQuality(summary: VisitSummary, chiefComplaint: string): NonNullable<VisitSummary['quality']> {
    if (summary.quality && Number.isFinite(summary.quality.score) && summary.quality.score > 0) {
        return {
            score: Math.max(0, Math.min(100, summary.quality.score)),
            confidence: Math.max(0, Math.min(1, summary.quality.confidence)),
            missingFields: summary.quality.missingFields ?? [],
            mode: summary.quality.mode ?? 'hybrid',
            generatedAt: summary.quality.generatedAt,
        };
    }

    const missingFields: string[] = [];
    if (!chiefComplaint) missingFields.push('chiefComplaint');
    if ((summary.doctorActions?.length ?? 0) === 0 && !summary.actionsParagraph.trim()) missingFields.push('doctorActions');
    if ((summary.prescriptionDraft?.medications?.length ?? 0) === 0) missingFields.push('medications');

    const richness =
        (summary.clinicalSnapshot.length > 0 ? 1 : 0)
        + (summary.doctorActions.length > 0 ? 1 : 0)
        + (summary.issuesParagraph.trim() ? 1 : 0)
        + (summary.actionsParagraph.trim() ? 1 : 0)
        + ((summary.prescriptionDraft?.diagnoses?.length ?? 0) > 0 ? 1 : 0)
        + ((summary.prescriptionDraft?.medications?.length ?? 0) > 0 ? 1 : 0)
        + (chiefComplaint ? 1 : 0);

    return {
        score: Math.max(32, Math.min(93, 34 + richness * 8 - missingFields.length * 7)),
        confidence: Math.max(0.45, Math.min(0.9, 0.5 + richness * 0.05 - missingFields.length * 0.05)),
        missingFields,
        mode: 'hybrid',
        generatedAt: new Date().toISOString(),
    };
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
    const expandDebounceRef = useRef<NodeJS.Timeout | null>(null);

    const isExpanding = isExpandingProp || isExpandingLocal;
    const isLocked = status === 'approved';
    const isDraft = status === 'draft';
    const isEmpty = summary.clinicalSnapshot.length === 0 && summary.doctorActions.length === 0;

    const {
        clinicalSnapshot,
        doctorActions,
        issuesParagraph,
        actionsParagraph,
        structuredFindings = [],
    } = summary;

    const derivedChiefComplaint = inferChiefComplaint(summary);
    const quality = deriveQuality(summary, derivedChiefComplaint);

    const dedupedDoctorActions = dedupeStrings(doctorActions.map((item) => item.text))
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

    const uniqueAdvice = dedupeStrings(summary.prescriptionDraft?.advice ?? [])
        .filter((text) => !dedupedDoctorActions.some((action) => tokenSimilarity(action.text, text) >= 0.7));

    const mergedNarrative = dedupeStrings([issuesParagraph, actionsParagraph], 0.55).join('\n\n').trim();

    const topFindings = (structuredFindings.length > 0
        ? structuredFindings
        : (dedupedClinicalSnapshot ?? []).map((item, idx) => ({
            id: `snapshot-${idx}`,
            label: item.label,
            category: item.category,
            status: item.status ?? (item.category === 'negative' ? 'denied' : 'confirmed'),
            confidence: item.confidence ?? 0.8,
            evidence: item.evidence,
        })))
        .filter((item) => item.status !== 'denied')
        .slice(0, 6);

    const hasSummaryContent =
        dedupedClinicalSnapshot.length > 0
        || dedupedDoctorActions.length > 0
        || mergedNarrative.length > 0
        || topFindings.length > 0
        || !!derivedChiefComplaint
        || (summary.prescriptionDraft?.diagnoses?.length ?? 0) > 0
        || (summary.prescriptionDraft?.medications?.length ?? 0) > 0;

    // ── Trigger /expand after any bullet edit ──────────────────────────────
    const triggerExpand = useCallback(async (
        snapshot: KeyFact[],
        actions: SummaryItem[]
    ) => {
        if (!transcript) return;

        if (expandDebounceRef.current) clearTimeout(expandDebounceRef.current);
        expandDebounceRef.current = setTimeout(async () => {
            setIsExpandingLocal(true);
            try {
                const resp = await fetch(`${WHISPER_ENDPOINT}/expand`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        clinical_snapshot: snapshot,
                        doctor_actions: actions.map(a => a.text),
                        transcript,
                    }),
                });
                if (resp.ok) {
                    const data = await resp.json();
                    onUpdateParagraphs(
                        data.issuesParagraph ?? '',
                        data.actionsParagraph ?? ''
                    );
                }
            } catch (e) {
                console.error('expand failed', e);
            } finally {
                setIsExpandingLocal(false);
            }
        }, 900); // debounce 900ms so rapid edits only fire once
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
                {item.isSupported === false && (
                    <span
                        className={styles.unsupportedBadge}
                        aria-label="Not found in transcript — verify before approving"
                        title="AI Confidence Low: This claim was not explicitly found in the transcript."
                    >
                        Not in transcript
                    </span>
                )}
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
                </div>
            </div>

            <div className={styles.content}>
                {/* ── Recording placeholder ───────────────────────────────── */}
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

                        <div className={styles.overviewCard}>
                            <div className={styles.overviewHeader}>
                                <div>
                                    <div className={styles.overviewLabel}>Chief Complaint</div>
                                    <div className={styles.overviewValue}>{derivedChiefComplaint || 'No summary generated yet'}</div>
                                </div>
                                {hasSummaryContent && (
                                    <div className={styles.qualityWrap}>
                                        <span className={styles.qualityBadge}>
                                            {(quality?.mode ?? 'hybrid').replace('_', ' ')}
                                        </span>
                                        <span className={styles.qualityText}>Quality {Math.round(quality?.score ?? 0)}%</span>
                                        <span className={styles.qualityText}>Confidence {Math.round((quality?.confidence ?? 0) * 100)}%</span>
                                    </div>
                                )}
                            </div>

                            {topFindings.length > 0 && (
                                <div className={styles.topFindingsRow}>
                                    {topFindings.map((item) => {
                                        const config = CATEGORY_CONFIG[item.category as KeyFactCategory] ?? CATEGORY_CONFIG.symptom;
                                        return (
                                            <span key={item.id} className={`${styles.chip} ${config.className}`} title={item.evidence || config.label}>
                                                {item.label}
                                            </span>
                                        );
                                    })}
                                </div>
                            )}

                            {hasSummaryContent && quality?.missingFields?.length ? (
                                <div className={styles.missingFields}>
                                    Missing: {quality.missingFields.join(', ')}
                                </div>
                            ) : null}
                        </div>

                        <div className={styles.sectionCompact}>
                            <div className={styles.sectionHeader}>
                                <h3 className={styles.sectionTitle}>Clinical Summary</h3>
                            </div>
                            <p className={styles.paragraphText}>{mergedNarrative || 'No summary generated yet.'}</p>
                        </div>

                        {/* ── Section 1: Clinical Snapshot ────────────────────── */}
                        {(dedupedClinicalSnapshot.length > 0 || isSummarizing) && (
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

                                {isSummarizing && dedupedClinicalSnapshot.length === 0 ? (
                                    <div className={styles.shimmerStrip}>
                                        {[80,60,90,55,70,65].map((w,i) => (
                                            <div key={i} className={styles.shimmerChip} style={{ width: w }} />
                                        ))}
                                    </div>
                                ) : (
                                    <div className={styles.chipStrip}>
                                        {[...dedupedClinicalSnapshot]
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
                                                        title={fact.isSupported === false ? "AI Confidence Low: This claim was not explicitly found in the transcript." : config.label}
                                                    >
                                                        {fact.label}
                                                        {fact.isSupported === false && (
                                                            <span
                                                                className={styles.chipUnsupported}
                                                                aria-label="Not found in transcript"
                                                                title="AI Confidence Low: This claim was not explicitly found in the transcript."
                                                            >!</span>
                                                        )}
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

                                        {/* Add chip input */}
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

                        {uniqueAdvice.length > 0 && (
                            <div className={styles.section}>
                                <div className={styles.sectionHeader}>
                                    <h3 className={styles.sectionTitle}>Advice</h3>
                                    <span className={styles.countBadge}>{uniqueAdvice.length}</span>
                                </div>
                                <ul className={styles.bulletList}>
                                    {uniqueAdvice.slice(0, 5).map((item, index) => (
                                        <li key={`${item}-${index}`} className={styles.bulletItem}>
                                            <span className={styles.bulletMarker} />
                                            <span className={styles.bulletText}>{item}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* ── Section 2: Doctor's Actions ──────────────────────── */}
                        {(dedupedDoctorActions.length > 0 || isSummarizing || isDraft) && (
                            <div className={styles.section}>
                                <div className={styles.sectionHeader}>
                                    <svg className={styles.sectionIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                    </svg>
                                    <h3 className={styles.sectionTitle}>Doctor Actions</h3>
                                    <span className={styles.countBadge}>{dedupedDoctorActions.length}</span>
                                </div>

                                {isSummarizing && dedupedDoctorActions.length === 0 ? (
                                    <div className={styles.shimmerList}>
                                        {[200,160,220].map((w,i) => (
                                            <div key={i} className={styles.shimmerLine} style={{ width: w }} />
                                        ))}
                                    </div>
                                ) : dedupedDoctorActions.length > 0 ? (
                                    <ul className={styles.bulletList}>
                                        {dedupedDoctorActions.map(item => renderActionBullet(item))}
                                    </ul>
                                ) : (
                                    <div className={styles.emptySection}>No actions captured</div>
                                )}

                                {!isLocked && (
                                    <button className={styles.addItemBtn} onClick={handleAddAction}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M12 5v14m-7-7h14" />
                                        </svg>
                                        Add item
                                    </button>
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
