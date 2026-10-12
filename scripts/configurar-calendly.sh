#!/usr/bin/env bash
# Conecta o Calendly: pede o token pessoal (não aparece na tela), confere com o Calendly e grava só no .env.
# Onde gerar o token: Calendly → Integrações → API e webhooks → Personal access tokens.
set -euo pipefail
. "$(dirname "$0")/_comum.sh"
checar_env
usar_node

printf "Cole o token do Calendly e aperte Enter (ele não aparece na tela): "
read -rs TOKEN
echo
TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
[ -n "$TOKEN" ] || { falha "Nenhum token informado."; exit 1; }

passo "Conferindo o token com o Calendly"
RESPOSTA=$(printf 'Authorization: Bearer %s' "$TOKEN" | curl -fsS -H @- https://api.calendly.com/users/me) \
  || { falha "O Calendly recusou o token. Gere um novo e tente de novo."; exit 1; }
CONTA=$(printf '%s' "$RESPOSTA" | node_crm -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).resource;console.log(`${r.name} <${r.email}>`)})')

definir_env CALENDLY_TOKEN "$TOKEN"
grep -q "^CALENDLY_INTERVALO_MIN=" "$APP_DIR/.env" || definir_env CALENDLY_INTERVALO_MIN 5
ok "Calendly conectado: $CONTA"

reiniciar_se_ligado
echo "  As reuniões aparecem no CRM em até $(env_get CALENDLY_INTERVALO_MIN 5) minutos."
