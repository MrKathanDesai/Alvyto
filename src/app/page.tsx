'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useRooms } from '@/contexts/RoomContext';
import {
  createVisit,
  getPatients,
  getDoctors,
  getPatient,
  getPatientVisits,
  validateVisitSummary,
  updateMedicalHistory,
  updateQueueEntry,
  ApiError,
} from '@/services/api';
import { Visit, DialogueTurn, VisitSummary } from '@/types';
import { Doctor, EMRPatient, MedicalHistoryRecord, QueueEntry } from '@/types/emr';
import styles from './page.module.css';
import PatientHeader from '@/components/PatientHeader';
import HistoryPanel from '@/components/HistoryPanel/HistoryPanel';
import MedicalSnapshot from '@/components/MedicalSnapshot';
import TranscriptionPanel from '@/components/TranscriptionPanel';
import SummaryPanel from '@/components/SummaryPanel';
import RecordingButton from '@/components/RecordingButton';
import { QueuePanel } from '@/components/QueuePanel/QueuePanel';
import SpeakerConfirmation from '@/components/SpeakerConfirmation/SpeakerConfirmation';
import ErrorBoundary from '@/components/ErrorBoundary';
import RecoveryBanner from '@/components/RecoveryBanner/RecoveryBanner';
import { useWhisperLive } from '@/hooks/useWhisperLive';
import { useVisitSummary } from '@/hooks/useVisitSummary';
import { useSessionPersistence } from '@/hooks/useSessionPersistence';
import { createEmptyMedicalHistory, deriveMedicalSnapshot } from '@/utils/medicalSnapshot';

function extractExistingVisitIdFromError(error: unknown): string | null {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') {
    return null;
  }

  const payload = error.data as {
    existingVisitId?: unknown;
    detail?: { existingVisitId?: unknown } | unknown;
  };

  if (typeof payload.existingVisitId === 'string') {
    return payload.existingVisitId;
  }

  if (payload.detail && typeof payload.detail === 'object') {
    const nested = payload.detail as { existingVisitId?: unknown };
    if (typeof nested.existingVisitId === 'string') {
      return nested.existingVisitId;
    }
  }

  return null;
}

