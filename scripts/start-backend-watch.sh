#!/bin/bash

# Script para iniciar o backend com hot reload (dotnet watch)
# Muito mais rápido - só recompila arquivos que mudaram

cd "$(dirname "$0")/../backend" || exit 1

echo "🔧 Parando processos existentes nas portas 5100 e 7197..."
lsof -ti:5100 | xargs kill -9 2>/dev/null
lsof -ti:7197 | xargs kill -9 2>/dev/null
sleep 1

echo ""
echo "🔥 Iniciando backend com HOT RELOAD (dotnet watch)..."
echo "   URL: https://localhost:7197"
echo "   Swagger: https://localhost:7197/swagger"
echo ""
echo "✨ O servidor reiniciará automaticamente quando você salvar arquivos!"
echo "⚠️  Para parar o servidor, pressione Ctrl+C"
echo ""

dotnet watch run --launch-profile https



