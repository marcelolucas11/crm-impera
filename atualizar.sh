#!/usr/bin/env bash
# Atualiza o CRM sem apagar dados:
#   1) backup do banco  2) baixa a versão nova do GitHub  3) reconstrói só o app  4) confere se subiu
# O banco não é reiniciado nem apagado. Mudanças de estrutura entram por migrações automáticas.
set -euo pipefail
cd "$(dirname "$0")"
. scripts/_comum.sh

checar_docker
checar_env
criar_pastas

ANTERIOR=$(versao_git)
ULTIMO_BACKUP=""

passo "1/4 Backup do banco"
if banco_rodando; then
  ./scripts/backup.sh
  ULTIMO_BACKUP=$(ls -1t "$(env_get BACKUP_DIR ../backups)"/crm_*.dump 2>/dev/null | head -n 1 || true)
else
  aviso "Banco ainda não está rodando — backup pulado."
fi

passo "2/4 Baixando a versão nova"
if git remote get-url origin >/dev/null 2>&1; then
  git pull --ff-only
else
  aviso "Sem repositório remoto configurado — usando os arquivos desta pasta."
fi
export APP_VERSION
APP_VERSION=$(versao_git)

passo "3/4 Reconstruindo o app ($ANTERIOR → $APP_VERSION)"
docker compose up -d db
docker compose build app
docker compose up -d --no-deps app

passo "4/4 Conferindo"
if aguardar_app; then
  ok "CRM atualizado para a versão $APP_VERSION. Pode continuar trabalhando."
else
  falha "A versão nova não respondeu. Seus dados continuam no banco."
  [ -n "$ULTIMO_BACKUP" ] && echo "  Backup feito antes da atualização: $ULTIMO_BACKUP"
  echo "  Veja o erro com: docker compose logs app --tail 50"
  exit 1
fi
