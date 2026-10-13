#!/usr/bin/env bash
# Simula uma resposta do Yay! Forms chegando no CRM (útil enquanto o CRM roda só no Mac).
# Uso: ./scripts/lead-teste.sh        (1 lead)
#      ./scripts/lead-teste.sh 5      (5 leads)
set -euo pipefail
. "$(dirname "$0")/_comum.sh"
checar_env

QTD="${1:-1}"
PORTA=$(env_get APP_PORT 3000)
TOKEN=$(env_get YAYFORMS_WEBHOOK_TOKEN)
NOMES=("Ana Paula Ribeiro" "Bruno Carvalho" "Camila Duarte" "Diego Martins" "Elaine Souza" "Felipe Rocha" "Gabriela Nunes" "Henrique Lopes")
FORMS=("Rifa iPhone 17" "Ação Premiada Moto" "Sorteio Pix R\$ 5 mil")
DDDS=("11" "21" "31" "41" "51" "61" "71" "85")

i=0
while [ $i -lt "$QTD" ]; do
  NOME=${NOMES[$((RANDOM % ${#NOMES[@]}))]}
  FORM=${FORMS[$((RANDOM % ${#FORMS[@]}))]}
  DDD=${DDDS[$((RANDOM % ${#DDDS[@]}))]}
  FONE="($DDD) 9$((RANDOM % 9000 + 1000))-$((RANDOM % 9000 + 1000))"
  # Simula a pessoa começando o formulário entre 5 e 120 minutos atrás
  INICIO=$(( $(date +%s) - (RANDOM % 116 + 5) * 60 ))
  PAYLOAD=$(cat <<EOF
{"form":{"title":"$FORM"},"response":{"answers":{
  "q1":{"title":"Qual é o seu nome?","type":"short_text","content":"$NOME"},
  "q2":{"title":"Seu WhatsApp","type":"phone_number","content":"$FONE"},
  "q3":{"title":"Quanto você investe em anúncios por mês?","type":"multiple_choice","content":["R\$ 5 a 10 mil"]}
},"startedAt":$INICIO,"submittedAt":$(date +%s),"hidden_fields":{"utm_source":"teste","utm_campaign":"simulacao"}}}
EOF
)
  RESPOSTA=$(curl -fsS -X POST "http://127.0.0.1:${PORTA}/webhooks/yayforms/${TOKEN}" -H 'Content-Type: application/json' -d "$PAYLOAD") \
    || { falha "Não consegui falar com o CRM. Ele está ligado? (./iniciar.sh)"; exit 1; }
  echo "  $NOME — $FONE — $FORM → $RESPOSTA"
  i=$((i + 1))
done
ok "$QTD lead(s) de teste enviado(s). Confira no kanban."
