/**
 * UNIVERSAL VALIDATION & CHARACTER RESTRICTIONS (PHASE 28.4.8)
 * Canonical validation rules across CRM and ERP platforms.
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedValue?: any;
}

/**
 * 1. Mobile Number Validation
 * - For India (+91 or default): Exactly 10 digits [6-9]\d{9}.
 * - No alphabetic, punctuation, or special characters.
 * - Country code should be handled separately.
 * - For other countries: ITU E.164 compliance (7 to 15 digits).
 */
export function validatePhoneNumber(phone: string, countryCode: string = '+91'): ValidationResult {
  if (!phone || typeof phone !== 'string') {
    return { isValid: false, error: 'Phone number is required.' };
  }

  // Strip whitespaces, dashes, parentheses
  let cleaned = phone.trim().replace(/[\s\-\(\)]/g, '');

  // Normalize country code
  const code = (countryCode || '+91').trim();
  const isIndia = code === '+91' || code === '91' || code === 'IN' || code === 'TN (+91)';

  // If phone begins with country code like +91 or 91, strip it for Indian numbers
  if (isIndia) {
    if (cleaned.startsWith('+91')) {
      cleaned = cleaned.substring(3);
    } else if (cleaned.startsWith('91') && cleaned.length === 12) {
      cleaned = cleaned.substring(2);
    } else if (cleaned.startsWith('0') && cleaned.length === 11) {
      cleaned = cleaned.substring(1);
    }

    // Must contain ONLY digits
    if (!/^\d+$/.test(cleaned)) {
      return {
        isValid: false,
        error: 'Phone number must contain only numeric digits (no letters or symbols).',
      };
    }

    if (cleaned.length !== 10) {
      return {
        isValid: false,
        error: `Indian mobile number must be exactly 10 digits (currently ${cleaned.length} digits).`,
      };
    }

    if (!/^[6-9]/.test(cleaned)) {
      return {
        isValid: false,
        error: 'Indian mobile number must start with 6, 7, 8, or 9.',
      };
    }

    return { isValid: true, sanitizedValue: cleaned };
  } else {
    // International standard (E.164 without plus or with plus)
    cleaned = cleaned.replace(/^\+/, '');
    if (!/^\d+$/.test(cleaned)) {
      return {
        isValid: false,
        error: 'International phone number must contain only numeric digits.',
      };
    }

    if (cleaned.length < 7 || cleaned.length > 15) {
      return {
        isValid: false,
        error: `Phone number must be between 7 and 15 digits (currently ${cleaned.length} digits).`,
      };
    }

    return { isValid: true, sanitizedValue: cleaned };
  }
}

/**
 * 2. Email Address Validation (RFC 5322 compatible regex)
 */
export function validateEmail(email: string): ValidationResult {
  if (!email || typeof email !== 'string') {
    return { isValid: false, error: 'Email address is required.' };
  }

  const clean = email.trim().toLowerCase();
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  if (!emailRegex.test(clean) || clean.length > 254) {
    return { isValid: false, error: 'Please enter a valid email address.' };
  }

  return { isValid: true, sanitizedValue: clean };
}

/**
 * 3. Person / Customer Name Validation
 * - Letters, spaces, hyphens, dots, apostrophes.
 * - Min 2 chars, max 100 chars.
 * - Reject purely numeric or symbol-only names.
 */
export function validatePersonName(name: string, fieldLabel = 'Full Name'): ValidationResult {
  if (!name || typeof name !== 'string') {
    return { isValid: false, error: `${fieldLabel} is required.` };
  }

  const clean = name.trim();
  if (clean.length < 2) {
    return { isValid: false, error: `${fieldLabel} must be at least 2 characters long.` };
  }

  if (clean.length > 100) {
    return { isValid: false, error: `${fieldLabel} cannot exceed 100 characters.` };
  }

  const nameRegex = /^[a-zA-Z\s\.\'\-]+$/;
  if (!nameRegex.test(clean)) {
    return { isValid: false, error: `${fieldLabel} can only contain letters, spaces, hyphens, and apostrophes.` };
  }

  return { isValid: true, sanitizedValue: clean };
}

/**
 * 4. PIN / Postal Code Validation
 * - For India: exactly 6 digits, not starting with 0.
 * - Generic: alphanumeric 3-10 chars.
 */
export function validatePostalCode(code: string, isIndia = true): ValidationResult {
  if (!code || typeof code !== 'string') {
    return { isValid: false, error: 'Postal code is required.' };
  }

  const clean = code.trim();
  if (isIndia) {
    if (!/^[1-9][0-9]{5}$/.test(clean)) {
      return { isValid: false, error: 'Indian PIN code must be exactly 6 digits and cannot begin with 0.' };
    }
  } else {
    if (!/^[A-Za-z0-9\s\-]{3,10}$/.test(clean)) {
      return { isValid: false, error: 'Postal code must be 3-10 alphanumeric characters.' };
    }
  }

  return { isValid: true, sanitizedValue: clean };
}

/**
 * 5. Age Validation
 * - Non-negative integer between 0 and 125.
 */
export function validateAge(age: number | string): ValidationResult {
  const num = typeof age === 'string' ? parseInt(age, 10) : age;
  if (isNaN(num) || num < 0 || num > 125 || !Number.isInteger(num)) {
    return { isValid: false, error: 'Age must be an integer between 0 and 125.' };
  }
  return { isValid: true, sanitizedValue: num };
}

/**
 * 6. Weight Validation
 * - Positive decimal between 1 and 300.
 */
export function validateWeight(weight: number | string): ValidationResult {
  const num = typeof weight === 'string' ? parseFloat(weight) : weight;
  if (isNaN(num) || num < 1 || num > 300) {
    return { isValid: false, error: 'Weight must be a positive number between 1 and 300.' };
  }
  return { isValid: true, sanitizedValue: Math.round(num * 10) / 10 };
}

/**
 * 7. Employee ID Validation
 * - Alphanumeric, hyphen, underscore, 2-30 chars.
 */
export function validateEmployeeId(empId: string): ValidationResult {
  if (!empId || typeof empId !== 'string') {
    return { isValid: false, error: 'Employee ID is required.' };
  }
  const clean = empId.trim().toUpperCase();
  if (!/^[A-Z0-9\-_]{2,30}$/.test(clean)) {
    return { isValid: false, error: 'Employee ID must be 2-30 alphanumeric characters, hyphens or underscores.' };
  }
  return { isValid: true, sanitizedValue: clean };
}

/**
 * 8. Notes / Description text validation
 * - Max length restriction (default 2000 chars).
 */
export function validateNotes(text: string, maxLength = 2000): ValidationResult {
  if (!text) return { isValid: true, sanitizedValue: '' };
  const clean = String(text).trim();
  if (clean.length > maxLength) {
    return { isValid: false, error: `Notes cannot exceed ${maxLength} characters (currently ${clean.length}).` };
  }
  return { isValid: true, sanitizedValue: clean };
}
