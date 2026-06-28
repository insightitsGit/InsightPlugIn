import * as vscode from 'vscode';
import { SmsConfig, SmsMessage, SmsProvider } from '../types';
import { CredentialStore } from '../security/credentialStore';
import { AuditLogger } from '../security/auditLogger';
import { RateLimiter } from '../security/rateLimiter';
import { getSecurityPolicy } from '../security/securityPolicy';
import { sanitizeErrorMessage } from '../security/errorSanitizer';
import { TwilioSmsProvider } from './twilioClient';
import { SinchSmsProvider } from './sinchClient';
import { Sms8SmsProvider } from './sms8Client';
import { getProviderLabel as catalogLabel } from './providerCatalog';

interface ProviderClient {
  getConfig(): SmsConfig | undefined;
  sendSms(config: SmsConfig, body: string): Promise<void>;
  fetchInboundMessages(config: SmsConfig, since?: Date): Promise<SmsMessage[]>;
}

export class SmsService {
  private readonly providers: Record<SmsProvider, ProviderClient>;

  constructor(
    private readonly credentials: CredentialStore,
    private readonly audit: AuditLogger,
    private readonly rateLimiter: RateLimiter
  ) {
    this.providers = {
      twilio: new TwilioSmsProvider(credentials),
      sinch: new SinchSmsProvider(credentials),
      sms8: new Sms8SmsProvider(credentials),
    };
  }

  getProvider(): SmsProvider {
    return vscode.workspace.getConfiguration('insightPlugin').get<SmsProvider>('smsProvider', 'twilio');
  }

  private getActiveProvider(): ProviderClient {
    const provider = this.getProvider();
    return this.providers[provider] ?? this.providers.twilio;
  }

  getConfig(): SmsConfig | undefined {
    return this.getActiveProvider().getConfig();
  }

  isConfigured(): boolean {
    return this.getConfig() !== undefined;
  }

  getProviderLabel(): string {
    return catalogLabel(this.getProvider());
  }

  async sendSms(body: string): Promise<void> {
    const config = this.getConfig();
    if (!config) {
      throw new Error(`${this.getProviderLabel()} is not configured. Add credentials in InsightPlugIn settings.`);
    }

    const policy = getSecurityPolicy();
    if (!this.rateLimiter.allow('sms.outbound', policy.maxOutboundSmsPerHour, 60 * 60 * 1000)) {
      this.audit.log({
        type: 'sms.outbound.blocked',
        detail: 'Outbound SMS rate limit exceeded',
      });
      throw new Error('Outbound SMS rate limit exceeded. Try again later.');
    }

    try {
      await this.getActiveProvider().sendSms(config, body);
      this.audit.log({
        type: 'sms.outbound.sent',
        actor: config.userPhoneNumber,
        detail: body,
        metadata: { provider: config.provider },
      });
    } catch (error) {
      const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
      throw new Error(message);
    }
  }

  async fetchInboundMessages(since?: Date): Promise<SmsMessage[]> {
    const config = this.getConfig();
    if (!config) {
      return [];
    }

    try {
      return await this.getActiveProvider().fetchInboundMessages(config, since);
    } catch (error) {
      const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
      throw new Error(message);
    }
  }
}
