# Overlay Corrigido para AWS Liveness Widget (Angular 19)

## 🎯 Objetivo

Garantir que o overlay (cores, raios, gradientes, efeitos) apareça **na
frente** da câmera do widget AWS Liveness --- mesmo que o widget crie um
`<iframe>` com z-index muito alto.

A correção exige colocar o overlay **dentro do mesmo container** onde o
AWS renderiza o iframe, e forçar z-index superior.

------------------------------------------------------------------------

# ✅ 1. Estrutura HTML correta

Coloque o overlay **dentro** do container que o AWS usa:

``` html
<div id="liveness-container" class="aws-wrapper">
  <div class="aws-overlay">
    <!-- Seus efeitos aqui -->
  </div>
</div>
```

⚠️ O overlay DEVE estar DENTRO do mesmo container do widget.

------------------------------------------------------------------------

# 🎨 2. CSS com prioridade total

Adicione no `styles.scss` ou global styles:

``` css
.aws-wrapper {
  position: relative;
}

.aws-wrapper iframe {
  position: relative !important;
  z-index: 1 !important; /* empurra o iframe para trás */
}

.aws-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 999999999 !important; /* acima do iframe */
  pointer-events: none; /* não bloqueia clicks do widget */
}
```

------------------------------------------------------------------------

# 🌈 3. Exemplo de overlay com gradientes (opcional)

``` html
<div class="aws-overlay">
  <div class="left-grad"></div>
  <div class="right-grad"></div>
</div>
```

``` css
.left-grad,
.right-grad {
  position: absolute;
  width: 140px;
  height: 100%;
}

.left-grad {
  left: 0;
  top: 0;
  background: linear-gradient(#ff00ff, #ff0066);
}

.right-grad {
  right: 0;
  top: 0;
  background: linear-gradient(#ffcc00, #ff0000);
}
```

------------------------------------------------------------------------

# ⚙️ 4. Por que isso funciona?

-   O AWS cria um `<iframe>` com `z-index` extremamente alto.
-   Como o overlay está **dentro do mesmo container**, o CSS consegue:
    -   definir o iframe com `z-index: 1`
    -   definir o overlay com `z-index` maior e sobrescrever
-   Resultado: Efeitos SEMPRE aparecem **na frente** da câmera.

------------------------------------------------------------------------

# 📦 5. Pronto para usar no Cursor

Este arquivo já está formatado para você colar no seu projeto direto.
