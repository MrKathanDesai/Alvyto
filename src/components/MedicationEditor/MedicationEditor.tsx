'use client';

import { useState, type KeyboardEvent } from 'react';
import type { PrescriptionMedicationDetail } from '@/types';
import styles from './MedicationEditor.module.css';

interface MedicationEditorProps {
  medications: PrescriptionMedicationDetail[];
  onChange: (medications: PrescriptionMedicationDetail[]) => void;
  disabled?: boolean;
  compact?: boolean;
}

const DRUG_LIST = [
  'Paracetamol',
  'Ibuprofen',
  'Aspirin',
  'Amoxicillin',
  'Azithromycin',
  'Ciprofloxacin',
  'Metformin',
  'Atorvastatin',
  'Omeprazole',
  'Pantoprazole',
  'Ranitidine',
  'Cetirizine',
  'Loratadine',
  'Montelukast',
  'Salbutamol',
  'Prednisolone',
  'Dexamethasone',
  'Metoprolol',
  'Carvedilol',
  'Amlodipine',
  'Lisinopril',
  'Losartan',
  'Furosemide',
  'Spironolactone',
  'Nitroglycerin',
  'Isosorbide Mononitrate',
  'Warfarin',
  'Clopidogrel',
  'Enoxaparin',
  'Insulin Regular',
  'Insulin Glargine',
  'Glibenclamide',
  'Sitagliptin',
  'Levothyroxine',
  'Hydrocortisone',
  'Folic Acid',
  'Iron Sucrose',
  'Vitamin D3',
  'Calcium Carbonate',
  'Magnesium Hydroxide',
  'Ondansetron',
  'Domperidone',
  'Metoclopramide',
  'Loperamide',
  'Oral Rehydration Salts',
  'Clindamycin',
  'Doxycycline',
  'Cotrimoxazole',
  'Fluconazole',
  'Acyclovir',
  'Diazepam',
  'Lorazepam',
  'Haloperidol',
  'Risperidone',
  'Sertraline',
  'Amitriptyline',
  'Gabapentin',
  'Carbamazepine',
  'Phenytoin',
  'Morphine',
  'Tramadol',
  'Diclofenac',
  'Naproxen',
  'Codeine',
  'Chlorpheniramine',
  'Betamethasone',
  'Clotrimazole',
  'Mupirocin',
  'Permethrin',
  'Albendazole',
  'Mebendazole',
  'Metronidazole',
  'Tinidazole',
  'Hydroxychloroquine',
  'Nitrofurantoin',
  'Trimethoprim',
] as const;

const FREQUENCY_OPTIONS = [
  'Morning',
  'Night',
  'Twice daily',
  'Three times daily',
  'Every 8 hrs',
  'Every 6 hrs',
  'As needed',
  'Once daily',
  'Bedtime',
] as const;

const ROUTE_OPTIONS = [
  'Oral',
  'Sublingual',
  'Injection',
  'Topical',
  'Inhalation',
  'IV',
  'Rectal',
] as const;

function normalizeMedication(medication: PrescriptionMedicationDetail): PrescriptionMedicationDetail {
  return {
    ...medication,
    name: medication.name?.trim() ?? '',
    dosage: medication.dosage?.trim() || undefined,
    frequency: medication.frequency?.trim() || undefined,
    duration: medication.duration?.trim() || undefined,
    route: medication.route?.trim() || undefined,
    instructions: medication.instructions?.trim() || undefined,
  };
}

function parseFrequency(frequency?: string): { count: string; unit: string } {
  const value = frequency?.trim() ?? '';
  if (!value) {
    return { count: '', unit: 'Once daily' };
  }

  if (value.toLowerCase() === 'as needed') {
    return { count: '', unit: 'As needed' };
  }

  const countMatch = value.match(/^(\d+)\s*[x×]\s*(.+)$/i);
  if (countMatch) {
    const parsedUnit = countMatch[2].trim();
    const option = FREQUENCY_OPTIONS.find((item) => item.toLowerCase() === parsedUnit.toLowerCase());
    return {
      count: countMatch[1],
      unit: option ?? 'Once daily',
    };
  }

  const directOption = FREQUENCY_OPTIONS.find((item) => item.toLowerCase() === value.toLowerCase());
  if (directOption) {
    return { count: '', unit: directOption };
  }

  return { count: '', unit: 'Once daily' };
}

function composeFrequency(count: string, unit: string): string {
  const normalizedCount = count.trim();
  const normalizedUnit = unit.trim();

  if (!normalizedUnit) return normalizedCount ? `${normalizedCount}×` : '';
  if (normalizedUnit.toLowerCase() === 'as needed') return 'As needed';
  if (!normalizedCount) return normalizedUnit;

  return `${normalizedCount}× ${normalizedUnit.toLowerCase()}`;
}

