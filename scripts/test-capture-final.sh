#!/bin/bash

###############################################################################
# Script de Teste - Captura Final (AWS Face Liveness)
# 
# Testa funcionalidade básica da página Capture Final
#
# Uso: ./scripts/test-capture-final.sh
###############################################################################

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

BACKEND_URL="https://localhost:7197"
FRONTEND_URL="https://localhost:4200"

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                                            ║${NC}"
echo -e "${BLUE}║        🧪 Teste Rápido - Captura Final                    ║${NC}"
echo -e "${BLUE}║                                                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Verificar backend
echo -e "${YELLOW}[1/4] Verificando Backend...${NC}"
echo -n "  → Backend rodando... "
if curl -k -s --connect-timeout 5 "$BACKEND_URL/api/liveness/ping" > /dev/null 2>&1; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
    echo -e "${RED}Backend não está rodando. Execute: cd backend && dotnet watch${NC}"
    exit 1
fi
echo ""

# Verificar frontend
echo -e "${YELLOW}[2/4] Verificando Frontend...${NC}"
echo -n "  → Frontend rodando... "
if curl -k -s --connect-timeout 5 "$FRONTEND_URL" > /dev/null 2>&1; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
    echo -e "${RED}Frontend não está rodando. Execute: cd frontend && npm run start:https${NC}"
    exit 1
fi
echo ""

# Testar endpoint de criação de sessão
echo -e "${YELLOW}[3/4] Testando Criação de Sessão...${NC}"
echo -n "  → POST /api/liveness/start... "
response=$(curl -k -s -w "\n%{http_code}" -X POST "$BACKEND_URL/api/liveness/start" 2>/dev/null)
status=$(echo "$response" | tail -n1)
body=$(echo "$response" | head -n-1)

if [ "$status" = "200" ]; then
    session_id=$(echo "$body" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
    if [ ! -z "$session_id" ]; then
        echo -e "${GREEN}✅ SessionID: $session_id${NC}"
    else
        echo -e "${RED}❌ SessionID não retornado${NC}"
        exit 1
    fi
else
    echo -e "${RED}❌ HTTP $status${NC}"
    exit 1
fi
echo ""

# Verificar página Capture Final
echo -e "${YELLOW}[4/4] Verificando Página Capture Final...${NC}"
echo -n "  → Página carrega... "
page=$(curl -k -s "$FRONTEND_URL/capture-final" 2>/dev/null)
if echo "$page" | grep -q "<!doctype html"; then
    echo -e "${GREEN}✅${NC}"
else
    echo -e "${RED}❌${NC}"
    exit 1
fi
echo ""

# Resumo
echo "═══════════════════════════════════════════════════════════"
echo ""
echo -e "${GREEN}✅ Todos os testes passaram!${NC}"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo -e "${BLUE}Acesse a página:${NC}"
echo -e "  ${YELLOW}$FRONTEND_URL/capture-final${NC}"
echo ""
echo -e "${BLUE}Passos:${NC}"
echo "  1. Clicar em 'Iniciar Verificação Facial'"
echo "  2. Aguardar countdown (3 segundos)"
echo "  3. Posicionar rosto na elipse"
echo "  4. Seguir instruções do widget"
echo "  5. Verificar resultados"
echo ""

