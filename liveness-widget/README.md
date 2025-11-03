# Face Liveness Widget

Micro-app React que expõe o FaceLivenessDetector da AWS como Web Component.

## Setup

```bash
# Instalar dependências
npm install

# Build para produção
npm run build
```

O build gera o arquivo `dist/widget.js` que deve ser copiado para `frontend/src/assets/liveness/` do projeto Angular.

## Uso no Angular

1. Copie `dist/widget.js` para `frontend/src/assets/liveness/widget.js`
2. Adicione o script no `index.html`:
   ```html
   <script src="/assets/liveness/widget.js"></script>
   ```
3. Use o componente no template:
   ```html
   <face-liveness-widget
     region="us-east-1"
     create-session-url="/api/liveness/session"
     results-url="/api/liveness/results">
   </face-liveness-widget>
   ```

## Eventos

O widget dispara eventos customizados:

- `liveness-complete`: Quando a análise é concluída (detail contém os resultados)
- `liveness-error`: Quando ocorre um erro (detail contém { message })

```javascript
document.addEventListener('liveness-complete', (e) => {
  console.log('Resultados:', e.detail)
})
```