function parseDuration(duration?: string): { totalTablets: string; durationText: string } {
  const value = duration?.trim() ?? '';
  if (!value) return { totalTablets: '', durationText: '' };

  const combined = value.match(/^(\d+)\s*tablets?\s*\/\s*(.+)$/i);
  if (combined) {
    return { totalTablets: combined[1], durationText: combined[2].trim() };
  }

  const tabletsOnly = value.match(/^(\d+)\s*tablets?$/i);
  if (tabletsOnly) {
    return { totalTablets: tabletsOnly[1], durationText: '' };
  }

  return { totalTablets: '', durationText: value };
}

function composeDuration(totalTablets: string, durationText: string): string {
  const tablets = totalTablets.trim();
  const duration = durationText.trim();

  if (tablets && duration) return `${tablets} tablets / ${duration}`;
  if (tablets) return `${tablets} tablets`;
  return duration;
}

export default function MedicationEditor({
  medications,
  onChange,
  disabled = false,
  compact = false,
}: MedicationEditorProps) {
  const [searchTextByRow, setSearchTextByRow] = useState<string[]>(() => medications.map((medication) => medication.name ?? ''));
  const [isSuggestionsOpenByRow, setIsSuggestionsOpenByRow] = useState<boolean[]>(() => medications.map(() => false));
  const [activeSuggestionIndexByRow, setActiveSuggestionIndexByRow] = useState<number[]>(() => medications.map(() => -1));

  const updateMedication = (index: number, nextPartial: Partial<PrescriptionMedicationDetail>) => {
    const next = medications.map((medication, itemIndex) =>
      itemIndex === index
        ? normalizeMedication({
            ...medication,
            ...nextPartial,
          })
        : medication
    );

    onChange(next);
  };

  const getSuggestions = (query: string): string[] => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];

    return DRUG_LIST.filter((drug) => drug.toLowerCase().includes(normalizedQuery)).slice(0, 12);
  };

  const updateSearchText = (index: number, value: string) => {
    setSearchTextByRow((prev) => {
      const next = [...prev];
      while (next.length < medications.length) next.push('');
      next[index] = value;
      return next;
    });
  };

  const setSuggestionsOpen = (index: number, isOpen: boolean) => {
    setIsSuggestionsOpenByRow((prev) => {
      const next = [...prev];
      while (next.length < medications.length) next.push(false);
      next[index] = isOpen;
      return next;
    });
  };

  const setActiveSuggestionIndex = (index: number, activeIndex: number) => {
    setActiveSuggestionIndexByRow((prev) => {
      const next = [...prev];
      while (next.length < medications.length) next.push(-1);
      next[index] = activeIndex;
      return next;
    });
  };

  const selectSuggestion = (index: number, suggestion: string) => {
    updateMedication(index, { name: suggestion });
    updateSearchText(index, suggestion);
    setSuggestionsOpen(index, false);
    setActiveSuggestionIndex(index, -1);
  };

  const handleNameInputChange = (index: number, value: string) => {
    updateMedication(index, { name: value });
    updateSearchText(index, value);

    const hasQuery = value.trim().length >= 1;
    setSuggestionsOpen(index, hasQuery);
    setActiveSuggestionIndex(index, -1);
  };

  const handleNameInputKeyDown = (
    index: number,
    event: KeyboardEvent<HTMLInputElement>,
    suggestions: string[]
  ) => {
    const hasSuggestions = suggestions.length > 0;
    const isDropdownOpen = isSuggestionsOpenByRow[index] ?? false;
    const activeIndex = activeSuggestionIndexByRow[index] ?? -1;

    if (event.key === 'Escape') {
      setSuggestionsOpen(index, false);
      setActiveSuggestionIndex(index, -1);
      return;
    }

    if (!hasSuggestions) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isDropdownOpen) {
        setSuggestionsOpen(index, true);
      }
      const nextIndex = activeIndex < suggestions.length - 1 ? activeIndex + 1 : 0;
      setActiveSuggestionIndex(index, nextIndex);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isDropdownOpen) {
        setSuggestionsOpen(index, true);
      }
      const nextIndex = activeIndex > 0 ? activeIndex - 1 : suggestions.length - 1;
      setActiveSuggestionIndex(index, nextIndex);
      return;
    }

    if (event.key === 'Enter' && isDropdownOpen && activeIndex >= 0) {
      event.preventDefault();
      selectSuggestion(index, suggestions[activeIndex]);
    }
  };

  const handleFrequencyUpdate = (index: number, nextCount?: string, nextUnit?: string) => {
    const current = medications[index];
    const parsed = parseFrequency(current.frequency);
    const count = nextCount ?? parsed.count;
    const unit = nextUnit ?? parsed.unit;
    updateMedication(index, { frequency: composeFrequency(count, unit) || undefined });
  };

  const handleDurationUpdate = (index: number, nextTotal?: string, nextDurationText?: string) => {
    const current = medications[index];
    const parsed = parseDuration(current.duration);
    const totalTablets = nextTotal ?? parsed.totalTablets;
    const durationText = nextDurationText ?? parsed.durationText;
    updateMedication(index, { duration: composeDuration(totalTablets, durationText) || undefined });
  };

  const handleAdd = () => {
    onChange([
      ...medications,
      {
        name: '',
        dosage: '',
        frequency: 'Once daily',
        duration: '',
        route: 'Oral',
        instructions: '',
      },
    ]);

    setSearchTextByRow((prev) => [...prev, '']);
    setIsSuggestionsOpenByRow((prev) => [...prev, false]);
    setActiveSuggestionIndexByRow((prev) => [...prev, -1]);
  };

  const handleRemove = (index: number) => {
    onChange(medications.filter((_, itemIndex) => itemIndex !== index));

    setSearchTextByRow((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    setIsSuggestionsOpenByRow((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    setActiveSuggestionIndexByRow((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <div className={`${styles.container} ${compact ? styles.compact : ''}`}>
      {medications.length === 0 ? (
        <div className={styles.emptyState}>No medicines added — tap + Add Medicine to begin</div>
      ) : (
        <div className={styles.rows}>
          {medications.map((medication, index) => {
            const frequency = parseFrequency(medication.frequency);
            const duration = parseDuration(medication.duration);
            const searchText = searchTextByRow[index] ?? medication.name ?? '';
            const suggestions = getSuggestions(searchText);
            const isSuggestionsOpen =
              (isSuggestionsOpenByRow[index] ?? false) && searchText.trim().length >= 1 && suggestions.length > 0;
            const activeSuggestionIndex = activeSuggestionIndexByRow[index] ?? -1;

            return (
              <article key={`${index}-${medication.name}`} className={styles.row}>
                <div className={styles.rowHeader}>
                  <div className={styles.nameWrapper}>
                    <input
                      type="text"
                      className={styles.nameInput}
                      placeholder="Drug Name"
                      value={searchText}
                      onChange={(event) => handleNameInputChange(index, event.target.value)}
                      onFocus={() => {
                        if (searchText.trim().length >= 1 && suggestions.length > 0) {
                          setSuggestionsOpen(index, true);
                        }
                      }}
                      onKeyDown={(event) => handleNameInputKeyDown(index, event, suggestions)}
                      disabled={disabled}
                      autoComplete="off"
                    />

                    {isSuggestionsOpen ? (
                      <div className={styles.suggestions} role="listbox" aria-label="Drug suggestions">
                        {suggestions.map((suggestion, suggestionIndex) => {
                          const isActive = suggestionIndex === activeSuggestionIndex;

                          return (
                            <div
                              key={suggestion}
                              role="option"
                              aria-selected={isActive}
                              className={`${styles.suggestionItem} ${isActive ? styles.suggestionItemActive : ''}`}
                              onClick={() => {
                                selectSuggestion(index, suggestion);
                              }}
                              onMouseEnter={() => setActiveSuggestionIndex(index, suggestionIndex)}
                            >
                              {suggestion}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => handleRemove(index)}
                    disabled={disabled}
                    aria-label="Remove medicine"
                  >
                    ×
                  </button>
                </div>

                <div className={styles.fieldGrid}>
                  <label className={styles.field}>
                    <span>Dose</span>
                    <input
                      type="text"
                      placeholder="e.g. 500mg"
                      value={medication.dosage ?? ''}
                      onChange={(event) => updateMedication(index, { dosage: event.target.value })}
                      disabled={disabled}
                    />
                  </label>

                  <div className={`${styles.field} ${styles.frequencyField}`}>
                    <span>Freq</span>
                    <div className={styles.frequencyInputs}>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        placeholder="1"
                        value={frequency.count}
                        onChange={(event) => handleFrequencyUpdate(index, event.target.value)}
                        disabled={disabled || frequency.unit === 'As needed'}
                      />
                      <span className={styles.frequencyMultiplier}>× per</span>
                      <select
                        value={frequency.unit}
                        onChange={(event) => handleFrequencyUpdate(index, undefined, event.target.value)}
                        disabled={disabled}
                      >
                        {FREQUENCY_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <label className={styles.field}>
                    <span>Total tablets</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      placeholder="e.g. 14"
                      value={duration.totalTablets}
                      onChange={(event) => handleDurationUpdate(index, event.target.value)}
                      disabled={disabled}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Duration</span>
                    <input
                      type="text"
                      placeholder="e.g. 7 days, 2 weeks"
                      value={duration.durationText}
                      onChange={(event) => handleDurationUpdate(index, undefined, event.target.value)}
                      disabled={disabled}
                    />
                  </label>

                  <label className={styles.field}>
                    <span>Route</span>
                    <select
                      value={medication.route || 'Oral'}
                      onChange={(event) => updateMedication(index, { route: event.target.value })}
                      disabled={disabled}
                    >
                      {ROUTE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className={`${styles.field} ${styles.instructionsField}`}>
                    <span>Instructions</span>
                    <input
                      type="text"
                      placeholder="e.g. Take after food, avoid alcohol"
                      value={medication.instructions ?? ''}
                      onChange={(event) => updateMedication(index, { instructions: event.target.value })}
                      disabled={disabled}
                    />
                  </label>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className={styles.addButton}
        onClick={handleAdd}
        disabled={disabled}
      >
        + Add Medicine
      </button>
    </div>
  );
}

export type { MedicationEditorProps };
