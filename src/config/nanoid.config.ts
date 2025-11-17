import { customAlphabet } from 'nanoid';

const CUSTOM_ALPHABET = '0123456789abcdef';

export const generateRequestId = customAlphabet(CUSTOM_ALPHABET, 8);
export const generatePrimaryId = customAlphabet(
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  16,
);
