import * as vscode from 'vscode';
import { SmsProvider } from '../types';
import { CredentialStore } from '../security/credentialStore';
import { isValidE164, isValidTwilioAccountSid, normalizePhoneNumber } from '../security/validation';
import { getSharedSmsSettings } from './smsConfig';

export const SMS_PROVIDERS: SmsProvider[] = ['twilio', 'sinch', 'sms8'];

export interface ProviderCatalogEntry {
  id: SmsProvider;
  label: string;
  tokenLabel: string;
  tokenHint: string;
  docsUrl: string;
  tagline: string;
}

export const PROVIDER_CATALOG: Record<SmsProvider, ProviderCatalogEntry> = {
  twilio: {
    id: 'twilio',
    label: 'Twilio',
    tokenLabel: 'Twilio Auth Token',
    tokenHint: 'From Twilio Console → Account → Auth Token. Leave blank to keep the saved token.',
    docsUrl: 'https://www.twilio.com/docs/sms',
    tagline: 'Cloud SMS API with dedicated phone numbers.',
  },
  sinch: {
    id: 'sinch',
    label: 'Sinch',
    tokenLabel: 'Sinch API Token',
    tokenHint: 'REST API token from Sinch Dashboard → APIs. Leave blank to keep the saved token.',
    docsUrl: 'https://developers.sinch.com/docs/sms/',
    tagline: 'Enterprise SMS REST API with regional endpoints.',
  },
  sms8: {
    id: 'sms8',
    label: 'SMS8',
    tokenLabel: 'SMS8 API Key',
    tokenHint: 'From app.sms8.io/api.php. Leave blank to keep the saved key.',
    docsUrl: 'https://mcp.sms8.io/sms-api-documentation',
    tagline: 'Android phone gateway — your SIM, no A2P 10DLC.',
  },
};

export interface ProviderReadiness {
  ready: boolean;
  missing: string[];
}

export function getProviderLabel(provider: SmsProvider): string {
  return PROVIDER_CATALOG[provider]?.label ?? 'Twilio';
}

export function isSmsProvider(value: string): value is SmsProvider {
  return SMS_PROVIDERS.includes(value as SmsProvider);
}

export function assessProviderReadiness(
  provider: SmsProvider,
  credentials: CredentialStore
): ProviderReadiness {
  const config = vscode.workspace.getConfiguration('insightPlugin');
  const shared = getSharedSmsSettings();
  const missing: string[] = [];

  if (!shared) {
    missing.push('Your phone (E.164)');
  }

  switch (provider) {
    case 'twilio': {
      const accountSid = config.get<string>('twilioAccountSid', '').trim();
      const twilioPhone = normalizePhoneNumber(config.get<string>('twilioPhoneNumber', ''));
      if (!isValidTwilioAccountSid(accountSid)) {
        missing.push('Twilio Account SID');
      }
      if (!credentials.isApiTokenConfigured('twilio')) {
        missing.push('Twilio Auth Token');
      }
      if (!isValidE164(twilioPhone)) {
        missing.push('Twilio phone number');
      }
      break;
    }
    case 'sinch': {
      const servicePlanId = config.get<string>('sinchServicePlanId', '').trim();
      const sinchPhone = normalizePhoneNumber(config.get<string>('sinchPhoneNumber', ''));
      if (!servicePlanId) {
        missing.push('Sinch Service Plan ID');
      }
      if (!credentials.isApiTokenConfigured('sinch')) {
        missing.push('Sinch API Token');
      }
      if (!isValidE164(sinchPhone)) {
        missing.push('Sinch sender phone');
      }
      break;
    }
    case 'sms8': {
      if (!credentials.isApiTokenConfigured('sms8')) {
        missing.push('SMS8 API Key');
      }
      break;
    }
  }

  return { ready: missing.length === 0, missing };
}

export function assessAllProviders(credentials: CredentialStore): Record<SmsProvider, ProviderReadiness> {
  return {
    twilio: assessProviderReadiness('twilio', credentials),
    sinch: assessProviderReadiness('sinch', credentials),
    sms8: assessProviderReadiness('sms8', credentials),
  };
}
