import React from 'react'
import ReactDOM from 'react-dom/client'
import reactToWebComponent from 'react-to-webcomponent'
import FaceLivenessWidget from './widget.jsx'

console.log('🔧 [widget.js] Iniciando registro do custom element...')

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
  
  console.log('🔧 [widget.js] reactToWebComponent criado (sem Shadow DOM), registrando custom element...')
  
  customElements.define('face-liveness-widget', FaceLivenessElement)
  
  console.log('✅ [widget.js] Custom element face-liveness-widget registrado com sucesso!')
  
  // Disparar evento customizado para notificar que o widget está pronto
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('face-liveness-widget-ready'))
    console.log('✅ [widget.js] Evento face-liveness-widget-ready disparado')
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
