# Diagnóstico: Widget Face Liveness - Verificação de Mock

## ✅ Verificação: Widget NÃO está mockado

O widget usa o componente oficial `FaceLivenessDetector` da AWS Amplify:
- **Fonte**: `liveness-widget/src/widget.jsx`
- **Componente**: `@aws-amplify/ui-react-liveness` v3.4.7
- **Implementação**: WebRTC real via AWS Rekognition Face Liveness

## ⚠️ Problema Identificado: Shadow DOM vs WebRTC

O widget está sendo convertido para Web Component usando `react-to-webcomponent`, que **por padrão usa Shadow DOM**. Isso pode causar problemas com:

1. **WebRTC**: Acesso à câmera pode ser bloqueado dentro de Shadow DOM
2. **Permissões de mídia**: `getUserMedia()` pode não funcionar corretamente
3. **Isolamento de contexto**: Shadow DOM isola o DOM, dificultando a comunicação WebRTC

## 🔍 Como Verificar se está Funcionando

### 1. Verificar Shadow DOM
```javascript
const widget = document.querySelector('face-liveness-widget')
console.log('Shadow DOM:', widget.shadowRoot) // Se null, não tem Shadow DOM
```

### 2. Verificar WebRTC
```javascript
// Verificar se há conexão WebRTC ativa
const connections = window.RTCPeerConnection || window.webkitRTCPeerConnection
console.log('WebRTC disponível:', !!connections)

// Verificar streams de mídia
const videoElements = document.querySelectorAll('video')
videoElements.forEach(video => {
  console.log('Video stream:', video.srcObject)
  console.log('Video playing:', !video.paused)
})
```

### 3. Verificar Console do Widget
Procure por logs do widget:
- `✅ [widget.jsx] Todas as verificações passaram, renderizando FaceLivenessDetector...`
- Erros relacionados a `getUserMedia` ou `RTCPeerConnection`

## 🛠️ Solução: Desabilitar Shadow DOM

O `react-to-webcomponent` pode ser configurado para **não usar Shadow DOM**:

```javascript
const FaceLivenessElement = reactToWebComponent(
  FaceLivenessWidget, 
  React, 
  ReactDOM,
  {
    shadow: false // ✅ Desabilitar Shadow DOM
  }
)
```

## 📋 Próximos Passos

1. **Atualizar `main.jsx`** para desabilitar Shadow DOM
2. **Rebuild do widget** (`npm run build` no diretório `liveness-widget`)
3. **Copiar widget.js** para `frontend/src/assets/liveness/`
4. **Testar** se WebRTC funciona corretamente

## 🔗 Referências

- [react-to-webcomponent docs](https://github.com/bitovi/react-to-webcomponent)
- [AWS Face Liveness Detector](https://docs.amplify.aws/react/build-a-backend/auth/liveness-detector/)
- [WebRTC e Shadow DOM issues](https://github.com/w3c/webrtc-pc/issues/244)

