# ReachPilot

Self-hosted Social-Scheduler mit MCP-Server. Claude plant Posts für **X, LinkedIn, Threads und Reddit** in feste Slots, ein Worker publiziert sie pünktlich, Antworten auf eigene Posts landen in einer Inbox und werden nur nach menschlicher Freigabe beantwortet.

Planung, Plattform-Einschränkungen und Roadmap: [`docs/PLAN.md`](docs/PLAN.md)

## Setup

Voraussetzung: Node.js ≥ 22

```bash
npm install
cp .env.example .env
npm run gen:key          # Ausgabe als TOKEN_ENC_KEY in .env eintragen
npm run db:push          # SQLite-Schema anlegen
```

Plattform-Credentials in `.env` eintragen (nur die, die du nutzt). Redirect-URI in jeder Developer-App:
`<PUBLIC_BASE_URL>/callback/<platform>` – z.B. `https://abc.trycloudflare.com/callback/threads`.

```bash
cloudflared tunnel --url http://localhost:8787   # HTTPS-URL als PUBLIC_BASE_URL setzen
npm run auth                                     # dann http://127.0.0.1:8787 öffnen und Accounts verbinden
```

## Betrieb

```bash
npm run worker     # dauerhaft laufen lassen (z.B. pm2, systemd, Docker)
npm run review                                   # wartende Einträge anzeigen
npm run review i                                 # interaktiv: j/n/s/q pro Eintrag
npm run review approve 3f2a9c1b 7d01e4aa         # mehrere per ID-Präfix
npm run review approve --all --platform=threads  # Bulk mit Filter + Bestätigung
npm run review reject --all --kind=reply         # auch Verwerfen geht gebündelt
```

### MCP in Claude einbinden

Claude Code:
```bash
claude mcp add reachpilot -- npx tsx /ABSOLUTER/PFAD/reachpilot/src/mcp/server.ts
```

Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "reachpilot": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTER/PFAD/reachpilot/src/mcp/server.ts"]
    }
  }
}
```

Beispiel-Prompt: *„Leg für meinen X-Account Slots Di/Do 08:30 und Sa 10:00 an und plane drei Posts über mein neues Package für die nächsten Slots.“*

## Struktur

```
src/
  config.ts              Env-Validierung (zod)
  accounts.ts            Token-Laden/Refresh, Account-Upsert
  crypto/tokens.ts       AES-256-GCM für OAuth-Tokens
  db/                    Drizzle-Schema + Client (SQLite, WAL)
  connectors/            x · linkedin · threads · reddit (gemeinsames Interface)
  scheduler/policy.ts    Guardrails: Limits, Abstände, Duplikate
  scheduler/slots.ts     Nächster freier Slot
  worker/index.ts        Publiziert fällige Posts, Retry, Inbox-Polling
  mcp/server.ts          MCP-Tools
  auth/oauth-server.ts   OAuth-Flows (Hono)
  cli/review.ts          Menschliche Freigabe
```

## Neue Plattform hinzufügen

`SocialConnector` aus `src/connectors/types.ts` implementieren, in `connectors/index.ts` registrieren, Plattform in `src/types.ts` und Limits in `policy.ts` ergänzen.
