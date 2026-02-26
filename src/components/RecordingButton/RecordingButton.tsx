'use client';

import { useState, useEffect } from 'react';
import styles from './RecordingButton.module.css';
import { VisitStatus } from '@/types';

interface RecordingButtonProps {
    isRecording: boolean;
    isProcessing: boolean;
    visitStatus: VisitStatus | null;
    onStartRecording: () => void;
    onStopRecording: () => void;
    onApprove: () => void;
    onDiscard: () => void;
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function RecordingButton({
    isRecording,
    isProcessing,
    visitStatus,
    onStartRecording,
    onStopRecording,
    onApprove,
    onDiscard,
}: RecordingButtonProps) {
    const [recordingTime, setRecordingTime] = useState(0);

    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (isRecording) {
            setRecordingTime(0);
            interval = setInterval(() => {
                setRecordingTime(t => t + 1);
            }, 1000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [isRecording]);

    const handleClick = () => {
        if (isProcessing) return;

        if (isRecording) {
            onStopRecording();
        } else {
            onStartRecording();
        }
    };

    // Show approved message
    if (visitStatus === 'approved') {
        return (
            <div className={styles.container}>
                <div className={styles.approvedMessage}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 13l4 4L19 7" />
                    </svg>
                    Visit Saved Successfully
                </div>
            </div>
        );
    }

    // Show approve button after recording
    if (visitStatus === 'draft' && !isRecording && !isProcessing) {
        return (
            <div className={styles.container}>
                <div className={styles.approveContainer}>
                    <button className={styles.discardBtn} onClick={onDiscard}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Discard
                    </button>
                    <button className={styles.approveBtn} onClick={onApprove}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M5 13l4 4L19 7" />
                        </svg>
                        Approve & Save
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {isRecording && (
                <div className={styles.timer}>
                    <span className={styles.timerDot} />
                    {formatTime(recordingTime)}
                </div>
            )}

            <button
                className={`${styles.recordingBtn} ${isProcessing ? styles.processing :
                        isRecording ? styles.recording :
                            styles.idle
                    }`}
                onClick={handleClick}
                disabled={isProcessing}
            >
                {isProcessing ? (
                    <>
                        <svg className={styles.processingIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2v4m0 12v4m-8-10h4m12 0h4m-5.636-6.364l-2.828 2.828M8.464 15.536l-2.828 2.828m11.314 0l-2.828-2.828M8.464 8.464L5.636 5.636" />
                        </svg>
                        Processing...
                    </>
                ) : isRecording ? (
                    <>
                        <svg className={styles.stopIcon} viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="2" />
                        </svg>
                        Stop Recording
                    </>
                ) : (
                    <>
                        <svg className={styles.micIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                        </svg>
                        Start Recording
                    </>
                )}
            </button>
        </div>
    );
}
