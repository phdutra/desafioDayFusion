#!/bin/bash

# Script para limpar build e reiniciar o projeto .NET
# Uso: ./clean-and-start.sh

echo "🧹 Limpando build anterior..."

# Limpar diretórios de build
rm -rf bin
rm -rf obj

# Limpar projetos .NET restantes
dotnet clean

echo "✅ Build limpo!"

echo "📦 Restaurando dependências..."
dotnet restore

echo "✅ Dependências restauradas!"

echo "🚀 Iniciando servidor com HTTPS..."
echo "⚠️  Certificado SSL: O .NET usará o certificado de desenvolvimento automático"
echo "⚠️  Se aparecer aviso de certificado, aceite no navegador"
dotnet run --launch-profile https

