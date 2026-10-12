#!/usr/bin/env bash
# Faz um backup do banco agora (pode rodar com o CRM ligado). Guarda em ../backups, mantém os 30 mais recentes.
set -euo pipefail
. "$(dirname "$0")/_comum.sh"
checar_env
usar_node
fazer_backup
