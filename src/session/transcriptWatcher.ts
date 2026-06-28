import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SessionManager } from '../session/sessionManager';
import { SmsService } from '../sms/smsService';
import { sanitizeErrorMessage } from '../security/errorSanitizer';
import { formatAgentSmsSummary } from '../processing/summarizer';
import { AgentWindowDiscovery } from './agentWindowDiscovery';

interface TranscriptMessage {
  role: string;
  text: string;
}

export class TranscriptWatcher implements vscode.Disposable {
  private watcher: fs.FSWatcher | undefined;
  private readonly offsets = new Map<string, number>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly discovery = new AgentWindowDiscovery();

  constructor(
    private readonly sessions: SessionManager,
    private readonly sms: SmsService,
    private readonly onStateChange: () => void
  ) {}

  start(): void {
    const roots = this.discovery.getTranscriptRoots();
    if (roots.length === 0) {
      return;
    }

    for (const root of roots) {
      this.scanExisting(root);
    }

    this.watcher = fs.watch(roots[0], { recursive: true }, (_event, filename) => {
      if (!filename || !String(filename).endsWith('.jsonl')) {
        return;
      }
      const fullPath = path.join(roots[0], String(filename));
      this.scheduleProcess(fullPath);
    });
  }

  dispose(): void {
    this.watcher?.close();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
  }

  private scanExisting(root: string): void {
    for (const window of this.discovery.discoverWindows()) {
      if (!window.transcriptPath.startsWith(root)) {
        continue;
      }
      this.initializeOffset(window.transcriptPath);
      this.sessions.registerSession(window.label, window.transcriptPath);
      this.onStateChange();
    }
  }

  private initializeOffset(file: string): void {
    if (!this.offsets.has(file)) {
      this.offsets.set(file, fs.statSync(file).size);
    }
  }

  private registerSessionForTranscript(file: string): void {
    const window = this.discovery.discoverWindows().find((item) => item.transcriptPath === file);
    const label = window?.label ?? `Agent ${path.basename(path.dirname(file)).slice(0, 8)}`;
    this.sessions.registerSession(label, file);
    this.onStateChange();
  }

  private scheduleProcess(file: string): void {
    const existing = this.debounceTimers.get(file);
    if (existing) {
      clearTimeout(existing);
    }
    this.debounceTimers.set(
      file,
      setTimeout(() => {
        this.processTranscript(file);
      }, 500)
    );
  }

  private processTranscript(file: string): void {
    if (!this.sessions.isSmsModeEnabled()) {
      return;
    }

    if (!fs.existsSync(file)) {
      return;
    }

    this.registerSessionForTranscript(file);

    const previousOffset = this.offsets.get(file) ?? 0;
    const content = fs.readFileSync(file, 'utf8');
    if (content.length <= previousOffset) {
      return;
    }

    const delta = content.slice(previousOffset);
    this.offsets.set(file, content.length);

    const messages = this.parseTranscriptDelta(delta);
    const assistantMessages = messages.filter((message) => message.role === 'assistant' && message.text.trim());
    if (assistantMessages.length === 0) {
      return;
    }

    const latest = assistantMessages[assistantMessages.length - 1].text;
    const session =
      this.sessions.listSessions().find((item) => item.transcriptPath === file) ??
      this.sessions.registerSession(path.basename(file, '.jsonl'), file);

    const active = this.sessions.getActiveSession();
    if (!active || active.id !== session.id) {
      return;
    }

    const config = this.sms.getConfig();
    if (!config) {
      return;
    }

    const summary = formatAgentSmsSummary(session.label, latest, config.summaryMaxLength);
    this.sessions.recordSessionMessage(session.id, summary);

    void this.sms
      .sendSms(summary)
      .then(() => this.onStateChange())
      .catch((error) => {
        const message = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
        void vscode.window.showErrorMessage(`InsightPlugIn failed to send SMS: ${message}`);
      });
  }

  private parseTranscriptDelta(delta: string): TranscriptMessage[] {
    const messages: TranscriptMessage[] = [];
    for (const line of delta.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as {
          role?: string;
          message?: { content?: Array<{ type?: string; text?: string }> };
        };
        const text = (parsed.message?.content ?? [])
          .filter((part) => part.type === 'text' && part.text)
          .map((part) => part.text)
          .join('\n');
        if (parsed.role && text) {
          messages.push({ role: parsed.role, text });
        }
      } catch {
        // Ignore malformed partial lines while file is being written.
      }
    }
    return messages;
  }
}
