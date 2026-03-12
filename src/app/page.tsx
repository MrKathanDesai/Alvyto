'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useRooms } from '@/contexts/RoomContext';
import { api } from '@/services/api';
import { Patient, MedicalHistory, Visit, SummaryItem, KeyFact, KeyFactCategory } from '@/types';
import styles from './page.module.css';
import PatientHeader from '@/components/PatientHeader';
import MedicalSnapshot from '@/components/MedicalSnapshot';
import TranscriptionPanel from '@/components/TranscriptionPanel';
import SummaryPanel from '@/components/SummaryPanel';
import RecordingButton from '@/components/RecordingButton';
import { QueuePanel } from '@/components/QueuePanel/QueuePanel';
import SpeakerConfirmation from '@/components/SpeakerConfirmation/SpeakerConfirmation';
import { useWhisperLive } from '@/hooks/useWhisperLive';
import { useVisitSummary } from '@/hooks/useVisitSummary';

export default function ExamRoom() {
  const router = useRouter();
  const { user, isAuthenticated, loading: authLoading, logout } = useAuth();
  const { getRoom, loading: roomLoading, assignPatient } = useRooms();

  // Data State
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [currentPatient, setCurrentPatient] = useState<Patient | null>(null);
  const [medicalHistory, setMedicalHistory] = useState<MedicalHistory | undefined>(undefined);
  const [lastVisit, setLastVisit] = useState<Visit | undefined>(undefined);
  const [dataLoading, setDataLoading] = useState(true);
  const [loadingError, setLoadingError] = useState<string | null>(null);

  // ... (auth effect)

  // Load initial data (Patients)
  useEffect(() => {
    async function loadPatients() {
      try {
        const data = await api.getPatients();
        setPatients(data);
      } catch (e) {
        console.error("Failed to load patients", e);
        setLoadingError("Failed to load patients list.");
      } finally {
        setDataLoading(false);
      }
    }
    loadPatients();
  }, []);

  // Determine initial selected patient based on room
  const currentRoom = user?.roomId ? getRoom(user.roomId) : null;

  useEffect(() => {
    if (currentRoom?.currentPatientId) {
      setSelectedPatientId(currentRoom.currentPatientId);
    } else {
      // If room is free, clear selected patient to show Queue
      setSelectedPatientId(null);
    }
  }, [currentRoom]);

  // Handle start visit from Queue
  const handleStartVisitFromQueue = useCallback(async (visit: Visit) => {
    if (!currentRoom) return;
    try {
      await assignPatient(currentRoom.id, visit.patientId);
      // The room refresh in context will trigger the effect above to set selectedPatientId
    } catch (error) {
      console.error("Failed to start visit", error);
      alert("Failed to start visit");
    }
  }, [currentRoom, assignPatient]);

  // Load Patient Details when selectedPatientId changes
  useEffect(() => {
    async function loadPatientDetails() {
      if (!selectedPatientId) {
        setCurrentPatient(null);
        setMedicalHistory(undefined);
        return;
      }

      setDataLoading(true);
      setLoadingError(null);
      try {
        // Parallel fetch
        const [patient, history, visits] = await Promise.all([
          api.getPatient(selectedPatientId),
          api.getMedicalHistory(selectedPatientId).catch(() => undefined), // Allow history to fail (optional)
          api.getPatientVisits(selectedPatientId).catch(() => []) // Allow visits to fail (optional)
        ]);

        setCurrentPatient(patient);
        setMedicalHistory(history);
        setLastVisit(visits.length > 0 ? visits[0] : undefined);
      } catch (e) {
        console.error("Failed to load patient details", e);
        setLoadingError("Failed to load patient data.");
      } finally {
        setDataLoading(false);
      }
    }
    loadPatientDetails();
  }, [selectedPatientId]);


  const {
    isRecording,
    isTranscribing,
    isSummarizing,
    confirmedText,
    partialText,
    fullTranscript,
    confidence,
    dialogue,
    startRecording,
    stopRecording,
    generateSummary,
    updateDialogue,
    clearTranscript,
    error: recordingError,
    isWhisperAvailable,
    connectionStatus,
    speakerSamples,
    isConfirming,
    confirmSpeakersClientSide,
    livePreviewText,
  } = useWhisperLive({
    whisperEndpoint: 'http://localhost:8000',
  });

  const {
    currentVisit,
    startNewVisit,
    updateTranscript,
    updateIssues,
    updateActions,
    updateKeyFacts,
    setVisitStatus,
    approveVisit,
    discardVisit,
  } = useVisitSummary();

  // Handle patient selection
  const handlePatientSelect = useCallback((patientId: string) => {
    setSelectedPatientId(patientId);
    discardVisit();
    clearTranscript();
  }, [discardVisit, clearTranscript]);

  // Handle start recording
  const handleStartRecording = useCallback(async () => {
    if (!selectedPatientId) return;
    clearTranscript();
    startNewVisit(selectedPatientId);
    await startRecording();
  }, [clearTranscript, startNewVisit, selectedPatientId, startRecording]);

  // Handle speaker reassignment
  const handleReassignSpeaker = useCallback((turnIndex: number, newSpeaker: string) => {
    // Determine which dialogue array we're currently using
    const currentDialogueArr = currentVisit?.dialogue || dialogue;
    if (!currentDialogueArr || currentDialogueArr.length === 0) return;

    // 1. Reassign the unknown turn
    const updated = currentDialogueArr.map((t, i) =>
      i === turnIndex ? { ...t, speaker: newSpeaker as any } : t
    );

    // 2. Merge with adjacent turns if they now have the same speaker
    const merged: typeof updated = [];
    for (const turn of updated) {
      const last = merged[merged.length - 1];
      if (last && last.speaker === turn.speaker) {
        // Merge: extend last turn's text and end time
        merged[merged.length - 1] = {
          ...last,
          text: last.text + " " + turn.text,
          end: Math.max(last.end, turn.end),
        };
      } else {
        merged.push({ ...turn });
      }
    }

    // 3. Save back to the correct state
    if (currentVisit) {
      updateTranscript(currentVisit.transcript, merged);
    } else {
      updateDialogue(merged);
    }
  }, [currentVisit, dialogue, updateTranscript, updateDialogue]);

  // Instantly derive chips from current issues + actions — no LLM call needed
  const LIFESTYLE_KW = ['rest', 'sleep', 'water', 'drink', 'diet', 'exercise', 'stress', 'hydrat'];
  const MED_KW = ['mg', 'prescribed', 'dose', 'tablet', 'syrup', 'antibiotic', 'ibuprofen', 'tylenol', 'aspirin', 'medication', 'paracetamol'];
  const WARN_KW = ['come back', 'return if', 'watch for', 'seek', 'emergency', 'if fever', 'if pain', 'warning'];
  const DURATION_KW = ['day', 'week', 'hour', 'month', 'since', 'ago', 'morning', 'yesterday', 'tonight'];

  const classifyChip = (text: string, defaultCat: string): string => {
    const l = text.toLowerCase();
    if (WARN_KW.some(k => l.includes(k))) return 'warning';
    if (MED_KW.some(k => l.includes(k))) return 'medication';
    if (LIFESTYLE_KW.some(k => l.includes(k))) return 'lifestyle';
    if (DURATION_KW.some(k => l.includes(k))) return 'duration';
    return defaultCat;
  };

  const deriveChips = useCallback((issues: SummaryItem[], actions: SummaryItem[], existingFacts: KeyFact[] = []) => {
    const chips: KeyFact[] = [];
    const seen = new Set<string>();

    const existingCatMap = new Map<string, KeyFactCategory>();
    existingFacts.forEach(fact => {
      existingCatMap.set(fact.label.toLowerCase(), fact.category);
    });

    const addChip = (text: string, defaultCat: string) => {
      const label = text.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase().replace(/[.,;]$/, '');
      if (label && !seen.has(label)) {
        seen.add(label);
        // Use the AI's existing category if we have it, otherwise fallback to heuristics
        const category = existingCatMap.get(label) || (classifyChip(text, defaultCat) as KeyFactCategory);
        chips.push({ label, category });
      }
    };
    issues.forEach(item => addChip(item.text, 'symptom'));
    actions.forEach(item => addChip(item.text, 'action'));
    return chips;
  }, []);

  // Handle stop recording
  // Wait for diarization + optional speaker confirmation. Instead of summarizing
  // immediately, drop into a 'ready_to_summarize' intermediate state so the user
  // must manually click the "Summarize" button.
  const handleStopRecording = useCallback(async () => {
    const doctorName = currentRoom?.assignedDoctor?.name || user?.name || "Doctor";
    const patientName = currentPatient?.name || "Patient";

    const { text, dialogue: finalDialogue } = await stopRecording(doctorName, patientName);
    updateTranscript(text, finalDialogue);
    setVisitStatus('ready_to_summarize');
  }, [stopRecording, updateTranscript, setVisitStatus, user, currentPatient, currentRoom]);

  // Handle manual summarize
  const handleManualSummarize = useCallback(async () => {
    // Generate summary from the correctly-labelled dialogue
    const currentDialogue = currentVisit?.dialogue || dialogue;
    const summary = await generateSummary(currentDialogue);

    if (summary) {
      if (summary.issuesIdentified) updateIssues(summary.issuesIdentified);
      if (summary.actionsPlan) updateActions(summary.actionsPlan);
      if (summary.keyFacts) updateKeyFacts(summary.keyFacts as KeyFact[]);
      setVisitStatus('draft');
    }
  }, [generateSummary, updateIssues, updateActions, updateKeyFacts, setVisitStatus, currentVisit, dialogue]);


  // Handle approve
  const handleApprove = useCallback(async () => {
    try {
      await approveVisit();
    } catch (error) {
      console.error('Error approving visit:', error);
    }
  }, [approveVisit]);

  // Handle discard
  const handleDiscard = useCallback(() => {
    discardVisit();
    clearTranscript();
  }, [discardVisit, clearTranscript]);

  // Handle logout
  const handleLogout = useCallback(() => {
    logout();
    router.push('/login');
  }, [logout, router]);

  // Redirect admin users to admin panel
  useEffect(() => {
    if (!authLoading && isAuthenticated && user?.role === 'admin') {
      router.push('/admin');
    }
  }, [authLoading, isAuthenticated, user, router]);

  // Show loading while auth, rooms, or room lookup hasn't resolved
  const isRoomUser = user?.role === 'room';
  const roomStillLoading = isRoomUser && user?.roomId && !currentRoom && roomLoading;

  if (authLoading || !isAuthenticated || user?.role === 'admin' || roomStillLoading) {
    return (
      <div className={styles.loadingState}>
        <div className={styles.loadingSpinner}></div>
        <p className={styles.loadingText}>Loading Exam Room...</p>
      </div>
    );
  }

  // Show Queue if in a room and no patient assigned
  const showQueue = currentRoom && !currentRoom.currentPatientId && !selectedPatientId;

  return (
    <main className={styles.main}>
      {/* Header with Room Info & Logout */}
      <div className={styles.topBar}>
        <div className={styles.roomInfo}>
          {currentRoom ? (
            <>
              <span className={styles.roomName}>{currentRoom.name}</span>
              <span className={styles.roomStatus}>
                {currentRoom.status === 'occupied' ? 'On Call' : 'Available'}
              </span>
              {currentRoom.assignedDoctor ? (
                <span className={styles.doctorBadge}>
                  👨‍⚕️ {currentRoom.assignedDoctor.name}
                </span>
              ) : currentRoom.assignedDoctorId && (
                <span className={styles.doctorBadge}>
                  👨‍⚕️ {currentRoom.assignedDoctorId}
                </span>
              )}
            </>
          ) : (
            <span className={styles.roomName}>
              No Room Selected
              <span
                style={{ fontSize: '0.8rem', opacity: 0.7, marginLeft: '8px', cursor: 'pointer' }}
                onClick={() => router.push('/login')}
              >
                (Select)
              </span>
            </span>
          )}
        </div>
        <button onClick={handleLogout} className={styles.logoutButton}>
          Log Out
        </button>
      </div>

      {/* Whisper Backend Status */}
      {!isWhisperAvailable && (
        <div className={styles.warningBanner}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>Whisper backend not running. Start it with: <code>cd room-agent && ./start.sh</code></span>
        </div>
      )}

      {/* Recording Error Banner */}
      {recordingError && (
        <div className={styles.errorBanner}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4m0 4h.01" />
          </svg>
          <span>{recordingError}</span>
        </div>
      )}

      {showQueue ? (
        <div className={styles.queueContainer}>
          <div className={styles.welcomeMessage}>
            <h2>Waiting for Patient</h2>
            <p>Select a patient from the queue to start the visit.</p>
          </div>
          <QueuePanel
            roomId={currentRoom!.id}
            onStartVisit={handleStartVisitFromQueue}
          />
        </div>
      ) : (
        <>
          {/* Patient Header */}
          {loadingError ? (
            <div className={styles.errorBanner}>{loadingError}</div>
          ) : currentPatient ? (
            <PatientHeader
              patient={currentPatient}
              patients={patients}
              lastVisit={lastVisit}
              hasHistory={!!medicalHistory}
              onPatientSelect={handlePatientSelect}
              readOnly={true} // Lock manual selection since we have a queue
            />
          ) : (
            <div className={styles.loadingState}>Loading Patient...</div>
          )}

          {/* Medical Snapshot */}
          {medicalHistory && (
            <MedicalSnapshot
              history={medicalHistory}
              isRecording={isRecording}
            />
          )}

          {/* Main Workspace */}
          <div className={styles.workspace}>
            <div className={styles.splitView}>
              <TranscriptionPanel
                confirmedText={confirmedText}
                partialText={partialText}
                livePreviewText={livePreviewText}
                confidence={confidence}
                isRecording={isRecording}
                isProcessing={isTranscribing}
                connectionStatus={connectionStatus}
                dialogue={currentVisit?.dialogue || dialogue}
                onReassign={handleReassignSpeaker}
              />

              {/* Right Panel - Summary */}
              <SummaryPanel
                issuesIdentified={currentVisit?.summary.issuesIdentified || []}
                actionsPlan={currentVisit?.summary.actionsPlan || []}
                keyFacts={currentVisit?.summary.keyFacts || []}
                status={currentVisit?.status || (isRecording ? 'recording' : 'draft')}
                isSummarizing={isSummarizing}
                onUpdateIssues={(items) => {
                  updateIssues(items);
                  // Instantly re-derive chips from the edited items, preserving AI categories
                  const newChips = deriveChips(items, currentVisit?.summary.actionsPlan || [], currentVisit?.summary.keyFacts || []);
                  updateKeyFacts(newChips);
                }}
                onUpdateActions={(items) => {
                  updateActions(items);
                  // Instantly re-derive chips from the edited items, preserving AI categories
                  const newChips = deriveChips(currentVisit?.summary.issuesIdentified || [], items, currentVisit?.summary.keyFacts || []);
                  updateKeyFacts(newChips);
                }}
              />
            </div>
          </div>

          {/* Recording Button */}
          <RecordingButton
            isRecording={isRecording}
            isProcessing={isTranscribing}
            visitStatus={currentVisit?.status || null}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onSummarize={handleManualSummarize}
            onApprove={handleApprove}
            onDiscard={handleDiscard}
          />

          {/* Speaker Confirmation Overlay */}
          {isConfirming && (
            <SpeakerConfirmation
              speakers={speakerSamples}
              onConfirm={confirmSpeakersClientSide}
            />
          )}
        </>
      )}
    </main>
  );
}
