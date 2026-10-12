#!/usr/bin/env bash
# Atualiza o CRM sem apagar dados:
#   1) backup do banco  2) baixa a versão nova do GitHub  3) prepara a nova versão com o CRM ainda ligado
#   4) reinicia (poucos segundos fora do ar)  5) confere
# Mudanças na estrutura do banco entram por migrações automáticas, que só acrescentam.
set -euo pipefail
. "$(dirname "$0")/scripts/_comum.sh"
checar_env
usar_node
criar_pastas

ULTIMO_BACKUP=""
ANTERIOR=$(git rev-parse HEAD 2>/dev/null || echo "")

passo "1/5 Backup do banco"
fazer_backup

passo "2/5 Baixando a versão nova"
if git remote get-url origin >/dev/null 2>&1; then
  if ! git pull --ff-only --quiet; then
    falha "Não consegui baixar a versão nova. O CRM continua ligado na versão atual ($(versao_git))."
    echo "  Se você editou arquivos dentro de app/, rode 'git status' para ver quais foram."
    exit 1
  fi
else
  aviso "Sem repositório remoto configurado — usando os arquivos desta pasta."
fi
NOVA=$(versao_git)
[ -n "$ANTERIOR" ] && echo "$ANTERIOR" > "$BACKUP_DIR/versao-anterior.txt"

passo "3/5 Preparando a versão $NOVA"
compilar_interface
PRECISA_SERVIDOR=0
servidor_precisa_instalar && PRECISA_SERVIDOR=1

passo "4/5 Reiniciando"
"$APP_DIR/parar.sh" >/dev/null
if [ "$PRECISA_SERVIDOR" = "1" ]; then
  echo "  instalando dependências do servidor"
  instalar_servidor
fi

if "$APP_DIR/iniciar.sh" >/dev/null 2>&1; then
  passo "5/5 Conferindo"
  ok "CRM atualizado para a versão $NOVA: http://localhost:$(env_get APP_PORT 3000)"
else
  falha "A versão $NOVA não ligou. Seus dados estão intactos."
  [ -n "$ULTIMO_BACKUP" ] && echo "  Backup feito antes da atualização: $ULTIMO_BACKUP"
  echo "  Últimas linhas do log:"
  tail -n 15 "$LOG_FILE" >&2
  echo
  echo "  Para voltar à versão anterior agora: ./scripts/voltar-versao.sh"
  exit 1
fi
