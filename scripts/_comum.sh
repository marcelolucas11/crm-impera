#!/usr/bin/env bash
# Funções usadas pelos outros scripts. Compatível com o bash do macOS (3.2) e com Linux.

AZUL=$'\033[1;34m'; VERDE=$'\033[1;32m'; AMARELO=$'\033[1;33m'; VERMELHO=$'\033[1;31m'; RESET=$'\033[0m'

passo() { echo "${AZUL}▶ $*${RESET}"; }
ok()    { echo "${VERDE}✔ $*${RESET}"; }
aviso() { echo "${AMARELO}! $*${RESET}"; }
falha() { echo "${VERMELHO}✖ $*${RESET}" >&2; }

# Lê uma variável do .env sem executar o arquivo
env_get() {
  local chave="$1" padrao="${2:-}" valor=""
  if [ -f .env ]; then
    valor=$(grep -E "^${chave}=" .env | tail -n 1 | cut -d= -f2- || true)
  fi
  if [ -z "$valor" ]; then echo "$padrao"; else echo "$valor"; fi
}

checar_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    falha "Docker não encontrado. Instale o Docker Desktop e abra o app."; exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    falha "O Docker não está rodando. Abra o Docker Desktop e tente de novo."; exit 1
  fi
}

checar_env() {
  if [ ! -f .env ]; then
    falha "Arquivo .env não encontrado. Rode primeiro: ./instalar.sh"; exit 1
  fi
}

banco_rodando() {
  [ -n "$(docker compose ps --status running -q db 2>/dev/null)" ]
}

criar_pastas() {
  local dados arquivos backups
  dados=$(env_get HOST_DATA_DIR ../dados)
  arquivos=$(env_get HOST_FILES_DIR ../arquivos)
  backups=$(env_get BACKUP_DIR ../backups)
  mkdir -p "$dados/postgres" "$arquivos" "$backups"
}

versao_git() {
  git rev-parse --short HEAD 2>/dev/null || echo "dev"
}

# Espera o app responder em /api/health (até ~90 s)
aguardar_app() {
  local porta tentativas=0
  porta=$(env_get APP_PORT 3000)
  while [ $tentativas -lt 45 ]; do
    if curl -fsS "http://127.0.0.1:${porta}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    tentativas=$((tentativas + 1))
    sleep 2
  done
  return 1
}
