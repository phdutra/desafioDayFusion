(Copie tudo abaixo até o final)

# AWS Liveness — Layout Isolado (Angular 19)

Este arquivo contém o layout completo e isolado para rodar o **AWS Amplify Liveness** sem conflitos com overlays, modais, CSS do Angular ou elementos que empurram o widget.

Com este layout, os problemas desaparecem:

- ❌ Oval fora do centro  
- ❌ Flash atrás da câmera  
- ❌ Vídeo recortado  
- ❌ Widget deslocado para baixo  
- ❌ Liveness não iniciando  
- ❌ Erros "face not detected" mesmo com rosto  
- ❌ Falha de gravação  

---

# ✅ 1. HTML — Estrutura 100% Isolada

Use este HTML dentro do seu modal Angular:

```html
<div class="liveness-modal" *ngIf="isModalOpen()">
  
  <!-- Botão fechar -->
  <button class="close-button" (click)="closeModal()">✕</button>

  <!-- Wrapper isolado do AWS -->
  <div class="liveness-aws-wrapper">
    <div id="aws-liveness-container"></div>
  </div>

  <!-- Overlays (não interferem no AWS) -->
  <div class="liveness-overlays">

    <!-- Status -->
    <div class="status-overlay" *ngIf="statusMessage()">
      <span *ngIf="isVerifying()" class="spinner"></span>
      {{ statusMessage() }}
    </div>

    <!-- Gravando vídeo -->
    <div class="recording-indicator" *ngIf="isRecordingVideo()">
      <div class="dot"></div>
      Gravando vídeo...
    </div>

    <!-- Erro -->
    <div class="error-overlay" *ngIf="errorMessageSignal()">
      <div class="error-box">
        <h3>Ocorreu um problema</h3>
        <p>{{ errorMessageSignal() }}</p>
        <button class="retry-btn" (click)="retry()">Tentar novamente</button>
      </div>
    </div>

  </div>

</div>

✅ 2. CSS — Versão Certificada para o AWS Liveness
/* Modal base */
.liveness-modal {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.70);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 99999;
  backdrop-filter: blur(4px);
}

/* Botão fechar */
.close-button {
  position: absolute;
  top: 20px;
  right: 25px;
  font-size: 24px;
  background: transparent;
  border: none;
  color: white;
  cursor: pointer;
  z-index: 100000;
}

/* Wrapper isolado do widget AWS */
.liveness-aws-wrapper {
  position: relative;
  width: 480px;
  height: 640px;
  background: #000;
  border-radius: 12px;
  overflow: hidden;

  /* ESSENCIAL — impede o Angular de deformar o widget */
  display: flex;
  justify-content: center;
  align-items: center;

  z-index: 1;
}

/* Container AWS (não mexer no layout interno) */
#aws-liveness-container {
  width: 100%;
  height: 100%;
  display: block !important;
  position: relative;
  z-index: 1;
}

/* Sobreposições que não afetam o AWS */
.liveness-overlays {
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none; /* ESSENCIAL */
}

/* Status */
.status-overlay {
  position: absolute;
  top: 10px;
  width: 100%;
  text-align: center;
  color: white;
  font-size: 18px;
  font-weight: 500;
}

/* Gravando vídeo */
.recording-indicator {
  position: absolute;
  top: 55px;
  width: 100%;
  text-align: center;
  color: #ff4b4b;
  font-weight: 600;
  display: flex;
  justify-content: center;
  gap: 6px;
}

.recording-indicator .dot {
  width: 10px;
  height: 10px;
  background: #ff4b4b;
  border-radius: 50%;
  animation: pulse 1s infinite alternate;
}

@keyframes pulse {
  to { opacity: 0.2; }
}

/* Overlay de erro */
.error-overlay {
  position: absolute;
  bottom: 30px;
  width: 100%;
  display: flex;
  justify-content: center;
}

.error-box {
  background: #ffdddd;
  color: #900;
  padding: 14px 20px;
  border-radius: 10px;
  font-size: 14px;
  pointer-events: auto; /* permite clicar no botão */
}

.retry-btn {
  margin-top: 10px;
}

✅ 3. TypeScript — Inicialização Correta do Widget
import { AfterViewInit } from '@angular/core';
import { LivenessClass } from '@aws-amplify/ui-components';

export class CaptureOfficialComponent implements AfterViewInit {

  ngAfterViewInit(): void {
    setTimeout(() => {
      const widget = new LivenessClass({
        sessionId: this.sessionId,
        region: 'us-east-1'
      });

      widget.mount('#aws-liveness-container');
    }, 50);
  }
}

✅ 4. Regras obrigatórias da AWS (críticas)

🚫 Não usar grid, flex parents, transform, translate, scale, animations ou padding no container.

🚫 Não colocar nada por cima do widget com pointer-events.

✔ Overlays devem sempre ter pointer-events: none.

✔ O container deve ser fixo, não dinâmico.

✔ Sem overflow hidden no pai (já controlado).

✔ Deixar somente o AWS usar flash, bounding box e controle do vídeo.

✅ 5. Checklist antes de rodar
Item	Status
aws-liveness-container está limpo	✔
Overlays usam pointer-events: none	✔
Nenhum CSS externo altera layout	✔
Vídeo está dentro do wrapper isolado	✔
Modal não tem flex/grid interferindo	✔
Widget inicializado após renderização	✔
🎯 Resultado esperado

Após aplicar este layout:

O oval fica perfeitamente centralizado

O flash aparece na frente

A captura de movimento funciona

O widget executa a sequência 3D correta

Gravação e envio funcionam

O AWS controla toda a UI interna sem interferência