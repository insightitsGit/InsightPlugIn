import * as vscode from 'vscode';
import twilio from 'twilio';
import { SmsConfig, SmsMessage } from '../types';
import { CredentialStore } from '../security/credentialStore';
import { isValidE164, isValidTwilioAccountSid, normalizePhoneNumber } from '../security/validation';
import { getSharedSmsSettings } from './smsConfig';

export class TwilioSmsProvider {
  constructor(private readonly credentials: CredentialStore) {}

  getConfig(): SmsConfig | undefined {
    const config = vscode.workspace.getConfiguration('insightPlugin');
    const accountSid = config.get<string>('twilioAccountSid', '').trim();
    const authToken = this.credentials.getApiTokenSync('twilio') ?? '';
    const providerPhoneNumber = normalizePhoneNumber(config.get<string>('twilioPhoneNumber', ''));
    const shared = getSharedSmsSettings();

    if (
      !isValidTwilioAccountSid(accountSid) ||
      !authToken ||
      !isValidE164(providerPhoneNumber) ||
      !shared
    ) {
      return undefined;
    }

    return {
      provider: 'twilio',
      providerPhoneNumber,
      userPhoneNumber: shared.userPhoneNumber,
      pollIntervalMs: shared.pollIntervalMs,
      summaryMaxLength: shared.summaryMaxLength,
      twilioAccountSid: accountSid,
    };
  }

  async sendSms(smsConfig: SmsConfig, body: string): Promise<void> {
    const authToken = this.credentials.getApiTokenSync('twilio');
    if (!authToken || !smsConfig.twilioAccountSid) {
      throw new Error('Twilio is not configured.');
    }

    const client = twilio(smsConfig.twilioAccountSid, authToken);
    await client.messages.create({
      body,
      from: smsConfig.providerPhoneNumber,
      to: smsConfig.userPhoneNumber,
    });
  }

  async fetchInboundMessages(smsConfig: SmsConfig, since?: Date): Promise<SmsMessage[]> {
    const authToken = this.credentials.getApiTokenSync('twilio');
    if (!authToken || !smsConfig.twilioAccountSid) {
      return [];
    }

    const client = twilio(smsConfig.twilioAccountSid, authToken);
    const messages = await client.messages.list({
      to: smsConfig.providerPhoneNumber,
      dateSentAfter: since,
      limit: 20,
    });

    return messages
      .filter((message) => message.direction === 'inbound')
      .map((message) => ({
        sid: message.sid,
        body: message.body ?? '',
        from: normalizePhoneNumber(message.from ?? ''),
        to: normalizePhoneNumber(message.to ?? ''),
        dateSent: message.dateSent ?? new Date(),
      }))
      .sort((left, right) => left.dateSent.getTime() - right.dateSent.getTime());
  }
}

/** @deprecated Use SmsService instead */
export class TwilioService extends TwilioSmsProvider {}
