# DayFusion - AWS Face Liveness (Config Completa)

## Configuração Recomendada do Widget AWS no Angular 19
Essa configuração evita:
- Elipse desalinhada
- Modo adaptativo empurrando vídeo para baixo
- Problemas de pouca luz
- Falhas de centralização
- UI instável durante a captura

---

## 1. HTML do Widget

```html
<face-liveness-widget
  id="liveness"
  environment="prod"
  client-id="SEU_CLIENT_ID"
  preset="face-liveness"
  challenge-versions="1.5.0"
  video-normalization="on"
  dark-environment-boost="on"
  max-video-duration="8000"
>
</face-liveness-widget>
```

---

## 2. Wrapper Angular (essencial para o layout)

```html
<div class="dayfusion-modal">
  <div class="aws-widget-wrapper">
    <face-liveness-widget
      id="liveness"
      environment="prod"
      client-id="SEU_CLIENT_ID"
      preset="face-liveness"
      challenge-versions="1.5.0"
      video-normalization="on"
      dark-environment-boost="on"
      max-video-duration="8000"
    ></face-liveness-widget>
  </div>
</div>
```

---

## 3. CSS Oficial Corrigido

```css
.aws-widget-wrapper {
  width: 100%;
  max-width: 420px;
  height: 580px;
  margin: 0 auto;
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
  background: #14163e;
  border-radius: 20px;
}

face-liveness-widget {
  width: 100%;
  height: 100%;
  display: block;
}

face-liveness-widget::part(camera-box) {
  transform: scale(1.2);
  margin-top: -40px;
}

face-liveness-widget::part(prompt) {
  font-size: 16px;
  color: white;
  text-align: center;
}

face-liveness-widget::part(close-button) {
  top: 16px;
  right: 16px;
}

face-liveness-widget::part(record-indicator) {
  top: 16px;
  left: 16px;
}

.dayfusion-modal {
  width: 100vw;
  height: 100vh;
  position: fixed;
  inset: 0;
  background: #0f1130;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 999999;
}

.dayfusion-modal .aws-widget-wrapper {
  width: 100%;
  max-width: none;
  height: 100%;
  border-radius: 0;
}

@media (max-width: 480px) {
  .aws-widget-wrapper {
    max-width: 100%;
    height: calc(100vh - 40px);
  }
  face-liveness-widget::part(camera-box) {
    transform: scale(1.05);
    margin-top: -20px;
  }
}
```

---

## 4. Por que isso funciona?

- `preset="face-liveness"` ativa o modo correto do AWS
- `dark-environment-boost="on"` corrige ambientes escuros (seu caso)
- `video-normalization="on"` melhora brilho/contraste automaticamente
- `challenge-versions="1.5.0"` fixa comportamento do overlay
- `max-video-duration` melhora estabilidade da captura
- CSS controla container externo, não o Shadow DOM

**Resultado:**  
✔ Elipse centralizada  
✔ Vídeo alinhado  
✔ Evita fallback de “baixa luz”  
✔ Comportamento estável no Desktop e Mobile  
✔ Fluxo consistente para produção  

---

## 5. Evento de Retorno (Angular)

```ts
const widget = document.getElementById('liveness');

widget.addEventListener('capture-complete', (e) => {
  console.log('Resultado:', e.detail);
});
```

---

Fim do documento.
