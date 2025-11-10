#!/bin/bash

echo "🧹 LIMPANDO TODOS OS CACHES DO SISTEMA"
echo "════════════════════════════════════════"
echo ""

cd /Users/raphaeldutra/Documents/Dutra/Desafio-2025/desafioDayFusion

# 1. Limpar cache do Angular
echo "1️⃣ Limpando cache do Angular..."
cd frontend
rm -rf .angular
rm -rf dist
rm -rf node_modules/.cache
echo "   ✅ Cache do Angular limpo"
echo ""

# 2. Limpar node_modules e reinstalar
echo "2️⃣ Limpando node_modules..."
rm -rf node_modules
rm -f package-lock.json
echo "   ✅ node_modules removido"
echo ""

echo "3️⃣ Reinstalando dependências..."
npm install
echo "   ✅ Dependências reinstaladas"
echo ""

# 3. Limpar build do backend
echo "4️⃣ Limpando build do backend..."
cd ../backend
rm -rf bin
rm -rf obj
echo "   ✅ Build do backend limpo"
echo ""

# 4. Rebuild backend
echo "5️⃣ Rebuilding backend..."
dotnet build
echo "   ✅ Backend rebuilded"
echo ""

cd ..

echo "════════════════════════════════════════"
echo "✅ TUDO LIMPO!"
echo ""
echo "📋 PRÓXIMOS PASSOS:"
echo "1. Reinicie o backend (se estiver rodando)"
echo "2. Reinicie o frontend (se estiver rodando)"
echo "3. Limpe o cache do navegador (Ctrl+Shift+Delete)"
echo "4. Ou execute: ./scripts/limpar-cache-navegador.sh"
echo ""

