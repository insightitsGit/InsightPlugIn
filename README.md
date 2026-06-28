# InsightPlugIn

Local Cursor extension for **SMS remote control** of agent sessions. Supports **Twilio**, **Sinch**, and **SMS8** as SMS providers, with a **Master Agent** that has global visibility over all open agent windows.

## Features

- Toggle switch for SMS remote mode
- One active SMS-linked session at a time
- Short agent summaries sent to your phone (optional redaction)
- Inbound SMS replies queued for the active session
- Master Agent activated by:
  - SMS remote toggle ON
  - Owner SMS: `MASTER` or `MASTER: <command>`
- Master Agent can pause, continue, stop, switch active session, and inject comments

## SMS Provider Integrations

InsightPlugIn uses a **unified SMS layer** — the same commands, polling, and Master Agent work regardless of which provider you choose. Configure one provider in the Control Center; switch anytime without changing SMS command syntax.

| | **Twilio** | **Sinch** | **SMS8** |
| --- | --- | --- | --- |
| **Type** | Cloud SMS API | Enterprise REST SMS | Android phone gateway |
| **Sender** | Twilio phone number | Sinch sender number | Your paired Android SIM |
| **Auth** | Account SID + Auth Token | Service Plan ID + API Token | API key |
| **Inbound** | REST polling (no webhook required) | REST polling | REST polling (`read-messages.php`) |
| **Best for** | Quick setup, dedicated numbers | Regional enterprise SMS | Own SIM, no A2P 10DLC, flat pricing |
| **Docs** | [twilio.com/docs/sms](https://www.twilio.com/docs/sms) | [developers.sinch.com/docs/sms](https://developers.sinch.com/docs/sms/) | [mcp.sms8.io](https://mcp.sms8.io/sms-api-documentation) |

### Twilio

1. Create a [Twilio](https://www.twilio.com) account and buy or verify a phone number.
2. In Control Center → **Twilio** tab, enter:
   - **Account SID** — Console → Account Info
   - **Auth Token** — stored in OS secret store (not plain settings)
   - **Twilio Phone** — your Twilio number in E.164 (`+15551234567`)
   - **Your Phone** — the mobile device that sends/receives control SMS
3. Save and enable **SMS Remote Mode**.

### Sinch

1. Create a [Sinch](https://sinch.com) account and configure an SMS service plan.
2. In Control Center → **Sinch** tab, enter:
   - **Service Plan ID** — Dashboard → APIs → REST configuration
   - **Sinch API Token** — stored in OS secret store
   - **Region** — US, EU, AU, BR, or CA (matches your Sinch endpoint)
   - **Sinch Phone** — approved sender number in E.164
   - **Your Phone** — authorized control device
3. Save and enable **SMS Remote Mode**.

### SMS8

1. Sign up at [app.sms8.io](https://app.sms8.io) and **pair your Android phone**.
2. Copy your API key from [app.sms8.io/api.php](https://app.sms8.io/api.php).
3. In Control Center → **SMS8** tab, enter:
   - **SMS8 API Key** — stored in OS secret store
   - **Your Phone** — E.164 number that will text the gateway
   - **Device ID** (optional) — leave blank for primary device
   - **SIM Slot** — `0` or `1` on dual-SIM phones
4. Save and enable **SMS Remote Mode**.

Messages route through your Android device. No Twilio-style sender number is required. For high-volume inbound, SMS8 also supports [webhooks](https://mcp.sms8.io/sms-api-documentation); this extension uses **polling** so no public URL is needed.

### Shared settings (all providers)

These apply no matter which provider is active:

| Setting | Purpose |
| --- | --- |
| `userPhoneNumber` | Outbound destination and inbound sender authorization |
| `pollIntervalMs` | How often to check for new inbound SMS |
| `summaryMaxLength` | Max characters in agent summary SMS |
| `authorizedPhoneNumbers` | Additional E.164 numbers allowed to send control SMS |
| `redactSmsContent` | Strip secrets/paths from outbound SMS when enabled |

## Setup

1. Install dependencies:

```bash
npm install
npm run compile
```

2. In Cursor, open the project folder and press `F5` to launch the Extension Development Host.

3. Open the **Control Center** sidebar panel, pick a provider tab, complete the setup checklist, and save.

4. Turn on **SMS Remote Mode**.

## SMS Commands

### Owner → Master Agent

- `MASTER` — activate Master Agent
- `MASTER: status`
- `MASTER: list` or `MASTER: windows`
- `MASTER: active session-123`
- `MASTER: pause session-123`
- `MASTER: continue session-123`
- `MASTER: stop session-123`
- `MASTER: comment session-123 Run tests before commit`

### Normal replies

Any non-`MASTER` SMS while a session is active is treated as a reply to the active agent session.

## Commands

- `InsightPlugIn: Toggle SMS Remote Mode`
- `InsightPlugIn: Open Control Panel`
- `InsightPlugIn: Open Master Agent`
- `InsightPlugIn: Register Current Session`
- `InsightPlugIn: Set Active SMS Session`
- `InsightPlugIn: Inject Pending SMS Reply`
- `InsightPlugIn: Get Agent Status`
- `InsightPlugIn: List Agent Windows`

## Architecture

- Local VS Code/Cursor extension
- Pluggable SMS providers: Twilio SDK, Sinch REST, SMS8 REST
- Local polling for inbound SMS (no hosted webhook required for any provider)
- Cursor agent transcript watcher for outbound summaries
- Master Agent context written to `.cursor/rules/master-agent.mdc`

## Security

InsightPlugIn is designed for enterprise use with defense-in-depth controls:

- **Secret storage**: Twilio, Sinch, and SMS8 API credentials plus the master passphrase are stored in the OS secret store (VS Code `SecretStorage`), not plain settings.
- **Sender validation**: Inbound SMS is accepted only from authorized E.164 numbers (`userPhoneNumber` + `authorizedPhoneNumbers`).
- **Optional master passphrase**: Enable `requireMasterPassphrase` and send `MASTER: <passphrase> <command>`.
- **Optional SMS redaction**: `redactSmsContent` defaults to **false**, so agent replies (including API keys) are sent in SMS as-is, truncated to `summaryMaxLength`. Set to **true** to strip secrets, code blocks, and paths before sending.
- **Rate limits**: Configurable outbound SMS/hour cap and inbound length/queue limits.
- **Audit log**: Security and SMS events are appended to a local JSONL audit log. Open via **InsightPlugIn: Export Audit Log**.
- **Webview hardening**: Strict CSP, cryptographic nonce, DOM-safe rendering, message type allowlist.

See [SECURITY.md](./SECURITY.md) for credential handling per provider and deployment guidance.

### Recommended enterprise settings

```json
{
  "insightPlugin.enforceSenderValidation": true,
  "insightPlugin.requireMasterPassphrase": true,
  "insightPlugin.redactSmsContent": true,
  "insightPlugin.auditLoggingEnabled": true,
  "insightPlugin.storeQueueInWorkspace": false,
  "insightPlugin.maxOutboundSmsPerHour": 120
}
```

## Notes

Cursor does not yet expose a fully public API for injecting prompts into existing agent chats. Pending SMS/master commands are queued locally and copied to the clipboard for injection via **Inject Pending SMS Reply** or paste into chat.