function extractChiefComplaintFromQueueNotes(notes?: string | null): string | null {
  const text = (notes ?? '').trim();
  if (!text) return null;
  const first = text.split('|')[0]?.trim() ?? '';
  return first || text;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanDoctorActionText(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = normalizeWhitespace(value);
    const objectMatch = trimmed.match(/['"]action['"]\s*:\s*['"](.+?)['"]/i);
    return normalizeWhitespace(objectMatch?.[1] ?? trimmed);
  }

  if (value && typeof value === 'object') {
    const maybe = value as { text?: unknown; action?: unknown; label?: unknown; note?: unknown };
    const textCandidate = [maybe.text, maybe.action, maybe.label, maybe.note].find((item) => typeof item === 'string');
    return typeof textCandidate === 'string' ? normalizeWhitespace(textCandidate) : '';
  }

  return '';
}

function normalizeSummaryForApproval(summary: VisitSummary, queueChiefComplaint?: string | null): VisitSummary {
  const normalizedChiefComplaint =
    (summary.chiefComplaint || '').trim()
    || (queueChiefComplaint || '').trim()
    || summary.clinicalSnapshot.find((item) => item.category === 'symptom' && (item.status ?? 'confirmed') !== 'denied')?.label?.trim()
    || '';

  const fallbackDraftFromPrescriptions =
    summary.prescriptions.length > 0
      ? summary.prescriptions
          .filter((rx) => (rx.name || '').trim())
          .map((rx) => ({
            name: rx.name.trim(),
            dosage: rx.dosage?.trim() || undefined,
            frequency: rx.frequency?.trim() || undefined,
            duration: undefined,
            route: undefined,
            instructions: undefined,
          }))
      : [];

  const draft = summary.prescriptionDraft
    ? {
        ...summary.prescriptionDraft,
        medications:
          (summary.prescriptionDraft.medications?.length ?? 0) > 0
            ? summary.prescriptionDraft.medications
            : fallbackDraftFromPrescriptions,
      }
    : (fallbackDraftFromPrescriptions.length > 0
      ? {
          diagnoses: [],
          medications: fallbackDraftFromPrescriptions,
          investigations: [],
          advice: [],
          warnings: [],
          reportSummary: '',
          followUp: null,
        }
      : null);

  const normalizedDoctorActions = summary.doctorActions
    .map((item, index) => {
      const text = cleanDoctorActionText(item);
      if (!text) return null;
      return {
        ...item,
        id: item.id || `action-${index}`,
        text,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return {
    ...summary,
    doctorActions: normalizedDoctorActions,
    chiefComplaint: normalizedChiefComplaint,
    prescriptionDraft: draft,
  };
}

export default function ExamRoom() {
  const router = useRouter();
  const WHISPER_ENDPOINT = process.env.NEXT_PUBLIC_WHISPER_ENDPOINT || 'http://localhost:8000';
  const { name, role, roomId, isAuthenticated, loaded, logout } = useAuth();
  const { getRoom, loading: roomLoading } = useRooms();

  // Data State
  const [patients, setPatients] = useState<EMRPatient[]>([]);
  const [doctorsById, setDoctorsById] = useState<Record<string, Doctor>>({});
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [currentPatient, setCurrentPatient] = useState<EMRPatient | null>(null);
  const [medicalHistory, setMedicalHistory] = useState<MedicalHistoryRecord | null>(null);
  const [patientVisits, setPatientVisits] = useState<Visit[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [savingMedicalHistory, setSavingMedicalHistory] = useState(false);
  // Tracks the backend visit ID for the active recording session
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null);
  const [activeQueueEntryId, setActiveQueueEntryId] = useState<string | null>(null);
  const hasRecoveredRef = useRef(false);
  const [showRecoveryBanner, setShowRecoveryBanner] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [visitError, setVisitError] = useState<string | null>(null);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [queueChiefComplaint, setQueueChiefComplaint] = useState<string | null>(null);

  const {
    saveSession,
    saveVisitDraft,
    clearSession,
    recoveredSession,
    recoveredDraft,
  } = useSessionPersistence();

  // Load initial data (Patients)
  useEffect(() => {
    async function loadPatients() {
      try {
        const [data, doctors] = await Promise.all([getPatients(), getDoctors(false)]);
        setPatients(data);
        setDoctorsById(doctors.reduce((acc, doctor) => ({ ...acc, [doctor.id]: doctor }), {} as Record<string, Doctor>));
      } catch (e) {
        console.error("Failed to load patients", e);
        setLoadingError("Failed to load patients list.");
      }
    }

    loadPatients();
  }, []);
  // Determine initial selected patient based on room
  const currentRoom = roomId ? getRoom(roomId) : null;
  // Derived from doctorsById (loaded with activeOnly=false) — no extra API call needed
  const assignedDoctorName = currentRoom?.assignedDoctorId
    ? (doctorsById[currentRoom.assignedDoctorId]?.name ?? null)
    : null;


  useEffect(() => {
    if (currentRoom?.currentPatientId) {
      setSelectedPatientId(currentRoom.currentPatientId);
    } else {
      setSelectedPatientId(null);
    }
  }, [currentRoom]);

  // Handle start visit from Queue
  const handleStartVisitFromQueue = useCallback(async (entry: QueueEntry) => {
    if (!currentRoom) return;
    setQueueError(null);
    try {
      // Mark the queue entry as in_room - this also updates room.status and room.current_patient_id on the backend
      await updateQueueEntry(entry.id, { status: 'in_room', roomId: currentRoom.id });
      // Track the active queue entry so we can mark it done when visit completes
      setActiveQueueEntryId(entry.id);
      setQueueChiefComplaint(extractChiefComplaintFromQueueNotes(entry.notes));
      // Set the selected patient immediately (don't wait for RoomContext poll)
      setSelectedPatientId(entry.patientId);
    } catch (error) {
      console.error("Failed to start visit from queue", error);
      setQueueError("Failed to start visit. Please try again.");
    }
  }, [currentRoom]);

  // Load Patient Details when selectedPatientId changes
  useEffect(() => {
    async function loadPatientDetails() {
      if (!selectedPatientId) {
        setCurrentPatient(null);
        setMedicalHistory(null);
        setPatientVisits([]);
        setHistoryOpen(false);
        return;
      }

      setLoadingError(null);
      try {
        const [patient, visits] = await Promise.all([
          getPatient(selectedPatientId),
          getPatientVisits(selectedPatientId).catch(() => [])
        ]);
        const history = patient.medicalHistory ?? null;

        setCurrentPatient(patient);
        setMedicalHistory(history);
        setPatientVisits(visits);
        setHistoryOpen(false);

      } catch (e) {
        console.error("Failed to load patient details", e);
        setLoadingError("Failed to load patient data.");
      }
    }
    loadPatientDetails();
  }, [selectedPatientId]);

  const {
    isRecording,
    isPaused,
    isTranscribing,
    isSummarizing,
    confirmedText,
    partialText,
    recordingDuration,
    confidence,
    dialogue,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    generateSummary,
    generateQuickSummary,
    updateDialogue,
    clearTranscript,
    error: recordingError,
    isWhisperAvailable,
    connectionStatus,
    speakerSamples,
    isConfirming,
    confirmSpeakersClientSide,
    livePreviewText,
    processingStage,
  } = useWhisperLive({
    whisperEndpoint: WHISPER_ENDPOINT,
    visitId: activeVisitId,
  });
  const {
    currentVisit,
    startNewVisit,
    updateTranscript,
    updateSummary,
    updateSnapshot,
    updateDoctorActions,
    updateParagraphs,
    setVisitStatus,
    approveVisit,
    discardVisit,
  } = useVisitSummary();

  const baseMedicalHistory = useMemo(() => {
    if (!currentPatient) return null;
    return medicalHistory ?? createEmptyMedicalHistory(currentPatient.id);
  }, [currentPatient, medicalHistory]);

  const liveMedicalSnapshot = useMemo(() => {
    if (!baseMedicalHistory) return null;
    return deriveMedicalSnapshot(
      baseMedicalHistory,
      currentVisit?.summary,
      currentVisit?.transcript || confirmedText || livePreviewText
    );
  }, [baseMedicalHistory, currentVisit?.summary, currentVisit?.transcript, confirmedText, livePreviewText]);

  useEffect(() => {
    if (activeVisitId && selectedPatientId) {
      saveSession(activeVisitId, selectedPatientId);
    }
  }, [activeVisitId, selectedPatientId, saveSession]);

  useEffect(() => {
    if (currentVisit && currentVisit.visitId) {
      saveVisitDraft(currentVisit);
    }
  }, [currentVisit, saveVisitDraft]);

  useEffect(() => {
    if (
      recoveredSession &&
      patients.length > 0 &&
      !activeVisitId &&
      !hasRecoveredRef.current
    ) {
      setShowRecoveryBanner(true);
    }
  }, [recoveredSession, patients, activeVisitId]);

  const handleRecover = useCallback(async () => {
    if (!recoveredSession) return;

    hasRecoveredRef.current = true;
    setShowRecoveryBanner(false);

    setSelectedPatientId(recoveredSession.selectedPatientId);
    setActiveVisitId(recoveredSession.activeVisitId);

    await startNewVisit(recoveredSession.selectedPatientId, recoveredSession.activeVisitId);

    if (recoveredDraft && recoveredDraft.transcript) {
      updateTranscript(recoveredDraft.transcript, recoveredDraft.dialogue);
      setVisitStatus(recoveredDraft.status);

      if (
        recoveredDraft.summary.clinicalSnapshot.length > 0 ||
        recoveredDraft.summary.doctorActions.length > 0 ||
        recoveredDraft.summary.prescriptions.length > 0 ||
        recoveredDraft.summary.prescriptionDraft
      ) {
        updateSummary(recoveredDraft.summary);
      }
    }
  }, [
    recoveredSession,
    recoveredDraft,
    startNewVisit,
    updateTranscript,
    setVisitStatus,
    updateSummary,
  ]);

  const handleDismissRecovery = useCallback(() => {
    setShowRecoveryBanner(false);
    clearSession();
    hasRecoveredRef.current = true;
  }, [clearSession]);

  // Handle patient selection
  const handlePatientSelect = useCallback((patientId: string) => {
    setSelectedPatientId(patientId);
    discardVisit();
    clearTranscript();
    setHistoryOpen(false);
    setPatientVisits([]);
    setActiveVisitId(null);
    setQueueChiefComplaint(null);
  }, [discardVisit, clearTranscript]);

  const handleSaveMedicalHistory = useCallback(async (data: {
    conditions: string[];
    allergies: string[];
    medications: Record<string, unknown>[];
    notes?: string;
  }) => {
    if (!currentPatient) return;

    try {
      setSavingMedicalHistory(true);
      const updatedHistory = await updateMedicalHistory(currentPatient.id, {
        conditions: data.conditions,
        allergies: data.allergies,
        medications: data.medications,
        notes: data.notes,
      });
      setMedicalHistory(updatedHistory);
    } catch (error) {
      console.error('Failed to update medical history', error);
      setLoadingError('Failed to update medical snapshot.');
    } finally {
      setSavingMedicalHistory(false);
    }
  }, [currentPatient]);
  // Handle start recording:
  // 1. Create the visit record in the backend (gets us a real visitId)
  // 2. Start the local in-memory session (transcript/dialogue live here only)
  // 3. Start audio streaming to the room-agent
  const handleStartRecording = useCallback(async () => {
    if (!selectedPatientId) return;

    const doctorId = currentRoom?.assignedDoctorId;
    const roomId = currentRoom?.id;

    if (!doctorId || !roomId) {
      setVisitError('This room has no assigned doctor. Please assign one in the admin panel before starting a visit.');
      return;
    }

    setVisitError(null);
    setValidationWarnings([]);
    try {
      clearTranscript();

      let newVisit;
      try {
        // Create backend visit record — only summary will ever be saved here
        newVisit = await createVisit({
          patientId: selectedPatientId,
          doctorId,
          roomId,
          chiefComplaint: queueChiefComplaint ?? undefined,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          const existingVisitId = extractExistingVisitIdFromError(error);
          if (existingVisitId) {
            await startNewVisit(selectedPatientId, existingVisitId);
            setActiveVisitId(existingVisitId);
            await startRecording(undefined, existingVisitId);
            return;
          }
        }
        throw error;
      }
      setActiveVisitId(newVisit.id);

      // Start in-memory session
      startNewVisit(selectedPatientId, newVisit.id);

      // Start audio streaming
      await startRecording(undefined, newVisit.id);
    } catch (error) {
      console.error("Failed to start recording", error);
      setActiveVisitId(null);
      if (error instanceof Error && error.message) {
        setVisitError(error.message);
      } else {
        setVisitError('Failed to start recording. Please check your microphone and try again.');
      }
    }
  }, [clearTranscript, startNewVisit, selectedPatientId, startRecording, currentRoom, queueChiefComplaint]);

  // Handle speaker reassignment
  const handleReassignSpeaker = useCallback((turnIndex: number, newSpeaker: string) => {
    const currentDialogueArr = currentVisit?.dialogue || dialogue;
    if (!currentDialogueArr || currentDialogueArr.length === 0) return;

    const updated = currentDialogueArr.map((t, i) =>
      i === turnIndex ? { ...t, speaker: newSpeaker as DialogueTurn['speaker'] } : t
    );

    const merged: typeof updated = [];
    for (const turn of updated) {
      const last = merged[merged.length - 1];
      if (last && last.speaker === turn.speaker) {
        merged[merged.length - 1] = {
          ...last,
          text: last.text + " " + turn.text,
          end: Math.max(last.end, turn.end),
        };
      } else {
        merged.push({ ...turn });
      }
    }

    if (currentVisit) {
      updateTranscript(currentVisit.transcript, merged);
    } else {
      updateDialogue(merged);
    }
  }, [currentVisit, dialogue, updateTranscript, updateDialogue]);

  // Handle stop recording — wait for diarization, then allow manual summarize.
  // Always use generic role labels in the transcript — the actual names of the
  // doctor and patient are available elsewhere (PatientHeader, room context).
  const handleStopRecording = useCallback(async () => {
    // Use the room's assigned doctor name — never fall back to the logged-in user's name
    // because the device user is staff/patient, not the doctor.
    const doctorName = assignedDoctorName || 'Doctor';
    const patientName = currentPatient?.name || 'Patient';
    const { text, dialogue: finalDialogue } = await stopRecording(doctorName, patientName);
    updateTranscript(text, finalDialogue);
    setVisitStatus('ready_to_summarize');
  }, [stopRecording, updateTranscript, setVisitStatus, assignedDoctorName, currentPatient?.name]);

  const handleEditTurn = useCallback((index: number, newText: string) => {
    const currentDialogueArr = currentVisit?.dialogue || dialogue;
    const updated = currentDialogueArr.map((t, i) =>
      i === index ? { ...t, text: newText } : t
    );
    if (currentVisit) {
      updateTranscript(currentVisit.transcript, updated);
    } else {
      updateDialogue(updated);
    }
  }, [currentVisit, dialogue, updateTranscript, updateDialogue]);

  const handleAddTurn = useCallback((speaker: string, text: string) => {
    const currentDialogueArr = currentVisit?.dialogue || dialogue;
    const newTurn: DialogueTurn = { speaker, text, start: 0, end: 0 };
    const updated = [...currentDialogueArr, newTurn];
    if (currentVisit) {
      updateTranscript(currentVisit.transcript, updated);
    } else {
      updateDialogue(updated);
    }
  }, [currentVisit, dialogue, updateTranscript, updateDialogue]);

  // Handle manual summarize
  const handleManualSummarize = useCallback(async () => {
    const currentDialogue = currentVisit?.dialogue || dialogue;

    const quickSummaryBase = generateQuickSummary(currentDialogue);
    const quickSummary = {
      ...quickSummaryBase,
      chiefComplaint: quickSummaryBase.chiefComplaint || queueChiefComplaint || '',
    };
    updateSummary(quickSummary);
    setVisitStatus('draft');

    // Pass the patient's existing medical history so the AI can include
    // known medications and conditions in the prescriptionDraft
    const historyForAI = medicalHistory
      ? {
          conditions: medicalHistory.conditions ?? [],
          allergies: medicalHistory.allergies ?? [],
          medications: medicalHistory.medications ?? [],
        }
      : null;
    const summary = await generateSummary(currentDialogue, historyForAI as Record<string, unknown> | null);

    if (summary) {
      updateSummary(summary);
      setVisitStatus('draft');
    }
  }, [generateQuickSummary, generateSummary, updateSummary, setVisitStatus, currentVisit, dialogue, medicalHistory, queueChiefComplaint]);

  // Handle approve — saves only structured summary to backend, transcript is discarded
  const handleApprove = useCallback(async () => {
    let effectiveVisitId = activeVisitId;

    if (!effectiveVisitId && selectedPatientId && currentRoom?.assignedDoctorId && currentRoom?.id) {
      try {
        try {
          const createdVisit = await createVisit({
            patientId: selectedPatientId,
            doctorId: currentRoom.assignedDoctorId,
            roomId: currentRoom.id,
            chiefComplaint: queueChiefComplaint ?? undefined,
          });
          effectiveVisitId = createdVisit.id;
          setActiveVisitId(createdVisit.id);
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const existingVisitId = extractExistingVisitIdFromError(error);
            if (existingVisitId) {
              effectiveVisitId = existingVisitId;
              setActiveVisitId(existingVisitId);
            } else {
              throw error;
            }
          } else {
            throw error;
          }
        }
      } catch (error) {
        console.error('Failed to create fallback visit for approval', error);
      }
    }

    if (!effectiveVisitId) {
      setVisitError('Cannot save: no active visit found. Please start a new recording.');
      return;
    }

    setVisitError(null);
    try {
      if (!currentVisit?.summary) {
        setVisitError('Cannot save: summary is empty. Please generate summary first.');
        return;
      }

      const normalizedSummary = normalizeSummaryForApproval(currentVisit.summary, queueChiefComplaint);
      const validation = await validateVisitSummary(effectiveVisitId, normalizedSummary);
      const validationMessages = [
        ...validation.missingFields.map((item) => item.message),
        ...validation.warnings,
      ];
      setValidationWarnings(validationMessages);

      updateSummary(validation.normalizedSummary);
      await approveVisit(effectiveVisitId, validation.normalizedSummary);

      // Mark the queue entry as done
      if (activeQueueEntryId) {
        try {
          await updateQueueEntry(activeQueueEntryId, { status: 'done' });
        } catch (e) {
          console.error('Failed to mark queue entry as done', e);
        }
        setActiveQueueEntryId(null);
      }

      clearSession();
      setActiveVisitId(null);
      setQueueChiefComplaint(null);
      setValidationWarnings([]);
      clearTranscript();

      // Refresh last visit for the PatientHeader and re-fetch patient medical history
      if (currentPatient) {
        const [updatedVisits, updatedPatient] = await Promise.all([
          getPatientVisits(currentPatient.id),
          getPatient(currentPatient.id),
        ]);
        setPatientVisits(updatedVisits ?? []);
        setMedicalHistory(updatedPatient?.medicalHistory ?? null);
      }
    } catch (error) {
      console.error('Error approving visit:', error);
      setVisitError(error instanceof Error ? error.message : 'Failed to save visit. Please try again.');
    }
  }, [approveVisit, activeVisitId, activeQueueEntryId, clearSession, clearTranscript, currentPatient, currentRoom?.assignedDoctorId, currentRoom?.id, currentVisit?.summary, queueChiefComplaint, selectedPatientId, updateSummary]);

  // Handle discard — cancels backend visit (best-effort), clears local session
  const handleDiscard = useCallback(async () => {
    await discardVisit(activeVisitId ?? undefined);

    // Mark the queue entry as done/left
    if (activeQueueEntryId) {
      try {
        await updateQueueEntry(activeQueueEntryId, { status: 'left' });
      } catch (e) {
        console.error('Failed to update queue entry on discard', e);
      }
      setActiveQueueEntryId(null);
    }

    clearSession();
    setActiveVisitId(null);
    setQueueChiefComplaint(null);
    setValidationWarnings([]);
    clearTranscript();
  }, [discardVisit, activeVisitId, activeQueueEntryId, clearSession, clearTranscript]);
  // Handle logout
  const handleLogout = useCallback(() => {
    logout();
    router.push('/login');
  }, [logout, router]);

  // Redirect unauthenticated users to login after auth state is loaded
  useEffect(() => {
    if (loaded && !isAuthenticated) {
      router.push('/login');
    }
  }, [loaded, isAuthenticated, router]);

  // Redirect admin users to admin panel
  useEffect(() => {
    if (loaded && isAuthenticated && role === 'admin') {
      router.push('/admin');
    }
  }, [loaded, isAuthenticated, role, router]);



  const isRoomUser = role === 'room_device';
  const roomStillLoading = isRoomUser && roomId && !currentRoom && roomLoading;
  if (!loaded || !isAuthenticated || role === 'admin' || roomStillLoading) {
    return (
      <div className={styles.loadingState} role="status" aria-live="polite">
        <div className={styles.loadingSpinner} aria-hidden="true"></div>
        <p className={styles.loadingText}>Loading Exam Room...</p>
      </div>
    );
  }

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
                {currentRoom.status === 'in_use' ? 'On Call' : 'Available'}
              </span>
              {currentRoom.assignedDoctorId && (
                <span className={styles.doctorBadge}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 11h-6M19 8v6" />
                  </svg>
                  {name}
                </span>
              )}
            </>
          ) : (
            <span className={styles.roomName}>
              No Room Selected
              <button
                className={styles.selectRoomLink}
                onClick={() => router.push('/login')}
              >
                Select
              </button>
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

      {showRecoveryBanner && recoveredSession && (
        <RecoveryBanner
          patientName={
            patients.find(p => p.id === recoveredSession.selectedPatientId)?.name || 'Unknown Patient'
          }
          savedAt={recoveredSession.savedAt}
          onRecover={handleRecover}
          onDismiss={handleDismissRecovery}
        />
      )}

      {/* Recording Error Banner */}
      {recordingError && (
        <div className={styles.errorBanner} role="alert">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4m0 4h.01" />
          </svg>
          <span>{recordingError}</span>
        </div>
      )}
      {/* Visit Start Error Banner */}
      {visitError && (
        <div className={styles.errorBanner} role="alert">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4m0 4h.01" />
          </svg>
          <span>{visitError}</span>
          <button
            className={styles.bannerDismiss}
            onClick={() => setVisitError(null)}
            aria-label="Dismiss error"
          >×</button>
        </div>
      )}
      {validationWarnings.length > 0 && (
        <div className={styles.warningBanner} role="status" aria-live="polite">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>{validationWarnings[0]}</span>
          <button
            className={styles.bannerDismiss}
            onClick={() => setValidationWarnings([])}
            aria-label="Dismiss warning"
          >×</button>
        </div>
      )}

      {showQueue ? (
        <div className={styles.queueContainer}>
          <div className={styles.welcomeMessage}>
            <h1>Waiting for Patient</h1>
            <p>Select a patient from the queue to start the visit.</p>
          </div>
          {queueError && (
            <div className={styles.errorBanner} role="alert">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4m0 4h.01" />
              </svg>
              <span>{queueError}</span>
              <button
                className={styles.bannerDismiss}
                onClick={() => setQueueError(null)}
                aria-label="Dismiss error"
              >×</button>
            </div>
          )}
          <QueuePanel
            roomId={currentRoom.id}
            onStartVisit={handleStartVisitFromQueue}
            patients={patients}
          />
        </div>
      ) : (
        <>
          {/* Patient Header */}
          {loadingError ? (
            <div className={styles.errorBanner}>{loadingError}</div>
          ) : currentPatient ? (
            <ErrorBoundary>
              <PatientHeader
                patient={currentPatient}
                patients={patients}
                visits={patientVisits}
                hasHistory={!!medicalHistory}
                onHistoryToggle={() => setHistoryOpen(o => !o)}
                historyOpen={historyOpen}
                onPatientSelect={handlePatientSelect}
                readOnly={true}
              />
            </ErrorBoundary>
          ) : (
            <div className={styles.loadingState}>Loading Patient...</div>
          )}

          {patientVisits.length > 0 && (
            <ErrorBoundary>
              <HistoryPanel
                visits={patientVisits}
                isOpen={historyOpen}
                onClose={() => setHistoryOpen(false)}
                patient={currentPatient}
                doctorsById={doctorsById}
              />
            </ErrorBoundary>
          )}

          {queueChiefComplaint && (
            <div className={styles.queueChiefComplaintBanner}>
              <span className={styles.queueChiefComplaintLabel}>Chief Complaint from Queue</span>
              <span className={styles.queueChiefComplaintValue}>{queueChiefComplaint}</span>
            </div>
          )}

          {/* Medical Snapshot */}
          {currentPatient && liveMedicalSnapshot && (
            <ErrorBoundary>
              <MedicalSnapshot
                history={liveMedicalSnapshot.history}
                isRecording={isRecording}
                editable
                saving={savingMedicalHistory}
                isLive={liveMedicalSnapshot.hasLiveUpdates}
                liveLabel="Live updates from transcript and summary"
                onSave={handleSaveMedicalHistory}
              />
            </ErrorBoundary>
          )}

          {/* Main Workspace */}
          <div className={styles.workspace}>
            <div className={styles.splitView}>
              <ErrorBoundary>
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
                  isEditable={!isRecording && !isTranscribing && (currentVisit?.dialogue || dialogue).length > 0}
                  onEditTurn={handleEditTurn}
                  onAddTurn={handleAddTurn}
                  doctorName={assignedDoctorName || 'Doctor'}
                  patientName={currentPatient?.name || 'Patient'}
                />
              </ErrorBoundary>

              <ErrorBoundary>
                <SummaryPanel
                  summary={currentVisit?.summary || {
                    clinicalSnapshot: [],
                    doctorActions: [],
                    prescriptions: [],
                    prescriptionDraft: null,
                    issuesParagraph: '',
                    actionsParagraph: '',
                    chiefComplaint: '',
                    structuredFindings: [],
                  }}
                  status={currentVisit?.status || (isRecording ? 'in_progress' : 'draft')}
                  isSummarizing={isSummarizing}
                  transcript={currentVisit?.transcript || ''}
                  onUpdateSnapshot={(items) => {
                    updateSnapshot(items);
                  }}
                  onUpdateDoctorActions={(items) => {
                    updateDoctorActions(items);
                  }}
                  onUpdateParagraphs={(issues, actions) => {
                    updateParagraphs(issues, actions);
                  }}
                />
              </ErrorBoundary>
            </div>
          </div>

          <RecordingButton
            isRecording={isRecording}
            isPaused={isPaused}
            isProcessing={isTranscribing}
            processingStage={processingStage}
            recordingDuration={recordingDuration}
            visitStatus={currentVisit?.status || null}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onPause={pauseRecording}
            onResume={resumeRecording}
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
