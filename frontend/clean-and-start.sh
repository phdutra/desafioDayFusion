#!/bin/bash

# Script para limpar cache e reiniciar o projeto Angular
# Uso: ./clean-and-start.sh

echo "🧹 Limpando cache e build anterior..."

# Limpar cache do npm
echo "  - Limpando cache do npm..."
npm cache clean --force

# Limpar dist
echo "  - Removendo pasta dist..."
rm -rf dist

# Limpar .angular (cache do Angular CLI)
echo "  - Removendo cache do Angular CLI (.angular)..."
rm -rf .angular

# Limpar node_modules/.cache se existir
if [ -d "node_modules/.cache" ]; then
  echo "  - Removendo node_modules/.cache..."
  rm -rf node_modules/.cache
fi

# Limpar qualquer outro cache do Angular
if [ -d ".angular" ]; then
  echo "  - Removendo .angular..."
  rm -rf .angular
fi

# Limpar cache do sistema de arquivos (macOS/Linux)
if [ -d "$HOME/.angular" ]; then
  echo "  - Limpando cache global do Angular..."
  rm -rf "$HOME/.angular"
fi

# Limpar cache do TypeScript
if [ -d "node_modules/.cache" ]; then
  echo "  - Removendo cache do TypeScript..."
  find node_modules -type d -name ".cache" -exec rm -rf {} + 2>/dev/null
fi

# Limpar arquivos temporários
echo "  - Limpando arquivos temporários..."
find . -type f -name "*.tsbuildinfo" -delete 2>/dev/null
find . -type d -name ".turbo" -exec rm -rf {} + 2>/dev/null

echo "✅ Cache limpo completamente!"

# Se quiser reinstalar dependências, descomente as linhas abaixo
# echo "📦 Reinstalando dependências..."
# npm install
# echo "✅ Dependências instaladas!"

