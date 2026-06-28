import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { SessionManager } from '../session/sessionManager';
import { SmsService } from '../sms/smsService';
import { AgentStatusService } from '../session/agentStatusService';
import { CredentialStore } from '../security/credentialStore';
import { AuditLogger } from '../security/auditLogger';
import { isValidSessionId } from '../security/validation';
import { assessAllProviders, PROVIDER_CATALOG, SMS_PROVIDERS } from '../sms/providerCatalog';

const ALLOWED_MESSAGE_TYPES = new Set([
  'ready',
  'toggleSms',
  'activateMaster',
  'setActiveSession',
  'saveConfig',
  'refreshWindows',
]);

export class ControlPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'insightPlugin.controlPanel';
  private webview: vscode.Webview | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessions: SessionManager,
    private readonly sms: SmsService,
    private readonly agentStatus: AgentStatusService,
    private readonly credentials: CredentialStore,
    private readonly audit: AuditLogger,
    private readonly onToggleSms: (enabled: boolean) => Promise<void>,
    private readonly onActivateMaster: () => Promise<void>,
    private readonly onSetActiveSession: (sessionId: string) => void,
    private readonly onRefreshWindows: () => Promise<void>,
    private readonly onSaveConfig: (config: Record<string, string | number | boolean | string[]>) => Promise<void>
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webview = webviewView.webview;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.renderHtml();
    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (!message || typeof message !== 'object' || !ALLOWED_MESSAGE_TYPES.has(String(message.type))) {
        this.audit.log({
          type: 'security.violation',
          detail: 'Rejected invalid webview message',
        });
        return;
      }

      switch (message.type) {
        case 'ready':
          this.postState(webviewView.webview);
          break;
        case 'toggleSms':
          await this.onToggleSms(Boolean(message.enabled));
          this.postState(webviewView.webview);
          break;
        case 'activateMaster':
          await this.onActivateMaster();
          this.postState(webviewView.webview);
          break;
        case 'setActiveSession': {
          const sessionId = String(message.sessionId ?? '');
          if (!isValidSessionId(sessionId)) {
            return;
          }
          this.onSetActiveSession(sessionId);
          this.postState(webviewView.webview);
          break;
        }
        case 'saveConfig':
          await this.onSaveConfig((message.config ?? {}) as Record<string, string | number | boolean | string[]>);
          this.postState(webviewView.webview);
          break;
        case 'refreshWindows':
          await this.onRefreshWindows();
          this.postState(webviewView.webview);
          break;
      }
    });

    webviewView.onDidDispose(() => {
      this.webview = undefined;
    });
  }

  refresh(): void {
    if (this.webview) {
      this.postState(this.webview);
    }
  }

  private postState(webview: vscode.Webview): void {
    const workspaceConfig = vscode.workspace.getConfiguration('insightPlugin');
    const smsProvider = this.sms.getProvider();
    const config = this.sms.getConfig();
    const snapshot = this.agentStatus.buildSnapshot();
    const readinessByProvider = assessAllProviders(this.credentials);
    webview.postMessage({
      type: 'state',
      payload: {
        smsModeEnabled: this.sessions.isSmsModeEnabled(),
        masterAgentActive: this.sessions.isMasterAgentActive(),
        masterActivationSource: this.sessions.getState().masterAgent.activationSource,
        smsConfigured: this.sms.isConfigured(),
        smsProvider,
        providerLabel: this.sms.getProviderLabel(),
        providerCatalog: PROVIDER_CATALOG,
        readinessByProvider,
        tokensConfigured: Object.fromEntries(
          SMS_PROVIDERS.map((provider) => [provider, this.credentials.isApiTokenConfigured(provider)])
        ),
        sessions: this.sessions.listSessions(),
        agentWindows: snapshot.windows,
        scannedAt: snapshot.scannedAt,
        windowCount: snapshot.windowCount,
        activeSessionId: this.sessions.getState().activeSessionId,
        config: {
          smsProvider,
          twilioAccountSid: workspaceConfig.get<string>('twilioAccountSid', ''),
          sinchServicePlanId: workspaceConfig.get<string>('sinchServicePlanId', ''),
          sinchRegion: workspaceConfig.get<string>('sinchRegion', 'us'),
          apiTokenConfigured: this.credentials.isApiTokenConfigured(smsProvider),
          twilioPhoneNumber: workspaceConfig.get<string>('twilioPhoneNumber', ''),
          sinchPhoneNumber: workspaceConfig.get<string>('sinchPhoneNumber', ''),
          sms8DeviceId: workspaceConfig.get<string>('sms8DeviceId', ''),
          sms8SimSlot: workspaceConfig.get<number>('sms8SimSlot', 0),
          userPhoneNumber: config?.userPhoneNumber ?? workspaceConfig.get<string>('userPhoneNumber', ''),
          pollIntervalMs: config?.pollIntervalMs ?? workspaceConfig.get<number>('pollIntervalMs', 8000),
          summaryMaxLength: config?.summaryMaxLength ?? workspaceConfig.get<number>('summaryMaxLength', 300),
          requireMasterPassphrase: workspaceConfig.get<boolean>('requireMasterPassphrase', false),
          masterPassphraseConfigured: Boolean(this.credentials.getMasterPassphraseSync()),
          enforceSenderValidation: workspaceConfig.get<boolean>('enforceSenderValidation', true),
          redactSmsContent: workspaceConfig.get<boolean>('redactSmsContent', false),
        },
      },
    });
  }

  private renderHtml(): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>InsightPlugIn</title>
  <style>
    :root {
      --ip-accent: var(--vscode-focusBorder, #007fd4);
      --ip-surface: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.04));
      --ip-border: var(--vscode-panel-border, rgba(128,128,128,0.35));
      --ip-muted: var(--vscode-descriptionForeground, rgba(128,128,128,0.9));
      --ip-success: var(--vscode-testing-iconPassed, #3fb950);
      --ip-warning: var(--vscode-editorWarning-foreground, #cca700);
      --ip-danger: var(--vscode-errorForeground, #f85149);
      --ip-idle: var(--vscode-disabledForeground, #8b949e);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: 14px 12px 20px;
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
      line-height: 1.45;
    }

    .hero {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin-bottom: 16px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--ip-border);
    }

    .hero-mark {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: linear-gradient(135deg, var(--ip-accent), color-mix(in srgb, var(--ip-accent) 55%, #6366f1));
      display: grid;
      place-items: center;
      font-size: 18px;
      flex-shrink: 0;
      box-shadow: 0 4px 14px color-mix(in srgb, var(--ip-accent) 35%, transparent);
    }

    .hero-copy h1 {
      margin: 0 0 4px;
      font-size: 15px;
      font-weight: 650;
      letter-spacing: -0.01em;
    }

    .hero-copy p {
      margin: 0;
      font-size: 11px;
      color: var(--ip-muted);
    }

    .stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 14px;
    }

    .stat {
      background: var(--ip-surface);
      border: 1px solid var(--ip-border);
      border-radius: 10px;
      padding: 10px 11px;
      min-height: 68px;
    }

    .stat-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--ip-muted);
      margin-bottom: 6px;
    }

    .stat-value {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      font-weight: 600;
      min-width: 0;
    }

    .stat-value > span:last-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--ip-idle);
    }

    .dot.on { background: var(--ip-success); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ip-success) 25%, transparent); }
    .dot.warn { background: var(--ip-warning); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ip-warning) 22%, transparent); }
    .dot.off { background: var(--ip-idle); }

    .panel {
      background: var(--ip-surface);
      border: 1px solid var(--ip-border);
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 12px;
    }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }

    .panel-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 650;
      letter-spacing: 0.02em;
    }

    .panel-icon {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      display: grid;
      place-items: center;
      font-size: 11px;
      background: color-mix(in srgb, var(--ip-accent) 18%, transparent);
      color: var(--ip-accent);
    }

    .panel-sub {
      font-size: 11px;
      color: var(--ip-muted);
      margin: -4px 0 10px;
    }

    .control-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-top: 1px solid var(--ip-border);
    }

    .control-row:first-of-type { border-top: none; padding-top: 0; }

    .control-copy strong {
      display: block;
      font-size: 12px;
      margin-bottom: 2px;
    }

    .control-copy span {
      font-size: 11px;
      color: var(--ip-muted);
    }

    .switch {
      position: relative;
      width: 42px;
      height: 24px;
      flex-shrink: 0;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }

    .slider {
      position: absolute;
      inset: 0;
      background: color-mix(in srgb, var(--ip-idle) 55%, transparent);
      border: 1px solid var(--ip-border);
      border-radius: 999px;
      cursor: pointer;
      transition: background 0.18s ease, border-color 0.18s ease;
    }

    .slider:before {
      content: "";
      position: absolute;
      width: 18px;
      height: 18px;
      left: 2px;
      top: 2px;
      border-radius: 50%;
      background: var(--vscode-foreground);
      transition: transform 0.18s ease;
    }

    .switch input:checked + .slider {
      background: color-mix(in srgb, var(--ip-success) 75%, transparent);
      border-color: color-mix(in srgb, var(--ip-success) 60%, var(--ip-border));
    }

    .switch input:checked + .slider:before {
      transform: translateX(18px);
    }

    .switch input:focus-visible + .slider {
      outline: 2px solid var(--ip-accent);
      outline-offset: 2px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      background: color-mix(in srgb, var(--ip-idle) 30%, transparent);
      color: var(--ip-muted);
      border: 1px solid var(--ip-border);
    }

    .badge.live {
      background: color-mix(in srgb, var(--ip-success) 18%, transparent);
      color: var(--ip-success);
      border-color: color-mix(in srgb, var(--ip-success) 35%, transparent);
    }

    .btn {
      appearance: none;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 8px 12px;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, transform 0.08s ease;
    }

    .btn:active { transform: scale(0.98); }

    .btn-primary {
      width: 100%;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      margin-top: 4px;
    }

    .btn-primary:hover { background: var(--vscode-button-hoverBackground, var(--vscode-button-background)); }

    .btn-secondary {
      background: transparent;
      color: var(--vscode-foreground);
      border-color: var(--ip-border);
      padding: 5px 10px;
      font-size: 11px;
    }

    .btn-secondary:hover {
      background: color-mix(in srgb, var(--ip-accent) 10%, transparent);
      border-color: color-mix(in srgb, var(--ip-accent) 40%, var(--ip-border));
    }

    .btn-ghost {
      width: 100%;
      margin-top: 6px;
      background: color-mix(in srgb, var(--ip-accent) 12%, transparent);
      color: var(--ip-accent);
      border-color: color-mix(in srgb, var(--ip-accent) 28%, transparent);
    }

    .scan-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 11px;
      color: var(--ip-muted);
      margin-bottom: 10px;
      padding: 7px 9px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent);
    }

    .window-list { display: flex; flex-direction: column; gap: 8px; }

    .window-card {
      border: 1px solid var(--ip-border);
      border-radius: 10px;
      padding: 10px;
      background: var(--vscode-editor-background);
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .window-card.active {
      border-color: color-mix(in srgb, var(--ip-accent) 55%, var(--ip-border));
      box-shadow: inset 3px 0 0 var(--ip-accent);
    }

    .window-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }

    .window-title {
      font-size: 12px;
      font-weight: 650;
      line-height: 1.3;
    }

    .status-pill {
      font-size: 10px;
      font-weight: 650;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 2px 7px;
      border-radius: 999px;
      white-space: nowrap;
      border: 1px solid transparent;
    }

    .status-pill.running { color: var(--ip-success); background: color-mix(in srgb, var(--ip-success) 14%, transparent); border-color: color-mix(in srgb, var(--ip-success) 30%, transparent); }
    .status-pill.waiting { color: var(--ip-warning); background: color-mix(in srgb, var(--ip-warning) 14%, transparent); border-color: color-mix(in srgb, var(--ip-warning) 30%, transparent); }
    .status-pill.paused { color: var(--ip-accent); background: color-mix(in srgb, var(--ip-accent) 14%, transparent); border-color: color-mix(in srgb, var(--ip-accent) 30%, transparent); }
    .status-pill.idle { color: var(--ip-idle); background: color-mix(in srgb, var(--ip-idle) 14%, transparent); border-color: color-mix(in srgb, var(--ip-idle) 30%, transparent); }

    .window-meta {
      font-size: 10px;
      color: var(--ip-muted);
      font-family: var(--vscode-editor-font-family, monospace);
      margin-bottom: 6px;
    }

    .window-summary {
      font-size: 11px;
      color: var(--ip-muted);
      margin-bottom: 8px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .empty {
      text-align: center;
      padding: 18px 10px;
      border: 1px dashed var(--ip-border);
      border-radius: 10px;
      color: var(--ip-muted);
    }

    .empty-icon { font-size: 22px; margin-bottom: 6px; opacity: 0.85; }
    .empty-title { font-size: 12px; font-weight: 600; color: var(--vscode-foreground); margin-bottom: 4px; }
    .empty-hint { font-size: 11px; }

    details.config {
      border: 1px solid var(--ip-border);
      border-radius: 12px;
      background: var(--ip-surface);
      margin-bottom: 12px;
      overflow: hidden;
    }

    details.config summary {
      list-style: none;
      cursor: pointer;
      padding: 12px;
      font-size: 12px;
      font-weight: 650;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      user-select: none;
    }

    details.config summary::-webkit-details-marker { display: none; }

    details.config[open] summary {
      border-bottom: 1px solid var(--ip-border);
    }

    .config-body { padding: 12px; }

    .field { margin-bottom: 10px; }

    .field label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 5px;
      color: var(--vscode-foreground);
    }

    .field-hint {
      font-size: 10px;
      color: var(--ip-muted);
      margin: -2px 0 5px;
    }

    .field input {
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--ip-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font: inherit;
      font-size: 12px;
    }

    .field select {
      width: 100%;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid var(--ip-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      font: inherit;
      font-size: 12px;
    }

    .field input:focus {
      outline: 2px solid color-mix(in srgb, var(--ip-accent) 50%, transparent);
      border-color: var(--ip-accent);
    }

    .notice {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      padding: 9px 10px;
      border-radius: 8px;
      font-size: 11px;
      color: var(--ip-muted);
      background: color-mix(in srgb, var(--ip-accent) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--ip-accent) 20%, transparent);
      margin-bottom: 12px;
    }

    .footer-note {
      text-align: center;
      font-size: 10px;
      color: var(--ip-muted);
      margin-top: 4px;
    }

    .provider-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 12px;
    }

    .provider-tab {
      flex: 1 1 calc(33.333% - 6px);
      min-width: 68px;
      border: 1px solid var(--ip-border);
      background: transparent;
      color: var(--vscode-foreground);
      border-radius: 8px;
      padding: 8px 6px;
      font: inherit;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
    }

    .provider-tab .tab-status {
      display: block;
      font-size: 9px;
      font-weight: 500;
      color: var(--ip-muted);
      margin-top: 2px;
    }

    .provider-tab.ready .tab-status { color: var(--ip-success); }
    .provider-tab.partial .tab-status { color: var(--ip-warning); }

    .provider-tab.active {
      border-color: color-mix(in srgb, var(--ip-accent) 55%, var(--ip-border));
      background: color-mix(in srgb, var(--ip-accent) 14%, transparent);
      color: var(--ip-accent);
    }

    .provider-panel { display: none; }
    .provider-panel.active { display: block; }

    .provider-tagline {
      font-size: 11px;
      color: var(--ip-muted);
      margin: 0 0 12px;
      line-height: 1.4;
    }

    .readiness-list {
      list-style: none;
      margin: 0 0 12px;
      padding: 10px 11px;
      border: 1px solid var(--ip-border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--ip-surface) 80%, transparent);
      font-size: 11px;
    }

    .readiness-list li {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      color: var(--ip-muted);
    }

    .readiness-list li.done { color: var(--ip-success); }
    .readiness-list li.pending { color: var(--ip-warning); }

    .token-status {
      display: inline-block;
      margin-top: 4px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .token-status.saved { color: var(--ip-success); }
    .token-status.missing { color: var(--ip-warning); }

    .field-label-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
    }
  </style>
