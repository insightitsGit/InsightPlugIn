import * as vscode from 'vscode';
import { SessionManager } from './session/sessionManager';
import { SmsService } from './sms/smsService';
import { SmsPoller } from './sms/smsPoller';
import { TranscriptWatcher } from './session/transcriptWatcher';
import { MasterAgentController } from './master/masterAgentController';
import { ControlPanelProvider } from './ui/controlPanelProvider';
import { AgentStatusService } from './session/agentStatusService';
import { CredentialStore } from './security/credentialStore';
import { AuditLogger } from './security/auditLogger';
import { RateLimiter } from './security/rateLimiter';
import { getSecurityPolicy } from './security/securityPolicy';
import {
  isValidE164,
  isValidTwilioAccountSid,
  normalizePhoneNumber,
} from './security/validation';
import { getProviderLabel, isSmsProvider } from './sms/providerCatalog';

let controlPanelProvider: ControlPanelProvider | undefined;
let smsPoller: SmsPoller | undefined;
let transcriptWatcher: TranscriptWatcher | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const credentials = new CredentialStore(context);
  await credentials.initialize();

  const audit = new AuditLogger(context);
  const rateLimiter = new RateLimiter();
  const sessions = new SessionManager(context, audit);
  const sms = new SmsService(credentials, audit, rateLimiter);
  const agentStatus = new AgentStatusService(sessions);
  const masterAgent = new MasterAgentController(sessions, sms, agentStatus);

  const refreshUi = () => {
    agentStatus.refreshDiscoveredWindows();
    controlPanelProvider?.refresh();
  };

  smsPoller = new SmsPoller(sms, sessions, masterAgent, credentials, audit, refreshUi);
  transcriptWatcher = new TranscriptWatcher(sessions, sms, refreshUi);

  const setSmsMode = async (enabled: boolean) => {
    sessions.setSmsModeEnabled(enabled);

    if (enabled) {
      if (!sms.isConfigured()) {
        sessions.setSmsModeEnabled(false);
        void vscode.window.showErrorMessage(
          `Configure ${sms.getProviderLabel()} credentials before enabling SMS mode.`
        );
        return;
      }

      const allSessions = sessions.listSessions();
      if (!sessions.getActiveSession() && allSessions.length > 0) {
        sessions.setActiveSession(allSessions[0].id);
      }

      transcriptWatcher?.start();
      smsPoller?.start();
      await masterAgent.activate('toggle');
      audit.log({ type: 'sms.mode.enabled' });
      void vscode.window.showInformationMessage('InsightPlugIn: SMS mode ON. Master Agent activated.');
    } else {
      smsPoller?.stop();
      transcriptWatcher?.dispose();
      await masterAgent.deactivate();
      audit.log({ type: 'sms.mode.disabled' });
      void vscode.window.showInformationMessage('InsightPlugIn: SMS mode OFF.');
    }

    refreshUi();
  };

  const saveConfig = async (config: Record<string, string | number | boolean | string[]>) => {
    const workspaceConfig = vscode.workspace.getConfiguration('insightPlugin');
    const provider = String(config.smsProvider ?? workspaceConfig.get('smsProvider', 'twilio')) as
      | 'twilio'
      | 'sinch'
      | 'sms8';
    const accountSid = String(config.twilioAccountSid ?? '').trim();
    const twilioPhone = normalizePhoneNumber(String(config.twilioPhoneNumber ?? ''));
    const sinchPhone = normalizePhoneNumber(String(config.sinchPhoneNumber ?? ''));
    const servicePlanId = String(config.sinchServicePlanId ?? '').trim();
    const sinchRegion = String(config.sinchRegion ?? 'us').trim();
    const sms8DeviceId = String(config.sms8DeviceId ?? '').trim();
    const sms8SimSlot = Number(config.sms8SimSlot ?? workspaceConfig.get('sms8SimSlot', 0));
    const userPhone = normalizePhoneNumber(String(config.userPhoneNumber ?? ''));
    const authToken = String(config.apiToken ?? '').trim();
    const masterPassphrase = String(config.masterPassphrase ?? '').trim();

    if (!isSmsProvider(provider)) {
      void vscode.window.showErrorMessage('SMS provider must be Twilio, Sinch, or SMS8.');
      return;
    }
    if (accountSid && !isValidTwilioAccountSid(accountSid)) {
      void vscode.window.showErrorMessage('Invalid Twilio Account SID format.');
      return;
    }
    if (twilioPhone && !isValidE164(twilioPhone)) {
      void vscode.window.showErrorMessage('Twilio phone must be valid E.164 format, e.g. +15551234567.');
      return;
    }
    if (sinchPhone && !isValidE164(sinchPhone)) {
      void vscode.window.showErrorMessage('Sinch phone must be valid E.164 format, e.g. +15551234567.');
      return;
    }
    if (userPhone && !isValidE164(userPhone)) {
      void vscode.window.showErrorMessage('Your phone must be valid E.164 format, e.g. +15559876543.');
      return;
    }
    if (sms8DeviceId && !/^\d+$/.test(sms8DeviceId)) {
      void vscode.window.showErrorMessage('SMS8 device ID must be a numeric device ID from your dashboard.');
      return;
    }
    if (sms8SimSlot !== 0 && sms8SimSlot !== 1) {
      void vscode.window.showErrorMessage('SMS8 SIM slot must be 0 or 1.');
      return;
    }

    await workspaceConfig.update('smsProvider', provider, vscode.ConfigurationTarget.Global);

    if (accountSid) {
      await workspaceConfig.update('twilioAccountSid', accountSid, vscode.ConfigurationTarget.Global);
    }
    if (authToken) {
      await credentials.setApiToken(provider, authToken);
    }
    if (twilioPhone) {
      await workspaceConfig.update('twilioPhoneNumber', twilioPhone, vscode.ConfigurationTarget.Global);
    }
    if (servicePlanId) {
      await workspaceConfig.update('sinchServicePlanId', servicePlanId, vscode.ConfigurationTarget.Global);
    }
    if (sinchRegion) {
      await workspaceConfig.update('sinchRegion', sinchRegion, vscode.ConfigurationTarget.Global);
    }
    if (sinchPhone) {
      await workspaceConfig.update('sinchPhoneNumber', sinchPhone, vscode.ConfigurationTarget.Global);
    }
    await workspaceConfig.update('sms8DeviceId', sms8DeviceId, vscode.ConfigurationTarget.Global);
    await workspaceConfig.update('sms8SimSlot', sms8SimSlot, vscode.ConfigurationTarget.Global);
    if (userPhone) {
      await workspaceConfig.update('userPhoneNumber', userPhone, vscode.ConfigurationTarget.Global);
    }
    if (masterPassphrase) {
      await credentials.setMasterPassphrase(masterPassphrase);
    }
    if (config.pollIntervalMs) {
      const pollIntervalMs = Math.max(
        Number(config.pollIntervalMs),
        getSecurityPolicy().minPollIntervalMs
      );
      await workspaceConfig.update('pollIntervalMs', pollIntervalMs, vscode.ConfigurationTarget.Global);
    }
    if (typeof config.redactSmsContent === 'boolean') {
      await workspaceConfig.update(
        'redactSmsContent',
        config.redactSmsContent,
        vscode.ConfigurationTarget.Global
      );
    }

    audit.log({ type: 'config.saved', metadata: { provider } });
    void vscode.window.showInformationMessage(`InsightPlugIn: ${getProviderLabel(provider)} settings saved securely.`);
    refreshUi();
  };

  controlPanelProvider = new ControlPanelProvider(
    context.extensionUri,
    sessions,
    sms,
    agentStatus,
    credentials,
    audit,
    setSmsMode,
    async () => {
      await masterAgent.activate('manual');
      refreshUi();
    },
    (sessionId) => {
      sessions.setActiveSession(sessionId);
      refreshUi();
    },
    async () => {
      refreshUi();
    },
    saveConfig
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ControlPanelProvider.viewType, controlPanelProvider),
    vscode.commands.registerCommand('insightPlugin.toggleSmsMode', async () => {
      await setSmsMode(!sessions.isSmsModeEnabled());
    }),
    vscode.commands.registerCommand('insightPlugin.openPanel', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.insightPlugin');
    }),
    vscode.commands.registerCommand('insightPlugin.openMasterAgent', async () => {
      await masterAgent.activate('manual');
      refreshUi();
    }),
    vscode.commands.registerCommand('insightPlugin.registerCurrentSession', async () => {
      const label = await vscode.window.showInputBox({
        prompt: 'Session label',
        value: `Agent ${new Date().toLocaleTimeString()}`,
      });
      if (!label) {
        return;
      }
      const session = sessions.registerSession(label);
      sessions.setActiveSession(session.id);
      refreshUi();
    }),
    vscode.commands.registerCommand('insightPlugin.setActiveSession', async () => {
      const allSessions = sessions.listSessions();
      if (allSessions.length === 0) {
        void vscode.window.showWarningMessage('No sessions registered yet.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        allSessions.map((session) => ({
          label: session.label,
          description: session.id,
          sessionId: session.id,
        })),
        { placeHolder: 'Select active SMS session' }
      );
      if (pick) {
        sessions.setActiveSession(pick.sessionId);
        refreshUi();
      }
    }),
    vscode.commands.registerCommand('insightPlugin.injectPendingSms', async () => {
      const active = sessions.getActiveSession();
      const injection = sessions.popNextInjection(active?.id);
      if (!injection) {
        void vscode.window.showInformationMessage('No pending SMS reply to inject.');
        return;
      }
      await vscode.env.clipboard.writeText(injection.text);
      void vscode.window.showInformationMessage(
        `Pending ${injection.source} message copied. Paste into the active agent chat.`
      );
    }),
    vscode.commands.registerCommand('insightPlugin.getAgentStatus', async () => {
      const snapshot = await masterAgent.getLatestStatus(true);
      const text = agentStatus.getDiscovery().formatStatusText(snapshot);
      await vscode.env.clipboard.writeText(text);
      const preview = snapshot.windows
        .slice(0, 3)
        .map((window) => `${window.label}: ${window.status}`)
        .join(' | ');
      void vscode.window.showInformationMessage(
        `InsightPlugIn: ${snapshot.windowCount} agent window(s). ${preview || 'No windows found.'} Full status copied to clipboard.`
      );
      refreshUi();
    }),
    vscode.commands.registerCommand('insightPlugin.listAgentWindows', async () => {
      const snapshot = await masterAgent.getLatestStatus(true);
      if (snapshot.windows.length === 0) {
        void vscode.window.showInformationMessage('InsightPlugIn: No agent windows discovered.');
        return;
      }

      const pick = await vscode.window.showQuickPick(
        snapshot.windows.map((window) => ({
          label: window.label,
          description: `${window.status}${window.id === snapshot.activeSessionId ? ' · active SMS' : ''}`,
          detail: window.lastSummary,
          sessionId: window.id,
        })),
        { placeHolder: 'Discovered agent windows' }
      );

      if (pick) {
        sessions.setActiveSession(pick.sessionId);
        refreshUi();
        void vscode.window.showInformationMessage(`Active SMS session set to ${pick.label}.`);
      }
    }),
    vscode.commands.registerCommand('insightPlugin.exportAuditLog', async () => {
      const auditPath = audit.getAuditFilePath();
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(auditPath));
      await vscode.window.showTextDocument(document, { preview: false });
    }),
    transcriptWatcher
  );

  if (sessions.isSmsModeEnabled()) {
    transcriptWatcher.start();
    smsPoller.start();
  }

  refreshUi();
}

export function deactivate(): void {
  smsPoller?.stop();
  transcriptWatcher?.dispose();
}
