#!/usr/bin/env bash
# Gera um backup completo do banco em ../backups (mantém os 30 mais recentes)
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/_comum.sh

checar_docker
checar_env

if ! banco_rodando; then
  falha "O banco não está rodando. Suba o CRM antes (./atualizar.sh)."; exit 1
fi

BACKUP_DIR=$(env_get BACKUP_DIR ../backups)
USUARIO=$(env_get POSTGRES_USER crm)
BANCO=$(env_get POSTGRES_DB crm)
mkdir -p "$BACKUP_DIR"

ARQUIVO="$BACKUP_DIR/crm_$(date +%Y-%m-%d_%H%M%S).dump"
docker compose exec -T db pg_dump -U "$USUARIO" -d "$BANCO" --format=custom > "$ARQUIVO.tmp"
mv "$ARQUIVO.tmp" "$ARQUIVO"

# Mantém só os 30 backups mais recentes
ls -1t "$BACKUP_DIR"/crm_*.dump 2>/dev/null | tail -n +31 | while read -r antigo; do rm -f "$antigo"; done

TAMANHO=$(du -h "$ARQUIVO" | cut -f1)
ok "Backup salvo: $ARQUIVO ($TAMANHO)"
