import * as vscode from 'vscode';
import { SmsConfig, SmsMessage } from '../types';
import { CredentialStore } from '../security/credentialStore';
import { isValidE164, normalizePhoneNumber } from '../security/validation';
import { getSharedSmsSettings, SinchRegion } from './smsConfig';

interface SinchInboundItem {
  id?: string;
  body?: string;
  from?: string;
  to?: string;
  received_at?: string;
}

interface SinchInboundResponse {
  inbounds?: SinchInboundItem[];
}

const REGION_BASE_URL: Record<SinchRegion, string> = {
  us: 'https://us.sms.api.sinch.com',
  eu: 'https://eu.sms.api.sinch.com',
  au: 'https://au.sms.api.sinch.com',
  br: 'https://br.sms.api.sinch.com',
  ca: 'https://ca.sms.api.sinch.com',
};

export class SinchSmsProvider {
  constructor(private readonly credentials: CredentialStore) {}

  getConfig(): SmsConfig | undefined {
    const config = vscode.workspace.getConfiguration('insightPlugin');
    const apiToken = this.credentials.getApiTokenSync('sinch') ?? '';
    const servicePlanId = config.get<string>('sinchServicePlanId', '').trim();
    const region = config.get<SinchRegion>('sinchRegion', 'us');
    const providerPhoneNumber = normalizePhoneNumber(config.get<string>('sinchPhoneNumber', ''));
    const shared = getSharedSmsSettings();

    if (!apiToken || !servicePlanId || !isValidE164(providerPhoneNumber) || !shared) {
      return undefined;
    }

    return {
      provider: 'sinch',
      providerPhoneNumber,
      userPhoneNumber: shared.userPhoneNumber,
      pollIntervalMs: shared.pollIntervalMs,
      summaryMaxLength: shared.summaryMaxLength,
      sinchServicePlanId: servicePlanId,
      sinchRegion: region,
    };
  }

  async sendSms(smsConfig: SmsConfig, body: string): Promise<void> {
    const apiToken = this.credentials.getApiTokenSync('sinch');
    if (!apiToken || !smsConfig.sinchServicePlanId || !smsConfig.sinchRegion) {
      throw new Error('Sinch is not configured.');
    }

    const baseUrl = REGION_BASE_URL[smsConfig.sinchRegion];
    const response = await fetch(
      `${baseUrl}/xms/v1/${encodeURIComponent(smsConfig.sinchServicePlanId)}/batches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: smsConfig.providerPhoneNumber,
          to: [smsConfig.userPhoneNumber],
          body,
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Sinch send failed (${response.status}): ${errorBody.slice(0, 200)}`);
    }
  }

  async fetchInboundMessages(smsConfig: SmsConfig, since?: Date): Promise<SmsMessage[]> {
    const apiToken = this.credentials.getApiTokenSync('sinch');
    if (!apiToken || !smsConfig.sinchServicePlanId || !smsConfig.sinchRegion) {
      return [];
    }

    const baseUrl = REGION_BASE_URL[smsConfig.sinchRegion];
    const params = new URLSearchParams({
      page_size: '20',
      to: smsConfig.providerPhoneNumber,
    });
    if (since) {
      params.set('start_date', since.toISOString());
    }

    const response = await fetch(
      `${baseUrl}/xms/v1/${encodeURIComponent(smsConfig.sinchServicePlanId)}/inbounds?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Sinch inbound fetch failed (${response.status}): ${errorBody.slice(0, 200)}`);
    }

    const payload = (await response.json()) as SinchInboundResponse;
    const inbounds = payload.inbounds ?? [];

    return inbounds
      .map((inbound) => ({
        sid: inbound.id ?? `sinch-${Date.now()}`,
        body: inbound.body ?? '',
        from: normalizePhoneNumber(inbound.from ?? ''),
        to: normalizePhoneNumber(inbound.to ?? smsConfig.providerPhoneNumber),
        dateSent: inbound.received_at ? new Date(inbound.received_at) : new Date(),
      }))
      .filter((message) => message.body.trim())
      .sort((left, right) => left.dateSent.getTime() - right.dateSent.getTime());
  }
}
