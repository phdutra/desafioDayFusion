# DayFusion – Correção do Modal Custom com AWS Liveness (Versão Focada em UI)

Este arquivo descreve **como corrigir o modal custom** que faz a captura, mantendo toda a lógica de negócio já existente (estados, resultados, análise, etc.), mas garantindo que o **widget oficial da AWS (Face Liveness)** funcione corretamente:

- sem elipse quebrada  
- sem flashes estranhos de cor  
- sem “faixas” coloridas em cima/baixo  
- centralizado na tela  
- com overlays (contagem, verificando, erro, gravando) funcionando por cima, sem atrapalhar o widget.

Ajustes valem para o componente:

`capture-official-liveness.component.html` + `capture-official-liveness.component.scss`

---

## 1. Estrutura de HTML recomendada (capture-official-liveness.component.html)

Use esta estrutura base (mantendo seus bindings e estados já existentes):

```html
<div class="liveness-modal-backdrop" *ngIf="isOpen">
  <div class="liveness-content">

    <!-- Overlay de preparação / contagem -->
    <div class="countdown-overlay" *ngIf="showPreparationScreen()">
      <div class="countdown-content">
        <h2>Prepare-se para a verificação</h2>
        <p>Mantenha o rosto centralizado, em ambiente bem iluminado.</p>
        <div class="countdown-number">
          {{ preparationCountdown() }}
        </div>
      </div>
    </div>

    <!-- RAIZ onde o widget AWS vai ficar -->
    <div class="aws-liveness-root">
      <div
        id="liveness-container-official"
        class="liveness-container">
        <!-- Aqui o LivenessWidgetComponent monta AwsLiveness / FaceLiveness -->
      </div>
    </div>

    <!-- Indicador de gravação (pequeno canto da tela) -->
    <div class="recording-indicator" *ngIf="isRecordingVideo()">
      <span class="dot"></span>
      <span>Gravando sessão</span>
    </div>

    <!-- Overlay de “Verificando...” (quando AWS está analisando) -->
    <div class="verifying-loading-overlay" *ngIf="isVerifying()">
      <div class="verifying-loading-content">
        <div class="spinner"></div>
        <p>Verificando sua selfie, aguarde...</p>
      </div>
    </div>

    <!-- Overlay de erro -->
    <div class="error-overlay" *ngIf="errorMessage()">
      <div class="error-content">
        <h3>Ocorreu um problema</h3>
        <p>{{ errorMessage() }}</p>
        <button type="button" (click)="retry()">Tentar novamente</button>
      </div>
    </div>

    <!-- Botão de fechar -->
    <button
      type="button"
      class="close-button"
      (click)="close()">
      ✕
    </button>
  </div>
</div>
```

> **Importante:**  
> - `#liveness-container-official` deve ser um container **limpo**, sem nada dentro.  
> - O componente `LivenessWidgetComponent` é quem usa esse ID para `initWidget()` e montar o widget AWS.

---

## 2. SCSS corrigido (capture-official-liveness.component.scss)

O foco aqui é:

- deixar o modal full-screen e centralizado  
- NÃO interferir no layout interno do AWS  
- overlays leves por cima (apenas com fundo preto translúcido)  
- NUNCA estilizar `div`, `canvas`, `video` globalmente

