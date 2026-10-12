#!/usr/bin/env bash
# Cria um usuário (pergunta nome, e-mail e senha). Use --admin para criar um administrador.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/_comum.sh
checar_docker
docker compose exec app node src/cli.js criar-usuario "$@"
