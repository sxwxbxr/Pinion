# Pinion

Self-hosted Social-Scheduler mit MCP-Server. Claude plant Posts für **X, LinkedIn, Threads, Reddit, Bluesky und Dev.to** in feste Slots, ein Worker publiziert sie pünktlich, Antworten auf eigene Posts landen in einer Inbox und werden nur nach menschlicher Freigabe beantwortet.

Planung, Plattform-Einschränkungen und Roadmap: [`docs/PLAN.md`](docs/PLAN.md)
Reddit-API-Antrag (Entwurf): [`docs/REDDIT-ANTRAG.md`](docs/REDDIT-ANTRAG.md)
Betrieb auf dem Raspberry Pi: [`docs/PI-SETUP.md`](docs/PI-SETUP.md) (`sudo ./deploy/install.sh`)

## Setup

Voraussetzung: Node.js ≥ 22

```bash
npm install
cp .env.example .env
npm run gen:key          # Ausgabe als TOKEN_ENC_KEY in .env eintragen
npm run db:migrate       # SQLite-Schema anlegen/aktualisieren
npm run check            # Typecheck + Tests
```

Plattform-Credentials in `.env` eintragen (nur die, die du nutzt). Redirect-URI in jeder Developer-App:
`<PUBLIC_BASE_URL>/callback/<platform>` – z.B. `https://abc.trycloudflare.com/callback/threads`.

```bash
cloudflared tunnel --url http://localhost:8787   # HTTPS-URL als PUBLIC_BASE_URL setzen
npm run auth                                     # dann http://127.0.0.1:8787 öffnen und Accounts verbinden
                                                 # Bluesky/Dev.to: Formular statt OAuth, kein Tunnel nötig
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
claude mcp add pinion -- npx tsx /ABSOLUTER/PFAD/pinion/src/mcp/server.ts
```

Claude Desktop (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "pinion": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTER/PFAD/pinion/src/mcp/server.ts"]
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
  connectors/            x · linkedin · threads · reddit · bluesky · devto (gemeinsames Interface)
  scheduler/policy.ts    Guardrails: Limits, Abstände, Duplikate
  scheduler/slots.ts     Nächster freier Slot
  worker/index.ts        Publiziert fällige Posts, Retry, Inbox-Polling
  mcp/server.ts          MCP-Tools
  auth/oauth-server.ts   OAuth-Flows (Hono)
  cli/review.ts          Menschliche Freigabe
  cli/status.ts          Überblick (Accounts, Queue, Fehler)
  cli/backup.ts          Online-Backup der SQLite-DB
  db/migrate.ts          Migrationen aus drizzle/ anwenden
deploy/                  install.sh, systemd-Units, pinion-Befehl für den Pi
test/                    node:test (npm test)
```

## Neue Plattform hinzufügen

`SocialConnector` aus `src/connectors/types.ts` implementieren (OAuth: `authorizeUrl`/`exchangeCode`, sonst `credentialFields`/`connectWithCredentials`), in `connectors/index.ts` registrieren, Plattform in `src/types.ts` und Limits in `policy.ts` ergänzen, Test in `test/` schreiben.
