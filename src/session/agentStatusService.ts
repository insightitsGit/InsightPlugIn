import * as vscode from 'vscode';
import { AgentWindowDiscovery, AgentStatusSnapshot } from '../session/agentWindowDiscovery';
import { SessionManager } from '../session/sessionManager';

export class AgentStatusService {
  private readonly discovery = new AgentWindowDiscovery();

  constructor(private readonly sessions: SessionManager) {}

  getDiscovery(): AgentWindowDiscovery {
    return this.discovery;
  }

  refreshDiscoveredWindows(): AgentStatusSnapshot {
    const discovered = this.discovery.discoverWindows();
    this.syncSessionsFromWindows(discovered);
    return this.buildSnapshot();
  }

  buildSnapshot(): AgentStatusSnapshot {
    const state = this.sessions.getState();
    const active = this.sessions.getActiveSession();
    return this.discovery.buildStatusSnapshot(
      this.sessions.isSmsModeEnabled(),
      this.sessions.isMasterAgentActive(),
      state.masterAgent.activationSource,
      state.activeSessionId,
      active?.label,
      this.sessions.listSessions()
    );
  }

  private syncSessionsFromWindows(windows: ReturnType<AgentWindowDiscovery['discoverWindows']>): void {
    for (const window of windows) {
      if (!window.transcriptPath) {
        continue;
      }

      const existing = this.sessions
        .listSessions()
        .find((session) => session.transcriptPath === window.transcriptPath);

      if (existing) {
        this.sessions.updateSessionFromDiscovery(existing.id, {
          status: window.status,
          lastSummary: window.lastSummary,
          lastMessageAt: window.lastMessageAt,
        });
        continue;
      }

      this.sessions.registerSession(window.label, window.transcriptPath);
      const registered = this.sessions
        .listSessions()
        .find((session) => session.transcriptPath === window.transcriptPath);
      if (registered) {
        this.sessions.updateSessionFromDiscovery(registered.id, {
          status: window.status,
          lastSummary: window.lastSummary,
          lastMessageAt: window.lastMessageAt,
        });
      }
    }
  }
}
