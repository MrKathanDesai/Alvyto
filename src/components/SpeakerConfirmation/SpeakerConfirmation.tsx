import React, { useState } from 'react';
import styles from './SpeakerConfirmation.module.css';
import { SpeakerSample } from '@/hooks/useWhisperLive';

interface SpeakerConfirmationProps {
    speakers: SpeakerSample[];
    onConfirm: (assignments: Record<string, string> | null) => void;
}

export default function SpeakerConfirmation({ speakers, onConfirm }: SpeakerConfirmationProps) {
    const [assignments, setAssignments] = useState<Record<string, string>>({});
    const roles = ["Doctor", "Patient", "Companion"];

    const assignRole = (speakerId: string, role: string) => {
        setAssignments((prev) => {
            const updated = { ...prev };
            for (const id in updated) {
                if (updated[id] === role && id !== speakerId) {
                    delete updated[id];
                }
            }
            updated[speakerId] = role;
            return updated;
        });
    };

    const allAssigned = speakers.length > 0 && speakers.every((s) => assignments[s.speaker_id]);

    if (!speakers || speakers.length === 0) {
        return null;
    }

    return (
        <div className={styles.overlay}>
            <div className={styles.card}>
                <div className={styles.header}>
                    <h3>Confirm Speakers</h3>
                    <p className={styles.subtitle}>
                        Please map the detected voices to their corresponding roles in the room before finalizing the transcript.
                    </p>
                </div>

                <div className={styles.speakersList}>
                    {speakers.map((spk) => (
                        <div key={spk.speaker_id} className={styles.speakerRow}>
                            <div className={styles.speakerSample}>
                                <span className={styles.speakerLabel}>{spk.speaker_id} said:</span>
                                <p className={styles.sampleText}>"{spk.sample_text}"</p>
                            </div>
                            <div className={styles.rolePills}>
                                {roles.map((role) => {
                                    const takenByOther = Object.entries(assignments).some(([id, r]) => r === role && id !== spk.speaker_id);
                                    return (
                                        <button
                                            key={role}
                                            className={`${styles.pill} ${assignments[spk.speaker_id] === role ? styles.pillActive : ''} ${takenByOther ? styles.pillDisabled : ''}`}
                                            disabled={takenByOther}
                                            onClick={() => assignRole(spk.speaker_id, role)}
                                        >
                                            {role}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                <div className={styles.actions}>
                    <button
                        className={styles.btnSkip}
                        onClick={() => onConfirm(null)}
                    >
                        Use Auto-Detection
                    </button>
                    <button
                        className={styles.btnConfirm}
                        disabled={!allAssigned}
                        onClick={() => onConfirm(assignments)}
                    >
                        Confirm & View Transcript
                    </button>
                </div>
            </div>
        </div>
    );
}
