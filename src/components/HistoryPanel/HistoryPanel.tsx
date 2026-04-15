'use client';

import { useState } from 'react';
import type React from 'react';
import styles from './HistoryPanel.module.css';
import { Visit } from '@/types';
import { downloadVisitPrescription } from '@/services/api';
import { Doctor, EMRPatient } from '@/types/emr';

const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'with', 'in', 'on', 'at', 'by', 'from', 'is', 'are', 'was', 'were',
    'patient', 'doctor', 'dr', 'take', 'give', 'check', 'look', 'reported', 'reports', 'advised', 'advice'
]);

function normalizeText(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenize(value: string): string[] {
    return normalizeText(value)
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function similarity(a: string, b: string): number {
    const aTokens = new Set(tokenize(a));
    const bTokens = new Set(tokenize(b));
    if (aTokens.size === 0 || bTokens.size === 0) return 0;
    let overlap = 0;
    aTokens.forEach((token) => {
        if (bTokens.has(token)) overlap += 1;
    });
    const denom = Math.max(aTokens.size, bTokens.size);
    return overlap / denom;
}

function dedupeBySimilarity(values: string[], threshold = 0.72): string[] {
    const out: string[] = [];
    values.forEach((value) => {
        const text = value.trim();
        if (!text) return;
        const duplicate = out.some((existing) => similarity(existing, text) >= threshold);
        if (!duplicate) out.push(text);
    });
    return out;
}

function removeNearDuplicates(values: string[], reference: string[], threshold = 0.68): string[] {
    return values.filter((value) => !reference.some((ref) => similarity(value, ref) >= threshold));
}

function mergeUniquePlanItems(actions: string[], advice: string[]): string[] {
    const merged = dedupeBySimilarity([...actions, ...advice], 0.7);
    return merged;
}

function deriveChiefComplaint(
    chiefComplaint: string,
    snapshotLabels: string[],
    issuesParagraph: string,
    doctorActions: string[],
): string {
    if (chiefComplaint.trim()) return chiefComplaint.trim();
    const symptomLike = snapshotLabels.find((item) => !/\b(no|denies|without|normal)\b/i.test(item));
    if (symptomLike) return symptomLike;
    const firstIssueSentence = issuesParagraph.split(/[.!?]/).map((s) => s.trim()).find(Boolean);
    if (firstIssueSentence) return firstIssueSentence;
    return doctorActions[0] ?? '';
}

function deriveQuality(
    explicitQuality: { score?: number; confidence?: number; missingFields?: string[] } | undefined,
    args: {
        snapshotCount: number;
        doctorActionCount: number;
        diagnosisCount: number;
        medicationCount: number;
        hasIssues: boolean;
        hasActions: boolean;
        chiefComplaint: string;
    }
): { score: number; confidence: number; missingFields: string[] } {
    if (explicitQuality && Number.isFinite(explicitQuality.score) && explicitQuality.score! > 0) {
        return {
            score: Math.max(0, Math.min(100, Number(explicitQuality.score ?? 0))),
            confidence: Math.max(0, Math.min(1, Number(explicitQuality.confidence ?? 0))),
            missingFields: explicitQuality.missingFields ?? [],
        };
    }

    const missingFields: string[] = [];
    if (!args.chiefComplaint) missingFields.push('chiefComplaint');
    if (args.medicationCount === 0) missingFields.push('medications');
    if (args.doctorActionCount === 0 && !args.hasActions) missingFields.push('doctorActions');

    const coveredSignals =
        (args.snapshotCount > 0 ? 1 : 0)
        + (args.doctorActionCount > 0 ? 1 : 0)
        + (args.diagnosisCount > 0 ? 1 : 0)
        + (args.medicationCount > 0 ? 1 : 0)
        + (args.hasIssues ? 1 : 0)
        + (args.hasActions ? 1 : 0)
        + (args.chiefComplaint ? 1 : 0);

    const score = Math.max(35, Math.min(92, 36 + coveredSignals * 8 - missingFields.length * 6));
    const confidence = Math.max(0.48, Math.min(0.9, 0.5 + coveredSignals * 0.05 - missingFields.length * 0.04));

    return { score, confidence, missingFields };
}

interface HistoryPanelProps {
    visits: Visit[];
    isOpen: boolean;
    onClose: () => void;
    patient?: EMRPatient | null;
    doctorsById?: Record<string, Doctor>;
}

function formatDate(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(d: string) {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatYear(d: string) {
    return new Date(d).getFullYear();
}

function formatStatus(status: string) {
    return status.replace(/_/g, ' ');
}

function getSnapshotChipClass(category: string) {
    switch (category) {
        case 'symptom':
            return styles.chipSymptom;
        case 'warning':
            return styles.chipWarning;
        case 'negative':
            return styles.chipNegative;
        case 'timing':
            return styles.chipTiming;
        case 'medication':
            return styles.chipMedication;
        case 'lifestyle':
            return styles.chipLifestyle;
        case 'condition':
            return styles.chipCondition;
        case 'result':
            return styles.chipResult;
        case 'action':
        default:
            return styles.chipAction;
    }
}

function VisitDetail({
    visit,
    index,
    total,
    patient,
    doctorsById,
}: {
    visit: Visit;
    index: number;
    total: number;
    patient?: EMRPatient | null;
    doctorsById?: Record<string, Doctor>;
}) {
    const visitNum = total - index;
    const clinicalSnapshot = visit.summary?.clinicalSnapshot ?? [];
    const doctorActions = visit.summary?.doctorActions ?? [];
    const issuesParagraph = visit.summary?.issuesParagraph?.trim() ?? '';
    const actionsParagraph = visit.summary?.actionsParagraph?.trim() ?? '';
    const chiefComplaintRaw = visit.summary?.chiefComplaint?.trim() ?? '';
    const quality = visit.summary?.quality;
    const prescriptionDraft = visit.summary?.prescriptionDraft;
    const diagnoses = prescriptionDraft?.diagnoses ?? [];
    const medications = (prescriptionDraft?.medications ?? []) as Array<{ name: string; dosage?: string; frequency?: string; duration?: string; route?: string; instructions?: string }>;
    const investigations = prescriptionDraft?.investigations ?? [];
    const advice = prescriptionDraft?.advice ?? [];

    const snapshotLabels = dedupeBySimilarity(clinicalSnapshot.map((chip) => chip.label));
    const doctorActionTexts = dedupeBySimilarity(doctorActions.map((a) => a.text));
    const uniqueDiagnoses = removeNearDuplicates(dedupeBySimilarity(diagnoses), snapshotLabels, 0.6);
    const uniqueAdvice = removeNearDuplicates(dedupeBySimilarity(advice), doctorActionTexts, 0.62);
    const uniqueDoctorActions = removeNearDuplicates(doctorActionTexts, uniqueAdvice, 0.72);
    const mergedCarePlan = mergeUniquePlanItems(uniqueDoctorActions, uniqueAdvice);

    const hasIssues = Boolean(issuesParagraph) && !snapshotLabels.some((item) => similarity(item, issuesParagraph) >= 0.38);
    const hasActions = Boolean(actionsParagraph) && !uniqueDoctorActions.some((item) => similarity(item, actionsParagraph) >= 0.38);
    const chiefComplaint = deriveChiefComplaint(chiefComplaintRaw, snapshotLabels, issuesParagraph, uniqueDoctorActions);
    const qualityView = deriveQuality(quality, {
        snapshotCount: snapshotLabels.length,
        doctorActionCount: uniqueDoctorActions.length,
        diagnosisCount: uniqueDiagnoses.length,
        medicationCount: medications.length,
        hasIssues,
        hasActions,
        chiefComplaint,
    });

    return (
        <div className={styles.detailCard}>
            <div className={styles.detailHeader}>
                <div className={styles.detailHeaderLeft}>
                    <span className={styles.detailVisitNum}>Visit #{visitNum}</span>
                    <span className={styles.detailDate}>{formatDate(visit.createdAt)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {visit.status === 'completed' && (
                        <button
                            type="button"
                            className={styles.clearCompareBtn}
                            onClick={() => void downloadVisitPrescription(visit.id, {
                                visit,
                                patient,
                                doctor: visit.doctorId ? doctorsById?.[visit.doctorId] : null,
                                allergies: patient?.medicalHistory?.allergies ?? [],
                            })}
                        >
                            Download Prescription
                        </button>
                    )}
                    <span className={styles.detailStatus}>{visit.status}</span>
                </div>
            </div>

            <div className={styles.summaryStrip}>
                <div className={styles.summaryItemPrimary}>
                    <span className={styles.summaryKey}>Chief complaint</span>
                    <span className={styles.summaryValPrimary}>{chiefComplaint || 'Not captured'}</span>
                    <span className={styles.summaryMeta}>
                        AI metadata: quality {Math.round(qualityView.score)}% · confidence {Math.round(qualityView.confidence * 100)}%
                    </span>
                </div>
            </div>

            {snapshotLabels.length > 0 && (
                <div className={styles.detailSection}>
                    <div className={styles.detailSectionLabel}>Clinical Findings</div>
                    <div className={styles.detailChipRow}>
                        {snapshotLabels.map((label, chipIdx) => (
                            <span
                                key={`${label}-${chipIdx}`}
                                className={[styles.chip, getSnapshotChipClass(clinicalSnapshot.find((c) => c.label === label)?.category ?? 'action')].join(' ')}
                            >
                                {label}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {uniqueDiagnoses.length > 0 && (
                <div className={styles.detailSection}>
                    <div className={styles.detailSectionLabel}>Diagnosis</div>
                    <div className={styles.detailChipRow}>
                        {uniqueDiagnoses.map((d, i) => <span key={i} className={styles.chip + ' ' + styles.chipCondition}>{d}</span>)}
                    </div>
                </div>
            )}

            {medications.length > 0 && (
                <div className={styles.detailSection}>
                    <div className={styles.detailSectionLabel}>Prescription</div>
                    <div className={styles.medTable}>
                        {medications.map((med, i) => (
                            <div key={i} className={styles.medRow}>
                                <div className={styles.medName}>{med.name}</div>
                                <div className={styles.medMeta}>
                                    {med.dosage && <span>{med.dosage}</span>}
                                    {med.frequency && <span>{med.frequency}</span>}
                                    {med.duration && <span>{med.duration}</span>}
                                    {med.route && med.route !== 'Oral' && <span>{med.route}</span>}
                                </div>
                                {med.instructions && <div className={styles.medInstructions}>{med.instructions}</div>}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {mergedCarePlan.length > 0 && (
                <div className={styles.detailSection}>
                    <div className={styles.detailSectionLabel}>Care Plan</div>
                    <ol className={styles.detailNumberedList}>
                        {mergedCarePlan.map((itemText, itemIdx) => (
                            <li key={`${itemText}-${itemIdx}`} className={styles.detailNumberedItem}>
                                <span className={styles.detailNumber}>{itemIdx + 1}.</span>
                                <span>{itemText}</span>
                            </li>
                        ))}
                    </ol>
                </div>
            )}

            {investigations.length > 0 && (
                <div className={styles.detailSection}>
                    <div className={styles.detailSectionLabel}>Investigations</div>
                    <ul className={styles.detailBulletList}>
                        {investigations.map((inv, i) => <li key={i}>{typeof inv === 'string' ? inv : inv.name}</li>)}
                    </ul>
                </div>
            )}

            {(hasIssues || hasActions) && (
                <div className={styles.detailSection}>
                    <div className={styles.detailSectionLabel}>Summary</div>
                    <p className={styles.detailParagraph}>{[issuesParagraph, actionsParagraph].filter(Boolean).join(' ')}</p>
                </div>
            )}

            {prescriptionDraft?.followUp && (
                <div className={styles.detailSection}>
                    <div className={styles.detailSectionLabel}>Follow-up</div>
                    <p className={styles.detailParagraph}>{typeof prescriptionDraft.followUp === 'string' ? prescriptionDraft.followUp : (prescriptionDraft.followUp?.timeline ?? prescriptionDraft.followUp?.notes ?? '')}</p>
                </div>
            )}
        </div>
    );
}
export default function HistoryPanel({ visits, isOpen, onClose, patient, doctorsById }: HistoryPanelProps) {
    const [selectedIds, setSelectedIds] = useState<string[]>(() =>
        visits.length > 0 ? [visits[0].id] : []
    );

    if (!isOpen || visits.length === 0) return null;

    const handleSelect = (e: React.MouseEvent, id: string) => {
        const isModified = e.metaKey || e.ctrlKey;
        if (!isModified) {
            setSelectedIds([id]);
        } else {
            setSelectedIds(prev => {
                if (prev.includes(id)) return prev;
                return [prev[0] ?? id, id];
            });
        }
    };

    const selectedVisits = selectedIds
        .map(id => visits.find(v => v.id === id))
        .filter(Boolean) as Visit[];

    // Group visits by year for timeline
    const byYear: Record<string, Visit[]> = {};
    visits.forEach(v => {
        const y = String(formatYear(v.createdAt));
        if (!byYear[y]) byYear[y] = [];
        byYear[y].push(v);
    });
    const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));

    const isComparing = selectedIds.length === 2;

    return (
        <div className={styles.panel}>
            {/* ── Panel Header ── */}
            <div className={styles.panelHeader}>
                <div className={styles.panelHeaderLeft}>
                    <span className={styles.panelTitle}>Visit History</span>
                    <span className={styles.panelCount}>{visits.length} visit{visits.length !== 1 ? 's' : ''}</span>
                    {isComparing && (
                        <span className={styles.compareLabel}>
                            Comparing 2 visits
                        </span>
                    )}
                </div>
                <div className={styles.panelHeaderRight}>
                    {isComparing && (
                        <button
                            className={styles.clearCompareBtn}
                            onClick={() => setSelectedIds([selectedIds[0]])}
                        >
                            Clear compare
                        </button>
                    )}
                    <span className={styles.hint}>Click to view · ⌘/Ctrl+Click to compare</span>
                    <button className={styles.closeBtn} onClick={onClose} aria-label="Close history panel">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* ── Body: Timeline + Detail ── */}
            <div className={styles.panelBody}>

                {/* Left: Visit Timeline */}
                <div className={styles.timeline}>
                    {years.map(year => (
                        <div key={year} className={styles.timelineYear}>
                            <div className={styles.timelineYearLabel}>{year}</div>
                            {byYear[year].map((visit) => {
                                const isSelected = selectedIds.includes(visit.id);
                                const isPrimary = selectedIds[0] === visit.id;
                                const isSecondary = selectedIds[1] === visit.id;

                                return (
                                    <button
                                        key={visit.id}
                                        className={[
                                            styles.timelineItem,
                                            isSelected ? styles.timelineItemSelected : '',
                                            isPrimary ? styles.timelineItemPrimary : '',
                                            isSecondary ? styles.timelineItemSecondary : '',
                                        ].join(' ')}
                                        onClick={(e) => handleSelect(e, visit.id)}
                                    >
                                        <div className={styles.timelineDot} />
                                        <div className={styles.timelineContent}>
                                            <div className={styles.timelineItemHeader}>
                                                <span className={styles.timelineItemDate}>{formatDateShort(visit.createdAt)}</span>
                                                <span className={styles.timelineItemStatus}>{formatStatus(visit.status)}</span>
                                            </div>
                                        </div>
                                        {isComparing && isSelected && (
                                            <span className={[styles.compareBadge, isPrimary ? styles.compareBadge1 : styles.compareBadge2].join(' ')}>
                                                {isPrimary ? 'A' : 'B'}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* Right: Detail / Compare View */}
                <div className={[styles.detailArea, isComparing ? styles.detailAreaCompare : ''].join(' ')}>
                    {selectedVisits.map((visit, i) => (
                        <div key={visit.id} className={isComparing ? styles.compareColumn : styles.singleColumn}>
                            {isComparing && (
                                <div className={[styles.compareColumnHeader, i === 0 ? styles.compareColHeaderA : styles.compareColHeaderB].join(' ')}>
                                    <span className={styles.compareColBadge}>{i === 0 ? 'A' : 'B'}</span>
                                    Visit #{visits.length - visits.indexOf(visit)} &nbsp;·&nbsp; {formatDate(visit.createdAt)}
                                </div>
                            )}
                            <VisitDetail
                                visit={visit}
                                index={visits.indexOf(visit)}
                                total={visits.length}
                                patient={patient}
                                doctorsById={doctorsById}
                            />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
