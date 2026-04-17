'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import styles from './TranscriptionPanel.module.css';
import type { DialogueTurn } from '@/hooks/useWhisperLive';

interface TranscriptionPanelProps {
    confirmedText: string;
    partialText: string;
    livePreviewText?: string;
    confidence?: number;
    isRecording: boolean;
    isProcessing: boolean;
    connectionStatus?: 'disconnected' | 'connecting' | 'connected' | 'error';
    dialogue?: DialogueTurn[];
    onReassign?: (turnIndex: number, newSpeaker: string) => void;
    isEditable?: boolean;
    onEditTurn?: (index: number, newText: string) => void;
    onAddTurn?: (speaker: string, text: string) => void;
    doctorName?: string | null;
    patientName?: string | null;
}

function SpeakerAvatar({ name }: { name: string }) {
    function getInitials(fullName: string) {
        if (!fullName || fullName === "Unknown") return "?";
        const cleaned = fullName.replace(/^Dr\.?\s*/i, "").trim();
        const parts = cleaned.split(" ").filter(Boolean);
        if (parts.length === 0) return "?";
        if (parts.length === 1) return parts[0][0].toUpperCase();
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }

    function getColor(name: string) {
        if (!name || name === "Unknown") return { bg: "#f0f0f0", text: "#999999" };
        const colors = [
            { bg: "#E3F2FD", text: "#1565C0" }, // blue
            { bg: "#E8F5E9", text: "#2E7D32" }, // green
            { bg: "#FFF3E0", text: "#E65100" }, // orange
            { bg: "#F3E5F5", text: "#6A1B9A" }, // purple
        ];
        const hash = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
        return colors[hash % colors.length];
    }

    const initials = getInitials(name);
    const { bg, text } = getColor(name);

    return (
        <div
            style={{
                backgroundColor: bg,
                color: text,
                width: 32,
                height: 32,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                flexShrink: 0,
                letterSpacing: "0.05em",
                marginRight: "8px"
            }}
        >
            {initials}
        </div>
    );
}

