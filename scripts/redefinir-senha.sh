#!/usr/bin/env bash
# Redefine a senha de um usuário. Uso: ./scripts/redefinir-senha.sh email@exemplo.com
set -euo pipefail
. "$(dirname "$0")/_comum.sh"
checar_env
usar_node
node_crm server/src/cli.js redefinir-senha "$@"
