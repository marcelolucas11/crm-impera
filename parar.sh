#!/usr/bin/env bash
# Desliga o CRM com segurança. Rode antes de ejetar o SSD.
# Desliga também o vigia (para ele não religar) e marca que foi de propósito.
set -euo pipefail
. "$(dirname "$0")/scripts/_comum.sh"

mkdir -p "$LOG_DIR"
touch "$PARADO_FILE"

if vigia_rodando; then
  kill -TERM "$(cat "$VIGIA_PID_FILE")" 2>/dev/null || true
  for _ in $(seq 1 15); do
    vigia_rodando || break
    sleep 1
  done
  vigia_rodando && kill -KILL "$(cat "$VIGIA_PID_FILE")" 2>/dev/null || true
fi
rm -f "$VIGIA_PID_FILE"

if ! crm_rodando; then
  rm -f "$PID_FILE"
  ok "CRM desligado."
  exit 0
fi

PID=$(cat "$PID_FILE")
kill -TERM "$PID" 2>/dev/null || true
for _ in 1 2 3 4 5 6 7 8 9 10; do
  crm_rodando || break
  sleep 1
done
if crm_rodando; then
  aviso "Forçando o desligamento"
  kill -KILL "$PID" 2>/dev/null || true
  sleep 1
fi
rm -f "$PID_FILE"
ok "CRM desligado."
