#!/bin/bash

# Script para parar processos do backend DayFusion
# Uso: ./stop-backend.sh

echo "🛑 Parando processos do DayFusion Backend..."
echo ""

# Verificar processos na porta 7197 (HTTPS)
echo "🔍 Verificando porta 7197 (HTTPS)..."
PIDS_7197=$(lsof -ti :7197 2>/dev/null)
if [ -z "$PIDS_7197" ]; then
    echo "✅ Porta 7197 está livre"
else
    echo "⚠️  Encontrados processos na porta 7197: $PIDS_7197"
    echo "🛑 Encerrando processos..."
    kill -9 $PIDS_7197 2>/dev/null
    echo "✅ Processos encerrados"
fi

# Verificar processos na porta 5100 (HTTP)
echo "🔍 Verificando porta 5100 (HTTP)..."
PIDS_5100=$(lsof -ti :5100 2>/dev/null)
if [ -z "$PIDS_5100" ]; then
    echo "✅ Porta 5100 está livre"
else
    echo "⚠️  Encontrados processos na porta 5100: $PIDS_5100"
    echo "🛑 Encerrando processos..."
    kill -9 $PIDS_5100 2>/dev/null
    echo "✅ Processos encerrados"
fi

# Verificar processos dotnet relacionados ao DayFusion
echo "🔍 Verificando processos dotnet do DayFusion..."
DOTNET_PIDS=$(ps aux | grep -i "dotnet.*DayFusion" | grep -v grep | awk '{print $2}')
if [ -z "$DOTNET_PIDS" ]; then
    echo "✅ Nenhum processo dotnet do DayFusion encontrado"
else
    echo "⚠️  Encontrados processos dotnet: $DOTNET_PIDS"
    echo "🛑 Encerrando processos..."
    echo $DOTNET_PIDS | xargs kill -9 2>/dev/null
    echo "✅ Processos encerrados"
fi

echo ""
echo "✅ Todos os processos do DayFusion foram encerrados!"
echo "🚀 Agora você pode iniciar o backend novamente com: dotnet run"

