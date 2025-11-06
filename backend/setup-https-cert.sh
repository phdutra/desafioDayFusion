#!/bin/bash

# Script para configurar certificado HTTPS para desenvolvimento
# Uso: ./setup-https-cert.sh

echo "🔐 Configurando certificado HTTPS para desenvolvimento .NET..."
echo ""

# Limpar certificados antigos
echo "1. Limpando certificados antigos..."
dotnet dev-certs https --clean 2>/dev/null || echo "   (nenhum certificado para limpar)"

# Gerar novo certificado
echo "2. Gerando novo certificado..."
dotnet dev-certs https

# Confiar no certificado
echo "3. Confiando no certificado (pode pedir senha do macOS)..."
dotnet dev-certs https --trust

# Verificar certificado
echo ""
echo "4. Verificando certificado..."
if dotnet dev-certs https --check --verbose 2>&1 | grep -q "Valid certificates"; then
    echo "✅ Certificado configurado com sucesso!"
else
    echo "⚠️  Certificado pode precisar de configuração manual"
    echo ""
    echo "Se o certificado não funcionar, execute manualmente:"
    echo "  dotnet dev-certs https --clean"
    echo "  dotnet dev-certs https"
    echo "  dotnet dev-certs https --trust"
fi

echo ""
echo "✅ Configuração concluída!"
echo ""
echo "Agora você pode iniciar o backend com:"
echo "  dotnet run --launch-profile https"


