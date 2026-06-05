/**
 * Validation utilities for phone numbers and message content
 */

export interface ValidationResult {
  valid: boolean;
  error: string;
}

/**
 * Validate phone number in E.164 format
 * 
 * E.164 format: +[country code][subscriber number]
 * - Starts with +
 * - Followed by 1-15 digits
 * - No spaces or special characters
 */
export function validatePhoneNumber(number: string): boolean {
  if (!number) {
    return false;
  }

  // E.164 pattern: + followed by 1-15 digits
  const pattern = /^\+[1-9]\d{1,14}$/;
  return pattern.test(number);
}

/**
 * GSM-7 basic character set as a Set for O(1) lookups.
 * Building this once at module load avoids repeated O(n) string scans
 * inside validateMessageContent.
 */
const GSM7_BASIC_SET: Set<string> = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
);

/** GSM-7 extended characters — each counts as 2 characters in the length budget. */
const GSM7_EXTENDED_SET: Set<string> = new Set("^{}\\[~]|€");

/**
 * Validate message content based on encoding
 */
export function validateMessageContent(
  content: string,
  encoding: 'GSM7' | 'UCS2' = 'GSM7'
): ValidationResult {
  if (!content) {
    return { valid: false, error: 'Message content cannot be empty' };
  }

  if (encoding === 'GSM7') {
    // O(n) scan — one pass, O(1) per character thanks to Set.has()
    let length = 0;
    for (const char of content) {
      if (GSM7_EXTENDED_SET.has(char)) {
        length += 2; // extended chars consume two septets
      } else if (GSM7_BASIC_SET.has(char)) {
        length += 1;
      } else {
        return {
          valid: false,
          error: `Invalid character for GSM-7 encoding: ${char}`,
        };
      }

      if (length > 160) {
        return {
          valid: false,
          error: `Message too long for GSM-7: exceeds 160 septets`,
        };
      }
    }
  } else if (encoding === 'UCS2') {
    // UCS-2 allows any Unicode character but limited to 70 characters
    if (content.length > 70) {
      return {
        valid: false,
        error: `Message too long for UCS-2: ${content.length} characters (max 70)`,
      };
    }
  } else {
    return { valid: false, error: `Unknown encoding: ${encoding}` };
  }

  return { valid: true, error: '' };
}

/**
 * Calculate exponential backoff delay
 * 
 * Formula: min(baseDelay * 2^attemptNumber, maxDelay)
 */
export function calculateBackoff(
  attemptNumber: number,
  baseDelay: number = 1,
  maxDelay: number = 300
): number {
  if (attemptNumber < 0) {
    attemptNumber = 0;
  }

  const delay = baseDelay * Math.pow(2, attemptNumber);
  return Math.min(delay, maxDelay);
}
