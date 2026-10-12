#!/usr/bin/env bash
# Redefine a senha de um usuário. Uso: ./scripts/redefinir-senha.sh email@exemplo.com
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/_comum.sh
checar_docker
docker compose exec app node src/cli.js redefinir-senha "$@"
