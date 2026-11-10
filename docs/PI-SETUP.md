# Pinion auf dem Raspberry Pi

```
 Laptop / Handy (Tailscale)               Raspberry Pi 5 (Tailscale)
 ┌──────────────────────┐   SSH (stdio)   ┌──────────────────────────────────────┐
 │ Claude Desktop/Code  │────────────────▶│ pinion mcp      (bei Bedarf)     │
 │                      │                 │ pinion-worker   (systemd, immer) │
 │ Browser 127.0.0.1    │──ssh -L 8787──▶ │ pinion connect  (nur zum Verbinden)
 └──────────────────────┘                 │ SQLite /var/lib/pinion           │
                                          │ Backup täglich 03:15 ──────────────▶ NAS
                                          └──────────────────────────────────────┘
 Nichts ist öffentlich erreichbar. Alles läuft über dein Tailnet.
```

| Pfad | Inhalt |
|---|---|
| `/opt/pinion` | Code, gebaut nach `dist/`, `.env` (nur User `pinion`, chmod 600) |
| `/var/lib/pinion/pinion.db` | Datenbank (Tokens AES-256-GCM-verschlüsselt) |
| `/var/lib/pinion/backups/` | tägliche Backups |
| `/usr/local/bin/pinion` | Befehl für alles Weitere |

## 1. Installieren (ca. 10 min)

Voraussetzung: Pi 4/5 mit **Raspberry Pi OS 64-bit**, per SSH erreichbar. Pinion braucht ca. 150 MB RAM und läuft problemlos neben NAS und Plex.

**Tailscale** (falls noch nicht auf dem Pi): `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up --ssh`. Mit `--ssh` brauchst du keine SSH-Keys, Tailscale regelt den Zugang. Den Namen des Pi zeigt `tailscale status` (z.B. `pi`, voll `pi.<tailnet>.ts.net`). Im Folgenden steht `<pi>` dafür.

```bash
ssh <user>@<pi>
git clone https://github.com/<owner>/pinion.git && cd pinion
sudo ./deploy/install.sh
exit                      # einmal neu einloggen, damit die Gruppe "pinion" aktiv wird
```

Das Skript installiert Node 22, legt den System-User `pinion` an, baut, migriert die DB, erzeugt den Verschlüsselungs-Schlüssel und startet den Worker.

> ⚠ `TOKEN_ENC_KEY` aus `/opt/pinion/.env` in den Passwortmanager kopieren (`sudo cat /opt/pinion/.env | grep TOKEN`). Ohne ihn lassen sich Backups nicht entschlüsseln.

## 2. Accounts verbinden

```bash
# Laptop: Tunnel öffnen und auf dem Pi den Connect-Server starten
ssh -L 8787:127.0.0.1:8787 <user>@<pi> -t pinion connect
# Browser auf dem Laptop: http://127.0.0.1:8787
```

| Plattform | Was du brauchst | Wo |
|---|---|---|
| **Bluesky** | Handle + App-Passwort | bsky.app → Einstellungen → Datenschutz und Sicherheit → App-Passwörter |
| **Dev.to** | API-Key | dev.to/settings/extensions → DEV Community API Keys |
| **LinkedIn** | Client-ID + Secret in `.env` | siehe unten |
| Threads, X | wie LinkedIn, Redirect muss öffentlich per HTTPS erreichbar sein | Etappe 4, kurz per `tailscale funnel 8787` nur während des Verbindens |
| Reddit | API-Antrag (Responsible Builder Policy) | reddit.com/wiki/api |

### Bluesky-App-Passwort (2 min)
1. bsky.app → **Einstellungen → Datenschutz und Sicherheit → App-Passwörter → Hinzufügen**
2. Name `Pinion`, „Zugriff auf Direktnachrichten“ **nicht** anhaken
3. Passwort (`xxxx-xxxx-xxxx-xxxx`) ins Connect-Formular kopieren. Widerrufen geht jederzeit an derselben Stelle.

