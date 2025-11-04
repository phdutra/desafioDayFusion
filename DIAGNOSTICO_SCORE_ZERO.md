# 🔍 Diagnóstico: Score Zero no Face Liveness 3D

## Problema Identificado

O score está retornando **0.0%** porque o widget AWS Face Liveness não está conseguindo transmitir vídeo via WebRTC para o AWS Rekognition. O status da sessão permanece **"CREATED"** (criada, mas sem vídeo transmitido).

## Sintomas

- Status da sessão: `CREATED` (nunca muda para `SUCCEEDED` ou `IN_PROGRESS`)
- Score de confiança: `0.0%`
- Qualidade: `POOR`
- Mensagens no console: "Status ainda CREATED após X tentativas. Widget pode não ter transmitido vídeo via WebRTC"

## Causas Possíveis

### 1. **Widget não inicializa corretamente**
- O widget AWS Face Liveness precisa estar completamente carregado e inicializado antes de começar a transmitir vídeo
- Pode haver problemas com o carregamento do script `widget.js`

### 2. **Cognito Identity Pool sem permissões**
- O Cognito Identity Pool precisa ter permissões para acessar o serviço AWS Rekognition Face Liveness
- Permissão necessária: `rekognition:CreateFaceLivenessSession`, `rekognition:GetFaceLivenessSessionResults`

### 3. **WebRTC não conecta**
- WebRTC requer HTTPS ou localhost
- Bloqueadores de WebRTC podem impedir a conexão
- Firewall ou proxy podem bloquear conexões WebRTC

### 4. **Formato da resposta da API incorreto**
- O widget espera um formato específico de resposta da API de criação de sessão
- URLs podem estar incorretas ou inacessíveis

## Correções Implementadas

### 1. Melhorias no Componente Frontend (`capture3d.component.ts`)
- ✅ Adicionado método `initializeWidget()` para verificar inicialização do widget
- ✅ Verificações mais robustas de configuração AWS SDK
- ✅ Logs detalhados para diagnóstico
- ✅ Validação de Identity Pool ID antes de inicializar

### 2. Ajustes no Backend (`LivenessController.cs`)
- ✅ Tempo de expiração corrigido para 3 minutos (conforme AWS)
- ✅ Logs mais detalhados
- ✅ Formato de resposta padronizado

## Próximos Passos para Resolver

### 1. Verificar Permissões do Cognito Identity Pool

No console AWS, verifique se o Identity Pool `us-east-1:2276b22e-33a1-4875-896e-1ec85d5debca` tem a seguinte política IAM anexada:

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

### 2. Verificar se está rodando em HTTPS ou localhost

- ✅ **localhost** (http://localhost:4200) - Funciona
- ✅ **HTTPS** - Funciona
- ❌ **HTTP em IP ou domínio** - NÃO funciona (WebRTC bloqueado)

### 3. Verificar Console do Navegador

Abra o DevTools (F12) e verifique:
- Erros de WebRTC no console
- Erros de CORS nas requisições
- Erros relacionados ao Cognito Identity Pool
- Mensagens de "Access Denied" ou "Unauthorized"

### 4. Testar Configuração AWS SDK

No console do navegador, execute:

```javascript
// Verificar se AWS SDK está disponível
console.log('AWS SDK:', window.AWS)

// Verificar configuração
console.log('AWS Config:', window.AWS?.config)

// Verificar credenciais
window.AWS?.config?.credentials?.get((err, creds) => {
  if (err) {
    console.error('Erro ao obter credenciais:', err)
  } else {
    console.log('Credenciais obtidas:', creds)
  }
})
```

### 5. Verificar Widget no DOM

No console do navegador, execute:

```javascript
const widget = document.querySelector('face-liveness-widget')
console.log('Widget:', widget)
console.log('Atributos:', {
  region: widget?.getAttribute('region'),
  createSessionUrl: widget?.getAttribute('create-session-url'),
  resultsUrl: widget?.getAttribute('results-url'),
  identityPoolId: widget?.getAttribute('identity-pool-id')
})
```

## Verificações Adicionais

1. **Widget.js está carregado?**
   - Verifique no Network tab se `/assets/liveness/widget.js` foi carregado
   - Tamanho esperado: ~2MB

2. **API está respondendo corretamente?**
   - Teste `POST /api/liveness/session` manualmente
   - Verifique se retorna `sessionId`, `transactionId`, `expiresAt`

3. **Cognito Identity Pool existe?**
   - Verifique no console AWS se o Identity Pool existe e está na região correta (us-east-1)

## Logs para Análise

Após as correções, os logs devem mostrar:

```
✅ Widget encontrado no DOM
✅ AWS SDK configurado e credenciais disponíveis
✅ Widget sinalizou que está pronto
📋 Configuração do widget: { region, createSessionUrl, resultsUrl, identityPoolId }
```

Se aparecerem erros, eles indicarão qual é o problema específico.

## Contato AWS Support

Se o problema persistir após verificar todos os itens acima, pode ser necessário:
1. Verificar se o serviço Face Liveness está habilitado na sua conta AWS
2. Verificar limites de rate limiting
3. Verificar se há problemas conhecidos na região us-east-1
