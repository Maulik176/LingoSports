# LingoSports Web (Next.js App Router)

This app is the hackathon UI for the multilingual realtime sports engine.

## Run

```bash
cd /Users/maulikranadive176/Desktop/RealTime-Sports-Engine/LingoSports/apps/web
npm install
npm run dev
```

The app expects the backend to run on `http://127.0.0.1:8002` and websocket at `ws://127.0.0.1:8002/ws`.

## Localization Files

- Source locale: `apps/web/messages/en.json`
- Target locales: `apps/web/messages/{es,fr,de,hi,ar,ja,pt}.json`
- Lingo config: `/Users/maulikranadive176/Desktop/RealTime-Sports-Engine/LingoSports/i18n.json`

## Lingo CLI Workflow

```bash
cd /Users/maulikranadive176/Desktop/RealTime-Sports-Engine/LingoSports
npm run locales:check
npm run lingo:run
npm run lingo:check
```

## MCP Workflow Notes

Use Lingo MCP to accelerate localization implementation in IDE agents. Keep the MCP working directory at:

`/Users/maulikranadive176/Desktop/RealTime-Sports-Engine/LingoSports/apps/web`

Suggested MCP prompts during iteration:

1. "Create locale-aware App Router navigation for `/[locale]` and preserve selected locale."
2. "Add new UI copy keys to `apps/web/messages/en.json` and propagate to all targets."
3. "Refactor untranslated hard-coded strings into dictionary keys."
4. "Generate localized copy for match detail, commentary filters, and metrics dashboard labels."

If your MCP host requires explicit server registration, use the official command from the latest Lingo MCP docs: [Lingo MCP](https://lingo.dev/en/mcp).
