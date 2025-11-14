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
    
    if (!el) {
      setError('Elemento face-liveness-widget não encontrado')
      setLoading(false)
      return
    }
    
    const region = el.getAttribute('region') || 'us-east-1'
    const createUrl = el.getAttribute('create-session-url') // ex.: /api/liveness/session
    const identityPoolId = el.getAttribute('identity-pool-id') // ID do Identity Pool passado pelo Angular
    let providedSessionId = el.getAttribute('session-id') // SessionId já criado pelo Angular (opcional)

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
    } catch (configError) {
      // Fallback para configuração compatível
      Amplify.configure({
        Auth: {
          region: region,
          identityPoolId: identityPoolId,
          identityPoolRegion: region,
        }
      })
    }

    // Função para processar sessionId quando disponível
    const processSessionId = (sessionIdValue) => {
      if (sessionIdValue) {
        setSessionId(sessionIdValue)
        setLoading(false)
        return true
      }
      return false
    }

    // Flag para rastrear se já processamos o sessionId (compartilhada entre observer e timeout)
    let sessionIdProcessed = false
    
    // Se já recebeu session-id como atributo, usar diretamente
    if (providedSessionId) {
      if (processSessionId(providedSessionId)) {
        sessionIdProcessed = true
        return
      }
    }
    
    // Observar mudanças no atributo session-id (caso seja atualizado depois)
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'session-id') {
          const newSessionId = el.getAttribute('session-id')
          if (newSessionId && !sessionIdProcessed) {
            if (processSessionId(newSessionId)) {
              sessionIdProcessed = true
              observer.disconnect()
            }
          }
        }
      })
    })

    observer.observe(el, {
      attributes: true,
      attributeFilter: ['session-id']
    })

    // Aguardar um pouco para ver se o session-id é definido via atributo
    
    const checkSessionIdTimeout = setTimeout(() => {
      // Verificar novamente o atributo (pode ter sido atualizado)
      providedSessionId = el.getAttribute('session-id')
      if (providedSessionId && !sessionIdProcessed) {
        if (processSessionId(providedSessionId)) {
          sessionIdProcessed = true
          observer.disconnect()
          return
        }
      }

      // Se ainda não tem sessionId, tentar criar sessão
      if (!sessionIdProcessed && createUrl) {
        fetch(createUrl, { method: 'POST' })
          .then(r => {
            if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`)
            return r.json()
          })
          .then(data => {
            if (data.sessionId) {
              setSessionId(data.sessionId)
              setLoading(false)
              sessionIdProcessed = true
              observer.disconnect()
            } else {
              throw new Error('Resposta da sessão não contém sessionId')
            }
          })
          .catch(err => {
            console.error('Erro ao criar sessão:', err)
            setError(err.message || 'Erro ao criar sessão de liveness')
            setLoading(false)
            observer.disconnect()
          })
      } else if (!createUrl && !sessionIdProcessed) {
        setError('create-session-url ou session-id não fornecido')
        setLoading(false)
        observer.disconnect()
      }
    }, 500) // Aguardar 500ms para ver se o session-id é definido

    // Cleanup
    return () => {
      clearTimeout(checkSessionIdTimeout)
      observer.disconnect()
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

  // Verificar se AWS está disponível
  const windowAWS = typeof window !== 'undefined' ? window.AWS : null
  const aws = windowAWS
  if (!aws) {
    console.error("❌ AWS não está disponível no window")
    return (
      <div style={{ padding: '20px', color: 'red', textAlign: 'center' }}>
        <div>❌ Erro: AWS SDK não está disponível</div>
        <p style={{ fontSize: '12px', marginTop: '10px', color: '#666' }}>
          Verifique se o script aws-sdk está carregado no index.html
        </p>
      </div>
    )
  }
  
  // Verificar se FaceLivenessDetector está disponível
  if (!FaceLivenessDetector) {
    console.error("❌ FaceLivenessDetector não está disponível")
    return (
      <div style={{ padding: '20px', color: 'red', textAlign: 'center' }}>
        <div>❌ Erro: FaceLivenessDetector não está disponível</div>
        <p style={{ fontSize: '12px', marginTop: '10px', color: '#666' }}>
          Verifique se @aws-amplify/ui-react-liveness está instalado corretamente
        </p>
      </div>
    )
  }
  
  if (!sessionId) {
    console.error("❌ SessionId não está disponível")
    return (
      <div style={{ padding: '20px', color: 'orange', textAlign: 'center' }}>
        <div>⚠️ Sessão não criada</div>
        <p style={{ fontSize: '12px', marginTop: '10px', color: '#666' }}>
          Aguardando criação da sessão...
        </p>
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

