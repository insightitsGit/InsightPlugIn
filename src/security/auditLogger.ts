import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { redactSensitiveContent } from '../processing/redactor';
import { maskPhoneNumber } from './validation';

export type AuditEventType =
  | 'sms.inbound.accepted'
  | 'sms.inbound.rejected'
  | 'sms.outbound.sent'
  | 'sms.outbound.blocked'
  | 'master.command'
  | 'config.saved'
  | 'sms.mode.enabled'
  | 'sms.mode.disabled'
  | 'injection.queued'
  | 'security.violation';

export interface AuditEvent {
  timestamp: string;
  type: AuditEventType;
  actor?: string;
  detail?: string;
  metadata?: Record<string, string | number | boolean>;
}

const MAX_AUDIT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_AUDIT_ENTRIES = 5000;

export class AuditLogger {
  private readonly auditFile: string;
  private enabled = true;

  constructor(private readonly context: vscode.ExtensionContext) {
    const dir = path.join(context.globalStorageUri.fsPath, 'insight-plugin');
    fs.mkdirSync(dir, { recursive: true });
    this.auditFile = path.join(dir, 'audit.log.jsonl');
    this.enabled = vscode.workspace.getConfiguration('insightPlugin').get<boolean>('auditLoggingEnabled', true);
  }

  refreshSettings(): void {
    this.enabled = vscode.workspace.getConfiguration('insightPlugin').get<boolean>('auditLoggingEnabled', true);
  }

  log(event: Omit<AuditEvent, 'timestamp'>): void {
    if (!this.enabled) {
      return;
    }

    const entry: AuditEvent = {
      timestamp: new Date().toISOString(),
      ...event,
      actor: event.actor ? maskPhoneNumber(event.actor) : undefined,
      detail: event.detail ? redactSensitiveContent(event.detail).slice(0, 500) : undefined,
    };

    try {
      fs.appendFileSync(this.auditFile, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
      this.rotateIfNeeded();
    } catch {
      // Audit logging must never break primary workflows.
    }
  }

  getAuditFilePath(): string {
    return this.auditFile;
  }

  private rotateIfNeeded(): void {
    try {
      const stat = fs.statSync(this.auditFile);
      if (stat.size <= MAX_AUDIT_FILE_BYTES) {
        return;
      }

      const lines = fs.readFileSync(this.auditFile, 'utf8').split('\n').filter(Boolean);
      const trimmed = lines.slice(-MAX_AUDIT_ENTRIES);
      fs.writeFileSync(this.auditFile, `${trimmed.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Ignore rotation failures.
    }
  }
}
