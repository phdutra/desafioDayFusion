# Overlay AWS Liveness Widget -- Guia Completo

## 🔥 Objetivo

Criar um overlay que fique **na frente da câmera** do widget AWS Face
Liveness.

------------------------------------------------------------------------

## ✅ 1. CSS para Overlay

Adicione em `styles.scss`:

``` css
.aws-liveness-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 99999 !important;
}
```

------------------------------------------------------------------------

## ✅ 2. Estrutura HTML

No componente onde o widget é renderizado:

``` html
<div id="liveness-container" style="position: relative;"></div>

<div class="aws-liveness-overlay">
  <!-- Seus efeitos aqui -->
</div>
```

------------------------------------------------------------------------

## 🎨 3. Exemplo de Efeitos Coloridos (opcional)

``` html
<div class="aws-liveness-overlay">
  <div class="left-gradient"></div>
  <div class="right-gradient"></div>
</div>
```

``` css
.left-gradient,
.right-gradient {
  position: absolute;
  width: 140px;
  height: 100%;
}

.left-gradient {
  left: 0;
  top: 0;
  background: linear-gradient(#ff00ff, #ff0066);
}

.right-gradient {
  right: 0;
  top: 0;
  background: linear-gradient(#9900ff, #ff3300);
}
```

------------------------------------------------------------------------

## ⚙️ 4. Notas

-   `pointer-events: none` garante que seu overlay **não bloqueie os
    cliques** do widget.
-   O overlay funciona sobre o `<iframe>` criado dinamicamente.
