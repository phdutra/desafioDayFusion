#!/bin/bash

# Script master para limpar e reiniciar todo o projeto DayFusion
# Uso: ./clean-and-start-all.sh

echo "🎯 DayFusion - Limpeza e Reinicialização Completa"
echo "=================================================="
echo ""

# Guardar diretório atual
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Limpar Frontend
echo ""
echo "📌 Limpando Frontend Angular..."
echo "----------------------------------------"
cd "$SCRIPT_DIR/frontend" && rm -rf dist .angular node_modules/.cache && npm cache clean --force
echo "✅ Concluído!"

# Limpar Backend  
echo ""
echo "📌 Limpando Backend .NET..."
echo "----------------------------------------"
cd "$SCRIPT_DIR/backend" && rm -rf bin obj && dotnet clean 2>/dev/null || echo "⚠️  dotnet clean pode ter falhado (normal se não houver projeto .NET)"
echo "✅ Concluído!"

echo ""
echo "=================================================="
echo "🎉 Limpeza concluída com sucesso!"
echo ""
echo "Para iniciar os serviços, execute em terminais separados:"
echo ""
echo "  Terminal 1 - Backend:"
echo "    cd backend && dotnet restore && dotnet run --urls 'http://localhost:5100'"
echo ""
echo "  Terminal 2 - Frontend:"
echo "    cd frontend && npm install && npm run start"
echo ""
echo "Ou use:"
echo "  cd backend && ./clean-and-start.sh"
echo "  cd frontend && ./clean-and-start.sh"
echo ""
echo "=================================================="

