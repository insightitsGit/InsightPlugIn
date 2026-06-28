import * as vscode from 'vscode';
import { parseAuthorizedPhoneNumbers, normalizePhoneNumber, isValidE164 } from './validation';

export interface SecurityPolicy {
  enforceSenderValidation: boolean;
  requireMasterPassphrase: boolean;
  auditLoggingEnabled: boolean;
  maxInboundSmsLength: number;
  maxInjectionQueueSize: number;
  maxOutboundSmsPerHour: number;
  minPollIntervalMs: number;
  storeQueueInWorkspace: boolean;
  authorizedPhoneNumbers: string[];
}

export function getSecurityPolicy(): SecurityPolicy {
  const config = vscode.workspace.getConfiguration('insightPlugin');
  const ownerPhone = normalizePhoneNumber(config.get<string>('userPhoneNumber', ''));
  const additional = parseAuthorizedPhoneNumbers(config.get<string[]>('authorizedPhoneNumbers', []));
  const authorized = new Set<string>();
  if (isValidE164(ownerPhone)) {
    authorized.add(ownerPhone);
  }
  for (const phone of additional) {
    authorized.add(phone);
  }

  return {
    enforceSenderValidation: config.get<boolean>('enforceSenderValidation', true),
    requireMasterPassphrase: config.get<boolean>('requireMasterPassphrase', false),
    auditLoggingEnabled: config.get<boolean>('auditLoggingEnabled', true),
    maxInboundSmsLength: config.get<number>('maxInboundSmsLength', 2000),
    maxInjectionQueueSize: config.get<number>('maxInjectionQueueSize', 100),
    maxOutboundSmsPerHour: config.get<number>('maxOutboundSmsPerHour', 120),
    minPollIntervalMs: config.get<number>('minPollIntervalMs', 5000),
    storeQueueInWorkspace: config.get<boolean>('storeQueueInWorkspace', false),
    authorizedPhoneNumbers: [...authorized],
  };
}

export function isAuthorizedSender(from: string, policy: SecurityPolicy): boolean {
  if (!policy.enforceSenderValidation) {
    return true;
  }
  const normalized = normalizePhoneNumber(from);
  return policy.authorizedPhoneNumbers.includes(normalized);
}
