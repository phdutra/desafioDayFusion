#!/bin/bash

echo "🧹 Limpando cache e reiniciando projeto Angular..."
echo ""

# Parar processo se estiver rodando
echo "🛑 Parando processos Angular..."
pkill -f "ng serve" || true
pkill -f "node.*angular" || true
sleep 2

# Limpar cache do Angular
echo "🗑️  Limpando cache do Angular..."
rm -rf .angular/cache
rm -rf .angular/.tmp
rm -rf node_modules/.cache
rm -rf dist

# Limpar cache do npm
echo "🗑️  Limpando cache do npm..."
npm cache clean --force

# Limpar node_modules e reinstalar (opcional, mais lento)
read -p "Deseja reinstalar node_modules? (s/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Ss]$ ]]; then
    echo "📦 Removendo node_modules..."
    rm -rf node_modules
    echo "📦 Reinstalando dependências..."
    npm install
fi

echo ""
echo "✅ Limpeza concluída!"
echo ""
echo "🚀 Para iniciar o projeto:"
echo "   npm start"
echo ""
echo "💡 Após iniciar, no navegador:"
echo "   1. Abra DevTools (F12)"
echo "   2. Limpe o cache: Ctrl+Shift+Delete (Windows) ou Cmd+Shift+Delete (Mac)"
echo "   3. Ou use: Ctrl+Shift+R (Windows) ou Cmd+Shift+R (Mac) para hard reload"
echo ""

