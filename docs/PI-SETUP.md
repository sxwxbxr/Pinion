# ReachPilot auf dem Raspberry Pi

```
 Laptop                                   Raspberry Pi (64-bit)
 ┌──────────────────────┐   SSH (stdio)   ┌──────────────────────────────────────┐
 │ Claude Desktop/Code  │────────────────▶│ reachpilot mcp      (bei Bedarf)     │
 │                      │                 │ reachpilot-worker   (systemd, immer) │
 │ Browser 127.0.0.1    │──ssh -L 8787──▶ │ reachpilot connect  (nur zum Verbinden)
 └──────────────────────┘                 │ SQLite /var/lib/reachpilot           │
                                          │ Backup täglich 03:15, 14 Stück       │
                                          └──────────────────────────────────────┘
```

| Pfad | Inhalt |
|---|---|
| `/opt/reachpilot` | Code, gebaut nach `dist/`, `.env` (nur User `reachpilot`, chmod 600) |
| `/var/lib/reachpilot/reachpilot.db` | Datenbank (Tokens AES-256-GCM-verschlüsselt) |
| `/var/lib/reachpilot/backups/` | tägliche Backups |
| `/usr/local/bin/reachpilot` | Befehl für alles Weitere |

## 1. Installieren (ca. 10 min)

Voraussetzung: Pi 4/5 mit **Raspberry Pi OS Lite 64-bit** (Raspberry Pi Imager, SSH aktivieren), per SSH erreichbar.

```bash
ssh <user>@<pi>.local
git clone https://github.com/<owner>/reachpilot.git && cd reachpilot
sudo ./deploy/install.sh
exit                      # einmal neu einloggen, damit die Gruppe "reachpilot" aktiv wird
```

Das Skript installiert Node 22, legt den System-User `reachpilot` an, baut, migriert die DB, erzeugt den Verschlüsselungs-Schlüssel und startet den Worker.

> ⚠ `TOKEN_ENC_KEY` aus `/opt/reachpilot/.env` in den Passwortmanager kopieren (`sudo cat /opt/reachpilot/.env | grep TOKEN`). Ohne ihn lassen sich Backups nicht entschlüsseln.

## 2. Accounts verbinden

```bash
# Laptop: Tunnel öffnen und auf dem Pi den Connect-Server starten
ssh -L 8787:127.0.0.1:8787 <user>@<pi>.local -t reachpilot connect
# Browser auf dem Laptop: http://127.0.0.1:8787
```

| Plattform | Was du brauchst | Wo |
|---|---|---|
| **Bluesky** | Handle + App-Passwort | bsky.app → Einstellungen → Datenschutz und Sicherheit → App-Passwörter |
| **Dev.to** | API-Key | dev.to/settings/extensions → DEV Community API Keys |
| **LinkedIn** | Client-ID + Secret in `.env` | linkedin.com/developers → App → Produkte „Sign In with LinkedIn“ + „Share on LinkedIn“; Redirect-URL `http://localhost:8787/callback/linkedin` |
| Threads, X | wie LinkedIn, Redirect muss HTTPS sein | kommt in Etappe 4 mit Cloudflare Tunnel |
| Reddit | API-Antrag (Responsible Builder Policy) | reddit.com/wiki/api |

LinkedIn-Credentials eintragen: `sudo -u reachpilot nano /opt/reachpilot/.env`, danach `sudo systemctl restart reachpilot-worker`.

Prüfen: `reachpilot status`

## 3. Claude einbinden (MCP über SSH)

Voraussetzung: SSH-Login per Key ohne Passwortabfrage (`ssh-copy-id <user>@<pi>.local`).

**Claude Code**
```bash
claude mcp add reachpilot -- ssh -T <user>@<pi>.local reachpilot mcp
```

**Claude Desktop** (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "reachpilot": { "command": "ssh", "args": ["-T", "<user>@<pi>.local", "reachpilot", "mcp"] }
  }
}
```

## 4. Prüfpunkt Etappe 1

```text
Claude: „Leg für Bluesky Slots Di/Do 09:00 an und plane einen kurzen Post über ReachPilot.“
Claude: „Plane auf LinkedIn einen Post für morgen 08:30.“
```
`reachpilot logs` zeigt `✅ … veröffentlicht: <URL>` → Etappe 1 erledigt.

## Alltag

| Befehl | Zweck |
|---|---|
| `reachpilot status` | Accounts, Queue, letzte Fehler |
| `reachpilot review i` | Freigaben (Reddit, Dev.to, Antworten) interaktiv |
| `reachpilot logs` | Worker-Log live |
| `reachpilot backup` | Backup sofort |
| `cd ~/reachpilot && git pull && sudo ./deploy/install.sh` | Update |

**Wiederherstellen:** `sudo systemctl stop reachpilot-worker`, Backup nach `/var/lib/reachpilot/reachpilot.db` kopieren (Owner `reachpilot`), Worker starten. Gleicher `TOKEN_ENC_KEY` nötig.

**SD-Karte:** SQLite im WAL-Modus schreibt wenig, trotzdem ist eine SSD (USB oder NVMe beim Pi 5) langlebiger.
