import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  AgentSession,
  PendingInjection,
  PluginState,
  SessionStatus,
} from '../types';
import { getSecurityPolicy } from '../security/securityPolicy';
import { clampString, isValidSessionId } from '../security/validation';
import { AuditLogger } from '../security/auditLogger';

const STATE_FILE = 'state.json';
const INBOUND_FILE = 'inbound-queue.json';

export class SessionManager {
  private state: PluginState;
  private readonly storageDir: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly audit: AuditLogger
  ) {
    this.storageDir = path.join(context.globalStorageUri.fsPath, 'insight-plugin');
    fs.mkdirSync(this.storageDir, { recursive: true });
    this.state = this.loadState();
  }

  getState(): PluginState {
    return structuredClone(this.state);
  }

  isSmsModeEnabled(): boolean {
    return this.state.smsModeEnabled;
  }

  isMasterAgentActive(): boolean {
    return this.state.masterAgent.active;
  }

  setSmsModeEnabled(enabled: boolean): void {
    this.state.smsModeEnabled = enabled;
    this.persist();
  }

  setMasterAgentActive(active: boolean, source?: PluginState['masterAgent']['activationSource']): void {
    this.state.masterAgent = {
      active,
      activatedAt: active ? new Date().toISOString() : undefined,
      activationSource: active ? source : undefined,
    };
    this.persist();
  }

  listSessions(): AgentSession[] {
    return [...this.state.sessions];
  }

  getActiveSession(): AgentSession | undefined {
    if (!this.state.activeSessionId) {
      return undefined;
    }
    return this.state.sessions.find((session) => session.id === this.state.activeSessionId);
  }

  registerSession(label: string, transcriptPath?: string): AgentSession {
    const safeLabel = clampString(label, 120) || 'Agent Session';
    const existing = this.state.sessions.find((session) => session.transcriptPath === transcriptPath);
    if (existing) {
      existing.label = safeLabel;
      existing.updatedAt = new Date().toISOString();
      this.persist();
      return existing;
    }

    const session: AgentSession = {
      id: `session-${Date.now()}`,
      label: safeLabel,
      transcriptPath,
      status: 'running',
      isSmsActive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.state.sessions.unshift(session);
    this.persist();
    return session;
  }

  setActiveSession(sessionId: string): AgentSession | undefined {
    if (!isValidSessionId(sessionId)) {
      this.audit.log({
        type: 'security.violation',
        detail: `Invalid session id: ${sessionId}`,
      });
      return undefined;
    }
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) {
      return undefined;
    }

    for (const item of this.state.sessions) {
      item.isSmsActive = item.id === sessionId;
    }

    this.state.activeSessionId = sessionId;
    session.updatedAt = new Date().toISOString();
    this.persist();
    return session;
  }

  updateSessionStatus(sessionId: string, status: SessionStatus): void {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    session.status = status;
    session.updatedAt = new Date().toISOString();
    this.persist();
  }

  updateSessionFromDiscovery(
    sessionId: string,
    update: Pick<AgentSession, 'status' | 'lastSummary' | 'lastMessageAt'>
  ): void {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }

    session.status = update.status;
    if (update.lastSummary) {
      session.lastSummary = update.lastSummary;
    }
    if (update.lastMessageAt) {
      session.lastMessageAt = update.lastMessageAt;
    }
    session.updatedAt = new Date().toISOString();
    this.persist();
  }

  recordSessionMessage(sessionId: string, summary: string): void {
    const session = this.state.sessions.find((item) => item.id === sessionId);
    if (!session) {
      return;
    }
    session.lastSummary = summary;
    session.lastMessageAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    this.persist();
  }

  setLastProcessedSmsSid(sid: string): void {
    this.state.lastProcessedSmsSid = sid;
    this.persist();
  }

  getLastProcessedSmsSid(): string | undefined {
    return this.state.lastProcessedSmsSid;
  }

  queueInjection(sessionId: string, text: string, source: PendingInjection['source']): PendingInjection {
    const policy = getSecurityPolicy();
    const safeText = clampString(text, policy.maxInboundSmsLength);
    const queue = this.readInboundQueue();

    if (queue.length >= policy.maxInjectionQueueSize) {
      this.audit.log({
        type: 'security.violation',
        detail: 'Injection queue limit reached',
        metadata: { queueSize: queue.length },
      });
      throw new Error('Pending injection queue is full.');
    }

    const injection: PendingInjection = {
      id: `inj-${Date.now()}`,
      sessionId,
      text: safeText,
      source,
      createdAt: new Date().toISOString(),
    };

    queue.push(injection);
    this.writeInboundQueue(queue);
    this.audit.log({
      type: 'injection.queued',
      detail: safeText,
      metadata: { sessionId, source },
    });
    return injection;
  }

  popNextInjection(sessionId?: string): PendingInjection | undefined {
    const queue = this.readInboundQueue();
    const index = queue.findIndex((item) => !sessionId || item.sessionId === sessionId);
    if (index === -1) {
      return undefined;
    }
    const [injection] = queue.splice(index, 1);
    this.writeInboundQueue(queue);
    return injection;
  }

  getWorkspaceStateFile(): string {
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspace) {
      return path.join(this.storageDir, INBOUND_FILE);
    }
    const dir = path.join(workspace, '.insight-plugin');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, INBOUND_FILE);
  }

  private readInboundQueue(): PendingInjection[] {
    const globalFile = path.join(this.storageDir, INBOUND_FILE);
    const workspaceFile = this.getWorkspaceStateFile();

    for (const file of [globalFile, workspaceFile]) {
      if (fs.existsSync(file)) {
        try {
          return JSON.parse(fs.readFileSync(file, 'utf8')) as PendingInjection[];
        } catch {
          return [];
        }
      }
    }
    return [];
  }

  private writeInboundQueue(queue: PendingInjection[]): void {
    const globalFile = path.join(this.storageDir, INBOUND_FILE);
    fs.writeFileSync(globalFile, JSON.stringify(queue, null, 2), { encoding: 'utf8', mode: 0o600 });

    if (getSecurityPolicy().storeQueueInWorkspace) {
      const workspaceFile = this.getWorkspaceStateFile();
      fs.writeFileSync(workspaceFile, JSON.stringify(queue, null, 2), { encoding: 'utf8', mode: 0o600 });
    }
  }

  private loadState(): PluginState {
    const file = path.join(this.storageDir, STATE_FILE);
    if (!fs.existsSync(file)) {
      return {
        smsModeEnabled: false,
        masterAgent: { active: false },
        sessions: [],
      };
    }

    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as PluginState;
    } catch {
      return {
        smsModeEnabled: false,
        masterAgent: { active: false },
        sessions: [],
      };
    }
  }

  private persist(): void {
    fs.writeFileSync(path.join(this.storageDir, STATE_FILE), JSON.stringify(this.state, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
}
