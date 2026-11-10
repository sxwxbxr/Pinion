#!/usr/bin/env bash
# Pinion auf einem Raspberry Pi (Pi 4/5, 64-bit Raspberry Pi OS oder Ubuntu) installieren oder aktualisieren.
# Aufruf aus dem geklonten Repo:   sudo ./deploy/install.sh
# Idempotent: erneut ausführen = Update (Code kopieren, bauen, migrieren, Worker neu starten).
set -euo pipefail

APP_DIR=/opt/pinion
DATA_DIR=/var/lib/pinion
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MAJOR=22
LOGIN_USER="${SUDO_USER:-}"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Bitte mit sudo ausführen: sudo ./deploy/install.sh"
[[ "$(uname -m)" == "aarch64" || "$(uname -m)" == "x86_64" ]] || die "64-bit-System nötig (gefunden: $(uname -m)). Raspberry Pi OS 64-bit installieren."
command -v systemctl >/dev/null || die "systemd nicht gefunden"

say "Systempakete"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git rsync build-essential python3 >/dev/null

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt $NODE_MAJOR ]]; then
  say "Node.js $NODE_MAJOR installieren (NodeSource)"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "Node $(node -v), npm $(npm -v)"

say "Service-User und Verzeichnisse"
id pinion &>/dev/null || useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin pinion
install -d -o pinion -g pinion -m 750 "$APP_DIR" "$DATA_DIR" "$DATA_DIR/backups"
if [[ -n "$LOGIN_USER" && "$LOGIN_USER" != "root" ]]; then
  usermod -aG pinion "$LOGIN_USER"
fi

say "Code nach $APP_DIR kopieren"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude data --exclude .git --exclude .env \
  "$SRC_DIR"/ "$APP_DIR"/
chown -R pinion:pinion "$APP_DIR"

say ".env"
ENV_FILE="$APP_DIR/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$APP_DIR/.env.example" "$ENV_FILE"
  KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  sed -i "s|^TOKEN_ENC_KEY=.*|TOKEN_ENC_KEY=$KEY|" "$ENV_FILE"
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=$DATA_DIR/pinion.db|" "$ENV_FILE"
  echo "Neue .env angelegt, TOKEN_ENC_KEY erzeugt."
  echo "⚠  Den TOKEN_ENC_KEY zusätzlich sicher aufbewahren (Passwortmanager). Ohne ihn sind Backups wertlos."
else
  echo ".env existiert, bleibt unverändert."
fi
chown pinion:pinion "$ENV_FILE"; chmod 600 "$ENV_FILE"

say "Abhängigkeiten und Build (dauert auf dem Pi ein paar Minuten)"
sudo -u pinion -H bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund --loglevel=error && npm run build --silent && npm prune --omit=dev --no-audit --no-fund --loglevel=error"

say "Datenbank migrieren"
sudo -u pinion -H bash -c "cd '$APP_DIR' && node dist/db/migrate.js"

say "Befehl 'pinion' und sudo-Regel"
install -m 755 "$APP_DIR/deploy/pinion" /usr/local/bin/pinion
cat > /etc/sudoers.d/pinion <<SUDO
# Mitglieder der Gruppe pinion dürfen den pinion-Befehl als Service-User ausführen
%pinion ALL=(pinion) NOPASSWD: /usr/local/bin/pinion
SUDO
chmod 440 /etc/sudoers.d/pinion
visudo -cf /etc/sudoers.d/pinion >/dev/null || die "sudoers-Regel ungültig"

say "systemd"
install -m 644 "$APP_DIR"/deploy/systemd/*.service "$APP_DIR"/deploy/systemd/*.timer /etc/systemd/system/

# Backup auf NAS o.ä.: BACKUP_DIR in .env → Schreibrecht für den gehärteten Backup-Dienst freigeben
BACKUP_DIR_ENV="$(grep -E '^BACKUP_DIR=' "$ENV_FILE" | cut -d= -f2- || true)"
DROPIN=/etc/systemd/system/pinion-backup.service.d
if [[ -n "$BACKUP_DIR_ENV" ]]; then
  install -d "$DROPIN"
  cat > "$DROPIN/backup-dir.conf" <<UNIT
[Unit]
RequiresMountsFor=$BACKUP_DIR_ENV
[Service]
ReadWritePaths=$BACKUP_DIR_ENV
UNIT
  sudo -u pinion test -w "$BACKUP_DIR_ENV" || echo "⚠  $BACKUP_DIR_ENV ist für User pinion nicht beschreibbar (siehe docs/PI-SETUP.md, Backup aufs NAS)"
  echo "Backups gehen nach $BACKUP_DIR_ENV"
else
  rm -rf "$DROPIN"
fi
systemctl daemon-reload
systemctl enable --now pinion-backup.timer >/dev/null
systemctl enable pinion-worker >/dev/null
systemctl restart pinion-worker
sleep 2
systemctl is-active --quiet pinion-worker && echo "Worker läuft ✓" || { journalctl -u pinion-worker -n 30 --no-pager; die "Worker startet nicht"; }

say "Fertig"
cat <<TXT
Nächste Schritte:
  1. Neu einloggen (Gruppe pinion wird aktiv), dann:  pinion status
  2. Accounts verbinden:  pinion connect
     Vom Laptop:  ssh -L 8787:127.0.0.1:8787 $LOGIN_USER@$(hostname)  → http://127.0.0.1:8787
     (über Tailscale: Hostname aus "tailscale status", z.B. $(hostname).<tailnet>.ts.net)
  3. Claude Desktop/Code einbinden: siehe docs/PI-SETUP.md
Update später: git pull && sudo ./deploy/install.sh
TXT
