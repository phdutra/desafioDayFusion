# 🔴 Solução: Score Zerado - Falta Transmissão WebRTC

## Problema Identificado

**HTTPS está funcionando corretamente**, mas o **score continua zerado** porque:

### Causa Raiz
O vídeo capturado pelo frontend **NÃO está sendo transmitido para a AWS Rekognition via WebRTC**.

**Fluxo atual (INCOMPLETO):**
1. ✅ Sessão criada na AWS (`CREATED`)
2. ✅ Frontend captura vídeo localmente (`getUserMedia`)
3. ❌ **Vídeo NÃO é transmitido via WebRTC para AWS**
4. ❌ AWS nunca recebe dados para processar
5. ❌ Status permanece `CREATED` (nunca muda para `SUCCEEDED`)
6. ❌ Score = 0.0% (sem processamento)
7. ❌ Sem thumbnails (geradas apenas após processamento)

## Por Que Isso Acontece?

### AWS Rekognition Face Liveness 3D Requer:

1. **Conexão WebRTC em tempo real** com servidores da AWS
2. **Handshake SDP/ICE** gerenciado automaticamente
3. **Transmissão contínua de frames de vídeo** durante a sessão

### Implementação Manual de WebRTC NÃO Funciona

Conforme documentação AWS e `README_AWS_Liveness_WebRTC_Fix.md`:
- AWS não expõe endpoints SDP/ICE diretamente
- Protocolo WebRTC requer configuração complexa (STUN/TURN, codecs, etc.)
- Componente oficial AWS gerencia tudo automaticamente

## Solução Recomendada: Widget React AWS Amplify UI

### Opção 1: Widget React como Web Component (RECOMENDADO) ⭐

**Conforme:** `day_fusion_configuration_aws_3D_livesses.md`

1. Criar micro-app React com `@aws-amplify/ui-react-liveness`
2. Expor como Web Component usando `react-to-webcomponent`
3. Integrar no Angular via tag HTML

**Prós:**
- ✅ Implementação oficial AWS
- ✅ WebRTC completo e gerenciado
- ✅ Melhor precisão de liveness
- ✅ Funciona corretamente

**Contras:**
- ❌ Requer criar widget React separado
- ❌ Bundle adicional (~200KB)

**Próximos Passos:**
- [ ] Criar pasta `frontend/liveness-widget/`
- [ ] Instalar dependências React + Amplify
- [ ] Implementar `FaceLivenessDetector` como Web Component
- [ ] Integrar no `capture3d.component.html`

---

### Opção 2: Solução Temporária - Upload de Frames (FALLBACK)

**Para POC/Demonstração enquanto widget não está pronto:**

1. Frontend captura frames durante movimento 3D
2. Backend usa `DetectFaces` para validar liveness básico
3. Calcula score baseado em variação entre frames

**Prós:**
- ✅ Funciona imediatamente
- ✅ Não requer widget React
- ✅ Mantém arquitetura atual

**Contras:**
- ❌ Não é liveness 3D real da AWS
- ❌ Menor precisão
- ❌ Pode não atender requisitos de compliance

---

## Status Atual do Código

### O Que Está Funcionando:
- ✅ HTTPS configurado no `angular.json`
- ✅ Backend cria sessão corretamente (`/api/liveness/start`)
- ✅ Backend busca resultados (`/api/liveness/results`)
- ✅ Frontend captura vídeo localmente

### O Que NÃO Está Funcionando:
- ❌ Transmissão WebRTC para AWS
- ❌ Handshake com servidores Rekognition
- ❌ Processamento de vídeo pela AWS
- ❌ Geração de thumbnails (ReferenceImage + AuditImages)

### Arquivos Afetados:
- `frontend/src/app/pages/capture3d/capture3d.component.ts` - não transmite vídeo
- `frontend/src/app/shared/components/camera-modal/camera-modal.component.ts` - captura local apenas
- Backend está correto, apenas aguardando dados da AWS

---

## Recomendação Imediata

**Para resolver o score zerado:**

1. **Curto Prazo (POC):** Implementar Opção 2 (upload de frames) para demonstração
2. **Médio Prazo (Produção):** Implementar Opção 1 (widget React) para liveness 3D real

---

## Referências

- `day_fusion_configuration_aws_3D_livesses.md` - Guia completo de implementação
- `README_AWS_Liveness_WebRTC_Fix.md` - Documentação sobre WebRTC
- `doc/diagnostico-score-zerado-thumbs-faltando.md` - Diagnóstico detalhado
- AWS Docs: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_StartFaceLivenessSession.html