export default function TranscriptionPanel({
    confirmedText,
    partialText,
    livePreviewText,
    confidence = 0,
    isRecording,
    isProcessing,
    connectionStatus = 'disconnected',
    dialogue = [],
    onReassign,
    isEditable = false,
    onEditTurn,
    onAddTurn,
    doctorName,
    patientName,
}: TranscriptionPanelProps) {
    const contentRef = useRef<HTMLDivElement>(null);
    const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const addTextareaRef = useRef<HTMLTextAreaElement | null>(null);

    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editText, setEditText] = useState('');
    const [isAddingTurn, setIsAddingTurn] = useState(false);
    const resolvedDoctorName = (doctorName || 'Doctor').trim() || 'Doctor';
    const resolvedPatientName = (patientName || 'Patient').trim() || 'Patient';
    const [newTurnSpeaker, setNewTurnSpeaker] = useState(resolvedDoctorName);
    const [newTurnText, setNewTurnText] = useState('');

    const SPEAKER_OPTIONS = [resolvedDoctorName, resolvedPatientName, "Companion"];

    useEffect(() => {
        setNewTurnSpeaker(resolvedDoctorName);
    }, [resolvedDoctorName]);

    const autoResize = useCallback((textarea: HTMLTextAreaElement | null) => {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }, []);

    // Auto-scroll to bottom when text updates
    useEffect(() => {
        if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }
    }, [confirmedText, partialText, dialogue]);

    useEffect(() => {
        autoResize(editTextareaRef.current);
    }, [editText, editingIndex, autoResize]);

    useEffect(() => {
        autoResize(addTextareaRef.current);
    }, [newTurnText, isAddingTurn, autoResize]);

    const isEmpty = !confirmedText && !partialText;
    const confidencePercent = Math.round(confidence * 100);

    const safeEditingIndex = editingIndex !== null && editingIndex < dialogue.length ? editingIndex : null;

    const handleSaveEdit = () => {
        if (safeEditingIndex === null) return;
        const trimmed = editText.trim();
        onEditTurn?.(safeEditingIndex, trimmed);
        setEditingIndex(null);
        setEditText('');
    };

    const handleCancelEdit = () => {
        setEditingIndex(null);
        setEditText('');
    };

    const handleSaveNewTurn = () => {
        const trimmed = newTurnText.trim();
        if (!trimmed) {
            return;
        }

        onAddTurn?.(newTurnSpeaker, trimmed);
        setNewTurnText('');
        setNewTurnSpeaker(resolvedDoctorName);
        setIsAddingTurn(false);
    };

    const handleCancelNewTurn = () => {
        setNewTurnText('');
        setNewTurnSpeaker(resolvedDoctorName);
        setIsAddingTurn(false);
    };

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <h2 className={styles.title}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    Live Transcription
                </h2>

                <div className={styles.statusGroup}>
                    {/* Confidence indicator */}
                    {(confirmedText || partialText) && confidence > 0 && (
                        <div className={styles.confidenceIndicator} title={`Confidence: ${confidencePercent}%`}>
                            <div
                                className={styles.confidenceBar}
                                style={{
                                    width: `${confidencePercent}%`,
                                    backgroundColor: confidence > 0.8 ? 'var(--color-success)' :
                                        confidence > 0.5 ? 'var(--color-warning)' :
                                            'var(--color-danger)'
                                }}
                            />
                            <span className={styles.confidenceText}>{confidencePercent}%</span>
                        </div>
                    )}

                    {/* Connection status */}
                    {isRecording && connectionStatus === 'connected' && (
                        <div className={styles.liveIndicator}>
                            <span className={styles.liveDot} />
                            LIVE
                        </div>
                    )}

                    {isRecording && connectionStatus === 'connecting' && (
                        <div className={styles.liveIndicator} style={{ backgroundColor: 'var(--color-warning-light)', color: 'var(--color-warning)' }}>
                            Connecting...
                        </div>
                    )}

                    {isProcessing && (
                        <div className={styles.liveIndicator} style={{ backgroundColor: 'var(--color-warning-light)', color: 'var(--color-warning)' }}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className={styles.spinIcon}>
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" />
                                <path d="M12 2C6.47715 2 2 6.47715 2 12" />
                            </svg>
                            Processing...
                        </div>
                    )}
                </div>
            </div>

            <div className={styles.content} ref={contentRef}>
                {isEmpty && !isRecording && !isProcessing ? (
                    <div className={styles.placeholder}>
                        <svg
                            className={styles.placeholderIcon}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                        >
                            <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                        <h3 className={styles.placeholderTitle}>No transcription yet</h3>
                        <p className={styles.placeholderText}>
                            Start recording to see live transcription appear here.
                        </p>
                    </div>
                ) : isEmpty && isRecording && !livePreviewText ? (
                    <div className={styles.placeholder}>
                        <div className={styles.recordingPulse}></div>
                        <h3 className={styles.placeholderTitle}>Listening</h3>
                        <p className={styles.placeholderText}>
                            Audio is being captured.
                        </p>
                    </div>
                ) : isEmpty && isProcessing ? (
                    <div className={styles.placeholder}>
                        <div className={styles.loadingSpinner}></div>
                        <h3 className={styles.placeholderTitle}>Processing Audio</h3>
                        <p className={styles.placeholderText}>
                            Transcribing and identifying speakers…
                        </p>
                    </div>
                ) : !isRecording && dialogue.length > 0 ? (
                    <div className={styles.dialogue}>
                        {dialogue.map((turn, i) => {
                            const isUnknown = turn.speaker === "Unknown";
                            const isEditing = safeEditingIndex === i;

                            return (
                                <div key={i} className={`${styles.dialogueTurn} ${styles[`speaker${turn.speaker}`]} ${isUnknown ? styles.speakerUnknown : ''}`}>
                                    <div className={styles.turnHeader}>
                                        <div className={styles.turnHeaderLeft}>
                                            <SpeakerAvatar name={turn.speaker} />
                                            <span className={`${styles.speakerLabel} ${styles[`label${turn.speaker}`]}`}>
                                                {turn.speaker}
                                            </span>
                                            {isUnknown && onReassign && (
                                                <select
                                                    className={styles.reassignSelect}
                                                    defaultValue=""
                                                    onChange={(e) => {
                                                        if (e.target.value) {
                                                            onReassign(i, e.target.value);
                                                        }
                                                    }}
                                                >
                                                    <option value="" disabled>Assign to...</option>
                                                    {SPEAKER_OPTIONS.map(opt => (
                                                        <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>

                                        {isEditable && !isEditing && (
                                            <button
                                                className={styles.editBtn}
                                                type="button"
                                                aria-label={`Edit turn ${i + 1}`}
                                                onClick={() => {
                                                    setEditingIndex(i);
                                                    setEditText(turn.text);
                                                }}
                                            >
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <path d="M12 20h9" />
                                                    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>

                                    {isEditing ? (
                                        <>
                                            <textarea
                                                ref={editTextareaRef}
                                                className={styles.editTextarea}
                                                value={editText}
                                                onChange={(e) => {
                                                    setEditText(e.target.value);
                                                    autoResize(e.target);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Escape') {
                                                        e.preventDefault();
                                                        handleCancelEdit();
                                                    }
                                                }}
                                                rows={2}
                                            />
                                            <div className={styles.editActions}>
                                                <button className={styles.saveBtn} type="button" onClick={handleSaveEdit}>
                                                    Save
                                                </button>
                                                <button className={styles.cancelBtn} type="button" onClick={handleCancelEdit}>
                                                    Cancel
                                                </button>
                                            </div>
                                        </>
                                    ) : (
                                        <p className={styles.turnText}>{turn.text}</p>
                                    )}
                                </div>
                            );
                        })}

                        {isEditable && (
                            <>
                                {isAddingTurn ? (
                                    <div className={styles.dialogueTurn}>
                                        <div className={styles.turnHeader}>
                                            <div className={styles.turnHeaderLeft}>
                                                <span className={styles.speakerLabel}>New turn</span>
                                                <select
                                                    className={styles.reassignSelect}
                                                    value={newTurnSpeaker}
                                                    onChange={(e) => setNewTurnSpeaker(e.target.value)}
                                                >
                                                    {SPEAKER_OPTIONS.map(opt => (
                                                        <option key={opt} value={opt}>{opt}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>
                                        <textarea
                                            ref={addTextareaRef}
                                            className={styles.editTextarea}
                                            placeholder="Type dialogue text..."
                                            value={newTurnText}
                                            onChange={(e) => {
                                                setNewTurnText(e.target.value);
                                                autoResize(e.target);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Escape') {
                                                    e.preventDefault();
                                                    handleCancelNewTurn();
                                                }
                                            }}
                                            rows={2}
                                        />
                                        <div className={styles.editActions}>
                                            <button className={styles.saveBtn} type="button" onClick={handleSaveNewTurn}>
                                                Save turn
                                            </button>
                                            <button className={styles.cancelBtn} type="button" onClick={handleCancelNewTurn}>
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        className={styles.addTurnBtn}
                                        type="button"
                                        onClick={() => setIsAddingTurn(true)}
                                    >
                                        + Add turn
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                ) : (
                    <div className={styles.transcript}>
                        {confirmedText && (
                            <span className={styles.confirmedText}>{confirmedText}</span>
                        )}
                        {partialText && (
                            <span className={styles.partialText}>
                                {confirmedText ? ' ' : ''}{partialText}
                            </span>
                        )}
                        {livePreviewText && isRecording && (
                            <div className={styles.livePreviewBanner}>
                                <span className={styles.previewLabel}>Live preview</span>
                                <p className={styles.previewText}>{livePreviewText}</p>
                                <span className={styles.previewNote}>Final transcript appears after recording stops</span>
                            </div>
                        )}
                        {isRecording && !livePreviewText && <span className={styles.cursor} />}
                    </div>
                )}
            </div>

            {isRecording && (
                <div className={styles.footer}>
                    <span className={styles.footerHint}>
                        Text may update as transcription refines
                    </span>
                </div>
            )}
        </div>
    );
}
