# AI / LLM context — InsightPlugIn

> Concise reference for humans and coding assistants.
> Do not invent APIs beyond this file and the package/repo source.
> Package: **`insight-plugin (VS Code/Cursor extension)` 0.1.0** · Import: **`N/A (extension)`**

---

## 10-sentence project summary

1. Local Cursor/VS Code extension for SMS remote control of agent sessions (Twilio, Sinch, SMS8) with a Master Agent.
2. Primary users: Developers who want to drive Cursor agent sessions from SMS.
3. Core problem: Cannot monitor or steer agent windows while away from the IDE.
4. Install/use from the repository README — do not invent extra CLI flags here.
5. Key surface: Extension UI + SMS commands (MASTER, pause/continue/stop). See README.
6. Compared with: manual IDE use · other remote-dev tools.
7. When NOT to use: You do not use Cursor/VS Code agents or SMS control.
8. Read architecture.md for stack placement.
9. Prefer facts from README / existing docs over marketing inference.
10. If an API is not listed in README or source, assume it does not exist.

---

## Core concepts

See README for product-specific terms. Keep terminology consistent with that file.

---

## Key APIs

```
Extension UI + SMS commands (MASTER, pause/continue/stop). See README.
```

---

## Common use cases

- Cannot monitor or steer agent windows while away from the IDE.
- See README examples and any `examples/` folder in the repo.

---

## Migration guidance

Start from the closest tool in: manual IDE use · other remote-dev tools. Follow README install and examples. Do not invent migration scripts that are not in the repo.

---

## Limitations / when NOT to use

- You do not use Cursor/VS Code agents or SMS control.
- Do not invent capabilities beyond README and source.

---

## Frequently compared projects

| Notes |
|-------|
| manual IDE use · other remote-dev tools |

---

## Links

- [ai-overview.md](ai-overview.md) · [llm-context.md](llm-context.md) · [architecture.md](architecture.md)
- ../README.md
