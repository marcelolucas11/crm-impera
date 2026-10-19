#!/usr/bin/env bash
# Vigia do CRM: liga o servidor e o religa sozinho se ele cair ou travar.
# Não rode direto: o ./iniciar.sh liga o vigia, e o ./parar.sh desliga os dois.
#
#   - O servidor saiu (erro, falta de memória...)  → religa em 3 s (se cair em seguida, espera mais, até 60 s)
#   - O servidor ficou sem responder por ~2 min     → força o desligamento e religa
#   - ./parar.sh                                   → desliga o servidor com calma e sai
set -uo pipefail
. "$(dirname "$0")/_comum.sh"
usar_node

PORTA=$(env_get APP_PORT 3000)
VERIFICAR_A_CADA=${VIGIA_INTERVALO:-15}      # segundos entre as conferências de /api/health
FALHAS_PARA_TRAVADO=${VIGIA_FALHAS:-8}    # 8 × 15 s = 2 min sem responder
CARENCIA_INICIO=${VIGIA_CARENCIA:-90}       # segundos depois de ligar antes de começar a conferir

PARANDO=0
PID_NODE=""

registrar() { echo "[vigia] $(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG_FILE"; }

desligar() {
  PARANDO=1
  if [ -n "$PID_NODE" ] && kill -0 "$PID_NODE" 2>/dev/null; then
    kill -TERM "$PID_NODE" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$PID_NODE" 2>/dev/null || break
      sleep 1
    done
    kill -0 "$PID_NODE" 2>/dev/null && kill -KILL "$PID_NODE" 2>/dev/null
  fi
  rm -f "$PID_FILE" "$VIGIA_PID_FILE"
  registrar "desligado"
  exit 0
}
trap desligar TERM INT
trap '' HUP

echo $$ > "$VIGIA_PID_FILE"
registrar "ligado"
espera_religar=3

while [ $PARANDO -eq 0 ]; do
  export APP_VERSION
  APP_VERSION=$(versao_crm)
  echo "----- $(date '+%Y-%m-%d %H:%M:%S') iniciando versão $APP_VERSION -----" >> "$LOG_FILE"
  "$NODE_DIR/bin/node" --disable-warning=ExperimentalWarning server/src/index.js >> "$LOG_FILE" 2>&1 &
  PID_NODE=$!
  echo "$PID_NODE" > "$PID_FILE"
  inicio=$(date +%s)
  falhas=0

  while kill -0 "$PID_NODE" 2>/dev/null; do
    sleep "$VERIFICAR_A_CADA" &
    wait $! 2>/dev/null
    [ $PARANDO -eq 1 ] && break
    kill -0 "$PID_NODE" 2>/dev/null || break
    [ $(( $(date +%s) - inicio )) -lt $CARENCIA_INICIO ] && continue
    if curl -fsS -m 5 "http://127.0.0.1:${PORTA}/api/health" >/dev/null 2>&1; then
      falhas=0
    else
      falhas=$((falhas + 1))
      if [ $falhas -ge $FALHAS_PARA_TRAVADO ]; then
        registrar "o CRM não responde há ~$((falhas * VERIFICAR_A_CADA)) s: forçando o reinício"
        kill -KILL "$PID_NODE" 2>/dev/null
        break
      fi
    fi
  done

  wait "$PID_NODE" 2>/dev/null
  codigo=$?
  [ $PARANDO -eq 1 ] && break

  durou=$(( $(date +%s) - inicio ))
  # Caiu logo depois de ligar: espera mais antes de tentar de novo (evita ficar religando sem parar)
  if [ $durou -lt 60 ]; then
    espera_religar=$(( espera_religar * 2 ))
    [ $espera_religar -gt 60 ] && espera_religar=60
  else
    espera_religar=3
  fi
  registrar "o CRM parou (código $codigo, ficou ligado ${durou} s). Religando em ${espera_religar} s"
  sleep "$espera_religar" &
  wait $! 2>/dev/null
done
desligar
