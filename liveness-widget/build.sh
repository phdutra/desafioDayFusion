#!/bin/bash

# Script para build do widget React
# Tenta diferentes métodos de instalação

echo "🔧 Build do Widget Face Liveness..."

# Tentar corrigir permissões (pode pedir senha)
echo "⚠️  Corrigindo permissões do npm cache..."
sudo chown -R $(whoami) ~/.npm 2>/dev/null || echo "⚠️  Não foi possível corrigir permissões automaticamente. Execute manualmente: sudo chown -R $(whoami) ~/.npm"

# Limpar cache do npm
echo "🧹 Limpando cache..."
npm cache clean --force 2>/dev/null || true

# Tentar instalar com npm
echo "📦 Instalando dependências com npm..."
if npm install; then
    echo "✅ npm install concluído"
else
    echo "❌ npm install falhou. Tentando com yarn..."
    
    # Tentar yarn se disponível
    if command -v yarn &> /dev/null; then
        echo "📦 Instalando com yarn..."
        yarn install
    else
        echo "❌ yarn não disponível. Instale yarn ou corrija permissões do npm."
        exit 1
    fi
fi

# Build
echo "🏗️  Buildando widget..."
npm run build || yarn build

# Copiar para Angular
if [ -f "dist/widget.js" ]; then
    echo "📋 Copiando widget para Angular..."
    cp dist/widget.js ../frontend/src/assets/liveness/widget.js
    echo "✅ Widget copiado para frontend/src/assets/liveness/widget.js"
    echo "✅ Build concluído com sucesso!"
else
    echo "❌ Arquivo dist/widget.js não encontrado. Build pode ter falhado."
    exit 1
fi

