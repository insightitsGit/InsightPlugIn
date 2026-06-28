import { prepareSmsContent } from './redactor';

function firstSentences(text: string, count: number): string {
  const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, count).join(' ');
}

export function summarizeForSms(text: string, maxLength: number): string {
  const cleaned = prepareSmsContent(text, maxLength);

  if (!cleaned) {
    return 'Agent update.';
  }

  let summary = firstSentences(cleaned, 2) || cleaned;
  if (summary.length > maxLength) {
    summary = `${summary.slice(0, maxLength - 3).trim()}...`;
  }
  return summary;
}

export function formatAgentSmsSummary(sessionLabel: string, text: string, maxLength: number): string {
  const summary = summarizeForSms(text, maxLength - sessionLabel.length - 16);
  return `[InsightPlugIn] ${sessionLabel}: ${summary}`;
}

export function formatMasterActivationSms(source: 'toggle' | 'sms'): string {
  if (source === 'sms') {
    return '[InsightPlugIn] Master Agent activated via SMS. Reply with MASTER: <command>';
  }
  return '[InsightPlugIn] Master Agent activated. Monitoring all open sessions.';
}
