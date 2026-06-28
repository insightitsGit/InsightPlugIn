const SECRET_PATTERNS: RegExp[] = [
  /\bAC[a-f0-9]{32}\b/gi,
  /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{10,}\b/g,
  /\b(?:api[_-]?key|secret|token|password|auth[_-]?token)\s*[:=]\s*['"]?[^\s'"]{4,}/gi,
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /\beyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g,
  /\+1\d{10}/g,
];

export function sanitizeErrorMessage(message: string): string {
  let result = message;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[redacted]');
  }
  return result.trim();
}
