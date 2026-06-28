import * as vscode from 'vscode';

const SENSITIVE_PATTERNS: RegExp[] = [
  /\bAC[a-f0-9]{32}\b/gi,
  /\bSK[a-f0-9]{32}\b/gi,
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}\b/g,
  /\b(AKIA|ASIA)[A-Z0-9]{12,}\b/g,
  /\b(?:api[_-]?key|secret|token|password|auth[_-]?token|private[_-]?key)\s*[:=]\s*['"]?[^\s'"]{8,}/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b(?:\d[ -]*?){13,19}\b/g,
  /-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g,
  /\bmongodb(\+srv)?:\/\/[^\s]+/gi,
  /\bpostgres(?:ql)?:\/\/[^\s]+/gi,
  /\bmysql:\/\/[^\s]+/gi,
  /\brediss?:\/\/[^\s]+/gi,
  /\b(?:twilio|account)[_-]?sid\s*[:=]\s*['"]?[A-Za-z0-9]{10,}/gi,
];

const CODE_FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]+`/g;
const TOOL_OUTPUT = /\[(?:REDACTED|tool_use|thinking|tool_result)\][\s\S]*?(?=\n\n|$)/gi;

export function isSmsRedactionEnabled(): boolean {
  return vscode.workspace.getConfiguration('insightPlugin').get<boolean>('redactSmsContent', false);
}

export function redactSensitiveContent(text: string): string {
  let result = text;

  result = result.replace(CODE_FENCE, '[code block redacted]');
  result = result.replace(INLINE_CODE, '[code redacted]');
  result = result.replace(TOOL_OUTPUT, '[tool output redacted]');

  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, '[redacted]');
  }

  result = result.replace(
    /([A-Za-z]:\\[^\s]+|\/(?:Users|home|var|etc|tmp|opt|private)\/[^\s]+)/gi,
    '[path redacted]'
  );

  result = result.replace(/\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[phone redacted]');

  return result.replace(/\s{2,}/g, ' ').trim();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function prepareSmsContent(text: string, maxLength: number): string {
  const prepared = isSmsRedactionEnabled() ? redactSensitiveContent(text) : normalizeWhitespace(text);
  if (!prepared) {
    return isSmsRedactionEnabled() ? 'Agent update (content redacted).' : 'Agent update.';
  }
  if (prepared.length <= maxLength) {
    return prepared;
  }
  return `${prepared.slice(0, maxLength - 3).trim()}...`;
}

/** @deprecated Use prepareSmsContent instead */
export function redactForSms(text: string, maxLength: number): string {
  return prepareSmsContent(text, maxLength);
}
