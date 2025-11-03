# 🔒 Configuração HTTPS para WebRTC - DayFusion

## 📋 Contexto

Conforme `README_AWS_Liveness_WebRTC_Fix.md`, o **WebRTC é obrigatório** para o AWS Rekognition Face Liveness funcionar corretamente. O WebRTC **requer HTTPS** em contexto seguro.

## ✅ Configuração Realizada

### 1. HTTPS Configurado no Angular

- **Arquivo:** `angular.json`
- **Configuração:** SSL habilitado com certificados autoassinados
- **Certificados:** Criados em `frontend/ssl/`
  - `localhost.pem` (certificado)
  - `localhost-key.pem` (chave privada)

### 2. Scripts Atualizados

- **Script padrão:** `npm start` ou `ng serve` (já usa HTTPS automaticamente)
- **Script alternativo:** `npm run start:https` (explícito)

### 3. Código Atualizado

- ✅ Removida implementação WebRTC manual (não funciona conforme documentação AWS)
- ✅ Adicionado tratamento de expiração de sessão (3 minutos)
- ✅ Permissões de câmera já solicitadas explicitamente via `getUserMedia()`
- ✅ Documentação inline sobre limitações e próximos passos

## 🚀 Como Executar

### Desenvolvimento Local

**IMPORTANTE:** Pare qualquer servidor Angular em execução antes de iniciar:

```bash
# 1. Parar servidor anterior (se estiver rodando)
pkill -f "ng serve" || true

# 2. Limpar cache (se necessário)
cd frontend
rm -rf .angular node_modules/.cache

# 3. Iniciar servidor com HTTPS
npm start
# ou explicitamente:
npm run start:https
```

O servidor iniciará em **https://localhost:4200** (não http).

**Verificação:** Verifique na barra de endereços do navegador que está mostrando `https://localhost:4200` e não `http://localhost:4200`.

### ⚠️ Aviso do Navegador

Ao acessar `https://localhost:4200`, o navegador exibirá um aviso de segurança porque o certificado é autoassinado. Isso é **normal em desenvolvimento**.

**Como prosseguir:**
1. Clique em "Avançado" ou "Advanced"
2. Clique em "Continuar para localhost" ou "Proceed to localhost"
3. O site funcionará normalmente

### 🧹 Limpeza de Cache do Navegador

Se o navegador ainda mostrar HTTP em vez de HTTPS:

1. **Limpar cache do navegador:**
   - Chrome: `Ctrl+Shift+Delete` (Windows/Linux) ou `Cmd+Shift+Delete` (Mac)
   - Selecione "Cache de imagens e arquivos" ou "Cached images and files"
   - Clique em "Limpar dados"

2. **Desregistrar Service Worker (se aplicável):**
   - Chrome: `F12` → Aba "Application" → "Service Workers" → "Unregister"

3. **Fechar todas as abas do localhost e reabrir**

4. **Usar modo anônimo/privado para testar:**
   - `Ctrl+Shift+N` (Chrome) ou `Cmd+Shift+N` (Mac)

### 🔄 Script de Reinício Rápido

Use o script fornecido para garantir limpeza completa:

```bash
cd frontend
./start-https.sh
```

### Produção

Em produção, use certificados SSL válidos (Let's Encrypt, AWS Certificate Manager, etc.).

## 📝 Notas Técnicas

### WebRTC e AWS Rekognition

Segundo a documentação oficial AWS:
- A AWS **não expõe diretamente** endpoints SDP/ICE para uso manual
- O componente oficial **FaceLivenessDetector** (AWS Amplify UI React) gerencia o WebRTC automaticamente
- Implementações WebRTC manuais **não funcionam** com Rekognition Face Liveness

### Próximos Passos

Para integração completa com WebRTC:
1. Usar componente oficial AWS Amplify UI React via Web Components no Angular
2. Ou aguardar componente Angular oficial da AWS
3. Atualmente, o backend faz polling e consegue obter resultados mesmo sem streaming WebRTC completo

### Sessão de Liveness

- **Validade:** 3 minutos (conforme AWS)
- **Tratamento:** Timer automático no componente `capture3d`
- **Recuperação:** Criar nova sessão se expirar

## 🔗 Referências

- `README_AWS_Liveness_WebRTC_Fix.md` - Documentação completa sobre WebRTC
- [AWS Rekognition Face Liveness Docs](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html)

