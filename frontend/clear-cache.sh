#!/bin/bash

echo "🧹 Limpando cache do Angular..."

# Limpar cache do Angular
rm -rf .angular
rm -rf .angular/cache
rm -rf node_modules/.cache
rm -rf dist

# Limpar arquivos temporários
find . -type f -name "*.tsbuildinfo" -delete 2>/dev/null || true
find . -type d -name ".ng" -exec rm -rf {} + 2>/dev/null || true

echo "✅ Cache limpo com sucesso!"
echo ""
echo "Para reiniciar o servidor:"
echo "  npm start"

