/**
 * Medical Classification Keywords Configuration
 * 
 * These keywords are used to classify clinical information into categories
 * for UI display purposes. They do NOT generate content - only categorize
 * existing content from AI-generated summaries.
 * 
 * Update this file to add new medications, symptoms, or other medical terms
 * specific to your practice.
 */

export const MEDICAL_KEYWORDS = {
  /**
   * Lifestyle and wellness recommendations
   */
  lifestyle: [
    'rest',
    'sleep',
    'water',
    'drink',
    'hydrat', // matches "hydrate", "hydration"
    'diet',
    'exercise',
    'stress',
    'avoid',
    'limit'
  ],

  /**
   * Medications and prescriptions
   */
  medication: [
    // Common pain relievers
    'ibuprofen',
    'tylenol',
    'aspirin',
    'paracetamol',
    'acetaminophen',
    
    // Antibiotics
    'antibiotic',
    'amoxicillin',
    'penicillin',
    'azithromycin',
    
    // Other common medications
    'medication',
    'medicine',
    'prescribed',
    'prescription',
    
    // Dosage indicators
    'mg',
    'ml',
    'dose',
    'tablet',
    'capsule',
    'syrup',
    'pill',
    'drops',
    
    // Frequency
    'daily',
    'twice',
    'three times',
    'as needed'
  ],

  /**
   * Warning signs and red flags
   */
  warning: [
    'come back',
    'return if',
    'watch for',
    'seek',
    'emergency',
    'if fever',
    'if pain',
    'if worsens',
    'warning',
    'urgent',
    'immediate',
    'call if',
    'go to ER'
  ],

  /**
   * Time and duration phrases
   */
  duration: [
    'day',
    'days',
    'week',
    'weeks',
    'hour',
    'hours',
    'month',
    'months',
    'since',
    'ago',
    'morning',
    'evening',
    'yesterday',
    'tonight',
    'tomorrow',
    'recently',
    'ongoing'
  ]
} as const;

/**
 * Classify text into a medical category based on keyword matching
 * @param text - The text to classify
 * @param defaultCategory - Fallback category if no keywords match
 * @returns The matched category or the default
 */
export function classifyMedicalText(
  text: string,
  defaultCategory: string = 'symptom'
): string {
  const normalized = text.toLowerCase();

  // Check each category in priority order
  if (MEDICAL_KEYWORDS.warning.some(keyword => normalized.includes(keyword))) {
    return 'warning';
  }

  if (MEDICAL_KEYWORDS.medication.some(keyword => normalized.includes(keyword))) {
    return 'medication';
  }

  if (MEDICAL_KEYWORDS.lifestyle.some(keyword => normalized.includes(keyword))) {
    return 'lifestyle';
  }

  if (MEDICAL_KEYWORDS.duration.some(keyword => normalized.includes(keyword))) {
    return 'duration';
  }

  return defaultCategory;
}
