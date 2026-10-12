#!/usr/bin/env bash
# Restaura o banco a partir de um backup.
# Uso: ./scripts/restaurar.sh ../backups/crm_2026-10-12_150000.dump
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/_comum.sh

checar_docker
checar_env

ARQUIVO="${1:-}"
if [ -z "$ARQUIVO" ] || [ ! -f "$ARQUIVO" ]; then
  falha "Informe o arquivo de backup. Disponíveis:"
  ls -1t "$(env_get BACKUP_DIR ../backups)"/crm_*.dump 2>/dev/null | head -n 10 || true
  exit 1
fi

USUARIO=$(env_get POSTGRES_USER crm)
BANCO=$(env_get POSTGRES_DB crm)

aviso "Isto vai SUBSTITUIR todos os dados atuais pelo conteúdo de: $ARQUIVO"
printf "Digite RESTAURAR para confirmar: "
read -r CONFIRMA
[ "$CONFIRMA" = "RESTAURAR" ] || { aviso "Cancelado."; exit 0; }

passo "Fazendo um backup do estado atual antes de restaurar"
./scripts/backup.sh

passo "Parando o app"
docker compose stop app

passo "Restaurando"
docker compose exec -T db pg_restore -U "$USUARIO" -d "$BANCO" --clean --if-exists --no-owner < "$ARQUIVO"

passo "Subindo o app"
docker compose up -d --no-deps app
if aguardar_app; then ok "Restauração concluída."; else falha "O app não respondeu. Veja: docker compose logs app --tail 50"; exit 1; fi
