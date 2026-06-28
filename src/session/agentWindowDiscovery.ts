import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { AgentSession, SessionStatus } from '../types';
import { isPathWithinRoot } from '../security/validation';
import { prepareSmsContent } from '../processing/redactor';

export interface AgentWindowSnapshot {
  id: string;
  label: string;
  transcriptPath: string;
  status: SessionStatus;
  lastMessageAt?: string;
  lastSummary?: string;
  lastRole?: 'user' | 'assistant';
  updatedAt: string;
}

export interface AgentStatusSnapshot {
  scannedAt: string;
  smsModeEnabled: boolean;
  masterAgentActive: boolean;
  masterActivationSource?: string;
  activeSessionId?: string;
  activeSessionLabel?: string;
  windowCount: number;
  windows: AgentWindowSnapshot[];
}

interface ParsedTranscriptTail {
  lastRole?: 'user' | 'assistant';
  lastText?: string;
  lastMessageAt?: string;
}

const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

export class AgentWindowDiscovery {
  getTranscriptRoots(): string[] {
    const roots: string[] = [];
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspace) {
      const encoded = workspace.replace(/[:\\]/g, (match) => (match === ':' ? '' : '-')).replace(/\\/g, '-');
      const projectRoot = path.join(os.homedir(), '.cursor', 'projects', encoded, 'agent-transcripts');
      if (fs.existsSync(projectRoot)) {
        roots.push(projectRoot);
      }
    }

    const projectsRoot = path.join(os.homedir(), '.cursor', 'projects');
    if (fs.existsSync(projectsRoot)) {
      for (const entry of fs.readdirSync(projectsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const transcriptDir = path.join(projectsRoot, entry.name, 'agent-transcripts');
        if (fs.existsSync(transcriptDir)) {
          roots.push(transcriptDir);
        }
      }
    }

    return [...new Set(roots)];
  }

