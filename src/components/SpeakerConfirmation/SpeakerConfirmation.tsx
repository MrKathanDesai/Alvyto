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
        setAssignments((prev) => ({ ...prev, [speakerId]: role }));
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
                        Map each detected voice to a role. If the same person was split into multiple voices, assign them the same role.
                    </p>
                </div>

                <div className={styles.speakersList}>
                    {speakers.map((spk) => (
                        <div key={spk.speaker_id} className={styles.speakerRow}>
                            <div className={styles.speakerSample}>
                                <span className={styles.speakerLabel}>{spk.backend_role ?? spk.speaker_id} said:</span>
                                <p className={styles.sampleText}>&quot;{spk.sample_text}&quot;</p>
                            </div>
                            <div className={styles.rolePills}>
                                {roles.map((role) => (
                                    <button
                                        key={role}
                                        className={`${styles.pill} ${assignments[spk.speaker_id] === role ? styles.pillActive : ''}`}
                                        onClick={() => assignRole(spk.speaker_id, role)}
                                    >
                                        {role}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <div className={styles.actions}>
                    <button
                        className={styles.btnConfirm}
                        disabled={!allAssigned}
                        onClick={() => onConfirm(assignments)}
                    >
                        Confirm Speakers
                    </button>
                </div>
            </div>
        </div>
    );
}
