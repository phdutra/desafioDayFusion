#!/bin/bash

echo "🔍 Verificando erros no projeto Angular..."
echo ""

# Verificar se o servidor está rodando
echo "1. Verificando servidor..."
if lsof -ti:4200 > /dev/null 2>&1; then
    echo "   ✅ Servidor rodando na porta 4200"
    PID=$(lsof -ti:4200 | head -1)
    echo "   📊 PID: $PID"
else
    echo "   ❌ Servidor NÃO está rodando na porta 4200"
fi
echo ""

# Verificar erros de TypeScript
echo "2. Verificando erros de TypeScript..."
cd "$(dirname "$0")"
npx tsc --noEmit 2>&1 | head -20
echo ""

# Verificar se os arquivos principais existem
echo "3. Verificando arquivos principais..."
FILES=(
    "src/main.ts"
    "src/app/app.component.ts"
    "src/app/app.config.ts"
    "src/app/app.routes.ts"
    "src/index.html"
)

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✅ $file"
    else
        echo "   ❌ $file NÃO ENCONTRADO"
    fi
done
echo ""

# Verificar se o build funciona
echo "4. Tentando build rápido..."
npm run build 2>&1 | tail -10
echo ""

echo "✅ Diagnóstico concluído!"
echo ""
echo "💡 Para ver erros em tempo real:"
echo "   1. Abra o navegador em http://localhost:4200"
echo "   2. Abra DevTools (F12)"
echo "   3. Vá na aba 'Console' para ver erros JavaScript"
echo "   4. Vá na aba 'Network' para ver erros de carregamento"
echo ""