```scss
/* BACKDROP do modal (por trás do widget) */
.liveness-modal-backdrop {
  position: fixed;
  inset: 0; /* top/right/bottom/left: 0 */
  display: flex;
  justify-content: center;
  align-items: center;

  background: rgba(0, 0, 0, 0.75);
  z-index: 9998;
}

/* CONTEÚDO principal do modal (envolve o widget + overlays) */
.liveness-content {
  position: relative;
  width: 100%;
  max-width: 520px;
  max-height: 90vh;

  display: flex;
  justify-content: center;
  align-items: center;

  margin: 0;
  padding: 0;

  background: transparent; /* não pintar a área do widget */
  overflow: visible;
}

/* RAIZ onde o AWS Liveness será renderizado */
.aws-liveness-root {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;

  /* Não definir altura fixa aqui; o AWS controla internamente via aspect-ratio */
}

/* Container do widget AWS – manter LIMPO */
.liveness-container {
  width: 100%;
  background: transparent !important;
  padding: 0;
  margin: 0;
  overflow: visible;
}

/* ========= OVERLAYS ========= */

/* Contagem de preparação antes da verificação */
.countdown-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;

  display: flex;
  justify-content: center;
  align-items: center;

  background: rgba(0, 0, 0, 0.7);
}

.countdown-content {
  text-align: center;
  color: #ffffff;
}

.countdown-number {
  margin-top: 16px;
  font-size: 56px;
  font-weight: 700;
}

/* Indicador de gravação (pequeno, canto superior direito) */
.recording-indicator {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 25;

  display: flex;
  align-items: center;
  gap: 8px;

  padding: 4px 10px;
  border-radius: 999px;

  background: rgba(0, 0, 0, 0.7);
  color: #ffffff;
  font-size: 13px;
}

.recording-indicator .dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #ff4b4b;
  box-shadow: 0 0 8px rgba(255, 75, 75, 0.9);
}

/* Overlay de “Verificando / analisando” */
.verifying-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;

  display: flex;
  justify-content: center;
  align-items: center;

  background: rgba(0, 0, 0, 0.55);
}

.verifying-loading-content {
  text-align: center;
  color: #ffffff;
}

.verifying-loading-content .spinner {
  width: 42px;
  height: 42px;
  margin: 0 auto 12px;

  border-radius: 50%;
  border: 4px solid rgba(255, 255, 255, 0.25);
  border-top-color: #8b5cf6;
  animation: verifying-spin 1s linear infinite;
}

/* Overlay de erro */
.error-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;

  display: flex;
  justify-content: center;
  align-items: center;

  background: rgba(0, 0, 0, 0.7);
}

.error-content {
  max-width: 360px;
  padding: 20px;
  border-radius: 10px;

  background: #111827;
  color: #f9fafb;
  text-align: center;
}

.error-content h3 {
  margin-bottom: 8px;
  font-size: 18px;
  font-weight: 600;
}

.error-content p {
  margin-bottom: 16px;
  font-size: 14px;
}

.error-content button {
  padding: 8px 16px;
  border-radius: 999px;
  border: none;
  cursor: pointer;

  background: #8b5cf6;
  color: #ffffff;
  font-weight: 500;
}

/* Botão de fechar (canto superior direito do modal) */
.close-button {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 50;

  width: 32px;
  height: 32px;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 999px;
  border: none;
  cursor: pointer;

  background: rgba(0, 0, 0, 0.7);
  color: #ffffff;
}

/* ========= Animações ========= */

@keyframes verifying-spin {
  to {
    transform: rotate(360deg);
  }
}
```

---

## 3. Regras importantes (para não quebrar o AWS)

1. **NÃO estilizar globalmente:**
   - `div { ... }`
   - `canvas { ... }`
   - `video { ... }`
   - `.amplify-flex { ... }`
   - `.amplify-liveness-overlay { ... }`

2. **NÃO definir:**
   - `background: green`, `yellow`, `blue` etc. em contêineres genéricos  
   - `overflow: hidden` na área do widget  
   - `height: 100vh` dentro da `.liveness-content`  
   - `transform`, `scale`, `rotate`, `translate` no contêiner do widget

3. **As cores de fundo das overlays devem ser sempre preto translúcido**:
   - `rgba(0, 0, 0, 0.5~0.8)`  
   - Nunca cores sólidas berrantes (verde/neon/amarelo), porque elas acabam aparecendo quando o vídeo ainda está inicializando.

4. **Deixar o AWS controlar a proporção interna**  
   O contêiner pai só centraliza; quem decide altura/largura (aspect-ratio) é o próprio widget.

---

## 4. Fluxo de funcionamento esperado

1. Usuário abre o modal (`isOpen = true`).  
2. Aparece `countdown-overlay` com 5, 4, 3, 2, 1.  
3. Ao final da preparação:
   - `showPreparationScreen = false`  
   - `startSession()` é chamado  
   - `initWidget(sessionId)` monta o AWS no `#liveness-container-official`.  
4. O AWS controla câmera, oval, flashes roxos, instruções etc.  
5. Seus overlays aparecem APENAS em momentos pontuais:
   - gravação (bolinha vermelha pequena)  
   - verificando (overlay leve)  
   - erro (overlay de mensagem)  
6. Nada disso move, recorta ou pinta o vídeo do AWS.

---

## 5. Checklist para validar

- [ ] Elipse do AWS aparece certinha, centralizada  
- [ ] Não aparecem mais “faixas” coloridas em cima ou embaixo  
- [ ] Nenhum flash verde/amarelo/azul  
- [ ] Ao inspecionar o elemento, nenhum `background` estranho aplicado em `div.amplify-flex`  
- [ ] Apenas overlays pretas semi-translúcidas aparecem quando você espera (contagem, verificando, erro)  
- [ ] Widget responde bem ao rosto, sem “saltar” ou mudar de proporção de forma estranha  

---

Pronto!  
Esse arquivo organiza toda a correção de **layout custom** para o seu modal, mantendo o **comportamento de dados e lógica** do DayFusion, mas deixando o widget da AWS trabalhar **do jeito que ele foi projetado**.

Pode colar esse conteúdo no Cursor, ajustar o que for específico de nome de classe se precisar, e testar.  
Se quiser, posso depois gerar também a versão com **Dark/Cyber UI** em volta, sem interferir no AWS.
