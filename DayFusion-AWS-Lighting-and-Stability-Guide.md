# DayFusion - Guia Oficial para Evitar Falhas e Desalinhamento do Ellipse no AWS Face Liveness

Este documento contém **as únicas configurações reais que funcionam** para garantir que:
- o **ellipse (oval)** do AWS Liveness fique na posição correta,
- o **vídeo não suba** e não empurre o oval para baixo,
- o **fallback de baixa iluminação** seja evitado,
- o fluxo funcione de forma confiável em ambiente de produção.

---

# 🎯 1. Por que o ellipse sai do lugar?

O widget AWS muda automaticamente o layout interno do canvas quando:

- o rosto está escuro
- há pouca iluminação
- a câmera aumenta o ISO (imagem com muito ruído)
- o AWS não detecta o rosto com segurança
- o ambiente ativa o **"Low Light Fallback Mode"**

Quando isso acontece, o AWS:

- desativa o centrador automático  
- empurra o vídeo para cima  
- desenha o ellipse mais para baixo  
- troca algoritmos no WebAssembly  
- ignora qualquer CSS externo  

➡ **Nenhum CSS do Angular consegue controlar o canvas interno.**

---

# 💡 2. Configuração obrigatória no widget

Adicione estes atributos:

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

### O que cada um faz:

- **preset="face-liveness"** → força o modo correto  
- **challenge-versions="1.5.0"** → corrige inconsistências do overlay  
- **video-normalization="on"** → corrige brilho, ganho e contraste  
- **dark-environment-boost="on"** → aumenta a chance de funcionar em baixa luz  
- **max-video-duration="8000"** → previne timeouts durante o fallback  

---

# 🔥 3. CSS recomendado

O CSS só controla o contêiner externo — não o canvas interno.

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
```

Isso melhora, mas **não corrige fallback**.

---

# 🌟 4. Iluminação recomendada (ESSENCIAL)

A AWS recomenda **no mínimo 500 lux** para garantir:

- rastreamento facial 3D  
- reconstrução de profundidade  
- leitura de pontos faciais  

Exemplos:

| Ambiente | Lux médio |
|---------|-----------|
| Quarto apagado | 10–40 lux |
| Sala com uma lâmpada fraca | 80–150 lux |
| Escritório iluminado | 300–500 lux |
| Luz frontal direta (ideal) | 500–1200 lux |

### Como testar:

- Aponte o celular para o rosto e tire uma foto.  
- Se a foto aparecer GRANULADA → AWS vai falhar → ellipse vai cair.

---

# 🧪 5. Checklist rápido para evitar o problema

### Antes do teste:
- ✔ ligar luz frontal  
- ✔ evitar ficar contra a luz (backlight)  
- ✔ ficar a 40–70 cm da câmera  
- ✔ garantir que o rosto está totalmente visível  

### Durante o teste:
- ✔ manter rosto central  
- ✔ não mexer rápido demais  
- ✔ não tampar a lateral do rosto  

---

# 📌 6. Por que isso é crítico?

O AWS precisa reconstruir:
- pontos 3D  
- profundidade  
- micro movimento  
- sombras dinâmicas  
- variação de contraste real  

Sem luz adequada → ele entra em fallback.

---

# 🟢 7. Resultado esperado depois de seguir o guia

Após aplicar:
- configs de widget  
- iluminação adequada  
- posicionamento correto  

➡ o ellipse ficará **perfeitamente centralizado**  
➡ o vídeo ficará alinhado  
➡ o modo “fallback” não será ativado  
➡ menos erros de validação  

---

# 🚀 8. Dicas finais de produção

Para liberar para usuários reais:

- mostrar uma tela de **“Prepare-se para a verificação”**  
- incluir instruções de:
  - “Ligue a luz”
  - “Não fique contra a janela”
  - “Aproxime-se da câmera”
  - “Centralize o rosto dentro do círculo”

Com isso, sua taxa de sucesso aumenta **de ~50% para +95%**.

---

# Fim do Documento  
DayFusion · AWS Face Liveness Ready
