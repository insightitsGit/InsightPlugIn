import * as vscode from 'vscode';
import { isMasterSmsCommand, parseAuthenticatedMasterCommand, SmsMessage } from '../types';
import { SessionManager } from '../session/sessionManager';
import { SmsService } from './smsService';
import { MasterAgentController } from '../master/masterAgentController';
import { AuditLogger } from '../security/auditLogger';
import { CredentialStore } from '../security/credentialStore';
import { getSecurityPolicy, isAuthorizedSender } from '../security/securityPolicy';
import { clampString } from '../security/validation';
import { sanitizeErrorMessage } from '../security/errorSanitizer';

export class SmsPoller {
  private timer: NodeJS.Timeout | undefined;
  private polling = false;

  constructor(
    private readonly sms: SmsService,
    private readonly sessions: SessionManager,
    private readonly masterAgent: MasterAgentController,
    private readonly credentials: CredentialStore,
    private readonly audit: AuditLogger,
    private readonly onStateChange: () => void
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }

    const interval = this.sms.getConfig()?.pollIntervalMs ?? 8000;
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, interval);

    void this.pollOnce();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.polling || !this.sessions.isSmsModeEnabled()) {
      return;
    }

    this.polling = true;
    try {
      const messages = await this.sms.fetchInboundMessages();
      const lastSid = this.sessions.getLastProcessedSmsSid();
      let newMessages = messages;
      if (lastSid) {
        const lastIndex = messages.findIndex((message) => message.sid === lastSid);
        newMessages = lastIndex === -1 ? messages : messages.slice(lastIndex + 1);
      } else {
        newMessages = messages.slice(-5);
      }

      for (const message of newMessages) {
        await this.handleInboundMessage(message);
        this.sessions.setLastProcessedSmsSid(message.sid);
      }
    } catch (error) {
      const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
      void vscode.window.showErrorMessage(`InsightPlugIn SMS poll failed: ${message}`);
    } finally {
      this.polling = false;
    }
  }

  private async handleInboundMessage(message: SmsMessage): Promise<void> {
    const policy = getSecurityPolicy();
    const trimmed = clampString(message.body, policy.maxInboundSmsLength);
    if (!trimmed) {
      return;
    }

    if (!isAuthorizedSender(message.from, policy)) {
      this.audit.log({
        type: 'sms.inbound.rejected',
        actor: message.from,
        detail: 'Unauthorized sender',
      });
      return;
    }

    this.audit.log({
      type: 'sms.inbound.accepted',
      actor: message.from,
      detail: trimmed,
    });

    if (isMasterSmsCommand(trimmed)) {
      const requiredPassphrase = policy.requireMasterPassphrase
        ? this.credentials.getMasterPassphraseSync()
        : undefined;

      if (policy.requireMasterPassphrase && !requiredPassphrase) {
        this.audit.log({
          type: 'security.violation',
          actor: message.from,
          detail: 'Master passphrase required but not configured',
        });
        await this.sms.sendSms('[InsightPlugIn] Master passphrase is not configured.');
        return;
      }

      const parsed = parseAuthenticatedMasterCommand(trimmed, requiredPassphrase);
      if (!parsed.authorized) {
        this.audit.log({
          type: 'sms.inbound.rejected',
          actor: message.from,
          detail: 'Invalid master passphrase',
        });
        return;
      }

      await this.masterAgent.activate('sms');
      if (parsed.command) {
        this.audit.log({
          type: 'master.command',
          actor: message.from,
          detail: parsed.command,
        });
        await this.masterAgent.executeCommand(parsed.command, 'sms');
      } else {
        await this.sms.sendSms('[InsightPlugIn] Master Agent active. Send MASTER: <command>.');
      }
      this.onStateChange();
      return;
    }

    const activeSession = this.sessions.getActiveSession();
    if (!activeSession) {
      await this.sms.sendSms('[InsightPlugIn] No active session. Text MASTER to control all sessions.');
      return;
    }

    try {
      this.sessions.queueInjection(activeSession.id, trimmed, 'sms');
    } catch {
      await this.sms.sendSms('[InsightPlugIn] Injection queue is full. Try again later.');
      return;
    }
    await vscode.env.clipboard.writeText(trimmed);
    void vscode.window.showInformationMessage(
      `InsightPlugIn: SMS reply queued for "${activeSession.label}". Press Inject Pending SMS or paste into chat.`
    );
    this.onStateChange();
  }
}