  discoverWindows(): AgentWindowSnapshot[] {
    const windows: AgentWindowSnapshot[] = [];
    const seenPaths = new Set<string>();

    for (const root of this.getTranscriptRoots()) {
      for (const file of this.collectJsonlFiles(root)) {
        if (seenPaths.has(file)) {
          continue;
        }
        seenPaths.add(file);

        const snapshot = this.buildWindowSnapshot(file);
        if (snapshot) {
          windows.push(snapshot);
        }
      }
    }

    return windows.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  buildStatusSnapshot(
    smsModeEnabled: boolean,
    masterAgentActive: boolean,
    masterActivationSource: string | undefined,
    activeSessionId: string | undefined,
    activeSessionLabel: string | undefined,
    registeredSessions: AgentSession[]
  ): AgentStatusSnapshot {
    const discovered = this.discoverWindows();
    const merged = this.mergeWithRegisteredSessions(discovered, registeredSessions);

    return {
      scannedAt: new Date().toISOString(),
      smsModeEnabled,
      masterAgentActive,
      masterActivationSource,
      activeSessionId,
      activeSessionLabel,
      windowCount: merged.length,
      windows: merged,
    };
  }

  mergeWithRegisteredSessions(
    discovered: AgentWindowSnapshot[],
    registeredSessions: AgentSession[]
  ): AgentWindowSnapshot[] {
    const byTranscript = new Map<string, AgentWindowSnapshot>();
    for (const window of discovered) {
      byTranscript.set(window.transcriptPath, window);
    }

    for (const session of registeredSessions) {
      if (session.transcriptPath && byTranscript.has(session.transcriptPath)) {
        const existing = byTranscript.get(session.transcriptPath)!;
        existing.id = session.id;
        existing.label = session.label;
        existing.status = session.status;
        if (session.isSmsActive) {
          existing.status = session.status;
        }
        if (session.lastSummary) {
          existing.lastSummary = session.lastSummary;
        }
        if (session.lastMessageAt) {
          existing.lastMessageAt = session.lastMessageAt;
        }
        continue;
      }

      byTranscript.set(session.transcriptPath ?? session.id, {
        id: session.id,
        label: session.label,
        transcriptPath: session.transcriptPath ?? '',
        status: session.status,
        lastMessageAt: session.lastMessageAt,
        lastSummary: session.lastSummary,
        updatedAt: session.updatedAt,
      });
    }

    return [...byTranscript.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  formatStatusText(snapshot: AgentStatusSnapshot): string {
    const lines = [
      `Scanned: ${snapshot.scannedAt}`,
      `SMS mode: ${snapshot.smsModeEnabled ? 'ON' : 'OFF'}`,
      `Master Agent: ${snapshot.masterAgentActive ? 'ACTIVE' : 'INACTIVE'}${
        snapshot.masterActivationSource ? ` (${snapshot.masterActivationSource})` : ''
      }`,
      `Active SMS session: ${snapshot.activeSessionLabel ?? 'none'}`,
      `Agent windows: ${snapshot.windowCount}`,
    ];

    for (const window of snapshot.windows) {
      const marker = window.id === snapshot.activeSessionId ? '*' : '-';
      const summary = window.lastSummary ? ` | ${window.lastSummary}` : '';
      lines.push(`${marker} ${window.label} (${window.id}) status=${window.status}${summary}`);
    }

    if (snapshot.windows.length === 0) {
      lines.push('No agent windows discovered.');
    }

    return lines.join('\n');
  }

  formatWindowsList(snapshot: AgentStatusSnapshot): string {
    if (snapshot.windows.length === 0) {
      return 'No agent windows discovered.';
    }

    return snapshot.windows
      .map((window, index) => {
        const active = window.id === snapshot.activeSessionId ? ' [ACTIVE SMS]' : '';
        const summary = window.lastSummary ? ` — ${window.lastSummary}` : '';
        return `${index + 1}. ${window.label} (${window.id}) status=${window.status}${active}${summary}`;
      })
      .join('\n');
  }

  formatStatusSms(snapshot: AgentStatusSnapshot): string {
    const header = `[InsightPlugIn] SMS=${snapshot.smsModeEnabled ? 'ON' : 'OFF'} Master=${
      snapshot.masterAgentActive ? 'ON' : 'OFF'
    } Active=${snapshot.activeSessionLabel ?? 'none'}`;

    if (snapshot.windows.length === 0) {
      return `${header} | No windows`;
    }

    const lines = snapshot.windows.slice(0, 5).map((window) => {
      const marker = window.id === snapshot.activeSessionId ? '*' : '-';
      return `${marker}${window.label}:${window.status}`;
    });

    const suffix = snapshot.windows.length > 5 ? ` +${snapshot.windows.length - 5} more` : '';
    return `${header} | ${lines.join(' | ')}${suffix}`;
  }

  formatWindowsListSms(snapshot: AgentStatusSnapshot): string {
    if (snapshot.windows.length === 0) {
      return '[InsightPlugIn] No agent windows found.';
    }

    const lines = snapshot.windows.slice(0, 8).map((window, index) => {
      const marker = window.id === snapshot.activeSessionId ? '*' : '';
      return `${index + 1}${marker})${window.label}:${window.status}`;
    });

    const suffix = snapshot.windows.length > 8 ? ` +${snapshot.windows.length - 8} more` : '';
    return `[InsightPlugIn] Windows (${snapshot.windowCount}): ${lines.join(' | ')}${suffix}`;
  }

  private buildWindowSnapshot(file: string): AgentWindowSnapshot | undefined {
    if (!fs.existsSync(file)) {
      return undefined;
    }

    const allowedRoots = this.getTranscriptRoots();
    if (!allowedRoots.some((root) => isPathWithinRoot(file, root))) {
      return undefined;
    }

    const stat = fs.statSync(file);
    const folderName = path.basename(path.dirname(file));
    const label = `Agent ${folderName.slice(0, 8) || path.basename(file, '.jsonl').slice(0, 8)}`;
    const tail = this.readTranscriptTail(file);
    const status = this.inferStatus(stat.mtimeMs, tail.lastRole);

    return {
      id: folderName || path.basename(file, '.jsonl'),
      label,
      transcriptPath: file,
      status,
      lastMessageAt: tail.lastMessageAt ?? stat.mtime.toISOString(),
      lastSummary: tail.lastText ? prepareSmsContent(this.truncate(tail.lastText, 160), 160) : undefined,
      lastRole: tail.lastRole,
      updatedAt: stat.mtime.toISOString(),
    };
  }

  private inferStatus(lastModifiedMs: number, lastRole?: 'user' | 'assistant'): SessionStatus {
    const ageMs = Date.now() - lastModifiedMs;
    if (ageMs > ACTIVE_WINDOW_MS) {
      return 'idle';
    }
    if (lastRole === 'user') {
      return 'waiting';
    }
    return 'running';
  }

  private readTranscriptTail(file: string): ParsedTranscriptTail {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    const tail: ParsedTranscriptTail = {};

    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        const parsed = JSON.parse(lines[index]) as {
          role?: string;
          timestamp?: string;
          message?: { content?: Array<{ type?: string; text?: string }> };
        };
        const text = (parsed.message?.content ?? [])
          .filter((part) => part.type === 'text' && part.text)
          .map((part) => part.text)
          .join('\n')
          .trim();

        if (!parsed.role || !text) {
          continue;
        }

        tail.lastRole = parsed.role === 'assistant' ? 'assistant' : 'user';
        tail.lastText = text;
        tail.lastMessageAt = parsed.timestamp;
        break;
      } catch {
        // Ignore malformed trailing lines.
      }
    }

    return tail;
  }

  private collectJsonlFiles(root: string): string[] {
    const results: string[] = [];
    const walk = (dir: string) => {
      if (!isPathWithinRoot(dir, root)) {
        return;
      }
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (!isPathWithinRoot(fullPath, root)) {
          continue;
        }
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          results.push(fullPath);
        }
      }
    };
    walk(root);
    return results;
  }

  private truncate(text: string, maxLength: number): string {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) {
      return cleaned;
    }
    return `${cleaned.slice(0, maxLength - 3).trim()}...`;
  }
}
