# ReachPilot – Planung

Self-hosted Plattform, die über einen MCP-Server Inhalte für X, LinkedIn, Threads und Reddit plant, zu festen Slots publiziert und Antworten auf eigene Posts in eine Freigabe-Queue holt.

## 1. Prinzipien

1. **Nur offizielle APIs.** Kein Scraping, keine Browser-Automation, keine inoffiziellen Endpunkte. Das ist nicht nur Policy, sondern Account-Schutz: ein gesperrter Account hat null Reichweite.
2. **Reichweite durch Konsistenz, nicht Volumen.** Fixe Slots, plattformnativer Content, Antworten auf die eigene Community. Konservative Tageslimits weit unter den API-Limits.
3. **Mensch im Loop für Interaktion.** Eigene Posts darf der Agent planen. Antworten erstellt er nur als Entwurf; freigegeben wird ausserhalb des MCP-Servers (`npm run review`), damit ein Agent sich nicht selbst freigeben kann.
4. **Bewusst nicht im Scope:** Auto-Likes, Auto-Follows, Votes, unaufgeforderte Kommentare unter fremden Posts per Keyword-Suche, Crossposting identischer Texte. Genau das verbieten die Plattformen und erkennen es zuverlässig.
5. **Datenhoheit.** SQLite lokal, OAuth-Tokens AES-256-GCM-verschlüsselt, Audit-Log für jede Aktion.

## 2. Plattform-Realität (Stand Nov. 2026)

| Plattform | Zugang | Kosten | Posten | Antworten | Inbox lesen |
|---|---|---|---|---|---|
| **X** | Developer Console, OAuth 2.0 + PKCE | Pay-per-use seit Feb. 2026, kein Free Tier – jeder Post und jeder Read kostet | ✅ | ✅ (im eigenen Thread) | ✅, aber kostenpflichtig → `INBOX_POLL_X=false` als Default |
| **LinkedIn** | Self-Serve „Share on LinkedIn“ (`w_member_social`) | gratis | ✅ eigenes Profil | ❌ ohne Community Management API | ❌ ohne Community Management API |
| **Threads** | Meta App, Threads-Use-Case | gratis | ✅ (max. 250/24 h) | ✅ (max. 1000/24 h) | ✅ |
| **Reddit** | Seit Nov. 2025 Antrag nötig (Responsible Builder Policy) | gratis, kommerziell separat | ✅ nach Freigabe | ✅ nach Freigabe | ✅ nach Freigabe |

Konsequenzen:
- **Reddit-Antrag sofort stellen** (Use Case ehrlich beschreiben: eigener Scheduler, Mensch gibt frei, keine Vote-Manipulation). Bis dahin ist der Connector fertig, aber inaktiv.
- **LinkedIn Company Pages** und Kommentar-Management brauchen die Community Management API (Review, für Einzelpersonen meist nicht erhältlich). Phase 1 = persönliches Profil.
- **X-Kosten budgetieren:** Posten ist günstig, Lesen summiert sich. Inbox-Polling nur gezielt aktivieren.
- **Threads** verlangt HTTPS-Redirect-URIs → im Dev ein Tunnel (`cloudflared` oder `ngrok`).

## 3. Architektur

```
 Claude (Desktop / Code)
        │  MCP (stdio)
        ▼
 ┌──────────────┐   schreibt    ┌───────────────┐   liest/claimt   ┌──────────────┐
 │  MCP-Server  │──────────────▶│  SQLite (WAL) │◀─────────────────│    Worker    │
 │  10 Tools    │               │ accounts      │                  │ Tick 30 s    │
 └──────────────┘               │ posting_slots │                  │ Retry/Backoff│
                                │ posts         │                  │ Inbox-Poll   │
 ┌──────────────┐   Tokens      │ inbox_items   │                  └──────┬───────┘
 │ OAuth-Server │──────────────▶│ audit_log     │                         │
 │ (Hono)       │               └───────────────┘                         ▼
 └──────────────┘                       ▲                    Connectors: X · LinkedIn
                                        │                                Threads · Reddit
 ┌──────────────┐   approve/reject      │
 │ review-CLI   │───────────────────────┘
 └──────────────┘
```

