import * as vscode from 'vscode';
import { SmsConfig, SmsMessage } from '../types';
import { CredentialStore } from '../security/credentialStore';
import { isValidE164, normalizePhoneNumber } from '../security/validation';
import { getSharedSmsSettings } from './smsConfig';

const SMS8_BASE_URL = 'https://app.sms8.io/services';

interface Sms8MessageRecord {
  ID?: string;
  number?: string;
  message?: string;
  status?: string;
  sentDate?: string;
  receivedDate?: string;
}

interface Sms8Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string; code?: number };
}

export class Sms8SmsProvider {
  constructor(private readonly credentials: CredentialStore) {}

  getConfig(): SmsConfig | undefined {
    const config = vscode.workspace.getConfiguration('insightPlugin');
    const apiKey = this.credentials.getApiTokenSync('sms8') ?? '';
    const shared = getSharedSmsSettings();
    const deviceId = config.get<string>('sms8DeviceId', '').trim();
    const simSlot = config.get<number>('sms8SimSlot', 0);

    if (!apiKey || !shared) {
      return undefined;
    }

    return {
      provider: 'sms8',
      providerPhoneNumber: deviceId ? `device:${deviceId}` : 'android-gateway',
      userPhoneNumber: shared.userPhoneNumber,
      pollIntervalMs: shared.pollIntervalMs,
      summaryMaxLength: shared.summaryMaxLength,
      sms8DeviceId: deviceId || undefined,
      sms8SimSlot: simSlot,
    };
  }

  async sendSms(smsConfig: SmsConfig, body: string): Promise<void> {
    const apiKey = this.credentials.getApiTokenSync('sms8');
    if (!apiKey) {
      throw new Error('SMS8 is not configured.');
    }

    const params = new URLSearchParams({
      key: apiKey,
      number: smsConfig.userPhoneNumber,
      message: body,
      prioritize: '1',
    });

    if (smsConfig.sms8DeviceId) {
      params.set('devices', smsConfig.sms8SimSlot !== undefined
        ? `${smsConfig.sms8DeviceId}|${smsConfig.sms8SimSlot}`
        : smsConfig.sms8DeviceId);
    }

    const response = await this.post<Sms8Envelope<{ messages?: Sms8MessageRecord[] }>>(
      `${SMS8_BASE_URL}/send.php`,
      params
    );

    if (!response.success) {
      throw new Error(response.error?.message ?? 'SMS8 send failed.');
    }
  }

  async fetchInboundMessages(smsConfig: SmsConfig, since?: Date): Promise<SmsMessage[]> {
    const apiKey = this.credentials.getApiTokenSync('sms8');
    if (!apiKey) {
      return [];
    }

    const params = new URLSearchParams({
      key: apiKey,
      status: 'Received',
    });

    if (since) {
      params.set('startTimestamp', String(Math.floor(since.getTime() / 1000)));
    } else {
      params.set('startTimestamp', String(Math.floor(Date.now() / 1000) - 86400));
    }

    if (smsConfig.sms8DeviceId) {
      params.set('deviceID', smsConfig.sms8DeviceId);
    }
    if (smsConfig.sms8SimSlot !== undefined) {
      params.set('simSlot', String(smsConfig.sms8SimSlot));
    }

    const response = await this.post<Sms8Envelope<{ messages?: Sms8MessageRecord[] }>>(
      `${SMS8_BASE_URL}/read-messages.php`,
      params
    );

    if (!response.success) {
      throw new Error(response.error?.message ?? 'SMS8 inbound fetch failed.');
    }

    const messages = response.data?.messages ?? [];

    return messages
      .map((record) => ({
        sid: record.ID ?? `sms8-${Date.now()}`,
        body: record.message ?? '',
        from: normalizePhoneNumber(record.number ?? ''),
        to: smsConfig.userPhoneNumber,
        dateSent: new Date(record.receivedDate ?? record.sentDate ?? Date.now()),
      }))
      .filter((message) => message.body.trim() && isValidE164(message.from))
      .sort((left, right) => left.dateSent.getTime() - right.dateSent.getTime());
  }

  private async post<T>(url: string, params: URLSearchParams): Promise<T> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const payload = (await response.json()) as T;
    if (!response.ok) {
      const error = payload as Sms8Envelope<unknown>;
      throw new Error(error.error?.message ?? `SMS8 request failed (${response.status}).`);
    }
    return payload;
  }
}
