#!/bin/bash

# Script para limpar cache do navegador e forçar reload
echo "🧹 Limpando cache do Angular..."
echo ""

# Limpar cache do Angular
rm -rf .angular/cache
rm -rf node_modules/.cache

echo "✅ Cache do Angular limpo!"
echo ""
echo "💡 Para limpar cache do navegador:"
echo "   Chrome/Edge: Ctrl+Shift+Delete (Windows) ou Cmd+Shift+Delete (Mac)"
echo "   Firefox: Ctrl+Shift+Delete (Windows) ou Cmd+Shift+Delete (Mac)"
echo ""
echo "   Ou use: Ctrl+Shift+R (Windows) ou Cmd+Shift+R (Mac) para hard reload"
echo ""
echo "📦 Para garantir que está usando a versão mais recente:"
echo "   1. Feche o navegador completamente"
echo "   2. Abra as ferramentas de desenvolvedor (F12)"
echo "   3. Clique com botão direito no ícone de recarregar"
echo "   4. Selecione 'Limpar cache e recarregar forçado'"
echo ""

