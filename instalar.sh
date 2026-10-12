#!/usr/bin/env bash
# Primeira instalação do CRM (rodar uma vez só, no Mac ou na VPS).
# Cria o .env com senhas aleatórias, cria as pastas de dados, sobe o sistema e cria o primeiro administrador.
set -euo pipefail
cd "$(dirname "$0")"
. scripts/_comum.sh

checar_docker

if [ -f .env ]; then
  aviso "Já existe um .env aqui — mantendo as configurações atuais."
else
  passo "Gerando o arquivo .env com senhas aleatórias"
  aleatorio() { openssl rand -hex "$1"; }
  cat > .env <<EOF
# Gerado por instalar.sh em $(date). NÃO envie este arquivo para o GitHub.

POSTGRES_USER=crm
POSTGRES_PASSWORD=$(aleatorio 24)
POSTGRES_DB=crm

HOST_DATA_DIR=../dados
HOST_FILES_DIR=../arquivos
BACKUP_DIR=../backups

APP_PORT=3000
SESSION_SECRET=$(aleatorio 32)
PUBLIC_URL=
DDI_PADRAO=55

FOLLOWUP_HORAS=24

YAYFORMS_WEBHOOK_TOKEN=$(aleatorio 16)
YAYFORMS_WEBHOOK_SECRET=
YAYFORMS_CAMPO_NOME=
YAYFORMS_CAMPO_TELEFONE=
YAYFORMS_CAMPO_EMAIL=
EOF
  chmod 600 .env
  ok ".env criado"
fi

passo "Criando as pastas de dados"
criar_pastas
ok "Pastas prontas: $(env_get HOST_DATA_DIR ../dados), $(env_get HOST_FILES_DIR ../arquivos), $(env_get BACKUP_DIR ../backups)"

passo "Construindo e subindo o CRM (a primeira vez demora alguns minutos)"
export APP_VERSION
APP_VERSION=$(versao_git)
docker compose up -d --build

passo "Aguardando o CRM responder"
if ! aguardar_app; then
  falha "O CRM não respondeu. Veja o motivo com: docker compose logs app --tail 50"
  exit 1
fi
ok "CRM no ar"

USUARIOS=$(docker compose exec -T app node src/cli.js contar-usuarios 2>/dev/null | tr -d '[:space:]' || echo 0)
if [ "${USUARIOS:-0}" = "0" ]; then
  passo "Criando o primeiro administrador"
  docker compose exec app node src/cli.js criar-usuario --admin
fi

PORTA=$(env_get APP_PORT 3000)
TOKEN=$(env_get YAYFORMS_WEBHOOK_TOKEN)
echo
ok "Instalação concluída."
echo "  Acesse:            http://localhost:${PORTA}"
echo "  Webhook Yay! Forms: <endereço público>/webhooks/yayforms/${TOKEN}"
echo "  Para atualizar:    ./atualizar.sh"
