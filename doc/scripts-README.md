# 📜 Scripts de Limpeza e Inicialização

Este documento descreve os scripts disponíveis para limpar cache e reiniciar o projeto DayFusion.

## 🚀 Scripts Disponíveis

### 1. Limpeza Completa (Raiz do Projeto)

```bash
./clean-and-start-all.sh
```

**O que faz:**
- Limpa cache e builds do Frontend Angular
- Limpa build do Backend .NET
- Remove arquivos temporários e de cache

**Quando usar:**
- Ao trocar de branch
- Quando houver problemas de build
- Antes de fazer deploy
- Depois de atualizar dependências

---

### 2. Frontend Angular

#### Limpar Cache

```bash
cd frontend
npm run clean
```

Ou usando npm scripts:

```bash
# Via npm
npm run clean

# Via script bash
./clean-and-start.sh
```

#### Reiniciar Limpo

```bash
cd frontend
npm run fresh-start
```

**O que faz:**
- Remove `dist/` e `.angular/`
- Limpa cache do npm
- Reinstala dependências
- Inicia o servidor

#### Limpar + Build

```bash
cd frontend
npm run clean
npm install
npm run build
```

---

### 3. Backend .NET

#### Limpar Build

```bash
cd backend
dotnet clean
```

Ou usando o script:

```bash
cd backend
./clean-and-start.sh
```

**O que faz:**
- Remove `bin/` e `obj/`
- Executa `dotnet clean`
- Restaura dependências
- Inicia o servidor na porta 5100

---

## 📋 Ordem Recomendada para Iniciar o Projeto

### Opção 1: Scripts Automáticos

**Terminal 1 - Backend:**
```bash
cd backend
./clean-and-start.sh
```

**Terminal 2 - Frontend:**
```bash
cd frontend
./clean-and-start.sh
```

### Opção 2: Scripts NPM/Dotnet

**Terminal 1 - Backend:**
```bash
cd backend
dotnet clean
dotnet restore
dotnet run --urls "http://localhost:5100"
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run clean
npm install
npm start
```

### Opção 3: Limpeza Total e Inicialização Manual

```bash
# 1. Limpar tudo
./clean-and-start-all.sh

# 2. Backend (Terminal 1)
cd backend
dotnet restore
dotnet run --urls "http://localhost:5100"

# 3. Frontend (Terminal 2)
cd frontend
npm install
npm start
```

---

## 🛠️ Comandos Úteis Adicionais

### Frontend

```bash
# Build de produção
npm run build

# Build com HTTPS (necessário para WebRTC)
npm run start:https

# Verificar versões
ng version
```

### Backend

```bash
# Rodar testes
dotnet test

# Verificar versão
dotnet --version

# Limpar completamente
rm -rf bin obj && dotnet clean
```

---

## ⚠️ Problemas Comuns

### "Cannot find module"

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### "Build error" no Angular

```bash
cd frontend
npm run clean
rm -rf node_modules
npm install
npm run build
```

### "Clean failed" no .NET

```bash
cd backend
rm -rf bin obj
dotnet clean
dotnet restore
dotnet build
```

---

## 📝 Notas

- **Cache do npm**: Use `npm cache clean --force` se necessário
- **Cache do Angular**: É limpo automaticamente pelo script `clean`
- **Build do .NET**: Sempre use `dotnet clean` antes de rebuild
- **HTTPS**: Necessário para WebRTC do Face Liveness 3D

---

## 🔗 Arquivos Relacionados

- `frontend/package.json` - Scripts npm
- `frontend/clean-and-start.sh` - Script bash do frontend
- `backend/clean-and-start.sh` - Script bash do backend
- `clean-and-start-all.sh` - Script master

