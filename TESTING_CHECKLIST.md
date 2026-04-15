# Comprehensive Testing Checklist
## Medical Transcription System Validation

This checklist ensures that all data flowing through the system is genuine and based on actual conversations, with no static or placeholder content appearing in production.

---

## ✅ Pre-Testing Setup

### 1. Environment Verification
- [ ] Fresh database created (delete `emr.db` and run `./setup_and_run.sh`)
- [ ] Verify seed data uses UUIDs (check that doctor IDs are not 'd1', 'd2', etc.)
- [ ] Ollama running with `llama3.1:8b` model installed
- [ ] All services started (ports 3000, 8000, 8080 responding)

### 2. Baseline Checks
- [ ] No visits exist in database initially
- [ ] Seed patients appear in admin panel (UUID-based IDs)
- [ ] No hardcoded transcripts in any visit records

---

## 🎤 Audio Recording Tests

### Test 1: Basic Recording Flow
**Steps**:
1. Select a patient from queue
2. Click "Start Recording"
3. Speak test conversation for 30 seconds
4. Click "Stop Recording"

**Verify**:
- [ ] Live preview shows actual spoken words (not placeholder text)
- [ ] Preview updates every ~5 seconds during recording
- [ ] No "example" or "test" text appears unless actually spoken
- [ ] Recording duration counter increases correctly

**Expected Result**: Live transcription reflects actual audio, not mock data.

---

### Test 2: Silent Audio Handling
**Steps**:
1. Start recording
2. Stay silent for 30 seconds
3. Stop recording

**Verify**:
- [ ] System shows "No transcription" or minimal output
- [ ] Does NOT show example medical dialogue
- [ ] Speaker confirmation UI either doesn't appear or shows empty samples

**Expected Result**: Empty audio produces empty transcript, not fallback content.

---

## 🗣️ Speaker Diarization Tests

### Test 3: Two-Speaker Conversation
**Steps**:
1. Record conversation with two distinct voices
2. First speaker says: "Hello, how are you feeling today?"
3. Second speaker says: "I have been experiencing back pain"
4. Stop recording and wait for processing

**Verify**:
- [ ] Speaker confirmation modal appears
- [ ] Shows two speakers: SPEAKER_00 and SPEAKER_01
- [ ] Sample text matches what was actually said
- [ ] NOT showing example text like "headache since yesterday"

**Expected Result**: Actual spoken phrases appear in speaker samples.

---

### Test 4: Single Speaker (Edge Case)
**Steps**:
1. Record audio with only one person speaking
2. Stop recording

**Verify**:
- [ ] Only one speaker detected
- [ ] All text attributed to SPEAKER_00
- [ ] Speaker confirmation shows only one speaker option

**Expected Result**: Single speaker correctly identified, no fake second speaker.

---

### Test 5: Patient Speaks First (Order Test)
**Steps**:
1. Have second person speak first: "Hello doctor"
2. Have first person respond: "Hi, what brings you in?"
3. Stop recording

**Verify**:
- [ ] Initial assignment may be incorrect (SPEAKER_00 = "Patient")
- [ ] Speaker confirmation UI allows correction
- [ ] After correction, dialogue labels update correctly

**Expected Result**: Manual override successfully reassigns speakers.

---

## 📝 Summary Generation Tests

### Test 6: Medical Conversation Summary
**Steps**:
1. Record conversation mentioning specific symptoms:
   - "I have a cough and sore throat"
   - "Started three days ago"
   - "Prescribed Ibuprofen 400mg twice daily"
2. Stop recording and confirm speakers
3. Click "Generate Summary"

**Verify**:
- [ ] Issues identified: "cough", "sore throat", "started three days ago"
- [ ] Actions: "Ibuprofen 400mg prescribed, twice daily"
- [ ] Key facts: chips show actual words from conversation
- [ ] NO example terms (headache, fever, antibiotics) unless spoken

**Expected Result**: Summary contains ONLY information from actual dialogue.

---

