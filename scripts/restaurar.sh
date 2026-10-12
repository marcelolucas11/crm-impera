#!/usr/bin/env bash
# Restaura o banco a partir de um backup.
# Uso: ./scripts/restaurar.sh ../backups/crm_2026-10-12_150000.db
set -euo pipefail
. "$(dirname "$0")/_comum.sh"
checar_env
usar_node

ARQUIVO="${1:-}"
if [ -z "$ARQUIVO" ] || [ ! -f "$ARQUIVO" ]; then
  falha "Informe o arquivo de backup. Os mais recentes:"
  ls -1t "$BACKUP_DIR"/crm_*.db 2>/dev/null | head -n 10 || true
  exit 1
fi
ARQUIVO="$(cd "$(dirname "$ARQUIVO")" && pwd)/$(basename "$ARQUIVO")"

passo "Conferindo o arquivo"
node_crm server/src/cli.js verificar "$ARQUIVO"

aviso "Isto vai SUBSTITUIR todos os dados atuais pelo conteúdo de: $ARQUIVO"
printf "Digite RESTAURAR para confirmar: "
read -r CONFIRMA
[ "$CONFIRMA" = "RESTAURAR" ] || { aviso "Cancelado."; exit 0; }

passo "Guardando o estado atual antes de restaurar"
fazer_backup

ESTAVA_LIGADO=0
crm_rodando && ESTAVA_LIGADO=1
"$APP_DIR/parar.sh" >/dev/null

passo "Restaurando"
rm -f "$DB_FILE-wal" "$DB_FILE-shm"
cp "$ARQUIVO" "$DB_FILE"
ok "Banco restaurado."

if [ "$ESTAVA_LIGADO" = "1" ]; then "$APP_DIR/iniciar.sh"; fi
