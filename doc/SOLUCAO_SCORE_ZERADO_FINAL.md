# 🔴 Solução: Score Zerado no Face Liveness 3D

## 📊 Análise dos Logs

```
Session 15b9ad8d-0123-4015-8d6b-fbff20203929 status check #1: Status=CREATED, Confidence=0
ReferenceImage is null
No audit images available
Status: CREATED for session
```

**Conclusão:** Sessão criada, mas **vídeo nunca foi transmitido via WebRTC**.

---

## ⚠️ PROBLEMA IDENTIFICADO

O widget `FaceLivenessDetector` oficial foi instalado, mas **NÃO está iniciando o WebRTC**.

### 🧩 Causa

**Cognito Identity Pool** é **OBRIGATÓRIO** para o `FaceLivenessDetector` da AWS Amplify.

Sem o Identity Pool:
- ❌ Amplify não consegue se autenticar
- ❌ WebRTC não inicia
- ❌ Vídeo não é transmitido
- ❌ Score = 0%

---

## ✅ SOLUÇÃO DEFINITIVA

### Opção 1: Configurar Cognito (Recomendado)

**Passo 1:** Criar Cognito Identity Pool

1. Acesse: https://console.aws.amazon.com/cognito/
2. **Identity pools** → **Create identity pool**
3. Nome: `dayfusion_liveness`
4. ✅ **Enable unauthenticated identities** (ESSENCIAL!)
5. **Unauthenticated role**: Criar nova ou usar existente
6. **Create**

**Passo 2:** Configurar IAM Permissions

Adicione na role do Identity Pool:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rekognition:CreateFaceLivenessSession",
        "rekognition:GetFaceLivenessSessionResults"
      ],
      "Resource": "*"
    }
  ]
}
```

**Passo 3:** Atualizar Widget

Copie o **Identity Pool ID** e atualize `liveness-widget/src/widget.jsx`:

```javascript
Amplify.configure({ 
  Auth: { 
    region: 'us-east-1',
    identityPoolId: 'us-east-1:xxxx-xxxx-xxxx' // COLE O ID AQUI
  } 
})
```

**Passo 4:** Recompilar e Testar

```bash
cd liveness-widget
npm run build
cp dist/widget.js ../frontend/src/assets/liveness/widget.js
cd ../frontend
npm run start:https  # REINICIAR em HTTPS!
```

---

### Opção 2: Usar Backend Direct (ALTERNATIVA)

Se não quiser usar Cognito, **você NÃO pode usar** o `FaceLivenessDetector` oficial.

**Alternativa:** Implementar WebRTC manual (complexo, não recomendado).

---

## 🔍 Verificação

Após configurar o Cognito, os logs devem mostrar:

```
✅ Session created
✅ WebRTC connection established
✅ Status=SUCCEEDED (não mais CREATED)
✅ Confidence=87.41 (não mais 0)
✅ Images: ReferenceImage + AuditImages presentes
```

---

## 📝 Resumo

| Item | Status Atual | Ação |
|------|--------------|------|
| Widget oficial | ✅ Instalado | OK |
| Backend API | ✅ Funcionando | OK |
| Cognito Identity Pool | ❌ **FALTANDO** | **CRIAR** |
| WebRTC | ❌ Não inicia | **FALTA COGNITO** |
| Score | 0% | **FALTA COGNITO** |

**Próximo passo:** Criar o Cognito Identity Pool conforme Opção 1 acima.

---

**Documentação:** `PROXIMOS_PASSOS_LIVENESS.md`

