#!/usr/bin/env bash
# Funções e caminhos usados pelos outros scripts. Compatível com o bash do macOS (3.2) e com Linux.
#
# Estrutura esperada (no SSD ou na VPS):
#   crm-impera/
#   ├── app/      ← este repositório
#   ├── node/     ← Node.js portátil (o instalar.sh baixa)
#   ├── dados/    ← crm.db
#   ├── backups/
#   ├── arquivos/
#   └── logs/

NODE_MAJOR=24

AZUL=$'\033[1;34m'; VERDE=$'\033[1;32m'; AMARELO=$'\033[1;33m'; VERMELHO=$'\033[1;31m'; RESET=$'\033[0m'
passo() { echo "${AZUL}▶ $*${RESET}"; }
ok()    { echo "${VERDE}✔ $*${RESET}"; }
aviso() { echo "${AMARELO}! $*${RESET}"; }
falha() { echo "${VERMELHO}✖ $*${RESET}" >&2; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_DIR="$(cd "$APP_DIR/.." && pwd)"
NODE_DIR="$BASE_DIR/node"
LOG_DIR="$BASE_DIR/logs"
PID_FILE="$LOG_DIR/crm.pid"
LOG_FILE="$LOG_DIR/crm.log"
cd "$APP_DIR"

# Lê uma variável do .env sem executar o arquivo
env_get() {
  local chave="$1" padrao="${2:-}" valor=""
  if [ -f "$APP_DIR/.env" ]; then
    valor=$(grep -E "^${chave}=" "$APP_DIR/.env" | tail -n 1 | cut -d= -f2- || true)
  fi
  if [ -z "$valor" ]; then echo "$padrao"; else echo "$valor"; fi
}

# Grava (ou troca) uma variável no .env sem mexer nas outras
definir_env() {
  local chave="$1" valor="$2" arquivo="$APP_DIR/.env"
  { grep -v -E "^${chave}=" "$arquivo" 2>/dev/null || true; echo "${chave}=${valor}"; } > "$arquivo.novo"
  mv "$arquivo.novo" "$arquivo"
  chmod 600 "$arquivo"
}

# Reinicia o CRM se ele estiver ligado (para ler o .env novo)
reiniciar_se_ligado() {
  if crm_rodando; then
    "$APP_DIR/parar.sh" >/dev/null
    "$APP_DIR/iniciar.sh"
  fi
}

# Caminho absoluto de uma pasta configurada no .env (relativa à pasta do app)
pasta_env() {
  local valor
  valor=$(env_get "$1" "$2")
  case "$valor" in
    /*) echo "$valor" ;;
    ../*) echo "$BASE_DIR/${valor#../}" ;;
    ./*) echo "$APP_DIR/${valor#./}" ;;
    *) echo "$APP_DIR/$valor" ;;
  esac
}

BACKUP_DIR="$(pasta_env BACKUP_DIR ../backups)"
DB_FILE="$(pasta_env DB_FILE ../dados/crm.db)"

checar_env() {
  if [ ! -f "$APP_DIR/.env" ]; then
    falha "Arquivo .env não encontrado. Rode primeiro: ./instalar.sh"; exit 1
  fi
  ajustar_env
}

# Versão 0.6: o histórico do WhatsApp passou de 30 para 90 dias. Quem ainda tem o valor que o instalar.sh
# gerava (30) passa para 90, uma vez só; quem escolheu outro valor não é mexido. Guarda uma cópia do .env antes.
ajustar_env() {
  local env="$APP_DIR/.env"
  if grep -qx 'WHATSAPP_HISTORICO_DIAS=30' "$env" && ! grep -q '^# ajuste-0.6' "$env"; then
    cp "$env" "$env.antes-0.6"
    sed -i.tmp 's/^WHATSAPP_HISTORICO_DIAS=30$/WHATSAPP_HISTORICO_DIAS=90/' "$env" && rm -f "$env.tmp"
    printf '%s\n' '# ajuste-0.6: WHATSAPP_HISTORICO_DIAS passou de 30 para 90 (cópia anterior em .env.antes-0.6)' >> "$env"
    echo "  .env: histórico do WhatsApp agora é de 90 dias (cópia anterior em .env.antes-0.6)"
  fi
}

usar_node() {
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    falha "Node.js não encontrado em $NODE_DIR. Rode primeiro: ./instalar.sh"; exit 1
  fi
  export PATH="$NODE_DIR/bin:$PATH"
}

node_crm() {
  "$NODE_DIR/bin/node" --disable-warning=ExperimentalWarning "$@"
}

criar_pastas() {
  mkdir -p "$BASE_DIR/dados" "$BACKUP_DIR" "$(pasta_env FILES_DIR ../arquivos)" "$LOG_DIR" "$(dirname "$DB_FILE")"
}

versao_git() {
  git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo "dev"
}

# Versão para mostrar: o número do arquivo VERSAO (o mesmo do GitHub) + o commit. Ex.: 0.5.2 (1c2d16e)
versao_crm() {
  local numero
  numero=$(head -n 1 "$APP_DIR/VERSAO" 2>/dev/null | tr -d '[:space:]')
  if [ -n "$numero" ]; then echo "$numero ($(versao_git))"; else versao_git; fi
}

crm_rodando() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid=$(cat "$PID_FILE" 2>/dev/null)
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && ps -p "$pid" -o command= 2>/dev/null | grep -q "server/src/index.js"
}

# Espera o app responder em /api/health (até ~40 s)
aguardar_app() {
  local porta tentativas=0
  porta=$(env_get APP_PORT 3000)
  while [ $tentativas -lt 40 ]; do
    if curl -fsS "http://127.0.0.1:${porta}/api/health" >/dev/null 2>&1; then return 0; fi
    if ! crm_rodando; then return 1; fi
    tentativas=$((tentativas + 1))
    sleep 1
  done
  return 1
}

hash_de() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 | cut -d' ' -f1; else sha256sum | cut -d' ' -f1; fi
}

# Dependências do servidor mudaram desde a última instalação?
servidor_precisa_instalar() {
  local atual salvo
  atual=$(cat "$APP_DIR/server/package-lock.json" | hash_de)
  salvo=$(cat "$APP_DIR/server/node_modules/.hash-instalado" 2>/dev/null || true)
  [ "$atual" != "$salvo" ]
}

instalar_servidor() {
  (cd "$APP_DIR/server" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
  cat "$APP_DIR/server/package-lock.json" | hash_de > "$APP_DIR/server/node_modules/.hash-instalado"
}

# Instala as dependências novas numa pasta separada, com o CRM ainda ligado
preparar_servidor() {
  local tmp="$APP_DIR/server/.instalando"
  rm -rf "$tmp"
  mkdir -p "$tmp"
  cp "$APP_DIR/server/package.json" "$APP_DIR/server/package-lock.json" "$tmp/"
  (cd "$tmp" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
  cat "$APP_DIR/server/package-lock.json" | hash_de > "$tmp/node_modules/.hash-instalado"
}

# Troca as dependências antigas pelas preparadas (leva menos de um segundo)
trocar_servidor() {
  local tmp="$APP_DIR/server/.instalando"
  [ -d "$tmp/node_modules" ] || return 0
  rm -rf "$APP_DIR/server/node_modules.antigo"
  [ -d "$APP_DIR/server/node_modules" ] && mv "$APP_DIR/server/node_modules" "$APP_DIR/server/node_modules.antigo"
  mv "$tmp/node_modules" "$APP_DIR/server/node_modules"
  rm -rf "$tmp" "$APP_DIR/server/node_modules.antigo"
}

# Recompila a interface só se algo nela mudou
compilar_interface() {
  local atual salvo
  atual=$( (cd "$APP_DIR/web" && cat package-lock.json index.html vite.config.js && find src -type f | LC_ALL=C sort | xargs cat) | hash_de )
  salvo=$(cat "$APP_DIR/server/public/.hash-interface" 2>/dev/null || true)
  if [ "$atual" = "$salvo" ] && [ "${1:-}" != "--forcar" ]; then
    echo "  interface sem mudanças"
    return 0
  fi
  (
    cd "$APP_DIR/web"
    local hash_lock salvo_lock
    hash_lock=$(cat package-lock.json | hash_de)
    salvo_lock=$(cat node_modules/.hash-instalado 2>/dev/null || true)
    if [ "$hash_lock" != "$salvo_lock" ]; then
      npm ci --no-audit --no-fund --loglevel=error
      echo "$hash_lock" > node_modules/.hash-instalado
    fi
    if ! npm run build --silent > "$LOG_DIR/compilacao.log" 2>&1; then
      tail -n 20 "$LOG_DIR/compilacao.log" >&2
      exit 1
    fi
  )
  rm -rf "$APP_DIR/server/public.novo"
  cp -R "$APP_DIR/web/dist" "$APP_DIR/server/public.novo"
  echo "$atual" > "$APP_DIR/server/public.novo/.hash-interface"
  rm -rf "$APP_DIR/server/public"
  mv "$APP_DIR/server/public.novo" "$APP_DIR/server/public"
  echo "  interface compilada"
}

# Backup consistente do banco (funciona com o CRM rodando). Mantém os 30 mais recentes.
fazer_backup() {
  if [ ! -f "$DB_FILE" ]; then
    aviso "Ainda não existe banco para copiar."
    return 0
  fi
  mkdir -p "$BACKUP_DIR"
  local destino carimbo n=1
  carimbo=$(date +%Y-%m-%d_%H%M%S)
  destino="$BACKUP_DIR/crm_${carimbo}.db"
  while [ -e "$destino" ]; do
    n=$((n + 1))
    destino="$BACKUP_DIR/crm_${carimbo}_${n}.db"
  done
  node_crm server/src/cli.js backup "$destino" >/dev/null
  ls -1t "$BACKUP_DIR"/crm_*.db 2>/dev/null | tail -n +31 | while read -r antigo; do rm -f "$antigo"; done
  ULTIMO_BACKUP="$destino"
  ok "Backup: $destino ($(du -h "$destino" | cut -f1))"
}
