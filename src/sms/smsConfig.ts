import * as vscode from 'vscode';
import { isValidE164, normalizePhoneNumber } from '../security/validation';

export type SinchRegion = 'us' | 'eu' | 'au' | 'br' | 'ca';

export function getSharedSmsSettings():
  | { userPhoneNumber: string; pollIntervalMs: number; summaryMaxLength: number }
  | undefined {
  const config = vscode.workspace.getConfiguration('insightPlugin');
  const userPhoneNumber = normalizePhoneNumber(config.get<string>('userPhoneNumber', ''));
  const pollIntervalMs = Math.max(
    config.get<number>('pollIntervalMs', 8000),
    config.get<number>('minPollIntervalMs', 5000)
  );
  const summaryMaxLength = config.get<number>('summaryMaxLength', 300);

  if (!isValidE164(userPhoneNumber)) {
    return undefined;
  }

  return { userPhoneNumber, pollIntervalMs, summaryMaxLength };
}