</head>
<body>
  <header class="hero">
    <div class="hero-mark" aria-hidden="true">📡</div>
    <div class="hero-copy">
      <h1>InsightPlugIn</h1>
      <p>Remote SMS via Twilio, Sinch, or SMS8</p>
    </div>
  </header>

  <section class="stat-grid" aria-label="Status overview">
    <div class="stat">
      <div class="stat-label">SMS Relay</div>
      <div class="stat-value"><span id="smsDot" class="dot off"></span><span id="smsStatText">Off</span></div>
    </div>
    <div class="stat">
      <div class="stat-label">SMS Provider</div>
      <div class="stat-value"><span id="providerDot" class="dot off"></span><span id="providerStatText">Not configured</span></div>
    </div>
    <div class="stat">
      <div class="stat-label">Master Agent</div>
      <div class="stat-value"><span id="masterDot" class="dot off"></span><span id="masterStatText">Inactive</span></div>
    </div>
    <div class="stat">
      <div class="stat-label">Agent Windows</div>
      <div class="stat-value"><span id="windowsDot" class="dot off"></span><span id="windowsStatText">0 found</span></div>
    </div>
  </section>

  <section class="panel">
    <div class="panel-head">
      <div class="panel-title"><span class="panel-icon">⚡</span> Control</div>
      <span id="masterBadge" class="badge">Standby</span>
    </div>
    <p class="panel-sub">Manage live relay, master agent, and session routing.</p>

    <div class="control-row">
      <div class="control-copy">
        <strong>SMS Remote Mode</strong>
        <span>Enables polling, summaries, and master agent</span>
      </div>
      <label class="switch" aria-label="Toggle SMS remote mode">
        <input id="smsToggle" type="checkbox" />
        <span class="slider"></span>
      </label>
    </div>

    <button id="masterBtn" class="btn btn-ghost" type="button">Open Master Agent</button>
  </section>

  <section class="panel">
    <div class="panel-head">
      <div class="panel-title"><span class="panel-icon">🪟</span> Agent Windows</div>
      <button id="refreshWindows" class="btn btn-secondary" type="button">Refresh</button>
    </div>
    <div id="scanInfo" class="scan-bar"><span>Not scanned yet</span></div>
    <div id="sessions" class="window-list"></div>
  </section>

  <details class="config">
    <summary>
      <span>SMS Provider &amp; Security</span>
      <span class="badge" id="configBadge">Setup</span>
    </summary>
    <div class="config-body">
      <div class="notice">🔒 Provider API keys and master passphrase are stored in your OS secret store.</div>

      <div class="field">
        <label>SMS Provider</label>
        <p class="provider-tagline" id="providerTagline">Choose a provider — settings are saved per provider.</p>
        <div class="provider-tabs">
          <button type="button" class="provider-tab" data-provider="twilio">
            Twilio
            <span class="tab-status" data-status-for="twilio">Setup</span>
          </button>
          <button type="button" class="provider-tab" data-provider="sinch">
            Sinch
            <span class="tab-status" data-status-for="sinch">Setup</span>
          </button>
          <button type="button" class="provider-tab" data-provider="sms8">
            SMS8
            <span class="tab-status" data-status-for="sms8">Setup</span>
          </button>
        </div>
      </div>

      <ul id="readinessList" class="readiness-list" aria-label="Provider setup checklist"></ul>

      <div id="twilioPanel" class="provider-panel">
        <div class="field">
          <label for="accountSid">Twilio Account SID</label>
          <input id="accountSid" autocomplete="off" />
        </div>
        <div class="field">
          <label for="twilioPhone">Twilio Phone</label>
          <input id="twilioPhone" placeholder="+15551234567" autocomplete="off" />
        </div>
      </div>

      <div id="sinchPanel" class="provider-panel">
        <div class="field">
          <label for="servicePlanId">Sinch Service Plan ID</label>
          <p class="field-hint">Dashboard → APIs → REST configuration</p>
          <input id="servicePlanId" autocomplete="off" />
        </div>
        <div class="field">
          <label for="sinchRegion">Sinch Region</label>
          <select id="sinchRegion">
            <option value="us">US</option>
            <option value="eu">EU</option>
            <option value="au">Australia</option>
            <option value="br">Brazil</option>
            <option value="ca">Canada</option>
          </select>
        </div>
        <div class="field">
          <label for="sinchPhone">Sinch Phone</label>
          <input id="sinchPhone" placeholder="+15551234567" autocomplete="off" />
        </div>
      </div>

      <div id="sms8Panel" class="provider-panel">
        <div class="field">
          <label for="sms8DeviceId">Device ID (optional)</label>
          <p class="field-hint">Leave blank for primary device. Use <code>2|0</code> format via device + SIM slot below.</p>
          <input id="sms8DeviceId" placeholder="1" autocomplete="off" />
        </div>
        <div class="field">
          <label for="sms8SimSlot">SIM Slot</label>
          <select id="sms8SimSlot">
            <option value="0">SIM 0 (primary)</option>
            <option value="1">SIM 1</option>
          </select>
        </div>
        <div class="notice">Messages route through your paired Android phone at app.sms8.io — no Twilio number required.</div>
      </div>

      <div class="field">
        <div class="field-label-row">
          <label for="authToken" id="authTokenLabel">API Token</label>
          <span id="tokenStatus" class="token-status missing">Not saved</span>
        </div>
        <p class="field-hint" id="tokenHint">Leave blank to keep the saved credential</p>
        <input id="authToken" type="password" autocomplete="new-password" placeholder="••••••••" />
      </div>
      <div class="field">
        <label for="userPhone">Your Phone</label>
        <p class="field-hint">E.164 format — used by all providers for delivery and inbound authorization</p>
        <input id="userPhone" placeholder="+15559876543" autocomplete="off" />
      </div>
      <div class="field">
        <label for="masterPassphrase">Master Passphrase</label>
        <p class="field-hint">Required when <code>requireMasterPassphrase</code> is enabled</p>
        <input id="masterPassphrase" type="password" autocomplete="new-password" placeholder="••••••••" />
      </div>
      <div class="field">
        <label for="pollInterval">Poll Interval (ms)</label>
        <p class="field-hint">How often to poll for inbound SMS — applies to Twilio, Sinch, and SMS8</p>
        <input id="pollInterval" type="number" min="5000" step="1000" />
      </div>

      <div class="control-row">
        <div class="control-copy">
          <strong>Redact secrets in SMS</strong>
          <span>Off sends API keys and full agent text</span>
        </div>
        <label class="switch" aria-label="Toggle SMS redaction">
          <input id="redactSms" type="checkbox" />
          <span class="slider"></span>
        </label>
      </div>

      <button id="saveConfig" class="btn btn-primary" type="button">Save Configuration</button>
    </div>
  </details>

  <p class="footer-note">Text <strong>MASTER: status</strong> for live session overview</p>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function post(type, payload = {}) {
      vscode.postMessage({ type, ...payload });
    }

    function formatRelativeTime(iso) {
      if (!iso) return 'Never';
      const diff = Date.now() - new Date(iso).getTime();
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
      if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
      return new Date(iso).toLocaleString();
    }

    function setDot(el, mode) {
      el.className = 'dot ' + (mode || 'off');
    }

    function statusClass(status) {
      if (status === 'running') return 'running';
      if (status === 'waiting') return 'waiting';
      if (status === 'paused') return 'paused';
      return 'idle';
    }

    let selectedProvider = 'twilio';
    let latestState = null;

    const PROVIDER_IDS = ['twilio', 'sinch', 'sms8'];

    function normalizeProvider(provider) {
      return PROVIDER_IDS.includes(provider) ? provider : 'twilio';
    }

    function getCatalogEntry(provider) {
      const catalog = (latestState && latestState.providerCatalog) || {};
      return catalog[provider] || {
        label: provider,
        tokenLabel: 'API Token',
        tokenHint: 'Leave blank to keep the saved credential',
        tagline: '',
      };
    }

    function updateProviderChrome(provider) {
      const entry = getCatalogEntry(provider);
      document.getElementById('providerTagline').textContent = entry.tagline || entry.label;
      document.getElementById('authTokenLabel').textContent = entry.tokenLabel || 'API Token';
      document.getElementById('tokenHint').textContent = entry.tokenHint || 'Leave blank to keep the saved credential';
    }

    function updateTokenStatus(provider) {
      const tokensConfigured = (latestState && latestState.tokensConfigured) || {};
      const saved = !!tokensConfigured[provider];
      const tokenStatus = document.getElementById('tokenStatus');
      tokenStatus.textContent = saved ? 'Saved in keychain' : 'Not saved yet';
      tokenStatus.className = 'token-status ' + (saved ? 'saved' : 'missing');
    }

    function renderReadiness(provider) {
      const readinessByProvider = (latestState && latestState.readinessByProvider) || {};
      const readiness = readinessByProvider[provider] || { ready: false, missing: [] };
      const list = document.getElementById('readinessList');
      list.innerHTML = '';

      const requiredItems = {
        twilio: ['Your phone (E.164)', 'Twilio Account SID', 'Twilio Auth Token', 'Twilio phone number'],
        sinch: ['Your phone (E.164)', 'Sinch Service Plan ID', 'Sinch API Token', 'Sinch sender phone'],
        sms8: ['Your phone (E.164)', 'SMS8 API Key'],
      }[provider] || [];

      for (const item of requiredItems) {
        const li = document.createElement('li');
        const done = !readiness.missing.includes(item);
        li.className = done ? 'done' : 'pending';
        li.textContent = (done ? '✓ ' : '○ ') + item;
        list.appendChild(li);
      }

      if (readiness.ready) {
        list.insertAdjacentHTML('beforeend', '<li class="done">✓ Ready to enable SMS Remote Mode</li>');
      }
    }

    function updateProviderTabStatuses() {
      const readinessByProvider = (latestState && latestState.readinessByProvider) || {};
      document.querySelectorAll('.provider-tab').forEach((button) => {
        const provider = button.getAttribute('data-provider');
        const readiness = readinessByProvider[provider] || { ready: false, missing: [] };
        const statusEl = button.querySelector('.tab-status');
        button.classList.remove('ready', 'partial');
        if (readiness.ready) {
          button.classList.add('ready');
          statusEl.textContent = 'Ready';
        } else if (readiness.missing.length < 4) {
          button.classList.add('partial');
          statusEl.textContent = readiness.missing.length + ' left';
        } else {
          statusEl.textContent = 'Setup';
        }
      });
    }

    function setProvider(provider) {
      selectedProvider = normalizeProvider(provider);
      document.querySelectorAll('.provider-tab').forEach((button) => {
        button.classList.toggle('active', button.getAttribute('data-provider') === selectedProvider);
      });
      document.getElementById('twilioPanel').classList.toggle('active', selectedProvider === 'twilio');
      document.getElementById('sinchPanel').classList.toggle('active', selectedProvider === 'sinch');
      document.getElementById('sms8Panel').classList.toggle('active', selectedProvider === 'sms8');
      updateProviderChrome(selectedProvider);
      updateTokenStatus(selectedProvider);
      renderReadiness(selectedProvider);
    }

    document.querySelectorAll('.provider-tab').forEach((button) => {
      button.addEventListener('click', () => setProvider(button.getAttribute('data-provider')));
    });

    function renderState(state) {
      latestState = state;
      const smsOn = !!state.smsModeEnabled;
      document.getElementById('smsToggle').checked = smsOn;
      setDot(document.getElementById('smsDot'), smsOn ? 'on' : 'off');
      document.getElementById('smsStatText').textContent = smsOn ? 'Live' : 'Off';

      const providerOk = !!state.smsConfigured;
      const providerName = state.providerLabel || getCatalogEntry(state.smsProvider || 'twilio').label;
      setDot(document.getElementById('providerDot'), providerOk ? 'on' : 'warn');
      document.getElementById('providerStatText').textContent = providerOk
        ? providerName + ' · Ready'
        : providerName + ' · Setup';

      const masterOn = !!state.masterAgentActive;
      setDot(document.getElementById('masterDot'), masterOn ? 'on' : 'off');
      document.getElementById('masterStatText').textContent = masterOn
        ? 'Active · ' + (state.masterActivationSource || 'manual')
        : 'Inactive';

      const count = state.windowCount || 0;
      setDot(document.getElementById('windowsDot'), count > 0 ? 'on' : 'off');
      document.getElementById('windowsStatText').textContent = count + (count === 1 ? ' window' : ' windows');

      const masterBadge = document.getElementById('masterBadge');
      masterBadge.textContent = masterOn ? 'Live' : 'Standby';
      masterBadge.className = 'badge' + (masterOn ? ' live' : '');

      const configBadge = document.getElementById('configBadge');
      configBadge.textContent = providerOk ? 'Ready' : 'Setup';
      configBadge.className = 'badge' + (providerOk ? ' live' : '');

      const scanInfo = document.getElementById('scanInfo');
      scanInfo.innerHTML = '';
      const scanLeft = document.createElement('span');
      scanLeft.textContent = 'Last scan: ' + formatRelativeTime(state.scannedAt);
      const scanRight = document.createElement('strong');
      scanRight.textContent = String(count);
      scanInfo.appendChild(scanLeft);
      scanInfo.appendChild(scanRight);

      const sessionsEl = document.getElementById('sessions');
      sessionsEl.innerHTML = '';
      const windows = (state.agentWindows && state.agentWindows.length > 0)
        ? state.agentWindows
        : state.sessions;

      if (!windows || windows.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.innerHTML = '<div class="empty-icon">🤖</div><div class="empty-title">No agent windows yet</div><div class="empty-hint">Open a Cursor agent chat, send a message, then tap Refresh.</div>';
        sessionsEl.appendChild(empty);
      } else {
        for (const session of windows) {
          const isActive = session.id === state.activeSessionId;
          const card = document.createElement('article');
          card.className = 'window-card' + (isActive ? ' active' : '');

          const top = document.createElement('div');
          top.className = 'window-top';

          const title = document.createElement('div');
          title.className = 'window-title';
          title.textContent = (isActive ? '★ ' : '') + (session.label || 'Agent');

          const pill = document.createElement('span');
          pill.className = 'status-pill ' + statusClass(session.status);
          pill.textContent = session.status || 'idle';

          top.appendChild(title);
          top.appendChild(pill);

          const meta = document.createElement('div');
          meta.className = 'window-meta';
          meta.textContent = session.id || '';

          card.appendChild(top);
          card.appendChild(meta);

          if (session.lastSummary) {
            const summary = document.createElement('div');
            summary.className = 'window-summary';
            summary.textContent = session.lastSummary;
            card.appendChild(summary);
          }

          const button = document.createElement('button');
          button.className = 'btn btn-secondary';
          button.type = 'button';
          button.textContent = isActive ? 'Active SMS Session' : 'Set as Active Session';
          button.disabled = isActive;
          button.addEventListener('click', () => post('setActiveSession', { sessionId: session.id }));
          card.appendChild(button);

          sessionsEl.appendChild(card);
        }
      }

      setProvider(state.smsProvider || state.config.smsProvider || 'twilio');
      updateProviderTabStatuses();
      document.getElementById('accountSid').value = state.config.twilioAccountSid || '';
      document.getElementById('twilioPhone').value = state.config.twilioPhoneNumber || '';
      document.getElementById('servicePlanId').value = state.config.sinchServicePlanId || '';
      document.getElementById('sinchRegion').value = state.config.sinchRegion || 'us';
      document.getElementById('sinchPhone').value = state.config.sinchPhoneNumber || '';
      document.getElementById('sms8DeviceId').value = state.config.sms8DeviceId || '';
      document.getElementById('sms8SimSlot').value = String(state.config.sms8SimSlot ?? 0);
      document.getElementById('userPhone').value = state.config.userPhoneNumber || '';
      document.getElementById('pollInterval').value = state.config.pollIntervalMs || 8000;
      document.getElementById('redactSms').checked = !!state.config.redactSmsContent;
    }

    window.addEventListener('message', (event) => {
      if (event.data.type === 'state') {
        renderState(event.data.payload);
      }
    });

    document.getElementById('smsToggle').addEventListener('change', (event) => {
      post('toggleSms', { enabled: event.target.checked });
    });

    document.getElementById('masterBtn').addEventListener('click', () => post('activateMaster'));
    document.getElementById('refreshWindows').addEventListener('click', () => post('refreshWindows'));
    document.getElementById('saveConfig').addEventListener('click', () => {
      post('saveConfig', {
        config: {
          smsProvider: selectedProvider,
          twilioAccountSid: document.getElementById('accountSid').value,
          apiToken: document.getElementById('authToken').value,
          twilioPhoneNumber: document.getElementById('twilioPhone').value,
          sinchServicePlanId: document.getElementById('servicePlanId').value,
          sinchRegion: document.getElementById('sinchRegion').value,
          sinchPhoneNumber: document.getElementById('sinchPhone').value,
          sms8DeviceId: document.getElementById('sms8DeviceId').value,
          sms8SimSlot: Number(document.getElementById('sms8SimSlot').value || 0),
          userPhoneNumber: document.getElementById('userPhone').value,
          masterPassphrase: document.getElementById('masterPassphrase').value,
          pollIntervalMs: Number(document.getElementById('pollInterval').value || 8000),
          redactSmsContent: document.getElementById('redactSms').checked,
        }
      });
      document.getElementById('authToken').value = '';
      document.getElementById('masterPassphrase').value = '';
    });

    setProvider('twilio');
    post('ready');
  </script>
</body>
</html>`;
  }
}
