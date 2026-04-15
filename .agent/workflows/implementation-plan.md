---
description: Exam Room EMR - Complete Implementation Plan
---

# Exam Room EMR - Implementation Plan

A calm, predictable single-room workspace for doctors to record patient consultations, view live transcription, and review/approve AI-generated visit summaries.

---

## Tech Stack

- **Framework**: Next.js 14 with TypeScript
- **Styling**: Vanilla CSS with CSS Modules
- **Transcription**: OpenAI Whisper API (via audio chunks)
- **AI Summarization**: OpenAI GPT-4 with strict medical prompt
- **Backend**: Supabase (PostgreSQL + Auth + Realtime)
- **Audio**: Web Audio API + MediaRecorder

---

## Phase 1: Project Setup & Core UI Foundation

### Step 1.1: Initialize Next.js Project
```bash
npx -y create-next-app@latest ./ --typescript --eslint --tailwind=false --src-dir --app --import-alias="@/*"
```

### Step 1.2: Setup Supabase
- Install Supabase client
- Create database schema for patients, visits, summaries
- Setup environment variables

### Step 1.3: Design System
- Create CSS custom properties (colors, typography, spacing)
- Define calm, medical-focused color palette
- Setup component styles

### Step 1.4: Patient Context Header Component
- Patient name, age, sex, patient ID
- "Past History Available" badge
- "View Last Visit" expandable dropdown
- Patient selector dropdown

### Step 1.5: Patient Medical Snapshot Component
- Collapsible card (collapsed by default)
- Medical conditions as chips/tags
- Allergies section with warning styling
- Current medications list
- Auto-collapse on recording start

---

## Phase 2: Main Workspace (Split View)

### Step 2.1: Layout Structure
- Responsive split-view container
- Left panel: 45% width for transcription
- Right panel: 55% width for summary
- Proper scroll handling

### Step 2.2: Live Transcription Panel
- Large scrollable text area
- Placeholder state when idle
- Streaming text appearance effect
- De-emphasized styling (lighter contrast)
- Read-only display

### Step 2.3: Visit Summary Panel
- "Draft" status badge
- **Issues Identified** section with bullets
- **Actions/Plan** section with bullets
- Inline editable bullets
- "+ Add item" functionality per section
- Empty state handling

---

## Phase 3: Recording & AI Integration

### Step 3.1: Recording Button Component
- Large pill-shaped button
- Mic icon with clear labels
- Recording state visual feedback
- Pulsing animation when active

### Step 3.2: Audio Recording Service
- MediaRecorder API setup
- Audio chunk collection
- WAV/WebM format handling
- Cleanup and error handling

### Step 3.3: OpenAI Whisper Integration
- Server-side API route for transcription
- Audio file upload handling
- Streaming transcription response
- Error handling and retries

### Step 3.4: Atomic Fact Extraction Pipeline
```
Transcript → Atomic Facts (NO prose)
```
- Extract verifiable facts only
- Categorize: Patient facts, Observations, Actions, Advice, Follow-up
- Apply proof rules (explicit, not inferred)
- Conflict resolution before summarization

### Step 3.5: AI Summary Generation
- LLM as formatter, not author
- Strict separation of fact types
- Post-LLM validation (hallucination firewall)
- Map every bullet to source facts

---

## Phase 4: Post-Recording Actions

### Step 4.1: Review Controls
- "Approve & Save" primary button
- Warning states for incomplete data
- Edit capabilities before approval

### Step 4.2: Approval Flow
- Lock summary on approval
- Mark visit as complete
- Timestamp recording

---

## Phase 5: Data Persistence & Cloud Sync

### Step 5.1: Supabase Schema
```sql
-- Patients table
CREATE TABLE patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  age INTEGER,
  sex TEXT,
  patient_id TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Medical history
CREATE TABLE medical_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id),
  conditions TEXT[],
  allergies TEXT[],
  medications JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Visits
CREATE TABLE visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id),
  transcript TEXT,
  atomic_facts JSONB,
  summary JSONB,
  status TEXT DEFAULT 'draft',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Step 5.2: API Routes
- GET /api/patients - List patients
- GET /api/patients/[id] - Get patient details
- GET /api/patients/[id]/visits - Get patient visits
- POST /api/visits - Create new visit
- PATCH /api/visits/[id] - Update visit
- POST /api/visits/[id]/approve - Approve visit

### Step 5.3: Sync Logic
- Only sync approved visits
- Optimistic UI updates
- Conflict resolution

---

## Design Tokens

```css
:root {
  /* Colors - Calm Medical Palette */
  --color-background: #FAFBFC;
  --color-surface: #FFFFFF;
  --color-surface-elevated: #FFFFFF;
  
  --color-primary: #2563EB;
  --color-primary-hover: #1D4ED8;
  
  --color-text-primary: #1F2937;
  --color-text-secondary: #6B7280;
  --color-text-muted: #9CA3AF;
  
  --color-success: #059669;
  --color-warning: #D97706;
  --color-danger: #DC2626;
  
  --color-border: #E5E7EB;
  --color-border-focus: #2563EB;
  
  /* Typography */
  --font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
  
  /* Spacing */
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
  --spacing-3: 0.75rem;
  --spacing-4: 1rem;
  --spacing-6: 1.5rem;
  --spacing-8: 2rem;
  
  /* Border Radius */
  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-full: 9999px;
  
  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}
```

---

## File Structure

```
/Users/kathandesai/alvyto/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── globals.css
│   │   └── api/
│   │       ├── transcribe/route.ts
│   │       ├── summarize/route.ts
│   │       ├── patients/route.ts
│   │       └── visits/route.ts
│   ├── components/
│   │   ├── PatientHeader/
│   │   ├── MedicalSnapshot/
│   │   ├── TranscriptionPanel/
│   │   ├── SummaryPanel/
│   │   ├── RecordingButton/
│   │   └── ui/
│   ├── hooks/
│   │   ├── useAudioRecording.ts
│   │   ├── useTranscription.ts
│   │   └── useVisitSummary.ts
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── openai.ts
│   │   └── factExtraction.ts
│   └── types/
│       └── index.ts
├── .env.local
├── package.json
└── tsconfig.json
```

---

## Safety Principles (Medical AI)

1. **Atomic Facts Only**: No prose extraction, only verifiable facts
2. **Proof Rules**: Facts must appear explicitly in transcript
3. **Conflict Resolution**: Score by recency, clarity, repetition
4. **Strict Categorization**: Patient facts, Observations, Actions, Advice, Follow-up
5. **LLM as Formatter**: Assembler only, no inference
6. **Post-LLM Validation**: Every bullet traced to source fact
7. **Mandatory Human Approval**: Nothing auto-saves or auto-syncs

---

## Environment Variables

```env
# OpenAI
OPENAI_API_KEY=sk-...

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```
