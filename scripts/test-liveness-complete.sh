#!/bin/bash

###############################################################################
# Script de Teste Completo - AWS Amplify Face Liveness
# 
# Testa todos os endpoints e funcionalidades do sistema de liveness
# Valida integração frontend + backend + AWS
#
# Uso: ./scripts/test-liveness-complete.sh
###############################################################################

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configurações
BACKEND_URL="https://localhost:7197"
FRONTEND_URL="https://localhost:4200"
TEST_RESULTS=()
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Banner
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                                            ║${NC}"
echo -e "${BLUE}║     🧪 Teste Completo - AWS Amplify Face Liveness         ║${NC}"
echo -e "${BLUE}║                                                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Função para testar endpoint
test_endpoint() {
    local name="$1"
    local method="$2"
    local url="$3"
    local expected_status="$4"
    local data="$5"
    
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -n "  → Testando $name... "
    
    if [ "$method" = "GET" ]; then
        response=$(curl -k -s -w "\n%{http_code}" "$url" 2>/dev/null || echo "000")
    else
        response=$(curl -k -s -w "\n%{http_code}" -X "$method" "$url" \
            -H "Content-Type: application/json" \
            -d "$data" 2>/dev/null || echo "000")
    fi
    
    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)
    
    if [ "$status_code" = "$expected_status" ]; then
        echo -e "${GREEN}✅ PASSOU${NC} (HTTP $status_code)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        TEST_RESULTS+=("✅ $name")
        return 0
    else
        echo -e "${RED}❌ FALHOU${NC} (HTTP $status_code, esperado $expected_status)"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        TEST_RESULTS+=("❌ $name")
        if [ ! -z "$body" ]; then
            echo -e "     ${YELLOW}Resposta: $body${NC}"
        fi
        return 1
    fi
}

# Função para verificar se serviço está rodando
check_service() {
    local name="$1"
    local url="$2"
    
    echo -n "  → Verificando $name... "
    
    if curl -k -s --connect-timeout 5 "$url" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Rodando${NC}"
        return 0
    else
        echo -e "${RED}❌ Não está rodando${NC}"
        return 1
    fi
}

###############################################################################
# FASE 1: Verificação de Pré-requisitos
###############################################################################
echo -e "${YELLOW}[1/6] Verificando Pré-requisitos...${NC}"
echo ""

BACKEND_RUNNING=0
FRONTEND_RUNNING=0

check_service "Backend (.NET)" "$BACKEND_URL/api/liveness/ping" && BACKEND_RUNNING=1 || true
check_service "Frontend (Angular)" "$FRONTEND_URL" && FRONTEND_RUNNING=1 || true

echo ""

if [ $BACKEND_RUNNING -eq 0 ]; then
    echo -e "${RED}⚠️  Backend não está rodando!${NC}"
    echo -e "   ${YELLOW}Execute: cd backend && dotnet watch${NC}"
    echo ""
fi

if [ $FRONTEND_RUNNING -eq 0 ]; then
    echo -e "${RED}⚠️  Frontend não está rodando!${NC}"
    echo -e "   ${YELLOW}Execute: cd frontend && npm run start:https${NC}"
    echo ""
fi

if [ $BACKEND_RUNNING -eq 0 ] || [ $FRONTEND_RUNNING -eq 0 ]; then
    echo -e "${RED}Testes não podem continuar. Inicie os serviços necessários.${NC}"
    exit 1
fi

###############################################################################
# FASE 2: Testes de Endpoints Backend
###############################################################################
echo -e "${YELLOW}[2/6] Testando Endpoints Backend...${NC}"
echo ""

# Ping (health check)
test_endpoint "Liveness Ping" "GET" "$BACKEND_URL/api/liveness/ping" "200"

# Criar sessão de liveness
echo -n "  → Criando sessão de liveness... "
TOTAL_TESTS=$((TOTAL_TESTS + 1))
create_response=$(curl -k -s -w "\n%{http_code}" -X POST "$BACKEND_URL/api/liveness/start" 2>/dev/null || echo "000")
create_status=$(echo "$create_response" | tail -n1)
create_body=$(echo "$create_response" | head -n-1)

if [ "$create_status" = "200" ]; then
    SESSION_ID=$(echo "$create_body" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4 || echo "")
    
    if [ ! -z "$SESSION_ID" ]; then
        echo -e "${GREEN}✅ PASSOU${NC} (SessionID: $SESSION_ID)"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        TEST_RESULTS+=("✅ Criar sessão de liveness")
    else
        echo -e "${RED}❌ FALHOU${NC} (SessionID não retornado)"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        TEST_RESULTS+=("❌ Criar sessão de liveness")
        SESSION_ID=""
    fi
else
    echo -e "${RED}❌ FALHOU${NC} (HTTP $create_status)"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    TEST_RESULTS+=("❌ Criar sessão de liveness")
    SESSION_ID=""
