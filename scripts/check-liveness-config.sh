#!/bin/bash

###############################################################################
# Script de Verificação de Configuração - AWS Amplify Face Liveness
# 
# Verifica se todas as configurações necessárias estão corretas
#
# Uso: ./scripts/check-liveness-config.sh
###############################################################################

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Contadores
TOTAL_CHECKS=0
PASSED_CHECKS=0
FAILED_CHECKS=0

# Banner
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                                                            ║${NC}"
echo -e "${BLUE}║  🔍 Verificação de Configuração - AWS Face Liveness       ║${NC}"
echo -e "${BLUE}║                                                            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Função de verificação
check_config() {
    local name="$1"
    local condition="$2"
    
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    echo -n "  → $name... "
    
    if eval "$condition"; then
        echo -e "${GREEN}✅${NC}"
        PASSED_CHECKS=$((PASSED_CHECKS + 1))
        return 0
    else
        echo -e "${RED}❌${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

# Função de verificação com valor
check_value() {
    local name="$1"
    local file="$2"
    local pattern="$3"
    
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
    echo -n "  → $name... "
    
    if [ -f "$file" ]; then
        if grep -q "$pattern" "$file" 2>/dev/null; then
            value=$(grep "$pattern" "$file" | head -1)
            echo -e "${GREEN}✅${NC}"
            echo -e "     ${BLUE}$value${NC}"
            PASSED_CHECKS=$((PASSED_CHECKS + 1))
            return 0
        else
            echo -e "${RED}❌ Não encontrado${NC}"
            FAILED_CHECKS=$((FAILED_CHECKS + 1))
            return 1
        fi
    else
        echo -e "${RED}❌ Arquivo não existe${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

###############################################################################
# 1. Verificar Estrutura de Arquivos
###############################################################################
echo -e "${YELLOW}[1/5] Verificando Estrutura de Arquivos...${NC}"
echo ""

check_config "Backend existe" "[ -d 'backend' ]"
check_config "Frontend existe" "[ -d 'frontend' ]"
check_config "Scripts existe" "[ -d 'scripts' ]"
check_config "Doc existe" "[ -d 'doc' ]"

echo ""

###############################################################################
# 2. Verificar Configurações Frontend
###############################################################################
echo -e "${YELLOW}[2/5] Verificando Configurações Frontend...${NC}"
echo ""

check_config "aws-exports.ts existe" "[ -f 'frontend/src/aws-exports.ts' ]"

if [ -f "frontend/src/aws-exports.ts" ]; then
    check_value "Identity Pool ID" "frontend/src/aws-exports.ts" "aws_cognito_identity_pool_id"
    check_value "AWS Region" "frontend/src/aws-exports.ts" "aws_project_region"
fi

check_config "package.json existe" "[ -f 'frontend/package.json' ]"

if [ -f "frontend/package.json" ]; then
    check_value "aws-amplify instalado" "frontend/package.json" "aws-amplify"
    check_value "@aws-amplify/ui-angular instalado" "frontend/package.json" "@aws-amplify/ui-angular"
fi

echo ""

###############################################################################
# 3. Verificar Configurações Backend
###############################################################################
echo -e "${YELLOW}[3/5] Verificando Configurações Backend...${NC}"
echo ""

# Verificar se appsettings.json existe
if [ -f "backend/appsettings.json" ]; then
    check_value "AWS Region no backend" "backend/appsettings.json" "\"Region\""
    check_value "S3 Bucket no backend" "backend/appsettings.json" "\"S3Bucket\""
else
    echo -e "  ${YELLOW}⚠️  appsettings.json não encontrado (pode usar env vars)${NC}"
fi

# Verificar LivenessController
check_config "LivenessController existe" "[ -f 'backend/Controllers/LivenessController.cs' ]"

if [ -f "backend/Controllers/LivenessController.cs" ]; then
    check_config "Endpoint /start implementado" "grep -q 'StartSession' 'backend/Controllers/LivenessController.cs'"
    check_config "Endpoint /results implementado" "grep -q 'GetResults' 'backend/Controllers/LivenessController.cs'"
fi

echo ""

###############################################################################
# 4. Verificar Componentes Angular
###############################################################################
echo -e "${YELLOW}[4/5] Verificando Componentes Angular...${NC}"
echo ""

check_config "CaptureOfficialComponent existe" "[ -f 'frontend/src/app/pages/capture-official/capture-official.component.ts' ]"
check_config "CaptureOfficialLivenessComponent existe" "[ -f 'frontend/src/app/pages/capture-official/capture-official-liveness.component.ts' ]"

if [ -f "frontend/src/app/pages/capture-official/capture-official-liveness.component.ts" ]; then
    check_config "Widget AWS importado" "grep -q 'AwsLiveness\\|FaceLiveness' 'frontend/src/app/pages/capture-official/capture-official-liveness.component.ts'"
    check_config "Amplify configurado" "grep -q 'Amplify.configure' 'frontend/src/app/pages/capture-official/capture-official-liveness.component.ts'"
fi

echo ""

###############################################################################
# 5. Verificar Serviços
###############################################################################
echo -e "${YELLOW}[5/5] Verificando Serviços...${NC}"
echo ""

check_config "LivenessService existe" "[ -f 'frontend/src/app/services/liveness.service.ts' ]"

if [ -f "frontend/src/app/services/liveness.service.ts" ]; then
    check_config "createSession implementado" "grep -q 'createSession' 'frontend/src/app/services/liveness.service.ts'"
    check_config "getResult implementado" "grep -q 'getResult' 'frontend/src/app/services/liveness.service.ts'"
fi

check_config "FaceMatchService existe" "[ -f 'frontend/src/app/core/services/face-match.service.ts' ]"
check_config "S3Service existe" "[ -f 'frontend/src/app/core/aws/s3.service.ts' ]"

echo ""

###############################################################################
# Resumo
###############################################################################
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Total de verificações: $TOTAL_CHECKS"
echo -e "  ${GREEN}✅ Passaram: $PASSED_CHECKS${NC}"
echo -e "  ${RED}❌ Falharam: $FAILED_CHECKS${NC}"
echo ""
echo "═══════════════════════════════════════════════════════"
echo ""

# Conclusão
if [ $FAILED_CHECKS -eq 0 ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                        ║${NC}"
    echo -e "${GREEN}║  ✅ CONFIGURAÇÃO COMPLETA! Sistema pronto para uso     ║${NC}"
    echo -e "${GREEN}║                                                        ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}Próximos passos:${NC}"
    echo ""
    echo "  1. Iniciar backend:"
    echo -e "     ${YELLOW}cd backend && dotnet watch${NC}"
    echo ""
    echo "  2. Iniciar frontend:"
    echo -e "     ${YELLOW}cd frontend && npm run start:https${NC}"
    echo ""
    echo "  3. Rodar testes:"
    echo -e "     ${YELLOW}./scripts/test-liveness-complete.sh${NC}"
    echo ""
    exit 0
elif [ $FAILED_CHECKS -le 3 ]; then
    echo -e "${YELLOW}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${YELLOW}║                                                        ║${NC}"
    echo -e "${YELLOW}║  ⚠️  ALGUMAS CONFIGURAÇÕES FALTANDO - Revisar         ║${NC}"
    echo -e "${YELLOW}║                                                        ║${NC}"
    echo -e "${YELLOW}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}Itens faltando podem ser:${NC}"
    echo "  • Variáveis de ambiente (ao invés de appsettings.json)"
    echo "  • Arquivos opcionais que não afetam funcionalidade"
    echo ""
    echo -e "${YELLOW}Sistema pode funcionar, mas recomenda-se revisar.${NC}"
    echo ""
    exit 0
else
    echo -e "${RED}╔════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                                                        ║${NC}"
    echo -e "${RED}║  ❌ CONFIGURAÇÃO INCOMPLETA - Revisar arquivos         ║${NC}"
    echo -e "${RED}║                                                        ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${YELLOW}Possíveis problemas:${NC}"
    echo "  • Arquivos de configuração ausentes"
    echo "  • Dependências não instaladas"
    echo "  • Componentes não implementados"
    echo ""
    echo -e "${BLUE}Ações recomendadas:${NC}"
    echo "  1. Verificar se todos os arquivos existem"
    echo "  2. Rodar: cd frontend && npm install"
    echo "  3. Rodar: cd backend && dotnet restore"
    echo "  4. Consultar: doc/amplify-liveness-validation-checklist.md"
    echo ""
    exit 1
fi

