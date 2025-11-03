#!/bin/bash

# Script para limpar cache e reiniciar o projeto Angular
# Uso: ./clean-and-start.sh

echo "🧹 Limpando cache e build anterior..."

# Limpar node_modules (opcional, descomente se necessário)
# rm -rf node_modules

# Limpar cache do npm
npm cache clean --force

# Limpar dist
rm -rf dist

# Limpar .angular (cache do Angular CLI)
rm -rf .angular

# Limpar node_modules/.cache se existir
if [ -d "node_modules/.cache" ]; then
  rm -rf node_modules/.cache
fi

echo "✅ Cache limpo!"

echo "📦 Reinstalando dependências..."
npm install

echo "✅ Dependências instaladas!"

echo "🚀 Iniciando servidor de desenvolvimento..."
npm run start

