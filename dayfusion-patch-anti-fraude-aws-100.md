# DayFusion – Patch Anti-Fraude AWS 100% (Widget + Polling + Fallback Seguro)

> Objetivo: **impedir que foto em celular ou qualquer spoof seja aprovado**, mesmo que:
> - o widget AWS não consiga completar o fluxo,
> - o polling falhe,
> - o resultado venha incompleto/nulo,
> - ou o fluxo local tente “compensar".
>
> Regra de ouro: **se AWS não disser claramente que é LIVE com confiança suficiente → TRATAR COMO FRAUDE.**

---

## 1. Princípios do Patch

1. **NUNCA** assumir “LIVE” como valor padrão.
2. Se **não houver resultado válido do AWS** → considerar “FAKE” / REJEITADO.
3. Se o **polling expirar / travar / der erro** → considerar “FAKE”.
4. Garantir que o **widget AWS realmente execute o fluxo de liveness 3D**, mesmo que visualmente "invisível".
5. Logar tudo de forma clara para auditoria.

---

## 2. Ajustes de CSS – Widget AWS invisível, mas funcional

Arquivo: `frontend/src/app/components/liveness-modal/liveness-modal.component.scss`  
(ou onde você configurou o `.aws-widget-container` / `face-liveness-widget`)

> O objetivo é: **o widget precisa existir visualmente para o navegador** (WebRTC, vídeo, canvas), mas sem atrapalhar a UI.

### ✅ Substitua o bloco atual do widget por este:

```scss
/* Widget AWS – funcional para WebRTC, mas “invisível” para o usuário */
.aws-widget-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  z-index: 9999; // garantir que não fique "atrás" de nada do ponto de vista do navegador
}

.aws-widget-container face-liveness-widget {
  width: 320px;
  height: 240px;
  opacity: 0.01;        // quase invisível, mas não 0
  transform: scale(0.001); // micro escala
  pointer-events: none; // não recebe clique
}
```

> ✋ Importante:  
> Evite hacks agressivos via `::ng-deep` apagando `div`, `span`, etc. Isso pode quebrar fluxo interno do widget.

Se quiser, pode adicionalmente “esconder” a camada visual via `filter: blur(20px);` ou `clip-path`, mas **sem remover vídeo/canvas nem zerar completamente a opacidade/escala**.

---

## 3. Ajustes no Polling – Timeout = FRAUDE

Arquivo: `frontend/src/app/components/liveness-modal/liveness-modal.component.ts`  
(Função semelhante à `checkAwsResultInBackground` do relatório)

### ✅ Versão robusta do polling com fallback seguro

