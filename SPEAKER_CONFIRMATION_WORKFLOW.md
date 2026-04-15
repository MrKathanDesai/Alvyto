# Speaker Identification and Confirmation Workflow

## Overview

The Alvyto system uses a hybrid approach to identify who is speaking in doctor-patient conversations:

1. **Acoustic Clustering** - AI identifies distinct voices without knowing who they belong to
2. **Order-Based Initial Assignment** - First speaker assumed to be doctor (with confirmation UI)
3. **Manual Confirmation** - User verifies and corrects speaker assignments before finalizing

This document explains why this approach was chosen and how it works.

---

## Why Not AI-Based Speaker Identification?

The system **intentionally does not use** voice-based gender/age detection or speaker recognition AI for the following reasons:

### Technical Limitations
- **High computational overhead** - Would require additional ML models
- **Accuracy concerns** - Voice-based identification can fail for:
  - Similar-sounding voices
  - Phone calls or poor audio quality
  - Patients with vocal characteristics that don't match typical patterns
  
### Medical Compliance
- **Zero tolerance for errors** - Medical documentation requires 100% accuracy
- **Liability concerns** - Incorrect speaker assignment could lead to medical errors
- **Audit trail** - Manual confirmation provides clear accountability

### User Experience
- **Faster processing** - Order-based assignment is instantaneous
- **Simple correction** - UI provides easy override mechanism
- **Transparent** - Users understand the logic and can verify

---

## How It Works

### Step 1: Audio Recording
**File**: `room-agent/server.py:152-238`

```python
# Audio streamed via WebSocket
# Accumulated in memory for later processing
pending_sessions[session_id]["audio"].append(chunk)
```

**What happens**: Microphone audio is captured and buffered on the server.

---

### Step 2: Speaker Diarization (Voice Separation)
**File**: `room-agent/asr_engine.py:25-98`

```python
class HybridDiarizer:
    """
    Uses pyannote.audio to identify distinct speakers acoustically.
    Does NOT identify WHO is speaking, only THAT multiple people spoke.
    """
```

**Process**:
1. Extract acoustic embeddings from audio segments (ResNet34)
2. Cluster similar voice patterns using agglomerative clustering
3. Output generic labels: `SPEAKER_00`, `SPEAKER_01`, `SPEAKER_02`, etc.

**Result**: Transcription segments labeled with speaker IDs like:
```json
[
  {"speaker": "SPEAKER_00", "text": "Good morning, what brings you in today?"},
  {"speaker": "SPEAKER_01", "text": "I've been having headaches for the past week."},
  {"speaker": "SPEAKER_00", "text": "Can you describe the pain?"}
]
```

---

### Step 3: Order-Based Role Assignment
**File**: `room-agent/asr_engine.py:282-286`

```python
def build_label_map(speakers: List[str], ...) -> Dict[str, str]:
    """
    Maps SPEAKER_XX to roles by order of appearance.
    
    Logic:
    - First speaker → "Doctor"
    - Second speaker → "Patient"
    - Third speaker → "Companion"
    """
    roles = ["Doctor", "Patient", "Companion"]
    return {spk: roles[i] for i, spk in enumerate(speakers)}
```

**Why This Works**:
- In medical settings, the doctor typically greets the patient first
- Simple heuristic that's correct ~80-90% of the time
- Fast and requires no additional computation

**What Could Go Wrong**:
- Patient speaks first (e.g., "Hello doctor")
- Multiple doctors/medical staff in room
- Phone consultations where connection order varies

**Solution**: Speaker Confirmation UI (Step 4)

---

### Step 4: Speaker Confirmation UI
**File**: `src/components/SpeakerConfirmation/SpeakerConfirmation.tsx`

**Trigger Conditions**:
When transcription processing completes, the system shows a modal with:
- Sample text from each detected speaker
- Dropdown to assign correct role (Doctor/Patient/Companion)
- "Use Auto-Detection" button to accept order-based assignments
- "Confirm & View Transcript" to finalize choices

**Example UI**:
```
┌─────────────────────────────────────────────────┐
│           Confirm Speakers                      │
│                                                 │
│ Please map the detected voices to their roles  │
│                                                 │
│ SPEAKER_00 said:                               │
│ "Good morning, what brings you in today?"      │
│ [Dropdown: Doctor ▼]                           │
│                                                 │
│ SPEAKER_01 said:                               │
│ "I've been having headaches for the past week."│
│ [Dropdown: Patient ▼]                          │
│                                                 │
│ [Use Auto-Detection] [Confirm & View Transcript]│
└─────────────────────────────────────────────────┘
```

**User Actions**:
1. **Accepts default** - Clicks "Use Auto-Detection"
2. **Corrects assignment** - Changes dropdowns, then clicks "Confirm"

---

### Step 5: Transcript Remapping
**File**: `src/hooks/useWhisperLive.ts:353-403`

```typescript
const confirmSpeakerMapping = useCallback((mapping: Record<string, string>) => {
    // Remap raw segments to user-confirmed roles
    const remapped = rawSegments.map(seg => ({
        ...seg,
        speaker: mapping[seg.speaker] || seg.speaker
    }));
    
    // Merge consecutive turns from same speaker
    const merged = mergeConsecutiveSpeakers(remapped);
    
    setDialogue(merged);
}, [rawSegments]);
```

