import { useEffect, useState } from 'react'
import { Amplify } from 'aws-amplify'
import { FaceLivenessDetector } from '@aws-amplify/ui-react-liveness'

// Componente oficial AWS Amplify Face Liveness com WebRTC real
// O elemento recebe atributos HTML (region, createSessionUrl, resultsUrl)
export default function Widget() {
  const [sessionId, setSessionId] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const el = document.currentScript?.ownerDocument?.currentScript ||
               document.querySelector('face-liveness-widget')
    
    const region = el?.getAttribute('region') || 'us-east-1'
    const createUrl = el?.getAttribute('create-session-url') // ex.: /api/liveness/session
    const identityPoolId = el?.getAttribute('identity-pool-id') // ID do Identity Pool passado pelo Angular

    if (!identityPoolId) {
      setError('identity-pool-id não fornecido. Configure o Identity Pool ID no componente Angular.')
      setLoading(false)
      return
    }

    // ✅ Configurar Amplify com Identity Pool (sem login de usuário)
    // Amplify v6 - configuração para usar apenas Identity Pool
    try {
      Amplify.configure({
        Auth: {
          Cognito: {
            identityPoolId: identityPoolId,
            allowGuestAccess: true,
          }
        }
      })
      console.log('✅ Amplify configurado com Identity Pool:', identityPoolId)
    } catch (configError) {
      console.warn('⚠️ Erro ao configurar Amplify v6, tentando configuração alternativa:', configError)
      // Fallback para configuração compatível
      Amplify.configure({
        Auth: {
          region: region,
          identityPoolId: identityPoolId,
          identityPoolRegion: region,
        }
      })
    }

    // Criar sessão ao montar
    if (createUrl) {
      fetch(createUrl, { method: 'POST' })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`)
          return r.json()
        })
        .then(data => {
          if (data.sessionId) {
            setSessionId(data.sessionId)
            setLoading(false)
            console.log('✅ Sessão criada:', data.sessionId)
          } else {
            throw new Error('Resposta da sessão não contém sessionId')
          }
        })
        .catch(err => {
          console.error('Erro ao criar sessão:', err)
          setError(err.message || 'Erro ao criar sessão de liveness')
          setLoading(false)
        })
    } else {
      setError('create-session-url não fornecido')
      setLoading(false)
    }
  }, [])


  const handleAnalysisComplete = async () => {
    const el = document.querySelector('face-liveness-widget')
    const resultsUrl = el?.getAttribute('results-url')
    
    if (resultsUrl && sessionId) {
      try {
        // Chama seu backend para buscar resultados e salvar as imagens no S3
        const response = await fetch(`${resultsUrl}?sessionId=${sessionId}`)
        const data = await response.json()
        
        // Disparar evento customizado para o Angular escutar
        const event = new CustomEvent('liveness-complete', { detail: data })
        document.dispatchEvent(event)
      } catch (err) {
        console.error('Erro ao buscar resultados:', err)
        const errorEvent = new CustomEvent('liveness-error', { 
          detail: { message: err.message } 
        })
        document.dispatchEvent(errorEvent)
      }
    }
  }

  const handleError = (error) => {
    console.error('Erro no Face Liveness:', error)
    const errorEvent = new CustomEvent('liveness-error', { 
      detail: { message: error.message || 'Erro durante verificação de liveness' } 
    })
    document.dispatchEvent(errorEvent)
  }

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center' }}>
        <div>Carregando sessão...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '20px', color: 'red', textAlign: 'center' }}>
        <div>Erro: {error}</div>
        <p style={{ fontSize: '12px', marginTop: '10px', color: '#666' }}>
          Verifique se o backend está rodando e se as URLs estão corretas.
        </p>
      </div>
    )
  }

  if (!sessionId) {
    return (
      <div style={{ padding: '20px', color: 'orange', textAlign: 'center' }}>
        <div>Sessão não criada</div>
      </div>
    )
  }

  // ✅ Usa o FaceLivenessDetector com WebRTC real e sem login
  // Usar a região extraída do atributo ou padrão
  const widgetRegion = document.querySelector('face-liveness-widget')?.getAttribute('region') || 'us-east-1'
  
  return (
    <FaceLivenessDetector
      sessionId={sessionId}
      region={widgetRegion}
      onAnalysisComplete={handleAnalysisComplete}
      onError={handleError}
      displayText={{
        cameraMinSpecificationsHeadingText: "Use a câmera frontal do seu dispositivo",
        cameraMinSpecificationsMessageText: "Verifique se sua câmera atende aos requisitos mínimos",
        goodFitCaptionText: "Posição perfeita",
        hintMoveFaceText: "Não detectamos um rosto. Ajuste sua posição.",
        hintTooCloseText: "Muito perto da câmera. Afaste-se um pouco.",
        hintTooFarText: "Muito longe. Aproxime-se da câmera.",
        hintCenterFaceText: "Centralize seu rosto na tela.",
        photosensitivityWarningBodyText: "Este teste de liveness usa luz estroboscópica que pode afetar pessoas com epilepsia fotossensível. Caso deseje continuar, clique em OK.",
        photosensitivityWarningHeadingText: "Aviso de fotossensibilidade",
        instructionMoveCloserText: "Muito longe. Aproxime-se da câmera.",
        instructionMoveFartherText: "Muito perto da câmera. Afaste-se um pouco.",
        instructionMoveFaceText: "Ajuste sua posição até centralizar seu rosto na tela.",
        startScreenBeginCheckText: "Iniciar Verificação"
      }}
    />
  )
}

