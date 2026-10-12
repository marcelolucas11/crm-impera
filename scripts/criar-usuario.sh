#!/usr/bin/env bash
# Cria um usuário (pergunta nome, e-mail e senha). Use --admin para criar um administrador.
set -euo pipefail
. "$(dirname "$0")/_comum.sh"
checar_env
usar_node
node_crm server/src/cli.js criar-usuario "$@"
