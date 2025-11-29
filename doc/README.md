# 📚 Documentação DayFusion - AWS Face Liveness

Documentação completa do sistema de verificação facial usando AWS Amplify Face Liveness.

---

## 📖 Documentos Disponíveis

### 🎯 Guias Principais

1. **[Referência Rápida](amplify-liveness-quick-reference.md)** ⚡
   - Comandos úteis e troubleshooting rápido
   - Configurações essenciais
   - Guia de consulta diária

2. **[Checklist de Validação](amplify-liveness-validation-checklist.md)** ✅
   - Checklist completo de testes
   - Pré-requisitos detalhados
   - Troubleshooting aprofundado
   - Métricas de sucesso

3. **[Captura Final - Guia Rápido](captura-final-guia-rapido.md)** 🎯
   - Implementação focada e simplificada
   - 100% funcional em web e mobile
   - Interface moderna e intuitiva
   - Liveness puro sem documento

4. **[Captura Final - Resumo](captura-final-resumo.md)** 📊
   - Detalhes da implementação
   - Características técnicas
   - Fluxo completo
   - Checklist de validação

### 🛠️ Scripts

Localizados em `/scripts/`:

1. **`test-liveness-complete.sh`** - Testes automatizados completos
   ```bash
   ./scripts/test-liveness-complete.sh
   ```

2. **`check-liveness-config.sh`** - Verificação de configuração
   ```bash
   ./scripts/check-liveness-config.sh
   ```

3. **`test-capture-final.sh`** - Testes específicos do Capture Final
   ```bash
   ./scripts/test-capture-final.sh
   ```

---

## 🚀 Início Rápido

### 1. Verificar Configuração
```bash
./scripts/check-liveness-config.sh
```

### 2. Iniciar Serviços
```bash
# Terminal 1 - Backend
cd backend
dotnet watch

# Terminal 2 - Frontend
cd frontend
npm run start:https
```

### 3. Testar Sistema
```bash
./scripts/test-liveness-complete.sh
```

### 4. Acessar Aplicação
```
https://localhost:4200/capture-official
```

---

## 📋 Fluxo Completo

```
┌─────────────────────────────────────────────────────────┐
│ 1. Upload de Documento (RG/CNH)                         │
│    → Validação automática                               │
│    → Score >= 85% = Documento válido                    │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Iniciar Verificação Liveness                         │
│    → Clicar "Iniciar Verificação Oficial"              │
│    → Modal abre com countdown (5s)                      │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Widget AWS Face Liveness                             │
│    → Elipse aparece na tela                            │
│    → Posicionar rosto na elipse                        │
│    → Seguir instruções de movimento facial              │
│    → Flash colorido (Face Movement and Light Challenge) │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 4. Processamento AWS                                     │
│    → AWS Rekognition analisa liveness                   │
│    → Grava vídeo da sessão                              │
│    → Extrai audit images (capturas faciais)             │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 5. Match com Documento                                   │
│    → Compara face do liveness com documento             │
│    → Calcula similarity score                           │
│    → Determina status final                             │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ 6. Resultados                                            │
│    ✅ Aprovado: Liveness ≥90% + Match ≥80% + Doc ≥85%  │
│    🔍 Revisar: Scores intermediários                    │
│    ❌ Rejeitado: Scores muito baixos                    │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 Critérios de Aprovação

| Métrica | Aprovado | Revisar | Rejeitado |
|---------|----------|---------|-----------|
| **Liveness** | ≥90% | 70-89% | <70% |
| **Match Facial** | ≥80% | 50-79% | <50% |
| **Documento** | ≥85% | 50-84% | <50% |

### Status Final

- **✅ Aprovado**: Todos os scores acima do mínimo excelente
- **🔍 Revisar**: Scores intermediários (requer análise humana)
- **❌ Rejeitado**: Qualquer score abaixo do mínimo aceitável

---

## 🔧 Configuração AWS

### Cognito Identity Pool
```
ID: us-east-1:2276b22e-33a1-4875-896e-1ec85d5debca
Region: us-east-1
```

### IAM Policy (unauthRole)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "rekognition:StartFaceLivenessSession",
      "Resource": "*"
    }
  ]
}
```

