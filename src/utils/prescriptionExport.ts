import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Visit, PrescriptionDraft } from '@/types';
import type { Doctor, EMRPatient } from '@/types/emr';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 42;
const INDIGO = rgb(0.11, 0.18, 0.34);
const SLATE = rgb(0.3, 0.36, 0.43);
const LIGHT = rgb(0.89, 0.92, 0.96);
const SOFT = rgb(0.97, 0.98, 0.99);

function formatDateTime(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatDateOnly(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

function computeAge(value?: string | null): string | null {
  if (!value) return null;
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 ? `${age} years` : null;
}

function normalizeDraft(visit: Visit): PrescriptionDraft | null {
  const draft = visit.summary?.prescriptionDraft;
  // If we have a draft with medications, use it as-is
  if (draft && draft.medications && draft.medications.length > 0) return draft;

  // Try prescriptionDraft.medications first
  let medications: Array<{name: string; dosage?: string; frequency?: string; duration?: string; route?: string; instructions?: string;}> =
    draft?.medications && draft.medications.length > 0
      ? draft.medications
      : (visit.summary?.prescriptions ?? []).map((item) => ({
          name: item.name,
          dosage: item.dosage,
          frequency: item.frequency,
          duration: undefined,
          route: undefined,
          instructions: undefined,
        }));

  // Last resort: extract from clinicalSnapshot items with category "medication"
  if (medications.length === 0) {
    const FREQ_WORDS = new Set(['daily','twice','once','thrice','weekly','hourly','mg','ml','mcg','g','tablet','tablets','capsule','capsules','drop','drops','patch','injection','oral','iv','im']);
    const ACTION_VERBS = /^(prescribing|prescribed|taking|take|administer|administering|give|giving|start|starting|use|using|apply|applying)\s+/i;
    medications = (visit.summary?.clinicalSnapshot ?? [])
      .filter((item) => item.category === 'medication')
      .map((item) => {
        let name = item.label.replace(ACTION_VERBS, '').trim();
        const words = name.split(/\s+/);
        if (words.length >= 2 && FREQ_WORDS.has(words[1].toLowerCase().replace(/[.,;]$/, ''))) {
          name = words[0];
        } else if (words.length > 2) {
          name = words.slice(0, 2).join(' ');
        }
        return { name, dosage: undefined, frequency: undefined, duration: undefined, route: undefined, instructions: undefined };
      });
  }

  const fallbackDiagnoses = (visit.summary?.clinicalSnapshot ?? [])
    .filter((item) => ['symptom', 'warning', 'action'].includes(item.category))
    .map((item) => item.label)
    .slice(0, 4);

  const fallbackAdvice = (visit.summary?.doctorActions ?? []).map((item) => item.text).slice(0, 5);

  const diagnoses = draft?.diagnoses ?? fallbackDiagnoses;
  const advice = draft?.advice ?? fallbackAdvice;
  const investigations = draft?.investigations ?? [];
  const warnings = draft?.warnings ?? [];
  const reportSummary = draft?.reportSummary ?? '';
  const followUp = draft?.followUp ?? null;

  const hasFollowUp = Boolean(followUp?.timeline || followUp?.notes);
  const hasContent =
    medications.length > 0 ||
    diagnoses.length > 0 ||
    advice.length > 0 ||
    investigations.length > 0 ||
    warnings.length > 0 ||
    reportSummary.trim().length > 0 ||
    hasFollowUp;

  if (!hasContent) return null;

  return {
    diagnoses,
    medications,
    investigations,
    advice,
    warnings,
    reportSummary,
    followUp,
  };
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = words[0] || '';
  for (const word of words.slice(1)) {
    const candidate = `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  lines.push(current);
  return lines;
}

function drawWrappedText(params: {
  page: PDFPage;
  text: string;
  x: number;
  y: number;
  maxWidth: number;
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
  lineGap?: number;
}): number {
  const { page, text, x, y, maxWidth, font, size, color = SLATE, lineGap = 4 } = params;
  const lines = wrapText(text, font, size, maxWidth);
  let cursor = y;
  for (const line of lines) {
    page.drawText(line, { x, y: cursor, font, size, color });
    cursor -= size + lineGap;
  }
  return cursor;
}

function drawKeyValueBlock(params: {
  page: PDFPage;
  label: string;
  value: string;
  x: number;
  y: number;
  width: number;
  labelFont: PDFFont;
  bodyFont: PDFFont;
}): void {
  const { page, label, value, x, y, width, labelFont, bodyFont } = params;
  page.drawText(label.toUpperCase(), {
    x,
    y,
    font: labelFont,
    size: 8,
    color: SLATE,
  });
  drawWrappedText({
    page,
    text: value || 'N/A',
    x,
    y: y - 14,
    maxWidth: width,
    font: bodyFont,
    size: 11,
    color: INDIGO,
    lineGap: 2,
  });
}

async function createPrescriptionPdfBytes(params: {
  visit: Visit;
  patient?: EMRPatient | null;
  doctor?: Doctor | null;
  allergies?: string[];
}): Promise<Uint8Array> {
  const { visit, patient, doctor, allergies = [] } = params;
  const draft = normalizeDraft(visit);

  const pdf = await PDFDocument.create();
  let page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const mono = await pdf.embedFont(StandardFonts.Courier);

  const patientName = patient?.name || `Patient ${visit.patientId.slice(0, 8)}`;
  const patientAge = computeAge(patient?.dateOfBirth);
  const patientMeta = [patientAge, patient?.sex || patient?.gender, patient?.phone].filter(Boolean).join(' • ') || 'N/A';
  const doctorName = doctor?.name || 'Assigned Doctor';
  const doctorMeta = [
    doctor?.specialty || 'General Medicine',
    doctor?.licenseNumber ? `Reg. No. ${doctor.licenseNumber}` : null,
    doctor?.phone || doctor?.email,
  ].filter(Boolean).join(' • ');
  const issueDateTime = formatDateTime(visit.endedAt || visit.createdAt);
  const issueDate = formatDateOnly(visit.endedAt || visit.createdAt);
  const visitReference = `VISIT-${visit.id.slice(0, 8).toUpperCase()}`;

  page.drawRectangle({
    x: 0,
    y: A4_HEIGHT - 120,
    width: A4_WIDTH,
    height: 120,
    color: SOFT,
  });

  page.drawText('ALVYTO CLINICAL PRESCRIPTION', {
    x: MARGIN,
    y: A4_HEIGHT - 58,
    font: bold,
    size: 20,
    color: INDIGO,
  });
  page.drawText('Computer-generated prescription record', {
    x: MARGIN,
    y: A4_HEIGHT - 78,
    font: regular,
    size: 10,
    color: SLATE,
  });

  drawWrappedText({
    page,
    text: doctorName,
    x: A4_WIDTH - 220,
    y: A4_HEIGHT - 54,
    maxWidth: 180,
    font: bold,
    size: 15,
    color: INDIGO,
    lineGap: 1,
  });
  drawWrappedText({
    page,
    text: doctorMeta || 'Prescriber details unavailable',
    x: A4_WIDTH - 220,
    y: A4_HEIGHT - 74,
    maxWidth: 180,
    font: regular,
    size: 9,
    color: SLATE,
    lineGap: 2,
  });

  let y = A4_HEIGHT - 150;
  page.drawRectangle({
    x: MARGIN,
    y: y - 86,
    width: A4_WIDTH - MARGIN * 2,
    height: 86,
    borderColor: LIGHT,
    borderWidth: 1,
    color: rgb(1, 1, 1),
  });

  drawKeyValueBlock({ page, label: 'Patient Name', value: patientName, x: MARGIN + 14, y: y - 16, width: 170, labelFont: bold, bodyFont: regular });
  drawKeyValueBlock({ page, label: 'Patient ID / MRN', value: `${visit.patientId.slice(0, 8).toUpperCase()} / ${patient?.mrn || 'N/A'}`, x: MARGIN + 195, y: y - 16, width: 150, labelFont: bold, bodyFont: regular });
  drawKeyValueBlock({ page, label: 'Date of Birth', value: patient?.dateOfBirth || 'N/A', x: MARGIN + 360, y: y - 16, width: 110, labelFont: bold, bodyFont: regular });
  drawKeyValueBlock({ page, label: 'Age / Sex / Contact', value: patientMeta, x: MARGIN + 14, y: y - 54, width: 240, labelFont: bold, bodyFont: regular });
  drawKeyValueBlock({ page, label: 'Issued On', value: issueDateTime, x: MARGIN + 275, y: y - 54, width: 170, labelFont: bold, bodyFont: regular });
  drawKeyValueBlock({ page, label: 'Reference', value: visitReference, x: MARGIN + 455, y: y - 54, width: 80, labelFont: bold, bodyFont: mono });

  y -= 120;

  page.drawText('ALLERGIES', {
    x: MARGIN,
    y,
    font: bold,
    size: 10,
    color: SLATE,
  });
  page.drawRectangle({
    x: MARGIN + 80,
    y: y - 6,
    width: A4_WIDTH - MARGIN * 2 - 80,
    height: 18,
    color: allergies.length ? rgb(1, 0.95, 0.95) : rgb(0.97, 0.98, 0.99),
    borderColor: LIGHT,
    borderWidth: 1,
  });
  page.drawText((allergies.length ? allergies.join(', ') : 'No known allergy documented').toUpperCase(), {
    x: MARGIN + 88,
    y,
    font: bold,
    size: 9,
    color: allergies.length ? rgb(0.63, 0.11, 0.11) : SLATE,
  });

  y -= 42;
  page.drawText('Rx', {
    x: MARGIN,
    y,
    font: bold,
    size: 28,
    color: INDIGO,
  });

  const diagnosisText = draft?.diagnoses?.length
    ? draft.diagnoses.map((item) => item.toUpperCase()).join(', ')
    : (visit.summary?.issuesParagraph || 'No diagnosis structured in this record.').trim();
  drawWrappedText({
    page,
    text: `Assessment: ${diagnosisText}`,
    x: MARGIN + 48,
    y: y + 8,
    maxWidth: A4_WIDTH - MARGIN * 2 - 48,
    font: regular,
    size: 11,
    color: INDIGO,
    lineGap: 2,
  });
  y -= 34;

  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4_WIDTH - MARGIN, y },
    thickness: 1,
    color: LIGHT,
  });
  y -= 20;

  const medications = draft?.medications ?? [];
  if (medications.length > 0) {
    medications.forEach((medication, index) => {
      const drugLine = `${index + 1}. ${medication.name.toUpperCase()}`;
      const schedule = [
        medication.dosage,
        medication.frequency,
        medication.duration,
        medication.route,
      ].filter(Boolean).join(' • ') || 'Dose / timing not captured';
      const instructions = medication.instructions || 'Take as advised by the clinician.';

      if (y < 170) {
        page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
        y = A4_HEIGHT - MARGIN;
      }

      page.drawText(drugLine, {
        x: MARGIN,
        y,
        font: bold,
        size: 12,
        color: INDIGO,
      });
      y = drawWrappedText({
        page,
        text: schedule,
        x: MARGIN + 22,
        y: y - 16,
        maxWidth: A4_WIDTH - MARGIN * 2 - 22,
        font: regular,
        size: 10,
        color: SLATE,
        lineGap: 2,
      });
      y = drawWrappedText({
        page,
        text: `Instructions: ${instructions}`,
        x: MARGIN + 22,
        y: y - 2,
        maxWidth: A4_WIDTH - MARGIN * 2 - 22,
        font: regular,
        size: 10,
        color: SLATE,
        lineGap: 2,
      });
      y -= 10;
      page.drawLine({
        start: { x: MARGIN + 18, y },
        end: { x: A4_WIDTH - MARGIN, y },
        thickness: 0.8,
        color: LIGHT,
      });
      y -= 16;
    });
  } else {
    y = drawWrappedText({
      page,
      text: 'No medication orders were captured in the approved visit summary.',
      x: MARGIN,
      y,
      maxWidth: A4_WIDTH - MARGIN * 2,
      font: regular,
      size: 11,
      color: SLATE,
      lineGap: 2,
    }) - 12;
  }

  const addSection = (title: string, lines: string[]) => {
    if (!lines.length) return;
    if (y < 140) {
      page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
      y = A4_HEIGHT - MARGIN;
    }
    page.drawText(title.toUpperCase(), {
      x: MARGIN,
      y,
      font: bold,
      size: 10,
      color: SLATE,
    });
    y -= 16;
    for (const line of lines) {
      y = drawWrappedText({
        page,
        text: `• ${line}`,
        x: MARGIN + 8,
        y,
        maxWidth: A4_WIDTH - MARGIN * 2 - 8,
        font: regular,
        size: 10,
        color: INDIGO,
        lineGap: 2,
      }) - 6;
    }
    y -= 6;
  };

  addSection('Investigations / Reports', [
    ...(draft?.reportSummary ? [draft.reportSummary] : []),
    ...((draft?.investigations ?? []).map((item) =>
      [item.name, item.details, item.timing].filter(Boolean).join(' — ')
    )),
  ]);
  addSection('Advice', draft?.advice ?? []);
  addSection('Warnings', draft?.warnings ?? []);

  const followUp = [draft?.followUp?.timeline, draft?.followUp?.notes].filter(Boolean).join(' • ');
  if (followUp) addSection('Follow-up', [followUp]);

  if (y < 120) {
    page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
    y = A4_HEIGHT - MARGIN;
  }

  y -= 10;
  page.drawLine({
    start: { x: A4_WIDTH - 210, y: y + 32 },
    end: { x: A4_WIDTH - MARGIN, y: y + 32 },
    thickness: 1,
    color: SLATE,
  });
  page.drawText(doctorName, {
    x: A4_WIDTH - 210,
    y: y + 14,
    font: bold,
    size: 11,
    color: INDIGO,
  });
  page.drawText(doctorMeta || 'Prescriber record', {
    x: A4_WIDTH - 210,
    y,
    font: regular,
    size: 9,
    color: SLATE,
  });
  page.drawText(`Issued: ${issueDate}  |  Ref: ${visitReference}`, {
    x: MARGIN,
    y: 34,
    font: mono,
    size: 8,
    color: SLATE,
  });
  page.drawText('Electronic prescription generated from approved visit record.', {
    x: MARGIN,
    y: 20,
    font: regular,
    size: 8,
    color: SLATE,
  });

  return pdf.save();
}

export async function triggerPrescriptionDownload(
  filename: string,
  params: {
    visit: Visit;
    patient?: EMRPatient | null;
    doctor?: Doctor | null;
    allergies?: string[];
  }
): Promise<void> {
  const pdfBytes = await createPrescriptionPdfBytes(params);
  const arrayBuffer = pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