### Test 7: Validation Against Transcript
**Steps**:
1. Record: "I took some pain medication yesterday"
2. Generate summary
3. Check if summary says "Tylenol" or "Ibuprofen" (it shouldn't)

**Verify**:
- [ ] Summary says "pain medication" (exact words)
- [ ] Does NOT say "Tylenol" or "Ibuprofen" unless spoken
- [ ] Validation function logged warnings for removed hallucinated terms

**Expected Result**: Validation prevents specific drug names not mentioned.

---

### Test 8: Empty Dialogue Summary
**Steps**:
1. Submit dialogue with <3 words per turn
2. Generate summary

**Verify**:
- [ ] Returns empty summary (no issues, no actions, no facts)
- [ ] Does NOT show placeholder/example summaries
- [ ] UI displays "No issues identified" / "No actions captured"

**Expected Result**: Empty input produces empty output, not mock data.

---

## 💾 Data Persistence Tests

### Test 9: Visit Storage
**Steps**:
1. Complete a visit with recording and summary
2. Approve visit
3. Query database: `sqlite3 emr.db "SELECT transcript, summary FROM visits;"`

**Verify**:
- [ ] Transcript field contains actual spoken words
- [ ] Summary JSON contains actual medical information
- [ ] NO example data (headache, fever, antibiotics) unless spoken
- [ ] Visit ID is UUID, not hardcoded

**Expected Result**: Database stores real data, not seed/test content.

---

### Test 10: Visit Retrieval
**Steps**:
1. Navigate to admin panel → Patients → View patient
2. Check past visits list

**Verify**:
- [ ] Visit transcript matches what was recorded
- [ ] Summary matches what was generated
- [ ] No switching to example data on page reload

**Expected Result**: Historical data remains accurate, not replaced with mock content.

---

## 🔄 API Integration Tests

### Test 11: Create Visit Endpoint
**Steps**:
1. Attempt to create visit without `doctorId` or `roomId`

**Verify**:
- [ ] API returns error (not silently using 'd1' or 'room1')
- [ ] Error message: "doctorId and roomId are required"

**Expected Result**: No fallback to hardcoded seed IDs.

---

### Test 12: Get Single Visit
**Steps**:
1. Create a visit with real data
2. GET `/api/visits/{visit_id}`

**Verify**:
- [ ] Returns actual visit data
- [ ] Does NOT crash (get_visit function exists)
- [ ] Transcript and summary match database

**Expected Result**: Single visit endpoint works without errors.

---

## 🎨 UI Display Tests

### Test 13: Medical Snapshot Component
**Steps**:
1. View patient with NO medical history
2. Check Medical Snapshot panel

**Verify**:
- [ ] Shows "No medical conditions documented"
- [ ] Shows "No allergies reported"
- [ ] Shows "No medications documented"
- [ ] NOT showing example conditions or medications

**Expected Result**: Empty state messages are clear and accurate.

---

### Test 14: Transcription Panel
**Steps**:
1. View a completed visit transcript
2. Check speaker labels

**Verify**:
- [ ] Labels show "Doctor" and "Patient" (or confirmed roles)
- [ ] NOT showing "SPEAKER_00" in final display
- [ ] Text matches actual spoken dialogue

**Expected Result**: Final transcript uses human-readable labels.

---

### Test 15: Summary Panel Chips
**Steps**:
1. View a visit with generated summary
2. Check key facts chips

**Verify**:
- [ ] Chips contain words from transcript
- [ ] Categories match content (symptom, medication, etc.)
- [ ] Classification keywords configurable in `src/config/medicalKeywords.ts`

**Expected Result**: Chips reflect actual conversation, categorized correctly.

---

## 🚨 Error Handling Tests

### Test 16: Whisper Backend Offline
**Steps**:
1. Stop room-agent service
2. Try to start recording

**Verify**:
- [ ] Error message displayed
- [ ] Does NOT show placeholder transcript
- [ ] User cannot proceed with recording

**Expected Result**: Graceful error, no fake data.

---

### Test 17: Ollama Offline
**Steps**:
1. Stop Ollama service
2. Record and transcribe audio
3. Try to generate summary

**Verify**:
- [ ] Summary generation fails gracefully
- [ ] Returns empty summary (not example summary)
- [ ] Error logged in room-agent

**Expected Result**: No summary generated, no placeholder content.

---

### Test 18: Database Unavailable
**Steps**:
1. Delete or corrupt `emr.db`
2. Try to create visit

**Verify**:
- [ ] Backend returns error
- [ ] Does NOT use in-memory mock data
- [ ] User sees error message

**Expected Result**: System fails safely without fake data.

---

## 🔍 Regression Tests (After Each Fix)

### Test 19: Seed Data UUID Check
**Steps**:
1. Delete `emr.db`
2. Run `./setup_and_run.sh`
3. Check database: `sqlite3 emr.db "SELECT id FROM doctors;"`

**Verify**:
- [ ] Doctor IDs are UUIDs (not 'd1', 'd2', 'd3')
- [ ] Patient IDs are UUIDs (not 'p1', 'p2')
- [ ] Room IDs are UUIDs (not 'room1', 'room2')

**Expected Result**: All seed data uses UUID-based IDs.

---

### Test 20: AI Prompt Validation
**Steps**:
1. Check `room-agent/summarizer.py` lines 68-85
2. Record a conversation WITHOUT mentioning "headache" or "fever"
3. Generate summary

**Verify**:
- [ ] Prompt uses generic placeholders like `<symptom>`
- [ ] Summary does NOT contain "headache" or "fever"
- [ ] Validation logs show no removed hallucinations

**Expected Result**: Example terms replaced with placeholders.

---

### Test 21: API Fallback Removed
**Steps**:
1. Check `src/services/api.ts` line 249-250
2. Verify no `|| 'd1'` or `|| 'room1'` fallbacks

**Verify**:
- [ ] Code throws error if doctorId/roomId missing
- [ ] No hardcoded defaults present

**Expected Result**: API requires explicit IDs, no silent fallbacks.

---

## 📊 Production Readiness Checklist

### Data Integrity
- [ ] All visits have unique UUIDs
- [ ] Transcripts match audio recordings
- [ ] Summaries derived from transcripts only
- [ ] No seed data in production visit records

### Security
- [ ] Environment variable `ENVIRONMENT=production` skips seeding
- [ ] Database credentials not hardcoded
- [ ] No sensitive data in logs

### Performance
- [ ] Transcription completes within 30 seconds for 5-minute audio
- [ ] Summary generation completes within 10 seconds
- [ ] No memory leaks in long recording sessions

### Compliance
- [ ] Audit trail for speaker confirmations
- [ ] Transcript editing tracked
- [ ] Doctor approval required before finalizing

---

## 🧪 Testing Tools

### Database Queries
```bash
# Check if any visits have example content
sqlite3 emr.db "SELECT id, transcript FROM visits WHERE transcript LIKE '%headache since yesterday%';"

# Verify seed data uses UUIDs
sqlite3 emr.db "SELECT id, name FROM doctors WHERE id LIKE 'd%';"

# Count visits
sqlite3 emr.db "SELECT COUNT(*) FROM visits;"
```

### API Testing
```bash
# Test visit creation without IDs
curl -X POST http://localhost:8080/api/visits \
  -H "Content-Type: application/json" \
  -d '{"patient_id": "test-patient"}'
# Should return error

# Test get visit endpoint
curl http://localhost:8080/api/visits/{visit_id}
# Should return visit data
```

### Log Monitoring
```bash
# Check for validation warnings in summarizer
tail -f room-agent/nohup.out | grep "hallucinated"

# Check for missing function errors
tail -f backend/nohup.out | grep "read_visit"
```

---

## ✅ Sign-Off

Once all tests pass:

- [ ] No static or placeholder medical data appears in any view
- [ ] All transcripts derived from actual audio
- [ ] All summaries generated from real transcripts
- [ ] Validation prevents hallucinated terms
- [ ] Seed data uses UUIDs and clearly labeled as test data
- [ ] Speaker confirmation workflow documented and functional
- [ ] System ready for clinical use

**Tester**: _________________  
**Date**: _________________  
**Version**: _________________  

---

## 📝 Notes

Use this space to document any issues found during testing:

```
Test #: ___
Issue: ___________________________________________
Severity: [ ] Critical  [ ] High  [ ] Medium  [ ] Low
Status: [ ] Open  [ ] Fixed  [ ] Won't Fix
```
