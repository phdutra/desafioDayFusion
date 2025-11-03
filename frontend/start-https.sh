#!/bin/bash

# Script para iniciar Angular com HTTPS após limpar cache

echo "🛑 Parando servidores Angular em execução..."
pkill -f "ng serve" || true
sleep 2

echo "🧹 Limpando cache..."
cd "$(dirname "$0")"
rm -rf .angular node_modules/.cache dist/.angular 2>/dev/null || true

echo "🔒 Iniciando servidor Angular com HTTPS..."
echo ""
echo "✅ Servidor iniciará em: https://localhost:4200"
echo "⚠️  Aceite o certificado autoassinado no navegador quando solicitado"
echo ""

npm start

