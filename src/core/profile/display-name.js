// Display-name rules (SRS 6.1). The same rule applies to every name received from a peer.
import { DISPLAY_NAME_MAX_CHARS, DISPLAY_NAME_MAX_BYTES } from '../../config/constants.js';

const FORBIDDEN =
  /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\u200B-\u200D\u2060\uFEFF]/u;

/**
 * @param {unknown} input
 * @returns {string} the trimmed, NFC-normalised name
 * @throws {Error} when the name breaks a rule
 */
export function validateDisplayName(input) {
  if (typeof input !== 'string') throw new Error('displayName');
  const name = input.normalize('NFC').trim();
  const codePoints = [...name].length;
  if (codePoints < 1 || codePoints > DISPLAY_NAME_MAX_CHARS) throw new Error('displayName');
  if (Buffer.byteLength(name, 'utf8') > DISPLAY_NAME_MAX_BYTES) throw new Error('displayName');
  if (FORBIDDEN.test(name)) throw new Error('displayName');
  if (!/\S/u.test(name)) throw new Error('displayName');
  return name;
}

/** Non-throwing variant: returns the valid name, or null. */
export function validateDisplayNameSafe(input) {
  try {
    return validateDisplayName(input);
  } catch {
    return null;
  }
}