### S3 Bucket
```
Nome: dayfusion-docs
Region: us-east-1
```

---

## 🐛 Troubleshooting Rápido

### Problema: Câmera não abre
**Solução:**
1. Verificar se está em HTTPS (`npm run start:https`)
2. Conceder permissão de câmera no navegador
3. Verificar se outra app não está usando a câmera

### Problema: Elipse não aparece
**Solução:**
1. Verificar console do navegador (F12)
2. Recarregar página (Ctrl+Shift+R)
3. Verificar se widget AWS carregou (`AwsLiveness` ou `FaceLiveness`)

### Problema: Backend não responde
**Solução:**
```bash
# Verificar se está rodando
curl -k https://localhost:7197/api/liveness/ping

# Se não responder, iniciar
cd backend && dotnet watch
```

### Problema: Match retorna 0%
**Solução:**
1. Verificar se documento foi enviado ao S3
2. Verificar se audit images foram salvas
3. Verificar logs do backend para erros AWS
4. Verificar se faces são detectáveis nas imagens

---

## 📱 Suporte Mobile

### Pré-requisitos
- Frontend rodando em HTTPS com IP local
- Certificado SSL aceito no mobile
- Permissão de câmera concedida

### Teste
```
1. Acessar https://[IP-LOCAL]:4200/capture-official
2. Upload de documento (foto ou galeria)
3. Iniciar verificação
4. Posicionar rosto (fullscreen automático)
5. Seguir instruções do widget
6. Ver resultados
```

---

## 📊 Performance Esperada

| Operação | Tempo |
|----------|-------|
| Modal abre | < 1s |
| Widget carrega | < 3s |
| Auto-start | < 5s |
| Processamento completo | < 10s |

---

## 🔍 Endpoints da API

### Backend

```
POST /api/liveness/start
  → Cria sessão de liveness
  → Retorna: { sessionId, transactionId, expiresAt }

GET /api/liveness/results?sessionId={id}
  → Busca resultados da sessão
  → Retorna: { confidence, livenessDecision, auditImageUrls }

POST /api/FaceVerification/match-from-liveness
  → Match facial com documento
  → Retorna: { status, livenessScore, matchScore, documentScore }

POST /api/FaceRecognition/validate-document
  → Valida se documento é RG/CNH
  → Retorna: { isValid, documentScore, observacao }

POST /api/Storage/presigned-url
  → Gera URL pré-assinada para upload S3
  → Retorna: { url, key }
```

---

## 🎓 Recursos Adicionais

### Documentação AWS
- [AWS Amplify Liveness](https://ui.docs.amplify.aws/react/connected-components/liveness)
- [AWS Rekognition Face Liveness](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html)
- [Cognito Identity Pools](https://docs.aws.amazon.com/cognito/latest/developerguide/identity-pools.html)

### Componentes Principais
- `CaptureOfficialComponent` - Página principal
- `CaptureOfficialLivenessComponent` - Widget AWS
- `LivenessService` - Service para API de liveness
- `FaceMatchService` - Service para match facial
- `S3Service` - Service para upload/download S3

---

## ✅ Antes de Deploy

- [ ] Backend com credenciais AWS válidas
- [ ] Cognito Identity Pool criado
- [ ] IAM Policy configurada
- [ ] S3 Bucket criado e configurado
- [ ] Frontend em HTTPS (produção)
- [ ] Variáveis de ambiente configuradas
- [ ] Testes completos passaram
- [ ] Testado em Chrome, Firefox, Safari
- [ ] Testado em mobile (iOS + Android)

---

## 📞 Suporte

Em caso de dúvidas ou problemas:

1. Consultar [Checklist de Validação](amplify-liveness-validation-checklist.md)
2. Consultar [Referência Rápida](amplify-liveness-quick-reference.md)
3. Rodar scripts de diagnóstico
4. Verificar logs do backend e frontend
5. Verificar console do navegador (F12)

---

**Última atualização:** 29/11/2025  
**Versão:** 1.0.0  
**Status:** ✅ Sistema funcionando 100%
