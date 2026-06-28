import { timingSafeEqual } from 'crypto';

export type SessionStatus = 'idle' | 'running' | 'paused' | 'waiting';

export interface AgentSession {
  id: string;
  label: string;
  transcriptPath?: string;
  status: SessionStatus;
  isSmsActive: boolean;
  lastMessageAt?: string;
  lastSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export type SmsProvider = 'twilio' | 'sinch' | 'sms8';

export interface SmsConfig {
  provider: SmsProvider;
  providerPhoneNumber: string;
  userPhoneNumber: string;
  pollIntervalMs: number;
  summaryMaxLength: number;
  twilioAccountSid?: string;
  sinchServicePlanId?: string;
  sinchRegion?: 'us' | 'eu' | 'au' | 'br' | 'ca';
  sms8DeviceId?: string;
  sms8SimSlot?: number;
}

/** @deprecated Use SmsConfig */
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  twilioPhoneNumber: string;
  userPhoneNumber: string;
  pollIntervalMs: number;
  summaryMaxLength: number;
}

export interface SmsMessage {
  sid: string;
  body: string;
  from: string;
  to: string;
  dateSent: Date;
}

export interface PendingInjection {
  id: string;
  sessionId: string;
  text: string;
  source: 'sms' | 'master';
  createdAt: string;
}

export type MasterAgentActivationSource = 'toggle' | 'sms' | 'manual';

export interface MasterAgentState {
  active: boolean;
  activatedAt?: string;
  activationSource?: MasterAgentActivationSource;
}

export interface PluginState {
  smsModeEnabled: boolean;
  masterAgent: MasterAgentState;
  sessions: AgentSession[];
  activeSessionId?: string;
  lastProcessedSmsSid?: string;
}

export const MASTER_SMS_KEYWORDS = ['MASTER', 'MASTER:', 'MASTER ON'] as const;

export function isMasterSmsCommand(body: string): boolean {
  const normalized = body.trim().toUpperCase();
  return MASTER_SMS_KEYWORDS.some(
    (keyword) => normalized === keyword || normalized.startsWith(`${keyword} `)
  );
}

export function extractMasterCommand(body: string): string {
  const trimmed = body.trim();
  for (const keyword of MASTER_SMS_KEYWORDS) {
    if (trimmed.toUpperCase().startsWith(keyword)) {
      return trimmed.slice(keyword.length).trim();
    }
  }
  return trimmed;
}

export function parseAuthenticatedMasterCommand(
  body: string,
  requiredPassphrase?: string
): { authorized: boolean; command: string } {
  const command = extractMasterCommand(body);
  if (!requiredPassphrase) {
    return { authorized: true, command };
  }
  if (!command) {
    return { authorized: false, command: '' };
  }

  const spaceIndex = command.indexOf(' ');
  if (spaceIndex === -1) {
    return {
      authorized: secureCompare(command, requiredPassphrase),
      command: '',
    };
  }

  const provided = command.slice(0, spaceIndex);
  const rest = command.slice(spaceIndex + 1).trim();
  return {
    authorized: secureCompare(provided, requiredPassphrase),
    command: rest,
  };
}

function secureCompare(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(providedBuffer, expectedBuffer);
}
