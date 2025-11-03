# Instruções para Build do Widget

## Problema de Permissão no NPM Cache

Se você encontrar o erro `EACCES` ao executar `npm install`, execute:

```bash
sudo chown -R $(whoami) ~/.npm
```

Você precisará da senha de administrador.

## Build do Widget

Após corrigir as permissões:

```bash
cd liveness-widget
npm install
npm run build
cp dist/widget.js ../frontend/src/assets/liveness/widget.js
```

## Alternativa: Usar yarn

Se o npm continuar com problemas:

```bash
cd liveness-widget
yarn install
yarn build
cp dist/widget.js ../frontend/src/assets/liveness/widget.js
```

## Verificar Build

Após o build, verifique se o arquivo foi criado:

```bash
ls -lh dist/widget.js
```

O arquivo deve ter pelo menos alguns MB (dependências incluídas).

## Nota sobre FaceLivenessDetector

O componente `FaceLivenessDetector` está disponível em `@aws-amplify/ui-react` a partir da versão 6.x.

Se ainda houver problemas, verifique a documentação oficial:
https://docs.amplify.aws/react/build-a-backend/auth/liveness-detector/

