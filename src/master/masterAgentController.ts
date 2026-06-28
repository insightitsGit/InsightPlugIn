import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { MasterAgentActivationSource } from '../types';
import { AgentStatusService } from '../session/agentStatusService';
import { SessionManager } from '../session/sessionManager';
import { SmsService } from '../sms/smsService';
import { formatMasterActivationSms } from '../processing/summarizer';
import { prepareSmsContent } from '../processing/redactor';

const MASTER_RULE_FILENAME = 'master-agent.mdc';

export class MasterAgentController {
  constructor(
    private readonly sessions: SessionManager,
    private readonly sms: SmsService,
    private readonly agentStatus: AgentStatusService
  ) {}

  async activate(source: MasterAgentActivationSource): Promise<void> {
    this.sessions.setMasterAgentActive(true, source);
    await this.writeMasterContext();
    await this.openMasterAgent(source);

    if (this.sessions.isSmsModeEnabled()) {
      await this.sms.sendSms(formatMasterActivationSms(source === 'sms' ? 'sms' : 'toggle'));
    }
  }

  async deactivate(): Promise<void> {
    this.sessions.setMasterAgentActive(false);
  }

  async executeCommand(command: string, source: MasterAgentActivationSource | 'sms' = 'manual'): Promise<void> {
    const normalized = command.trim();
    if (!normalized) {
      return;
    }

    const lower = normalized.toLowerCase();

    if (lower === 'status') {
      await this.sendStatusSms();
      return;
    }

    if (lower === 'list' || lower === 'windows' || lower === 'list windows') {
      await this.sendWindowsListSms();
      return;
    }

    if (lower.startsWith('pause ')) {
      const sessionId = this.resolveSessionToken(lower.replace('pause ', '').trim());
      if (sessionId) {
        this.sessions.updateSessionStatus(sessionId, 'paused');
        await this.sms.sendSms(`[InsightPlugIn] Paused ${this.getSessionLabel(sessionId)}.`);
      }
      return;
    }

    if (lower.startsWith('continue ')) {
      const sessionId = this.resolveSessionToken(lower.replace('continue ', '').trim());
      if (sessionId) {
        this.sessions.updateSessionStatus(sessionId, 'running');
        await this.sms.sendSms(`[InsightPlugIn] Continued ${this.getSessionLabel(sessionId)}.`);
      }
      return;
    }

    if (lower.startsWith('stop ')) {
      const sessionId = this.resolveSessionToken(lower.replace('stop ', '').trim());
      if (sessionId) {
        this.sessions.updateSessionStatus(sessionId, 'idle');
        await this.sms.sendSms(`[InsightPlugIn] Stopped ${this.getSessionLabel(sessionId)}.`);
      }
      return;
    }

    if (lower.startsWith('active ')) {
      const sessionId = this.resolveSessionToken(lower.replace('active ', '').trim());
      if (sessionId) {
        this.sessions.setActiveSession(sessionId);
        await this.sms.sendSms(`[InsightPlugIn] Active SMS session: ${this.getSessionLabel(sessionId)}.`);
      }
      return;
    }

    if (lower.startsWith('comment ')) {
      const match = normalized.match(/^comment\s+(\S+)\s+(.+)$/i);
      if (match) {
        const sessionId = this.resolveSessionToken(match[1]);
        const text = match[2];
        if (sessionId && text) {
          this.sessions.queueInjection(sessionId, text, 'master');
          await this.sms.sendSms(`[InsightPlugIn] Comment queued for ${this.getSessionLabel(sessionId)}.`);
        }
      }
      return;
    }

    const active = this.sessions.getActiveSession();
    if (active) {
      this.sessions.queueInjection(active.id, normalized, source === 'sms' ? 'master' : 'master');
      await this.sms.sendSms(`[InsightPlugIn] Command queued for ${active.label}.`);
    }
  }

  async openMasterAgent(source: MasterAgentActivationSource = 'manual'): Promise<void> {
    await this.writeMasterContext();

    const prompt = this.buildMasterPrompt(source);
    await vscode.env.clipboard.writeText(prompt);

    const opened = await this.tryOpenCursorAgent(prompt);
    if (!opened) {
      void vscode.window.showInformationMessage(
        'InsightPlugIn: Master Agent context copied. Open a new Cursor agent chat and paste to start.'
      );
    }
  }

  private async writeMasterContext(): Promise<void> {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) {
      return;
    }

    const snapshot = await this.getLatestStatus(true);