```ts
private async checkAwsResultInBackground(sessionId: string): Promise<any> {
  if (!sessionId) {
    console.warn('[Liveness] checkAwsResultInBackground chamado sem sessionId.');
    return {
      decision: 'FAKE',
      confidence: 0,
      reason: 'Missing sessionId',
      status: 'failed'
    };
  }

  if (this.awsPollingActive) {
    console.log('[Liveness] Polling já está ativo, ignorando nova chamada.');
    return null;
  }

  this.awsPollingActive = true;

  const maxAttempts = 60;       // ~60s (1s por tentativa) – ajuste se quiser
  const pollInterval = 1000;
  let attempts = 0;

  return new Promise((resolve) => {
    const doResolve = (result: any) => {
      this.awsPollingActive = false;
      resolve(result);
    };

    const poll = setInterval(async () => {
      attempts++;

      try {
        const response = await fetch(`${this.resultsUrl}?sessionId=${sessionId}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json'
          }
        });

        if (!response.ok) {
          console.warn('[Liveness] Falha ao obter resultado AWS. HTTP:', response.status);
          if (attempts >= maxAttempts) {
            clearInterval(poll);
            return doResolve({
              decision: 'FAKE',
              confidence: 0,
              reason: `AWS results endpoint error: ${response.status}`,
              status: 'failed'
            });
          }
          return;
        }

        const data = await response.json();
        console.log('[Liveness] Resultado AWS parcial:', data);

        // Se ainda estiver processando, segue o polling
        if (!data.status || data.status === 'IN_PROGRESS') {
          if (attempts >= maxAttempts) {
            clearInterval(poll);
            return doResolve({
              decision: 'FAKE',
              confidence: 0,
              reason: 'AWS timeout – still IN_PROGRESS',
              status: 'timeout'
            });
          }
          return;
        }

        // Aqui já temos um status conclusivo
        clearInterval(poll);

        const livenessDecision = data.livenessDecision ?? data.decision;
        const confidence = data.confidence ?? data.livenessConfidence ?? 0;

        // Normalização do resultado
        const normalized = {
          raw: data,
          decision: livenessDecision ?? (confidence >= 0.7 ? 'LIVE' : 'FAKE'),
          confidence,
          status: data.status === 'SUCCEEDED' ? 'success' : 'failed',
          reason: data.reason || null
        };

        console.log('[Liveness] Resultado AWS normalizado:', normalized);
        return doResolve(normalized);

      } catch (err) {
        console.error('[Liveness] Erro no polling AWS:', err);

        if (attempts >= maxAttempts) {
          clearInterval(poll);
          return doResolve({
            decision: 'FAKE',
            confidence: 0,
            reason: 'AWS polling exception/timeout',
            status: 'failed'
          });
        }
      }
    }, pollInterval);
  });
}
```

> 🔐 Observação:  
> Se o AWS não conseguir concluir, **o resultado final sempre será `FAKE`**.

---

## 4. Tratamento do Resultado – AWS manda na decisão

Ainda no `liveness-modal.component.ts`, onde você consolida os scores (AWS + captura local).

### ✅ Exemplo de “merge” seguro com prioridade da AWS

```ts
private mergeLivenessResults(localAnalysis: any, awsResult: any) {
  // localAnalysis = resultado interno (frames, olhos, movimento etc)
  // awsResult = retorno do checkAwsResultInBackground()

  let finalIsLive = false;
  let finalScore = 0;
  let finalReason: string | null = null;

  // 1. Se não veio awsResult, considere FRAUDE
  if (!awsResult) {
    console.warn('[Liveness] awsResult ausente – marcando como FAKE.');
    return {
      isLive: false,
      finalScore: 0,
      reason: 'AWS did not return any liveness result',
      source: 'fallback'
    };
  }

  const decision = (awsResult.decision || '').toUpperCase();
  const confidence = awsResult.confidence ?? 0;

  // 2. Se AWS falou que é FAKE ou status falhou → bloqueia
  if (
    decision === 'FAKE' ||
    awsResult.status === 'failed' ||
    awsResult.status === 'timeout'
  ) {
    console.warn('[Liveness] AWS indicou FAKE ou falha – bloqueando.');
    return {
      isLive: false,
      finalScore: Math.min(localAnalysis?.score ?? 30, 30),
      reason: awsResult.reason || 'AWS marked as FAKE or failed',
      source: 'aws'
    };
  }

  // 3. Se AWS disse LIVE com confiança boa → considera live
  if (decision === 'LIVE' && confidence >= 0.7) {
    finalIsLive = true;
    finalScore = Math.max(localAnalysis?.score ?? 80, 80);
    finalReason = 'AWS confirmed LIVE with high confidence';
  } else {
    // Qualquer outra situação cinza → tratar como FAKE
    console.warn('[Liveness] AWS retornou decisão incerta – tratando como FAKE.');
    return {
      isLive: false,
      finalScore: Math.min(localAnalysis?.score ?? 30, 30),
      reason: 'AWS returned uncertain decision',
      source: 'aws'
    };
  }

  return {
    isLive: finalIsLive,
    finalScore,
    reason: finalReason,
    source: 'aws+local',
    aws: awsResult,
    local: localAnalysis
  };
}
```

> 🧠 Ideia: você pode salvar esse objeto completo em DynamoDB como auditoria da sessão.

---

## 5. Ajuste no Listener de Eventos do Widget – Nunca assumir LIVE

Arquivo: onde você trata `liveness-complete` / `liveness-error` (conforme relatório).

### ✅ Ajuste do listener para não assumir LIVE por padrão

```ts
private attachWidgetEvents(): void {
  const onLivenessComplete = (event: Event) => {
    const customEvent = event as CustomEvent;

    const detail = customEvent.detail || {};
    const decision = detail.decision ?? detail.livenessDecision ?? 'FAKE';
    const confidence = detail.confidence ?? detail.livenessConfidence ?? 0;

    this.awsWidgetResult = {
      status: 'success',
      decision: decision.toUpperCase(),
      confidence,
      raw: detail
    };

    console.log('[Liveness] Evento liveness-complete:', this.awsWidgetResult);
  };

  const onLivenessError = (event: Event) => {
    const customEvent = event as CustomEvent;
    console.error('[Liveness] Evento liveness-error:', customEvent.detail);

    this.awsWidgetResult = {
      status: 'failed',
      decision: 'FAKE',
      confidence: 0,
      raw: customEvent.detail
    };
  };

  document.addEventListener('liveness-complete', onLivenessComplete);
  document.addEventListener('liveness-error', onLivenessError);

  // Guarde referências se precisar remover depois em ngOnDestroy
  this.widgetEventHandlers = { onLivenessComplete, onLivenessError };
}
```

> Antes você fazia fallback para `decision || 'LIVE'` → isso permitia aprovação com payload incompleto. Agora, fallback é sempre `'FAKE'`.

---

## 6. Regra Global – Se AWS falhar, NÃO APROVA

Em qualquer ponto onde você conclui a verificação (no `confirmLiveness()`, `finalizarSessao()` ou similar), **aplique a seguinte filosofia**:

```ts
if (!awsResult || awsResult.decision === 'FAKE' || awsResult.status !== 'success') {
  // Qualquer dúvida → NÃO APROVA
  aprovado = false;
  motivo = 'Liveness not confirmed by AWS';
} else {
  // Só entra aqui se decisão for LIVE com confiança boa (tratado na mergeLivenessResults)
  aprovado = true;
}
```

---

## 7. Logs Recomendados (para testar o caso do CELULAR)

Durante seus testes com celular na frente da câmera, confira no console:

1. Resultado do polling:  
   `"[Liveness] Resultado AWS normalizado:"`
2. Resultado da mesclagem:  
   `mergeLivenessResults(...)`
3. Como ficou `decision` e `confidence`.

Se o AWS estiver funcionando corretamente, o comportamento esperado é:

- `decision = FAKE`  
- `confidence` baixo  
- `status = failed` ou `success` com FAKE

E o sistema: **NÃO APROVA**.

Se o AWS continuar retornando LIVE nessas condições, aí o problema é **de configuração / cenário de teste** (ex.: a câmera está captando seu rosto atrás do celular, ou o fluxo AWS não está realmente usando Face Liveness 3D).

---

## 8. Checklist rápido para você marcar no Cursor

1. [ ] Atualizar CSS do widget para a versão “quase invisível, mas funcional”.
2. [ ] Aplicar `checkAwsResultInBackground` com fallback de timeout → `FAKE`.
3. [ ] Implementar `mergeLivenessResults` com prioridade absoluta da AWS.
4. [ ] Ajustar listeners de eventos do widget (`liveness-complete` / `liveness-error`) para:
   - [ ] Nunca assumir `'LIVE'` por padrão.
   - [ ] Fallback sempre `'FAKE'`.
5. [ ] Garantir que em **nenhum** lugar do código exista algo como:
   - `decision || 'LIVE'`
   - `confidence || 1`
6. [ ] Testar caso real de fraude:
   - [ ] Foto no celular na frente da câmera.
   - [ ] Boneco / foto impressa.
   - [ ] Tela de outro celular com vídeo.

Em todos esses casos, o esperado é:  
**REJEITADO** com motivo indicando problema na verificação AWS.

---

Se quiser, no próximo passo podemos:
- adicionar **camada de regras de negócio** por cima (ex.: bloquear usuário após X tentativas FAKE),
- gravar as tentativas em uma tabela `LivenessAudit` no DynamoDB,
- e gerar um relatório de auditoria para o banco.
