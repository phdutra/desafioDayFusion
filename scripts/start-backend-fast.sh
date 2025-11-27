#!/bin/bash

# Script para iniciar o backend com build rápido (incremental)

cd "$(dirname "$0")/../backend" || exit 1

echo "🔧 Parando processos existentes nas portas 5100 e 7197..."
lsof -ti:5100 | xargs kill -9 2>/dev/null
lsof -ti:7197 | xargs kill -9 2>/dev/null
sleep 1

echo "🏗️  Build incremental rápido (sem clean)..."
# Build incremental - só compila o que mudou
dotnet build --no-restore --verbosity quiet

if [ $? -ne 0 ]; then
    echo "⚠️  Build incremental falhou. Fazendo restore e rebuild completo..."
    dotnet restore
    dotnet build --verbosity minimal
    if [ $? -ne 0 ]; then
        echo "❌ Erro no build. Verifique os erros acima."
        exit 1
    fi
fi

echo ""
echo "🚀 Iniciando backend em HTTPS..."
echo "   URL: https://localhost:7197"
echo "   Swagger: https://localhost:7197/swagger"
echo ""
echo "💡 Dica: Use 'dotnet watch run --launch-profile https' para hot reload"
echo "⚠️  Para parar o servidor, pressione Ctrl+C"
echo ""

dotnet run --launch-profile https --no-build



