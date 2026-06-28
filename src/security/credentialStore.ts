import * as vscode from 'vscode';
import { SmsProvider } from '../types';

const TOKEN_KEYS: Record<SmsProvider, string> = {
  twilio: 'insightPlugin.twilioAuthToken',
  sinch: 'insightPlugin.sinchApiToken',
  sms8: 'insightPlugin.sms8ApiKey',
};

export class CredentialStore {
  private tokenCache: Partial<Record<SmsProvider, string>> = {};
  private masterPassphraseCache: string | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    await this.migrateLegacySettings();
    this.tokenCache.twilio = (await this.context.secrets.get(TOKEN_KEYS.twilio)) ?? undefined;
    this.tokenCache.sinch = (await this.context.secrets.get(TOKEN_KEYS.sinch)) ?? undefined;
    this.tokenCache.sms8 = (await this.context.secrets.get(TOKEN_KEYS.sms8)) ?? undefined;
    this.masterPassphraseCache = await this.context.secrets.get('insightPlugin.masterPassphrase');
  }

  getApiTokenSync(provider: SmsProvider): string | undefined {
    return this.tokenCache[provider];
  }

  /** @deprecated Use getApiTokenSync('twilio') */
  getAuthTokenSync(): string | undefined {
    return this.getApiTokenSync('twilio');
  }

  async setApiToken(provider: SmsProvider, token: string): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed) {
      await this.clearApiToken(provider);
      return;
    }
    await this.context.secrets.store(TOKEN_KEYS[provider], trimmed);
    this.tokenCache[provider] = trimmed;
    if (provider === 'twilio') {
      await this.clearLegacyAuthTokenSetting();
    }
  }

  /** @deprecated Use setApiToken('twilio', token) */
  async setAuthToken(token: string): Promise<void> {
    await this.setApiToken('twilio', token);
  }

  async clearApiToken(provider: SmsProvider): Promise<void> {
    await this.context.secrets.delete(TOKEN_KEYS[provider]);
    delete this.tokenCache[provider];
    if (provider === 'twilio') {
      await this.clearLegacyAuthTokenSetting();
    }
  }

  getMasterPassphraseSync(): string | undefined {
    return this.masterPassphraseCache;
  }

  async setMasterPassphrase(value: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) {
      await this.clearMasterPassphrase();
      return;
    }
    await this.context.secrets.store('insightPlugin.masterPassphrase', trimmed);
    this.masterPassphraseCache = trimmed;
  }

  async clearMasterPassphrase(): Promise<void> {
    await this.context.secrets.delete('insightPlugin.masterPassphrase');
    this.masterPassphraseCache = undefined;
  }

  isApiTokenConfigured(provider: SmsProvider): boolean {
    return Boolean(this.getApiTokenSync(provider));
  }

  private async migrateLegacySettings(): Promise<void> {
    const config = vscode.workspace.getConfiguration('insightPlugin');
    const legacyToken = config.get<string>('twilioAuthToken', '').trim();
    if (!legacyToken) {
      return;
    }

    const existing = await this.context.secrets.get(TOKEN_KEYS.twilio);
    if (!existing) {
      await this.context.secrets.store(TOKEN_KEYS.twilio, legacyToken);
    }
    await this.clearLegacyAuthTokenSetting();
  }

  private async clearLegacyAuthTokenSetting(): Promise<void> {
    const config = vscode.workspace.getConfiguration('insightPlugin');
    const current = config.get<string>('twilioAuthToken', '').trim();
    if (current) {
      await config.update('twilioAuthToken', '', vscode.ConfigurationTarget.Global);
    }
  }
}
