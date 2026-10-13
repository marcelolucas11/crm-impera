#!/usr/bin/env bash
# Liga o CRM em segundo plano. Pode fechar o Terminal depois.
set -euo pipefail
. "$(dirname "$0")/scripts/_comum.sh"
checar_env
usar_node
criar_pastas

PORTA=$(env_get APP_PORT 3000)

if crm_rodando; then
  ok "O CRM já está ligado: http://localhost:${PORTA}"
  exit 0
fi

if [ ! -f "$APP_DIR/server/public/index.html" ] || servidor_precisa_instalar; then
  aviso "Instalação incompleta — rodando ./atualizar.sh"
  exec "$APP_DIR/atualizar.sh"
fi

export APP_VERSION
APP_VERSION=$(versao_crm)
echo "----- $(date '+%Y-%m-%d %H:%M:%S') iniciando versão $APP_VERSION -----" >> "$LOG_FILE"
nohup "$NODE_DIR/bin/node" --disable-warning=ExperimentalWarning server/src/index.js >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

if aguardar_app; then
  ok "CRM ligado (versão $APP_VERSION): http://localhost:${PORTA}"
else
  falha "O CRM não ligou. Últimas linhas do log ($LOG_FILE):"
  tail -n 20 "$LOG_FILE" >&2
  exit 1
fi
