# 🧠 Diagnóstico — Sessão Expirada (AWS Rekognition Face Liveness)

## 📋 Contexto
O log mostra que a sessão de Liveness chegou até o estado **IN_PROGRESS** (transmitindo vídeo e processando), mas terminou com:

```
status: EXPIRED
confidence: 0
livenessDecision: UNKNOWN
hasReferenceImage: false
auditImagesCount: 0
```

Isso significa que **o vídeo foi transmitido**, mas **nenhuma verificação facial foi concluída dentro do tempo limite de 3 minutos**.

---

## 🧩 Diagnóstico Técnico

### ✅ O que está funcionando
- Credenciais Cognito válidas (`hasAccessKey: true`, `hasSecretKey: true`)
- Sessão criada e reconhecida pela AWS (`sessionId` válido)
- WebRTC ativo e transmitindo vídeo (`IN_PROGRESS detectado`)
- Amplify configurado corretamente

### ⚠️ O que causou o `EXPIRED`
O Rekognition Face Liveness expira sessões automaticamente em até **3 minutos** se:
1. Nenhuma interação facial (movimento ou clique) ocorrer;
2. O usuário não clicar em **“Iniciar Verificação”**;
3. O rosto não for detectado ou ficar fora do enquadramento;
4. O widget for aberto antes das credenciais e o cronômetro começar antes da captura real.

---

## ✅ Soluções

### 1️⃣ Renderizar o widget apenas no clique
Garanta que o widget **não é criado automaticamente** ao carregar a página.
Crie um botão “Iniciar Verificação” e só então inicialize o detector:

```typescript
async startVerification() {
  await this.ensureCredentialsReady();
  this.renderWidget(); // inicia o FaceLivenessDetector apenas agora
}
```

Assim o temporizador de 3 minutos só começa **quando o usuário inicia a verificação**.

---

### 2️⃣ Confirmar clique dentro do widget
Certifique-se de clicar no botão **“Iniciar Verificação”** dentro do widget (não apenas abrir a tela).  
O Rekognition **só processa o vídeo após esse evento**.

Sem o clique, ele mantém `status: IN_PROGRESS` até expirar.

---

### 3️⃣ Garantir captura facial válida
Verifique que a câmera está:
- Com permissão no Chrome (`🔒 > Permissões > Câmera > Permitir`);
- Rosto bem enquadrado e iluminado;
- Usuário olhando diretamente para a câmera.

O log `hasReferenceImage: false` indica que nenhum frame útil foi capturado.

---

### 4️⃣ Aumentar polling de resultados
Para dar mais tempo de processamento após o vídeo:

```typescript
const maxAttempts = 30; // padrão: 15
const pollingDelay = 8000; // 8 segundos entre polls
```

Isso evita que o polling encerre antes da AWS retornar o resultado final.

---

### 5️⃣ Evitar renderizar antes das credenciais AWS
Aguarde as credenciais Cognito antes de criar o detector:

```typescript
const creds = AWS.config.credentials as AWS.CognitoIdentityCredentials;
await creds.getPromise();
this.renderWidget();
```

---

## 📋 Checklist Final

| Item | Esperado | Situação Atual |
|------|-----------|----------------|
| Sessão criada com sucesso | ✅ | OK |
| WebRTC ativo | ✅ | OK |
| Captura facial (hasReferenceImage) | ✅ | ❌ |
| Clique em “Iniciar Verificação” | ✅ | ❌ |
| Sessão expira após 3 min | ⚠️ | Corrigir via fluxo de start |
| Confidence > 0 | ✅ | ❌ |

---

## 🧠 Conclusão
O sistema está **quase 100% funcional**.  
A sessão foi criada e transmitiu vídeo, mas expirou antes da confirmação de liveness.  
A correção está no **momento da inicialização e interação do usuário**, não nas credenciais ou backend.

---

👨‍💻 **Autor:** Rapha Dutra  
📅 Atualizado: Novembro/2025  
🚀 Projeto: DayFusion — AWS Rekognition FaceID POC
