import React from 'react'
import ReactDOM from 'react-dom/client'
import reactToWebComponent from 'react-to-webcomponent'
import FaceLivenessWidget from './widget.jsx'

try {
  // Registrar o custom element
  // ✅ IMPORTANTE: shadow: false para permitir WebRTC funcionar corretamente
  // Shadow DOM pode bloquear acesso à câmera e WebRTC
  const FaceLivenessElement = reactToWebComponent(
    FaceLivenessWidget, 
    React, 
    ReactDOM,
    {
      shadow: false // Desabilitar Shadow DOM para WebRTC funcionar
    }
  )
  
  customElements.define('face-liveness-widget', FaceLivenessElement)
  
  // Disparar evento customizado para notificar que o widget está pronto
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('face-liveness-widget-ready'))
  }
} catch (error) {
  console.error('❌ [widget.js] ERRO ao registrar custom element:', error)
  console.error('❌ [widget.js] Stack trace:', error.stack)
  
  // Disparar evento de erro
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('face-liveness-widget-error', {
      detail: { error: error.message, stack: error.stack }
    }))
  }
}
