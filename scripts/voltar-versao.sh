#!/usr/bin/env bash
# Volta o app para a versão que estava antes da última atualização. Os dados não são tocados.
# Uso: ./scripts/voltar-versao.sh            (volta para a versão anterior)
#      ./scripts/voltar-versao.sh <commit>   (volta para uma versão específica)
set -euo pipefail
. "$(dirname "$0")/_comum.sh"
checar_env
usar_node

ALVO="${1:-$(cat "$BACKUP_DIR/versao-anterior.txt" 2>/dev/null || true)}"
if [ -z "$ALVO" ]; then
  falha "Não sei para qual versão voltar. Versões recentes:"
  git log --oneline -n 10
  exit 1
fi
git cat-file -e "${ALVO}^{commit}" 2>/dev/null || { falha "Versão não encontrada: $ALVO"; exit 1; }

ATUAL=$(versao_crm)
passo "Voltando de $ATUAL para $(git rev-parse --short "$ALVO")"
git reset --hard "$ALVO" >/dev/null

compilar_interface
"$APP_DIR/parar.sh" >/dev/null
servidor_precisa_instalar && instalar_servidor
"$APP_DIR/iniciar.sh"
aviso "Na próxima vez que rodar ./atualizar.sh, o CRM vai para a versão mais nova do GitHub de novo."