### LinkedIn-App (10 min)
1. [linkedin.com/developers/apps](https://www.linkedin.com/developers/apps) → **Create app**. LinkedIn verlangt eine Company Page als Besitzer: eine eigene, leere Seite reicht (z.B. „sweber.dev“).
2. Tab **Products**: „Sign In with LinkedIn using OpenID Connect“ und „Share on LinkedIn“ anfordern (werden meist sofort freigegeben).
3. Tab **Auth** → Authorized redirect URLs: `http://localhost:8787/callback/linkedin`
4. Client ID und Primary Client Secret eintragen:
   ```bash
   sudo -u pinion nano /opt/pinion/.env     # LINKEDIN_CLIENT_ID=… / LINKEDIN_CLIENT_SECRET=…
   ```
5. `pinion connect` neu starten, im Browser auf „linkedin“ klicken. Der Token gilt 60 Tage, danach einmal neu verbinden.

Der Redirect auf `localhost` funktioniert, weil der Browser über den SSH-Tunnel mit dem Pi spricht. Dafür muss nichts öffentlich sein.

Prüfen: `pinion status`

## 3. Claude einbinden (MCP über SSH)

Voraussetzung: SSH ohne Passwortabfrage. Mit `tailscale up --ssh` ist das schon erledigt, sonst `ssh-copy-id <user>@<pi>`.

**Claude Code**
```bash
claude mcp add pinion -- ssh -T <user>@<pi> pinion mcp
```

**Claude Desktop** (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "pinion": { "command": "ssh", "args": ["-T", "<user>@<pi>", "pinion", "mcp"] }
  }
}
```

## 4. Prüfpunkt Etappe 1

```text
Claude: „Leg für Bluesky Slots Di/Do 09:00 an und plane einen kurzen Post über Pinion.“
Claude: „Plane auf LinkedIn einen Post für morgen 08:30.“
```
`pinion logs` zeigt `✅ … veröffentlicht: <URL>` → Etappe 1 erledigt.

## Alltag

| Befehl | Zweck |
|---|---|
| `pinion status` | Accounts, Queue, letzte Fehler |
| `pinion review i` | Freigaben (Reddit, Dev.to, Antworten) interaktiv |
| `pinion logs` | Worker-Log live |
| `pinion backup` | Backup sofort |
| `cd ~/pinion && git pull && sudo ./deploy/install.sh` | Update |

**Wiederherstellen:** `sudo systemctl stop pinion-worker`, Backup nach `/var/lib/pinion/pinion.db` kopieren (Owner `pinion`), Worker starten. Gleicher `TOKEN_ENC_KEY` nötig.

## Backup aufs NAS

Die SD-Karte ist der Teil, der am ehesten kaputtgeht. Deshalb sollten die Backups aufs NAS gehen.

1. NAS-Freigabe auf dem Pi einhängen, z.B. per `/etc/fstab` (NFS oder SMB). Wichtig ist, dass der User `pinion` darin schreiben darf. Bei SMB geht das mit `uid=pinion,gid=pinion`.
2. `sudo mkdir -p /mnt/nas/backups/pinion && sudo chown pinion: /mnt/nas/backups/pinion`
3. In `/opt/pinion/.env`: `BACKUP_DIR=/mnt/nas/backups/pinion`
4. `sudo ./deploy/install.sh` erneut ausführen (gibt dem Backup-Dienst Schreibrecht), testen mit `pinion backup`

Hängt das NAS beim Backup nicht, lässt systemd den Lauf aus und holt ihn nach (`Persistent=true`).

**SD-Karte:** SQLite im WAL-Modus schreibt wenig. Läuft auf dem Pi 5 aber ohnehin schon Plex, lohnt sich eine NVMe-SSD (Pi-5-HAT) fürs System, weil sie langlebiger und schneller ist.
