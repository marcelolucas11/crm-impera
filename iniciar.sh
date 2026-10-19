#!/usr/bin/env bash
# Liga o CRM em segundo plano. Pode fechar o Terminal depois.
# Liga junto o vigia, que religa o CRM sozinho se ele cair ou travar.
#   ./iniciar.sh --automatico   (usado pelo cron da VPS) só religa se o CRM não foi desligado de propósito
set -euo pipefail
. "$(dirname "$0")/scripts/_comum.sh"

AUTOMATICO=0
[ "${1:-}" = "--automatico" ] && AUTOMATICO=1

if [ $AUTOMATICO -eq 1 ]; then
  # Desligado com ./parar.sh, no meio de uma atualização, ou instalação incompleta: não mexe
  [ -f "$PARADO_FILE" ] && exit 0
  [ -f "$APP_DIR/.env" ] && [ -x "$NODE_DIR/bin/node" ] && [ -f "$APP_DIR/server/public/index.html" ] || exit 0
  if vigia_rodando || crm_rodando; then exit 0; fi
  echo "[vigia] $(date '+%Y-%m-%d %H:%M:%S') CRM estava desligado sem ninguém pedir: religando" >> "$LOG_FILE"
fi

checar_env
usar_node
criar_pastas
rm -f "$PARADO_FILE"

PORTA=$(env_get APP_PORT 3000)

if vigia_rodando; then
  ok "O CRM já está ligado: http://localhost:${PORTA}"
  exit 0
fi
if crm_rodando; then
  # Ligado por uma versão antiga (sem vigia): desliga e liga de novo com o vigia
  "$APP_DIR/parar.sh" >/dev/null
  rm -f "$PARADO_FILE"
fi

if [ ! -f "$APP_DIR/server/public/index.html" ] || servidor_precisa_instalar; then
  aviso "Instalação incompleta — rodando ./atualizar.sh"
  exec "$APP_DIR/atualizar.sh"
fi

rm -f "$PID_FILE"
nohup bash "$APP_DIR/scripts/vigia.sh" >/dev/null 2>&1 &
# Espera o vigia ligar o servidor
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -f "$PID_FILE" ] && break
  sleep 0.5
done
instalar_checagem_automatica || true

if aguardar_app; then
  ok "CRM ligado (versão $(versao_crm)): http://localhost:${PORTA}"
else
  falha "O CRM não respondeu ainda. O vigia continua tentando religar. Últimas linhas do log ($LOG_FILE):"
  tail -n 20 "$LOG_FILE" >&2
  exit 1
fi