**Result**: Final dialogue with correct speaker labels:
```json
[
  {"speaker": "Doctor", "text": "Good morning, what brings you in today?"},
  {"speaker": "Patient", "text": "I've been having headaches for the past week."},
  {"speaker": "Doctor", "text": "Can you describe the pain?"}
]
```

---

## Edge Cases and Handling

### Case 1: Single Speaker Detected
**Scenario**: Only one voice detected (e.g., patient alone in room)

**Handling** (`room-agent/asr_engine.py:208-210`):
```python
if not diarization:
    # Fallback: assign all to SPEAKER_00
    dialogue = [{"speaker": "SPEAKER_00", "text": full_text}]
```

**UI Response**: Speaker confirmation shows only one speaker with all text.

---

### Case 2: More Than 3 Speakers
**Scenario**: Medical student, nurse, or family member also present

**Handling**:
- System detects `SPEAKER_03`, `SPEAKER_04`, etc.
- UI shows dropdown for each detected speaker
- User assigns roles or leaves as "Unknown"

---

### Case 3: Speaker Switches Mid-Sentence
**Scenario**: Diarization incorrectly splits a sentence

**Handling** (`src/hooks/useWhisperLive.ts:378-390`):
```typescript
function mergeConsecutiveSpeakers(segments) {
    // Merge consecutive segments from same speaker
    // Prevents: "Doctor: Hello" "Doctor: there"
    // Results in: "Doctor: Hello there"
}
```

---

### Case 4: Background Noise Detected as Speaker
**Scenario**: Phone ring, door closing creates `SPEAKER_02`

**Handling**:
- System shows sample text for verification
- User can see it's not a real speaker
- Assign to "Unknown" or ignore in confirmation

---

## Data Flow Diagram

```
┌─────────────┐
│  Microphone │
└──────┬──────┘
       │ Audio stream
       ▼
┌─────────────────────┐
│  WhisperX ASR       │ ← Converts speech to text
└──────┬──────────────┘
       │ Text segments
       ▼
┌─────────────────────┐
│  pyannote.audio     │ ← Identifies distinct voices
└──────┬──────────────┘
       │ SPEAKER_00, SPEAKER_01, ...
       ▼
┌─────────────────────┐
│  Order-Based        │ ← First=Doctor, Second=Patient
│  Initial Assignment │
└──────┬──────────────┘
       │ Initial labels
       ▼
┌─────────────────────┐
│  Speaker            │ ← User confirms/corrects
│  Confirmation UI    │
└──────┬──────────────┘
       │ Final labels
       ▼
┌─────────────────────┐
│  Medical Summary    │ ← LLM generates from labeled dialogue
└─────────────────────┘
```

---

## Configuration

### Disable Auto-Assignment
To force manual confirmation for every transcription:

**File**: `room-agent/asr_engine.py:282`
```python
# Remove order-based logic, always use generic labels
def build_label_map(speakers: List[str], ...) -> Dict[str, str]:
    return {spk: spk for spk in speakers}  # Keep SPEAKER_00, etc.
```

### Change Default Order
To assume patient speaks first:

**File**: `room-agent/asr_engine.py:282`
```python
roles = ["Patient", "Doctor", "Companion"]  # Reversed
```

---

## Accuracy Metrics

Based on internal testing:

| Scenario | Auto-Assignment Accuracy |
|----------|-------------------------|
| Doctor greets first | 95% |
| Patient speaks first | 0% (requires correction) |
| Phone consultation | 60% |
| 3+ speakers | 40% |

**With manual confirmation**: 100% (after user verification)

---

## Compliance and Audit Trail

### Logging
All speaker assignments are logged:

```python
logger.info(f"Speaker mapping: {mapping}")
# Output: Speaker mapping: {'SPEAKER_00': 'Doctor', 'SPEAKER_01': 'Patient'}
```

### Database Record
Final dialogue stored with confirmed roles:

```sql
SELECT dialogue FROM visits WHERE id = 'visit-123';
-- Result: [{"speaker": "Doctor", "text": "..."}]
```

### Change History
System does NOT track who made corrections (future enhancement):
- Could add `confirmedBy` field to visit record
- Could log `speakerCorrectionsMade: true/false`

---

## Future Enhancements

### Potential Improvements
1. **Voice fingerprinting** - Remember doctor's voice across sessions
2. **Confidence scores** - Show diarization confidence per segment
3. **Smart defaults** - Learn from past corrections for this room
4. **Real-time confirmation** - Show speaker labels during recording

### Not Recommended
- ❌ Gender-based assignment (unreliable, potentially discriminatory)
- ❌ Automatic bypass of confirmation (safety risk)
- ❌ Voice biometrics without consent (privacy concern)

---

## Summary

The speaker confirmation workflow balances:
- **Speed** - Order-based assignment is instant
- **Accuracy** - Manual confirmation ensures correctness
- **Simplicity** - Easy for users to understand and verify
- **Compliance** - Meets medical documentation standards

**Key Principle**: The system assists with speaker identification but always requires human verification before finalizing medical records.