Drei Prozesse teilen sich eine SQLite-Datei: MCP-Server (von Claude gestartet), Worker (dauerhaft), OAuth-Server (nur zum Verbinden).

## 4. Datenmodell

- **accounts** – Plattform, Handle, externe User-ID, verschlüsselte Tokens, Ablaufdatum, Zeitzone
- **posting_slots** – Wochentag (1 = Mo … 7 = So) + Uhrzeit pro Account
- **posts** – eigene Posts *und* Antworten (`kind`), Status-Maschine: `pending_approval → scheduled → publishing → published | failed | cancelled`, plus Versuche, nächster Versuch, Content-Hash
- **inbox_items** – Antworten anderer auf eigene Posts (`new → drafted → answered | dismissed`)
- **audit_log** – wer (mcp/cli/worker/auth) hat wann was ausgelöst

## 5. MCP-Tools

| Tool | Zweck |
|---|---|
| `list_accounts` | Accounts inkl. Fähigkeiten und Limits |
| `get_posting_slots` / `set_posting_slots` | Regelmässigkeit festlegen |
| `schedule_post` | Post in nächsten freien Slot oder zu Zeitpunkt planen |
| `update_post` / `cancel_post` | Planung anpassen |
| `list_posts` | Queue und Verlauf |
| `list_inbox` / `dismiss_inbox_item` | Antworten auf eigene Posts |
| `draft_reply` | Antwort-Entwurf → Freigabe-Queue |

## 6. Guardrails (src/scheduler/policy.ts)

- Zeichenlimits pro Plattform, Reddit braucht Titel + Subreddit
- Tageslimits (Posts und Antworten getrennt) in der Account-Zeitzone
- Mindestabstand zwischen Posts (X 90 min, Threads 120 min, LinkedIn/Reddit 12 h)
- Duplikat-Sperre 30 Tage (bei Reddit über alle Reddit-Accounts hinweg)
- Worker: atomarer Claim, Retry nur bei 429/5xx mit Backoff, hängende Posts werden nie blind wiederholt (Doppelpost-Schutz)

## 7. Roadmap

**Phase 0 – Setup (1–2 Tage)**
Developer-Apps bei X, LinkedIn, Meta anlegen · Reddit-Antrag stellen · Tunnel für HTTPS · Accounts verbinden

**Phase 1 – MVP Scheduling (dieses Scaffold)**
X, Threads, LinkedIn posten über Slots · Claude Desktop/Code als Oberfläche

**Phase 2 – Engagement**
Inbox für Threads/Reddit (X optional) · Antwort-Entwürfe mit Freigabe · Benachrichtigung bei neuen Antworten (z.B. ntfy/Telegram)

**Phase 3 – Lernen & Medien**
Metriken pro Post abholen (Impressions, Replies) · Tool `get_performance` damit Claude Slots/Themen datenbasiert anpasst · Bilder/Carousels · Threads-Serien auf X

**Phase 4 – Produktiv/Remote**
MCP über Streamable HTTP + OAuth, damit es auch in claude.ai / mobil nutzbar ist · kleines Web-Dashboard für Freigaben · Postgres + Deployment auf Schweizer Hosting · ggf. Multi-User

## 8. Offene Entscheidungen

- Persönliche Accounts oder (später) Firmen-Accounts? → bestimmt, ob LinkedIn Community Management nötig wird
- Nur Eigengebrauch oder als Produkt? → Multi-Tenancy, Reddit-Commercial-Approval, X-Kostenmodell
- Freigabe-Oberfläche: CLI reicht für dich allein, für Mobile lohnt sich Phase 4 früher
