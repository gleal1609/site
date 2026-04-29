#!/bin/bash
# Reverso Media Server — macOS launcher

cd "$(dirname "$0")/scripts" || exit 1

echo ""
echo "  Reverso Media Server"
echo "  ===================="
echo ""

if ! command -v node &>/dev/null; then
  echo "  [ERRO] Node.js não encontrado."
  echo "  Instale em: https://nodejs.org/"
  echo ""
  read -rp "  Pressione Enter para fechar..."
  exit 1
fi

echo "  Instalando dependências..."
npm install --no-audit --no-fund >/dev/null 2>&1 || echo "  [AVISO] npm install retornou erro. Tentando continuar..."

echo "  Iniciando servidor (porta 7847 — instâncias antigas são encerradas automaticamente)..."
echo ""
node local-server.mjs

echo ""
echo "  Servidor encerrado."
read -rp "  Pressione Enter para fechar..."