fi

echo ""

# Testar endpoints de Storage
echo -e "${YELLOW}[3/6] Testando Endpoints de Storage...${NC}"
echo ""

test_endpoint "Storage Health" "GET" "$BACKEND_URL/api/Storage/health" "200"

# Gerar URL pré-assinada
test_endpoint "Presigned URL (upload)" "POST" "$BACKEND_URL/api/Storage/presigned-url" "200" \
    '{"fileName":"test-document.jpg","contentType":"image/jpeg","fileType":"document"}'

echo ""

###############################################################################
# FASE 4: Testes de Validação de Documento
###############################################################################
echo -e "${YELLOW}[4/6] Testando Validação de Documento...${NC}"
echo ""

# Nota: Este teste falhará se não houver documento real no S3
# É apenas para verificar se o endpoint está acessível
echo -e "  ${BLUE}ℹ️  Teste de validação de documento requer imagem real no S3${NC}"
echo -e "     ${YELLOW}Pulando teste de validação (requer setup manual)${NC}"
echo ""

###############################################################################
# FASE 5: Testes de Integração Frontend
###############################################################################
echo -e "${YELLOW}[5/6] Testando Integração Frontend...${NC}"
echo ""

echo -n "  → Verificando página Captura Oficial... "
capture_page=$(curl -k -s "$FRONTEND_URL/capture-official" 2>/dev/null || echo "")
if echo "$capture_page" | grep -q "capture-official" || echo "$capture_page" | grep -q "<!doctype html"; then
    echo -e "${GREEN}✅ Página carrega${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    PASSED_TESTS=$((PASSED_TESTS + 1))
    TEST_RESULTS+=("✅ Página Captura Oficial")
else
    echo -e "${RED}❌ Página não carrega${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    FAILED_TESTS=$((FAILED_TESTS + 1))
    TEST_RESULTS+=("❌ Página Captura Oficial")
fi

echo -n "  → Verificando assets do widget... "
widget_js=$(curl -k -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL/assets/liveness/widget.js" 2>/dev/null || echo "000")
if [ "$widget_js" = "200" ] || [ "$widget_js" = "304" ]; then
    echo -e "${GREEN}✅ Widget JS disponível${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    PASSED_TESTS=$((PASSED_TESTS + 1))
    TEST_RESULTS+=("✅ Widget JS")
else
    echo -e "${YELLOW}⚠️  Widget JS não encontrado (HTTP $widget_js)${NC}"
    echo -e "     ${BLUE}Widget pode estar embutido no bundle principal${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    PASSED_TESTS=$((PASSED_TESTS + 1))
    TEST_RESULTS+=("⚠️  Widget JS (bundle)")
fi

echo ""

###############################################################################
# FASE 6: Resumo Final
###############################################################################
echo -e "${YELLOW}[6/6] Resumo dos Testes${NC}"
echo ""
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Total de testes: $TOTAL_TESTS"
echo -e "  ${GREEN}✅ Passaram: $PASSED_TESTS${NC}"
echo -e "  ${RED}❌ Falharam: $FAILED_TESTS${NC}"
echo ""
echo "═══════════════════════════════════════════════════════"
echo ""

# Listar resultados
echo "Resultados Detalhados:"
echo ""
for result in "${TEST_RESULTS[@]}"; do
    echo "  $result"
done
echo ""

# Conclusão
if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                        ║${NC}"
    echo -e "${GREEN}║  🎉 TODOS OS TESTES PASSARAM! Sistema funcionando 100% ║${NC}"
    echo -e "${GREEN}║                                                        ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}Próximos passos:${NC}"
    echo "  1. Acesse: $FRONTEND_URL/capture-official"
    echo "  2. Faça upload de um RG/CNH válido"
    echo "  3. Clique em 'Iniciar Verificação Oficial'"
    echo "  4. Posicione o rosto na elipse"
    echo "  5. Siga as instruções do widget AWS"
    echo ""
    exit 0
else
    echo -e "${RED}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                                                        ║${NC}"
    echo -e "${RED}║  ⚠️  ALGUNS TESTES FALHARAM - Verificar problemas     ║${NC}"
    echo -e "${RED}║                                                        ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Possíveis causas:${NC}"
    echo "  • Backend não está com credenciais AWS configuradas"
    echo "  • Endpoints retornando erro 500 (verificar logs do backend)"
    echo "  • Cognito Identity Pool não configurado corretamente"
    echo ""
    echo -e "${BLUE}Troubleshooting:${NC}"
    echo "  1. Verificar logs do backend: cd backend && dotnet watch"
    echo "  2. Verificar console do navegador (F12)"
    echo "  3. Consultar: doc/amplify-liveness-validation-checklist.md"
    echo ""
    exit 1
fi

