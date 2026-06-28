import * as path from 'path';

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;
const SESSION_ID_PATTERN = /^session-\d+$/;
const TWILIO_SID_PATTERN = /^AC[a-f0-9]{32}$/i;

export function normalizePhoneNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    return `+${digits.slice(1).replace(/\D/g, '')}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return digits.startsWith('+') ? digits : `+${digits}`;
}

export function isValidE164(value: string): boolean {
  return E164_PATTERN.test(normalizePhoneNumber(value));
}

export function isValidSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value) || /^[a-f0-9-]{8,64}$/i.test(value);
}

export function isValidTwilioAccountSid(value: string): boolean {
  return TWILIO_SID_PATTERN.test(value.trim());
}

export function clampString(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return trimmed.slice(0, maxLength);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function maskPhoneNumber(value: string): string {
  const normalized = normalizePhoneNumber(value);
  if (normalized.length < 6) {
    return '***';
  }
  return `${normalized.slice(0, 3)}***${normalized.slice(-2)}`;
}

export function maskSecret(value: string, visiblePrefix = 4, visibleSuffix = 0): string {
  if (!value) {
    return '';
  }
  if (value.length <= visiblePrefix + visibleSuffix) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, visiblePrefix)}${'*'.repeat(8)}${visibleSuffix ? value.slice(-visibleSuffix) : ''}`;
}

export function isPathWithinRoot(candidatePath: string, rootPath: string): boolean {
  const resolvedCandidate = path.resolve(candidatePath);
  const resolvedRoot = path.resolve(rootPath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function parseAuthorizedPhoneNumbers(raw: string[]): string[] {
  const values = new Set<string>();
  for (const entry of raw) {
    const normalized = normalizePhoneNumber(entry);
    if (isValidE164(normalized)) {
      values.add(normalized);
    }
  }
  return [...values];
}
