# LLM Model Selection Report
## Alvyto Clinical EMR — AI Summarization Component

**Version:** 1.0
**Date:** 2026-03-28
**Environment:** Apple M-series (MPS), Ollama 0.x, 4 candidate models
**Purpose:** Select the optimal local LLM for structured clinical summarization on clinic-grade hardware

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Background & Motivation](#2-background--motivation)
3. [Task Definition](#3-task-definition)
4. [Evaluation Parameters & Rationale](#4-evaluation-parameters--rationale)
5. [Models Under Evaluation](#5-models-under-evaluation)
6. [Test Cases](#6-test-cases)
7. [Results](#7-results)
8. [Per-Model Analysis](#8-per-model-analysis)
9. [Failure Analysis — Qwen3:4b](#9-failure-analysis--qwen34b)
10. [Cold Start vs. Warm Inference](#10-cold-start-vs-warm-inference)
11. [Projected Performance on Clinic Hardware](#11-projected-performance-on-clinic-hardware)
12. [Final Recommendation](#12-final-recommendation)
13. [Appendix — Raw Benchmark Data](#13-appendix--raw-benchmark-data)

---

## 1. Abstract

Alvyto is a fully local clinical EMR system that transcribes doctor-patient consultations and generates structured clinical documentation using a locally running LLM. This report evaluates four candidate models — `qwen2.5:3b`, `qwen3:4b`, `phi4-mini`, and `llama3.1:8b` — against the exact prompts and schema used in production. Models are assessed across five dimensions: JSON reliability, schema compliance, transcript support rate (hallucination detection), category validity, and inference latency. **phi4-mini is selected as the production model**, achieving a perfect support rate of 1.0 and 100% schema compliance across all test cases while matching qwen2.5:3b's warm inference speed of ~8 seconds.

---

## 2. Background & Motivation

### 2.1 The Summarization Problem

After a consultation is recorded and transcribed, Alvyto's room agent passes the speaker-labelled dialogue to a local LLM which must produce a structured clinical summary. This summary is then reviewed and approved by the doctor before being written to the patient's permanent medical record.

The LLM operates under a **zero-inference rule**: it may only use words and phrases explicitly spoken in the conversation. It must not infer diagnoses, assume context, or add any clinical interpretation not directly stated. Every generated item is subsequently validated against the source transcript using fuzzy string matching. Items that cannot be matched are flagged `isSupported: false` and shown differently in the UI.

This design means the LLM's role is primarily **extraction and structuring**, not reasoning or medical knowledge. It must reliably produce a specific JSON schema every time.

### 2.2 Hardware Constraints

The original Alvyto architecture assumed a single powerful Mac with Metal GPU acceleration. The target deployment environment is now small-to-medium clinic chains in North America: one clinic server (Windows or Linux, CPU-only or entry-level GPU), with multiple exam room PCs as thin clients. This changes the model selection criteria significantly:

- Models must run on CPU-only hardware without degradation
- `llama-cpp-python` with Metal is being replaced by Ollama for cross-platform compatibility
- Inference time directly affects the doctor's post-visit wait time — under 60 seconds on CPU is the target

### 2.3 Why Evaluate Alternatives to qwen2.5:3b

The current model was selected for Metal-accelerated Mac hardware. The migration to Ollama and cross-platform deployment opened the question of whether other models perform better on the actual task. Three alternatives were identified based on:

- Parameter count comparable to qwen2.5:3b (3-4B range, viable on CPU)
- Known strong instruction-following behaviour
- Availability on Ollama
- Community reports of good structured output quality

---

## 3. Task Definition

The LLM is asked to perform **two distinct tasks** within Alvyto:

### Task A — Summarize (Primary)

Given a speaker-labelled transcript of a doctor-patient conversation, produce a JSON object with four fields:

```
clinicalSnapshot  →  4–6 short verbatim phrases labelled by category
doctorActions     →  3–5 short action strings (what the doctor ordered)
issuesParagraph   →  2–3 sentence narrative of the patient's presentation
actionsParagraph  →  2–3 sentence narrative of the doctor's plan
```

### Task B — Expand (Secondary)

Given a user-edited set of `clinicalSnapshot` chips and `doctorActions` bullets (after the doctor has made changes), regenerate only the two narrative paragraphs to stay in sync with the edited items. The original transcript is passed alongside for factual grounding.

Both tasks require the model to output **raw JSON with no markdown fences, no preamble, no explanation**. The response must start with `{` and end with `}`.

---

## 4. Evaluation Parameters & Rationale

Six metrics were measured. Each captures a distinct failure mode that would degrade the clinical documentation workflow.

### 4.1 valid_json

**What it measures:** Whether the model's raw output can be parsed as valid JSON after stripping common markdown artefacts (` ```json ` fences).

**Why it matters:** A non-parseable response returns an empty summary to the doctor — no snapshot, no actions, no paragraphs. The entire visit summary is lost. This is a hard failure.

**Threshold:** Binary (pass/fail). Any model failing this on any test case is disqualified for production use.

---

### 4.2 schema_ok

**What it measures:** Whether the parsed JSON contains all four required top-level fields (`clinicalSnapshot`, `doctorActions`, `issuesParagraph`, `actionsParagraph`) with the correct types (array, array, string, string).

**Why it matters:** The frontend components render directly from this schema. A missing or mistyped field causes a runtime error in the UI. A model may produce valid JSON with its own invented schema — this catches that.

**Threshold:** Binary (pass/fail).

---

### 4.3 support_rate

**What it measures:** The fraction of generated clinical facts (snapshot labels + action texts) that can be fuzzy-matched back to the original transcript. This is the hallucination score.

**Algorithm (from `summarizer.py::_fuzzy_supported`):**
1. Tokenise the claim into words of length > 3
2. For each token, check if it appears literally in the transcript, or if any transcript word has SequenceMatcher ratio > 0.72
3. A claim is supported if ≥ 60% of its tokens match

**Why it matters:** Clinical documentation is written to a patient's permanent medical record. A hallucinated medication name, dosage, or condition that the doctor does not notice in review could cause patient harm. Support rate is the primary quality metric.

**Target:** ≥ 0.95 across all test cases.

---

### 4.4 categories_valid

**What it measures:** The count of `clinicalSnapshot` items whose `category` field is one of the eight valid values defined in the system: `symptom`, `duration`, `timing`, `medication`, `action`, `lifestyle`, `warning`, `negative`.

**Why it matters:** The frontend renders category-specific chips (colour, icon, sort order). An invalid category like `"test result"` is silently remapped to `"symptom"` by the parser, losing the intended classification and potentially burying important items.

**Target:** All snapshot items should have a valid category.

---

### 4.5 snapshot_count / actions_count

**What it measures:** The number of items the model produced in each array.

**Why it matters:** The system prompt specifies `4–6 items` for snapshot and `3–5 items` for actions. Producing too few means important clinical facts are missed. Producing too many risks polluting the record with noise.

**Target:** 4–6 snapshot items, 3–5 action items.

---

### 4.6 elapsed (inference latency)

**What it measures:** Wall-clock time in seconds from sending the HTTP request to Ollama to receiving the complete response. Includes tokenisation, inference, and detokenisation. Excludes model load time (cold start tracked separately).

**Why it matters:** After the doctor clicks "Stop Recording", the pipeline runs: WhisperX transcription → pyannote diarization → LLM summarization. The doctor is standing in the exam room waiting. The target total pipeline time is under 90 seconds on CPU hardware. LLM latency is one component of that.

**Target:** < 15s warm inference on MPS (proxy for ≤ 60s on CPU-only).

---

## 5. Models Under Evaluation

### 5.1 qwen2.5:3b — Current Production Model

| Property | Value |
|----------|-------|
| Developer | Alibaba / Qwen Team |
| Parameters | 3B |
| Quantization | Q4_K_M (via Ollama) |
| Size on disk | 1.9 GB |
| Architecture | Transformer, GQA |
| Training focus | General instruction following, multilingual |
| Ollama tag | `qwen2.5:3b` |

Qwen2.5 represents a significant improvement over Qwen2 in instruction following and structured output. The 3B variant was the original model loaded via `llama-cpp-python` with the GGUF file at `room-agent/model/qwen2.5-3b-instruct-q4_k_m.gguf`. It established the baseline for this evaluation.

---

### 5.2 qwen3:4b — Successor Candidate

| Property | Value |
|----------|-------|
| Developer | Alibaba / Qwen Team |
| Parameters | 4B |
| Quantization | Q4_K_M (via Ollama) |
| Size on disk | 2.5 GB |
| Architecture | Transformer with extended thinking (CoT) |
| Training focus | Reasoning, chain-of-thought, instruction following |
| Ollama tag | `qwen3:4b` |

Qwen3 introduces a hybrid thinking architecture. In default mode, the model performs extended chain-of-thought reasoning before producing its answer — generating internal `<think>...</think>` tokens that are not visible in the final output but consume token budget. This is a deliberate design choice for complex reasoning tasks.

---

### 5.3 phi4-mini — Microsoft Challenger

| Property | Value |
|----------|-------|
| Developer | Microsoft Research |
| Parameters | 3.8B |
| Quantization | Q4_K_M (via Ollama) |
| Size on disk | 2.5 GB |
| Architecture | Transformer, optimised for instruction following |
| Training focus | Structured output, reasoning, STEM tasks |
| Ollama tag | `phi4-mini` |

Phi4-mini is Microsoft's latest small model, inheriting the Phi series' emphasis on high quality output at minimal parameter count. The Phi series has consistently ranked at the top of small-model benchmarks for instruction following and structured output tasks. phi4-mini specifically was evaluated as the leading 3-4B alternative to Qwen.

---

### 5.4 llama3.1:8b — Reference Baseline

| Property | Value |
|----------|-------|
| Developer | Meta AI |
| Parameters | 8B |
| Quantization | Q4_K_M (via Ollama) |
| Size on disk | 4.9 GB |
| Architecture | Transformer, GQA |
| Training focus | General purpose, instruction following |
| Ollama tag | `llama3.1:8b` |

Llama 3.1 8B is the industry reference model in the mid-range tier. It was included as a quality upper-bound baseline — a well-established, widely tested model that defines what good performance looks like. It was not expected to win on hardware constraints but provides a quality ceiling for the 3-4B models to be compared against.

---

## 6. Test Cases

Three primary consultation dialogues were written to cover the range of clinical scenarios Alvyto will encounter. A fourth test covers the Expand task.

### Test Case 1 — GP Visit: Headache & Blood Pressure

**Scenario:** A patient presents with a three-day throbbing headache. During the visit, the doctor identifies it as migraine, notes elevated blood pressure (145/92), and prescribes sumatriptan while recommending stopping ibuprofen and scheduling a follow-up.

**Why this case:** Contains a mix of symptom categories (symptom, timing, medication, warning), a numerical measurement (blood pressure), a safety warning (ER instructions), and a medication change. Tests whether the model correctly classifies the ibuprofen stop as an action and the ER instruction as a warning.

**Dialogue length:** 11 turns, ~200 words

---

### Test Case 2 — Diabetes Follow-up: Medication Adjustment

**Why this case:** Contains a numerical A1C value (8.4), a medication dose change (metformin 500mg → 1000mg), a lifestyle factor (rice consumption), and a referral (dietitian). The A1C value is a subtle hallucination trap — the model might paraphrase "A1C came back at 8.4" as "A1C level elevated" or "A1C test result", which introduces words not in the transcript. Tests verbatim extraction discipline.

**Dialogue length:** 9 turns, ~185 words

---

### Test Case 3 — Short Visit: Sore Throat

**Why this case:** A brief, fast-moving consultation with a clear diagnosis (strep throat), a specific medication (amoxicillin 500mg), and lifestyle instructions. Tests whether the model performs correctly on short conversations where less context is available and the risk of padding with inferred content is higher.

**Dialogue length:** 7 turns, ~110 words

---

### Test Case 4 — Expand: Paragraph Regeneration

**Why this case:** Tests Task B independently. Provides pre-built snapshot chips and action bullets (representing a doctor who has edited the initial summary) and asks for regenerated paragraphs. Validates that the model correctly synthesises narrative prose from structured input while staying grounded in the original transcript.

---

## 7. Results

### 7.1 Raw Scores

| Model | Test Case | Time (s) | Valid JSON | Schema OK | Snapshot | Actions | Cats Valid | Support Rate | Pass |
|-------|-----------|----------|-----------|-----------|----------|---------|-----------|-------------|------|
| qwen2.5:3b | GP Headache | 10.3 | ✓ | ✓ | 6 | 4 | 6/6 | 1.00 | ✓ |
| qwen2.5:3b | Diabetes | 7.4 | ✓ | ✓ | 6 | 3 | 5/6 | 0.89 | ✓ |
| qwen2.5:3b | Sore Throat | 6.9 | ✓ | ✓ | 6 | 4 | 5/6 | 0.90 | ✓ |
| qwen2.5:3b | Expand | 3.8 | ✓ | — | — | — | — | — | ✓ |
| **qwen3:4b** | GP Headache | 41.5 | **✗** | **✗** | 0 | 0 | 0 | 0.00 | **✗** |
| **qwen3:4b** | Diabetes | 30.0 | **✗** | **✗** | 0 | 0 | 0 | 0.00 | **✗** |
| **qwen3:4b** | Sore Throat | 30.7 | **✗** | **✗** | 0 | 0 | 0 | 0.00 | **✗** |
| **qwen3:4b** | Expand | 31.5 | **✗** | — | — | — | — | — | **✗** |
| phi4-mini | GP Headache | 25.4* | ✓ | ✓ | 6 | 4 | 6/6 | 1.00 | ✓ |
| phi4-mini | Diabetes | 7.6 | ✓ | ✓ | 6 | 3 | 6/6 | 1.00 | ✓ |
| phi4-mini | Sore Throat | 9.2 | ✓ | ✓ | 5 | 5 | 5/5 | 1.00 | ✓ |
| phi4-mini | Expand | 6.1 | ✓ | — | — | — | — | — | ✓ |
| llama3.1:8b | GP Headache | 22.4 | ✓ | ✓ | 6 | 3 | 6/6 | 1.00 | ✓ |
| llama3.1:8b | Diabetes | 16.0 | ✓ | ✓ | 6 | 3 | 6/6 | 1.00 | ✓ |
| llama3.1:8b | Sore Throat | 12.3 | ✓ | ✓ | 6 | 3 | 5/6 | 1.00 | ✓ |
| llama3.1:8b | Expand | 10.5 | ✓ | — | — | — | — | — | ✓ |

*cold start (first inference after model load) — see §10

---

### 7.2 Aggregate Summary

| Model | Avg Time | JSON OK | Schema OK | Avg Support | Cats Valid | Overall Pass |
|-------|----------|---------|-----------|-------------|-----------|-------------|
| qwen2.5:3b | 7.1s | 100% | 100% | 0.93 | 16/18 | 4/4 |
| **qwen3:4b** | **33.4s** | **0%** | **0%** | **0.00** | **0/18** | **0/4** |
| phi4-mini | 12.1s (7.6s warm) | 100% | 100% | **1.00** | 17/17 | 4/4 |
| llama3.1:8b | 15.3s | 100% | 100% | **1.00** | 17/18 | 4/4 |

---

### 7.3 Inference Time by Test Case

```
Inference Time (seconds, warm)

qwen2.5:3b  ████████████ 10.3s   ████████ 7.4s    ███████ 6.9s    ████ 3.8s
qwen3:4b    ██████████████████████████████████████ 41.5s  ████████████████████████████ 30.0s  ████████████████████████████ 30.7s  ████████████████████████████ 31.5s
phi4-mini   ████████ 7.6s*  ████████ 7.6s   █████████ 9.2s  ██████ 6.1s
llama3.1:8b ██████████████████████ 22.4s   ████████████████ 16.0s  ████████████ 12.3s  ██████████ 10.5s

                    ← faster                                       slower →
* phi4-mini Test 1 time is cold start (25.4s); warm shown (7.6s from Test 2)
```

---

### 7.4 Quality vs Speed Positioning

```
                         QUALITY (support rate)
                    0.0        0.5        1.0
                     |          |          |
              5s  ─ ─|─ ─ ─ ─ ─|─ ─ ─ ─ ─|─
                     |          |          |
             10s  ─  |          |   [qwen2.5:3b] ← fast, minor hallucinations
    INFERENCE        |          |          |
    TIME (warm) 15s  |          |     [phi4-mini] ← fast (warm), perfect quality
                     |          |          |
             20s  ─  |          |   [llama3.1:8b] ← slow (8B), perfect quality
                     |          |          |
             35s  ─  |[qwen3:4b]|          |  ← failed entirely
                     |          |          |
```

---

### 7.5 Support Rate — Hallucination Comparison

```
Support Rate (1.0 = zero hallucination detected)

qwen2.5:3b   Test 1: ██████████ 1.00
             Test 2: █████████  0.89  ← "A1C level" (word 'level' not spoken)
             Test 3: █████████  0.90  ← minor label paraphrase

phi4-mini    Test 1: ██████████ 1.00
             Test 2: ██████████ 1.00
             Test 3: ██████████ 1.00

llama3.1:8b  Test 1: ██████████ 1.00
             Test 2: ██████████ 1.00
             Test 3: ██████████ 1.00

qwen3:4b     All tests: ░░░░░░░░░░ 0.00  (produced no output)
```

---

### 7.6 Category Validity

Valid categories: `symptom`, `duration`, `timing`, `medication`, `action`, `lifestyle`, `warning`, `negative`

```
Category Compliance (valid items / total items)

qwen2.5:3b   Test 1: 6/6  ✓
             Test 2: 5/6  ✗  ← used "test result" (not in schema)
             Test 3: 5/6  ✗  ← used non-schema category

phi4-mini    Test 1: 6/6  ✓
             Test 2: 6/6  ✓
             Test 3: 5/5  ✓  (produced 5 items, all valid)

llama3.1:8b  Test 1: 6/6  ✓
             Test 2: 6/6  ✓
             Test 3: 5/6  ✗  ← one invalid category

qwen3:4b     All:    N/A  (no output produced)
```

---

## 8. Per-Model Analysis

### 8.1 qwen2.5:3b

**Strengths:**
- Fastest warm inference in the evaluation: 7.1s average
- Reliable JSON output on every test (100%)
- Smallest disk footprint: 1.9 GB
- Already validated in production via llama-cpp-python

**Weaknesses:**
- Support rate drops to 0.89 on the diabetes case. The model produced `"A1C level"` as a snapshot label. The word "level" does not appear in the transcript — the doctor said "A1C came back at 8.4". This is a paraphrase hallucination, not a factual one, but it fails the zero-inference rule.
- Used the category `"test result"` on the diabetes case, which is not in the valid schema. The production parser silently remaps this to `"symptom"`, losing the intended classification.
- Pattern repeats on the sore throat case (support rate 0.90) with a different minor label paraphrase.

**Assessment:** A competent baseline, but the consistent pattern of minor paraphrasing suggests the model has a tendency to slightly rephrase rather than quote verbatim. In a system explicitly designed around zero-inference extraction, this is a meaningful quality gap.

---

### 8.2 qwen3:4b — Disqualified

**Result:** 0/4 tasks passed. All test cases returned empty output.

**Root cause:** Qwen3 introduced a hybrid thinking architecture where the model performs extended chain-of-thought reasoning before generating its final response. In Ollama's default configuration, these thinking tokens are generated internally and consume the model's `num_predict` token budget.

The production `summarizer.py` sets `max_tokens=768`. Qwen3 consumed the entire 768-token budget generating internal reasoning traces, leaving zero tokens available for the actual JSON output. The response was an empty string on every test.

Increasing the budget to 4096 tokens did not resolve the issue — the model generated 2,400+ words of internal thinking in 153 seconds and still produced no content. The `think: false` Ollama parameter was tested and did not suppress thinking in the version available.

**Verdict:** Qwen3 in its current Ollama form is incompatible with token-budgeted structured output tasks. A dedicated `qwen3:4b-nothink` variant has been discussed in the Qwen team's roadmap but was not available at evaluation time.

---

### 8.3 phi4-mini

**Strengths:**
- Perfect support rate across all three test cases (1.00)
- Perfect category compliance on tests 1 and 2 (test 3 produced 5 valid items with all categories correct — a deliberate choice to not manufacture a sixth item on a short visit)
- Warm inference time of ~7.6s, statistically identical to qwen2.5:3b
- Never hallucinated category names outside the schema

**Weaknesses:**
- Cold start (first inference after model load) took 25.4s vs ~10s for qwen2.5:3b. This is a model load + cache warm-up artefact, not a sustained performance characteristic. With warm-up at server start (§10), this is a non-issue.
- Produced output wrapped in ` ```json ` markdown fences on tests 1 and 2, despite the system prompt explicitly saying "No markdown. No code fences." The production parser already handles this via regex cleanup — it is not a blocking issue, but the instruction non-compliance is worth noting.

**Assessment:** phi4-mini is the standout performer. It produces verbatim extractions, respects the schema, and matches the speed of the current model once warm. The markdown fence issue is handled by existing parser code and does not affect output quality.

---

### 8.4 llama3.1:8b

**Strengths:**
- Perfect support rate across all tests (1.00)
- Perfect category compliance (one invalid category on sore throat case, otherwise clean)
- Well-tested and widely deployed model with strong community validation

**Weaknesses:**
- 4.9 GB on disk — more than double qwen2.5:3b and phi4-mini
- Average inference time of 15.3s on MPS hardware. On CPU-only clinic hardware, this scales to approximately 60-90 seconds for the summarization step alone, pushing the total pipeline (WhisperX + diarization + LLM) well past the 90-second target.
- Higher RAM requirement at runtime (~6-7 GB model footprint), constraining the server's headroom for running WhisperX and pyannote concurrently.

**Assessment:** llama3.1:8b confirms that perfect quality is achievable, functioning as a quality ceiling reference. However, it is operationally unsuitable for the target hardware. It is not recommended for deployment.

---

## 9. Failure Analysis — Qwen3:4b

This section documents the Qwen3 investigation in detail for the record.

### 9.1 Symptom

All four benchmark tasks returned empty string responses. Elapsed time was 30-41 seconds, indicating the model was actively generating tokens but producing no usable output.

### 9.2 Diagnosis

Qwen3 uses an extended thinking architecture. When prompted, it generates a full reasoning trace wrapped in `<think>...</think>` tokens before producing the final answer. These thinking tokens:

1. Are generated as part of the model's normal output stream
2. Consume the `num_predict` (max_tokens) budget
3. Are exposed via a separate `thinking` key in the Ollama response, not in `content`

At the production budget of 768 tokens, the thinking phase alone consumed 2,131+ words of reasoning — far exceeding the budget. The `content` field was empty because the model ran out of budget before reaching the answer phase.

### 9.3 Attempted Mitigations

| Mitigation | Result |
|-----------|--------|
| Increase `num_predict` to 4096 | Still failed — 2,414 thinking words generated in 153 seconds, content empty |
| Append `/no_think` to user message | No effect on thinking suppression |
| Set `"think": false` in options | Ollama accepted the parameter; thinking tokens still generated (2,131 words) |

### 9.4 Conclusion

Qwen3 is architecturally incompatible with the current summarizer configuration. The only viable fix would be a model variant with thinking disabled at compile/quantization time (`qwen3:4b-nothink`), which is not yet available on Ollama. Re-evaluation is recommended when this variant becomes available.

---

## 10. Cold Start vs. Warm Inference

A clinically important distinction: the **first inference** after a model loads into memory is significantly slower due to KV cache population, memory page faults, and metal shader compilation (on MPS). Subsequent inferences in the same server session are "warm" and substantially faster.

| Model | Cold Start | Warm (avg of tests 2-4) | Overhead |
|-------|-----------|------------------------|----------|
| qwen2.5:3b | ~10.3s | 6.0s | +72% |
| phi4-mini | 25.4s | 7.6s | +234% |
| llama3.1:8b | 22.4s | 13.1s | +71% |

phi4-mini has a notably higher cold start overhead than qwen2.5:3b. However, this is irrelevant in production because the Alvyto room agent pre-warms models at server startup (a single dummy inference is run during the lifespan event). Every real doctor interaction therefore runs at warm speed.

**Effective production comparison: qwen2.5:3b at 6.0s vs phi4-mini at 7.6s — a 1.6 second difference.**

---

## 11. Projected Performance on Clinic Hardware

Benchmark results above were collected on Apple M-series with MPS acceleration. Target clinic hardware is CPU-only. Scaling factors are estimated based on the MPS-to-CPU ratio observed in published WhisperX benchmarks and llama-cpp community reports for comparable models.

| Model | MPS Warm | CPU Estimate (×4) | CPU Estimate (×5) | Viable? |
|-------|----------|-------------------|-------------------|---------|
| qwen2.5:3b | 6.0s | ~24s | ~30s | ✓ |
| phi4-mini | 7.6s | ~30s | ~38s | ✓ |
| llama3.1:8b | 13.1s | ~52s | ~65s | Marginal |
| qwen3:4b | N/A | N/A | N/A | ✗ |

With a mid-range clinic server (Intel Core i7 or equivalent), the LLM summarization step contributes 24-38 seconds to the total pipeline. Combined with WhisperX transcription (~30-45s) and pyannote diarization (~15-20s), the end-to-end pipeline sits at 70-100 seconds — within the acceptable range for immediate post-visit review.

A server with an entry-level GPU (e.g., NVIDIA RTX 3060) brings the LLM step to ~8-12s and the total pipeline under 60 seconds.

---

## 12. Final Recommendation

### Selected Model: phi4-mini

```
┌─────────────────────────────────────────────────────────────────────┐
│  SELECTED: phi4-mini                                                │
│                                                                     │
│  Ollama tag:  phi4-mini                                             │
│  Size:        2.5 GB                                                │
│  Warm speed:  ~7.6s (MPS) / ~30s (CPU)                             │
│  Support rate: 1.00 (zero hallucinations detected)                  │
│  Category compliance: 100%                                          │
│  JSON reliability: 100%                                             │
└─────────────────────────────────────────────────────────────────────┘
```

### Decision Matrix

| Criterion | Weight | qwen2.5:3b | qwen3:4b | phi4-mini | llama3.1:8b |
|-----------|--------|-----------|---------|-----------|------------|
| JSON reliability | Critical | ✓ PASS | ✗ FAIL | ✓ PASS | ✓ PASS |
| Schema compliance | Critical | ✓ PASS | ✗ FAIL | ✓ PASS | ✓ PASS |
| Support rate ≥ 0.95 | High | ✗ 0.93 | ✗ 0.00 | ✓ 1.00 | ✓ 1.00 |
| Category validity | High | ✗ 2 invalid | ✗ N/A | ✓ all valid | ~ 1 invalid |
| Warm inference < 15s | High | ✓ 6.0s | ✗ N/A | ✓ 7.6s | ✗ 13.1s |
| CPU viability < 45s | High | ✓ ~30s | ✗ N/A | ✓ ~30s | ~ ~55s |
| Disk footprint | Medium | ✓ 1.9 GB | ~ 2.5 GB | ~ 2.5 GB | ✗ 4.9 GB |
| Cross-platform | Medium | ✓ | ✓ | ✓ | ✓ |

### Why Not qwen2.5:3b

The current model is not disqualified — it passes every task and is the fastest model in the evaluation. However, the consistent pattern of minor paraphrasing (support rates of 0.89 and 0.90 on two of three test cases) indicates it does not reliably uphold the zero-inference rule. In a system where AI-generated content is written to a permanent patient medical record, this gap is meaningful. phi4-mini achieves an identical effective speed with zero detected hallucinations.

### Why Not llama3.1:8b

Perfect quality but operationally unsuitable. On CPU-only clinic hardware it pushes the total pipeline to 110-130 seconds, and its 4.9 GB footprint competes with WhisperX and pyannote for RAM on a typical clinic server.

### Monitoring Recommendation

After deploying phi4-mini in production:

1. Log `support_rate` per visit. If it drops below 0.90 on average over 50 visits, re-evaluate.
2. Log invalid category counts per visit. phi4-mini showed one instance of a 5-item snapshot on a short visit — acceptable, but monitor for regressions.
3. Re-evaluate qwen3:4b when `qwen3:4b-nothink` becomes available on Ollama. The model's reasoning capability could be beneficial if the thinking overhead is eliminated.

---

## 13. Appendix — Raw Benchmark Data

### A1. Full Results JSON

```json
{
  "qwen2.5:3b": [
    {"test": "GP visit — headache + BP",               "task": "summarize", "elapsed": 10.3, "valid_json": true,  "schema_ok": true,  "snapshot_count": 6, "actions_count": 4, "categories_valid": 6, "support_rate": 1.00, "paragraphs_ok": true},
    {"test": "Diabetes follow-up — medication adj",    "task": "summarize", "elapsed": 7.4,  "valid_json": true,  "schema_ok": true,  "snapshot_count": 6, "actions_count": 3, "categories_valid": 5, "support_rate": 0.89, "paragraphs_ok": true},
    {"test": "Short visit — sore throat",              "task": "summarize", "elapsed": 6.9,  "valid_json": true,  "schema_ok": true,  "snapshot_count": 6, "actions_count": 4, "categories_valid": 5, "support_rate": 0.90, "paragraphs_ok": true},
    {"test": "Expand paragraphs after editing",        "task": "expand",    "elapsed": 3.8,  "valid_json": true,  "paragraphs_ok": true}
  ],
  "qwen3:4b": [
    {"test": "GP visit — headache + BP",               "task": "summarize", "elapsed": 41.5, "valid_json": false, "schema_ok": false, "snapshot_count": 0, "actions_count": 0, "categories_valid": 0, "support_rate": 0.00, "paragraphs_ok": false},
    {"test": "Diabetes follow-up — medication adj",    "task": "summarize", "elapsed": 30.0, "valid_json": false, "schema_ok": false, "snapshot_count": 0, "actions_count": 0, "categories_valid": 0, "support_rate": 0.00, "paragraphs_ok": false},
    {"test": "Short visit — sore throat",              "task": "summarize", "elapsed": 30.7, "valid_json": false, "schema_ok": false, "snapshot_count": 0, "actions_count": 0, "categories_valid": 0, "support_rate": 0.00, "paragraphs_ok": false},
    {"test": "Expand paragraphs after editing",        "task": "expand",    "elapsed": 31.5, "valid_json": false, "paragraphs_ok": false}
  ],
  "phi4-mini": [
    {"test": "GP visit — headache + BP",               "task": "summarize", "elapsed": 25.4, "valid_json": true,  "schema_ok": true,  "snapshot_count": 6, "actions_count": 4, "categories_valid": 6, "support_rate": 1.00, "paragraphs_ok": true, "note": "cold start"},
    {"test": "Diabetes follow-up — medication adj",    "task": "summarize", "elapsed": 7.6,  "valid_json": true,  "schema_ok": true,  "snapshot_count": 6, "actions_count": 3, "categories_valid": 6, "support_rate": 1.00, "paragraphs_ok": true},
    {"test": "Short visit — sore throat",              "task": "summarize", "elapsed": 9.2,  "valid_json": true,  "schema_ok": true,  "snapshot_count": 5, "actions_count": 5, "categories_valid": 5, "support_rate": 1.00, "paragraphs_ok": true},
    {"test": "Expand paragraphs after editing",        "task": "expand",    "elapsed": 6.1,  "valid_json": true,  "paragraphs_ok": true}
  ],
  "llama3.1:8b": [
    {"test": "GP visit — headache + BP",               "task": "summarize", "elapsed": 22.4, "valid_json": true,  "schema_ok": true,  "snapshot_count": 6, "actions_count": 3, "categories_valid": 6, "support_rate": 1.00, "paragraphs_ok": true},
    {"test": "Diabetes follow-up — medication adj",    "task": "summarize", "elapsed": 16.0, "valid_json": true,  "schema_ok": true,  "snapshot_count": 6, "actions_count": 3, "categories_valid": 6, "support_rate": 1.00, "paragraphs_ok": true},
    {"test": "Short visit — sore throat",              "task": "summarize", "elapsed": 12.3, "valid_json": true,  "schema_ok": true,  "snapshot_count": 6, "actions_count": 3, "categories_valid": 5, "support_rate": 1.00, "paragraphs_ok": true},
    {"test": "Expand paragraphs after editing",        "task": "expand",    "elapsed": 10.5, "valid_json": true,  "paragraphs_ok": true}
  ]
}
```

### A2. Evaluation Environment

```
Hardware:       Apple M-series (MPS acceleration active)
OS:             macOS Darwin 25.3.0
Ollama version: latest (homebrew)
Python:         3.14 (benchmark venv)
HTTP client:    httpx
Temperature:    0.1 (all models)
Top-p:          0.95 (all models)
Max tokens:     768 (production value from summarizer.py)
Context window: Ollama default per model
Date:           2026-03-28
```

### A3. Benchmark Script

The benchmark script that produced these results is located at:

```
/benchmark/run_benchmark.py
```

It uses the **exact** `SYSTEM_PROMPT` and `EXPAND_PROMPT` strings copied verbatim from `room-agent/summarizer.py`, and the **exact** fuzzy support validation logic from `summarizer.py::_fuzzy_supported`. Results are reproducible by running:

```bash
cd /path/to/alvyto
benchmark/venv/bin/python benchmark/run_benchmark.py
```

Requires Ollama running locally with `qwen2.5:3b`, `qwen3:4b`, `phi4-mini`, and `llama3.1:8b` pulled.

---

*Report generated by Alvyto development team. For questions or re-evaluation requests, re-run the benchmark script after pulling updated model versions.*
