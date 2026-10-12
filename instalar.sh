#!/usr/bin/env bash
# Primeira instalação do CRM (rodar uma vez só, no Mac ou na VPS).
# Baixa o Node.js portátil, cria o .env com senhas aleatórias, prepara o banco,
# compila a interface, cria o primeiro administrador e liga o CRM.
set -euo pipefail
. "$(dirname "$0")/scripts/_comum.sh"

# --- 1. Pastas ---
passo "Criando as pastas em $BASE_DIR"
criar_pastas
ok "dados/, backups/, arquivos/ e logs/ prontos"

# --- 2. Node.js portátil ---
if [ -x "$NODE_DIR/bin/node" ]; then
  ok "Node.js portátil já existe ($("$NODE_DIR/bin/node" --version))"
else
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) PLATAFORMA="darwin-arm64" ;;
    Darwin-x86_64) PLATAFORMA="darwin-x64" ;;
    Linux-x86_64) PLATAFORMA="linux-x64" ;;
    Linux-aarch64) PLATAFORMA="linux-arm64" ;;
    *) falha "Sistema não suportado: $(uname -s) $(uname -m)"; exit 1 ;;
  esac
  passo "Baixando o Node.js ${NODE_MAJOR} portátil ($PLATAFORMA) para $NODE_DIR"
  URL_BASE="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  TEMP=$(mktemp -d)
  curl -fsSL "$URL_BASE/SHASUMS256.txt" -o "$TEMP/SHASUMS256.txt"
  ARQUIVO=$(grep -E "node-v[0-9.]+-${PLATAFORMA}\.tar\.gz$" "$TEMP/SHASUMS256.txt" | awk '{print $2}' | head -n 1)
  [ -n "$ARQUIVO" ] || { falha "Não encontrei o Node para $PLATAFORMA"; exit 1; }
  curl -fSL --progress-bar "$URL_BASE/$ARQUIVO" -o "$TEMP/$ARQUIVO"
  ESPERADO=$(grep " $ARQUIVO\$" "$TEMP/SHASUMS256.txt" | awk '{print $1}')
  OBTIDO=$(cat "$TEMP/$ARQUIVO" | hash_de)
  if [ "$ESPERADO" != "$OBTIDO" ]; then
    falha "O arquivo baixado não confere com a assinatura oficial. Instalação cancelada."; rm -rf "$TEMP"; exit 1
  fi
  tar -xzf "$TEMP/$ARQUIVO" -C "$TEMP"
  rm -rf "$NODE_DIR"
  mv "$TEMP/${ARQUIVO%.tar.gz}" "$NODE_DIR"
  rm -rf "$TEMP"
  ok "Node.js $("$NODE_DIR/bin/node" --version) instalado (assinatura conferida)"
fi
usar_node

# --- 3. Configuração ---
if [ -f "$APP_DIR/.env" ]; then
  aviso "Já existe um .env — mantendo as configurações atuais."
else
  passo "Gerando o .env com senhas aleatórias"
  aleatorio() { openssl rand -hex "$1"; }
  cat > "$APP_DIR/.env" <<EOF
# Gerado por instalar.sh em $(date). NÃO envie este arquivo para o GitHub.

# Endereço e porta do CRM
APP_PORT=3000
HOST=127.0.0.1
# Endereço público (Tailscale Funnel no Mac, domínio na VPS). Usado para mostrar a URL do webhook.
PUBLIC_URL=

SESSION_SECRET=$(aleatorio 32)

# Pastas (relativas a esta pasta)
DB_FILE=../dados/crm.db
FILES_DIR=../arquivos
BACKUP_DIR=../backups

# DDI colocado na frente de telefones com DDD + número
DDI_PADRAO=55
# Horas sem contato até o lead ficar marcado como atrasado
FOLLOWUP_HORAS=24

# Calendly (grave o token com ./scripts/configurar-calendly.sh)
CALENDLY_TOKEN=
CALENDLY_INTERVALO_MIN=5

# WhatsApp por QR code (0 desliga)
WHATSAPP_ATIVO=1
# 1 = conversa nova de número desconhecido vira lead sozinha; 0 = aparece na tela de WhatsApp com o botão "Transformar em lead"
WHATSAPP_CRIAR_LEADS=0

# Yay! Forms
YAYFORMS_WEBHOOK_TOKEN=$(aleatorio 16)
YAYFORMS_WEBHOOK_SECRET=
YAYFORMS_CAMPO_NOME=
YAYFORMS_CAMPO_TELEFONE=
YAYFORMS_CAMPO_EMAIL=
EOF
  chmod 600 "$APP_DIR/.env"
  ok ".env criado"
fi

# --- 4. Dependências e interface ---
passo "Instalando as dependências do servidor"
instalar_servidor
ok "Servidor pronto"
passo "Compilando a interface"
compilar_interface --forcar
ok "Interface pronta"

# --- 5. Primeiro administrador ---
USUARIOS=$(node_crm server/src/cli.js contar-usuarios | tail -n 1)
if [ "$USUARIOS" = "0" ]; then
  passo "Criando o primeiro administrador"
  node_crm server/src/cli.js criar-usuario --admin || true
  if [ "$(node_crm server/src/cli.js contar-usuarios | tail -n 1)" = "0" ]; then
    falha "Nenhum administrador foi criado. Rode: ./scripts/criar-usuario.sh --admin"
    exit 1
  fi
fi

# --- 6. Ligar ---
"$APP_DIR/iniciar.sh"

echo
ok "Instalação concluída."
echo "  Abra:               http://localhost:$(env_get APP_PORT 3000)"
echo "  Dia a dia:          ./iniciar.sh  |  ./parar.sh  |  ./atualizar.sh"
echo "  Lead de teste:      ./scripts/lead-teste.sh"
