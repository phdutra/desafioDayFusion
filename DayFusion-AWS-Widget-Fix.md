# DayFusion-AWS-Widget-Fix.md

## Ajustes para o AWS Face Liveness Widget no Angular 19

### 1. Estrutura HTML
```html
<div class="dayfusion-modal">
  <div class="aws-widget-wrapper">
    <face-liveness-widget
      id="liveness"
      environment="prod"
      client-id="SEU_CLIENT_ID"
    ></face-liveness-widget>
  </div>
</div>
```

### 2. CSS principal
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