    const rulesDir = path.join(workspace, '.cursor', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });

    const active = this.sessions.getActiveSession();
    const content = `# InsightPlugIn Master Agent

You are the Master Agent for InsightPlugIn.

## Responsibilities
- Monitor all open Cursor agent sessions listed below
- Accept owner commands from SMS or the InsightPlugIn toggle
- Add comments/instructions to any session
- Pause, continue, stop, or switch active SMS sessions
- Never expose secrets, tokens, passwords, or raw code in SMS summaries

## Current State
- Scanned at: ${snapshot.scannedAt}
- SMS mode: ${this.sessions.isSmsModeEnabled() ? 'ON' : 'OFF'}
- Master Agent: ${this.sessions.isMasterAgentActive() ? 'ACTIVE' : 'INACTIVE'}
- Active SMS session: ${active?.label ?? 'none'}
- Agent windows: ${snapshot.windowCount}

## Sessions
${snapshot.windows
  .map(
    (window) =>
      `- ${window.label} (${window.id}) status=${window.status} last="${prepareSmsContent(window.lastSummary ?? 'none', 120)}"`
  )
  .join('\n') || '- none'}

## Command Examples
- \`status\`
- \`list\` or \`windows\`
- \`active session-123\`
- \`pause session-123\`
- \`continue session-123\`
- \`stop session-123\`
- \`comment session-123 Ship the fix after tests pass\`
`;

    fs.writeFileSync(path.join(rulesDir, MASTER_RULE_FILENAME), content, 'utf8');
  }

  private buildMasterPrompt(source: MasterAgentActivationSource): string {
    const snapshot = this.agentStatus.buildSnapshot();
    const active = this.sessions.getActiveSession();
    return [
      'You are the InsightPlugIn Master Agent with global visibility over all open Cursor agent sessions.',
      `Activation source: ${source}.`,
      `Scanned at: ${snapshot.scannedAt}.`,
      `Active SMS session: ${active?.label ?? 'none'}.`,
      'Use the session registry below. You may pause, continue, stop, switch active session, and inject comments.',
      'Owner can text MASTER: status or MASTER: list to fetch live window status.',
      '',
      'Sessions:',
      ...snapshot.windows.map((window) => this.formatWindowLine(window, active?.id)),
      '',
      'When the owner sends SMS commands, treat them as high-priority instructions.',
    ].join('\n');
  }

  private formatWindowLine(
    window: { label: string; id: string; status: string; lastSummary?: string },
    activeSessionId?: string
  ): string {
    const active = window.id === activeSessionId ? ' | smsActive=true' : '';
    const summary = window.lastSummary ? ` | last="${prepareSmsContent(window.lastSummary, 120)}"` : '';
    return `- ${window.label} | id=${window.id} | status=${window.status}${active}${summary}`;
  }

  private async tryOpenCursorAgent(prompt: string): Promise<boolean> {
    const candidates = [
      'composer.startComposerPrompt',
      'cursor.openComposer',
      'aichat.newchataction',
      'workbench.action.chat.open',
    ];

    for (const command of candidates) {
      try {
        await vscode.commands.executeCommand(command, prompt);
        return true;
      } catch {
        // Try next known command name across Cursor/VS Code versions.
      }
    }
    return false;
  }

  private resolveSessionToken(token: string): string | undefined {
    const sessions = this.sessions.listSessions();
    return (
      sessions.find((session) => session.id === token)?.id ??
      sessions.find((session) => session.label.toLowerCase() === token.toLowerCase())?.id ??
      sessions.find((session) => session.id.endsWith(token))?.id
    );
  }

  private getSessionLabel(sessionId: string): string {
    return this.sessions.listSessions().find((session) => session.id === sessionId)?.label ?? sessionId;
  }

  async getLatestStatus(refresh = true) {
    return refresh ? this.agentStatus.refreshDiscoveredWindows() : this.agentStatus.buildSnapshot();
  }

  async getWindowsList(refresh = true) {
    const snapshot = await this.getLatestStatus(refresh);
    return snapshot.windows;
  }

  private async sendStatusSms(): Promise<void> {
    const snapshot = await this.getLatestStatus(true);
    await this.sms.sendSms(this.agentStatus.getDiscovery().formatStatusSms(snapshot));
  }

  private async sendWindowsListSms(): Promise<void> {
    const snapshot = await this.getLatestStatus(true);
    await this.sms.sendSms(this.agentStatus.getDiscovery().formatWindowsListSms(snapshot));
  }
}
