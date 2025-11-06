# 🧠 AWS Face Liveness Integration — Fix para Score 0%

## 📋 Problema original
O projeto Angular utilizava o `<face-liveness-widget>` do sample AWS.  
Esse componente **cria a sessão** (`status: CREATED`) mas **não envia o vídeo via WebRTC**, resultando sempre em:

```
status: CREATED
confidence: 0
livenessDecision: UNKNOWN
```

Mesmo com Cognito e permissões corretas.

---

## ✅ Solução: usar o `FaceLivenessDetector` oficial (Amplify SDK)

Abaixo está o passo a passo completo para substituir o widget e ativar o streaming real via WebRTC.

---

### 1️⃣ Instalar dependências

```bash
npm install aws-amplify @aws-sdk/client-rekognition
```

---

### 2️⃣ Configurar Amplify globalmente

No arquivo `main.ts` (ou `app.module.ts`), adicione:

```typescript
import { Amplify } from 'aws-amplify';
import awsExports from './aws-exports';

Amplify.configure(awsExports);
```

Verifique que o arquivo `aws-exports.ts` contém:

```typescript
const awsmobile = {
  aws_project_region: 'us-east-1',
  aws_cognito_identity_pool_id: 'us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
  aws_cognito_region: 'us-east-1'
};
export default awsmobile;
```

> ⚠️ **Importante:** o `identityPoolId` não pode estar vazio.  
> Caso contrário, o Amplify não autentica e o WebRTC não inicia.

---

### 3️⃣ Criar container no template Angular

No arquivo `capture3d.component.html`:

```html
<div id="liveness-container" *ngIf="showLivenessWidget"></div>
```

Remova o antigo `<face-liveness-widget>`.

---

### 4️⃣ Atualizar método `renderWidget()` no `capture3d.component.ts`

Substitua **todo o conteúdo** do método `renderWidget()` por este:

```typescript
private async renderWidget(): Promise<void> {
  console.log('🎨 Renderizando FaceLivenessDetector real...');

  // Garante que credenciais Cognito estão disponíveis
  const creds = this.AWS.config.credentials;
  if (!creds) throw new Error('Credenciais AWS não disponíveis.');
  await creds.getPromise();

  const container = document.getElementById('liveness-container');
  if (!container) throw new Error('Container do widget não encontrado.');

  container.innerHTML = ''; // limpa o container

  // Importar o FaceLivenessDetector do Amplify
  const { FaceLivenessDetector } = await import('aws-amplify/face-liveness');

  const detector = new FaceLivenessDetector({
    region: this.awsRegion,
    sessionId: this.livenessSession?.sessionId || '',
    credentials: this.AWS.config.credentials,
    onSuccess: (result) => {
      console.log('✅ Liveness success:', result);
      this.onLivenessComplete(result);
    },
    onError: (err) => {
      console.error('❌ Liveness error:', err);
      this.livenessError = err.message || 'Erro no Liveness';
    },
  });

  container.appendChild(detector);
}
```

---

### 5️⃣ Ajustar fluxo de inicialização

No método `ngAfterViewInit()`, mantenha a sequência:

```typescript
await this.checkWebRTC();
await this.setupAWS();
await this.ensureCredentialsReady();
// Não renderiza automaticamente aqui
```

E só chame `this.renderWidget()` **dentro do botão ou do método** que o usuário clica para iniciar a verificação (`onLivenessStart()`).

---

### 6️⃣ Verifique HTTPS e permissões

O WebRTC exige HTTPS — mesmo em localhost:

```bash
https://localhost:4200
```

Se usar certificado autoassinado, aceite o alerta no navegador.  
No Chrome: clique no cadeado → Permissões → **Câmera → Permitir**

---

### 7️⃣ Revisar permissões IAM

No Cognito → Identity Pool → Roles (Auth e Unauth), adicione esta policy inline:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rekognition:CreateFaceLivenessSession",
        "rekognition:GetFaceLivenessSessionResults",
        "kinesisvideo:GetSignalingChannelEndpoint",
        "kinesisvideo:GetIceServerConfig",
        "kinesisvideo:ConnectAsViewer",
        "kinesisvideo:ConnectAsMaster"
      ],
      "Resource": "*"
    }
  ]
}
```

---

### 8️⃣ Resultado esperado

Após o ajuste:
- O widget cria o **canal WebRTC real**
- A câmera abre imediatamente
- O status muda de `CREATED` → `IN_PROGRESS` → `SUCCEEDED`
- O campo **confidence** > `0.9`
- O score e imagens são retornados corretamente

---

### 9️⃣ Dica de debug

Abra o console do navegador e verifique:

```bash
✅ WebRTC conectado
✅ Credenciais Cognito prontas
✅ Widget inicializado (FaceLivenessDetector)
```

Se aparecer apenas `Status: CREATED` → algo ainda está usando o widget antigo.

---

## 🧩 Conclusão

O `<face-liveness-widget>` é apenas um **mock visual**.  
Para um fluxo funcional, o componente deve usar o **`FaceLivenessDetector`** oficial do **Amplify**, que autentica com Cognito e envia vídeo para a AWS via WebRTC.

---

👨‍💻 **Autor:** Rapha Dutra  
📅 Atualizado: Novembro/2025  
🚀 Projeto: DayFusion – AWS Rekognition FaceID POC
