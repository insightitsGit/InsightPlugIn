# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Reporting a vulnerability

Please report security issues privately to your repository maintainer or organization security contact.

Do not open public GitHub issues for undisclosed vulnerabilities.

## Security architecture

### Credential handling

InsightPlugIn supports three SMS providers. **API credentials for all providers** are stored with VS Code `SecretStorage` (OS keychain/credential manager):

| Provider | Secret storage key | Plain settings (non-secret) |
| -------- | ------------------ | ----------------------------- |
| Twilio | `insightPlugin.twilioAuthToken` | Account SID, Twilio phone number |
| Sinch | `insightPlugin.sinchApiToken` | Service Plan ID, region, sender phone |
| SMS8 | `insightPlugin.sms8ApiKey` | Optional device ID, SIM slot |

Additional notes:

- Legacy `insightPlugin.twilioAuthToken` settings values are migrated to secret storage and cleared.
- Master passphrases are stored in secret storage only.
- Only one provider is active at a time (`insightPlugin.smsProvider`); inactive provider credentials remain in secret storage until cleared.

### Inbound SMS authorization

- When `enforceSenderValidation` is enabled (default), only messages from configured authorized numbers are processed.
- Unauthorized senders are rejected and recorded in the audit log without executing commands.
- Authorization is **provider-agnostic** — the same `userPhoneNumber` and `authorizedPhoneNumbers` list applies to Twilio, Sinch, and SMS8.

### Outbound data minimization

- By default (`redactSmsContent: false`), outbound SMS includes the agent's reply text as-is (including API keys), truncated to `summaryMaxLength`.
- Set `redactSmsContent: true` to strip code blocks, credentials, connection strings, filesystem paths, and phone numbers before SMS send.
- Local audit logs always redact sensitive content on disk regardless of the SMS setting.

### Audit and monitoring

- Audit events are written locally to global extension storage (`audit.log.jsonl`).
- Audit entries redact message bodies and mask phone numbers.
- Use command `InsightPlugIn: Export Audit Log` to review events.

### Rate limiting and abuse controls

- Outbound SMS rate limit (`maxOutboundSmsPerHour`)
- Inbound SMS max length (`maxInboundSmsLength`)
- Pending injection queue cap (`maxInjectionQueueSize`)
- Minimum polling interval (`minPollIntervalMs`)

### Webview security

- Content Security Policy blocks external resources
- Scripts require per-load cryptographic nonce
- Webview messages are type-allowlisted and session IDs validated

## Deployment guidance

1. Enable `requireMasterPassphrase` for production SMS control planes.
2. Keep `storeQueueInWorkspace` disabled unless required for debugging.
3. Restrict authorized phone numbers to known owner devices (`userPhoneNumber` + minimal `authorizedPhoneNumbers`).
4. Rotate provider API credentials on a regular schedule:
   - **Twilio**: regenerate Auth Token in Console
   - **Sinch**: rotate REST API token in Dashboard
   - **SMS8**: regenerate key at app.sms8.io/api.php (old keys invalidate immediately)
5. Review audit logs after enabling SMS mode in shared environments.
6. Choose the provider that matches your compliance needs:
   - **Twilio/Sinch**: cloud-hosted; review their SOC/compliance docs
   - **SMS8**: messages route through your own Android device and carrier

## Known limitations

- SMS is not end-to-end encrypted; treat SMS as a low-trust control channel.
- Clipboard injection requires local user action in the IDE.
- Cursor does not expose a fully public API for direct agent prompt injection.
- SMS8 throughput depends on paired Android device availability and plan limits.
