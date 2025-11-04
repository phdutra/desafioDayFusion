# 🔒 Como Ativar HTTPS no Localhost

## ✅ Opção 1: Usar Certificados Existentes (Mais Simples)

Os certificados já estão configurados! Basta rodar:

```bash
npm run start:https
```

ou simplesmente:

```bash
npm start
```

(Porque o `angular.json` já está configurado com `"ssl": true`)

⚠️ **Nota**: Os certificados atuais podem mostrar um aviso de segurança no navegador. Você precisará clicar em "Avançadas" → "Ir para localhost (não seguro)" na primeira vez.

---

## 🔐 Opção 2: Gerar Certificados Confiáveis com mkcert (Recomendado)

Com mkcert, os certificados serão **confiáveis** e não mostrarão avisos de segurança.

### Instalar mkcert no macOS:

```bash
# Instalar via Homebrew
brew install mkcert

# Instalar o CA (Certificate Authority) local
mkcert -install
```

### Gerar certificados para localhost:

```bash
cd frontend/ssl
mkcert localhost 127.0.0.1 ::1
```

Isso criará:
- `localhost+2.pem` (certificado)
- `localhost+2-key.pem` (chave privada)

### Atualizar angular.json para usar os novos certificados:

```json
"sslCert": "ssl/localhost+2.pem",
"sslKey": "ssl/localhost+2-key.pem"
```

Ou renomear os arquivos:
```bash
mv localhost+2.pem localhost.pem
mv localhost+2-key.pem localhost-key.pem
```

---

## 📋 Resumo das Opções

| Método | Comando | Confiável? | Aviso no Navegador? |
|--------|---------|------------|---------------------|
| Certificados Existentes | `npm run start:https` | ❌ | ✅ Sim (primeira vez) |
| mkcert | `npm run start:https` | ✅ | ❌ Não |

---

## 🚀 Testar HTTPS

1. Rode o servidor:
   ```bash
   npm run start:https
   ```

2. Acesse: `https://localhost:4200`

3. Se aparecer aviso de segurança, clique em "Avançadas" → "Ir para localhost (não seguro)"

4. O WebRTC funcionará corretamente em HTTPS! 🎉

---

## ❓ Problemas Comuns

### Porta 4200 já em uso:
```bash
# Matar processo na porta 4200
lsof -ti:4200 | xargs kill -9

# Ou usar outra porta
ng serve --ssl --port 4300
```

### Certificado expirado:
Gere novos certificados com mkcert (Opção 2 acima).

### WebRTC não funciona:
- ✅ Certifique-se de estar usando **HTTPS** ou **localhost**
- ❌ HTTP com IP (ex: `http://192.168.1.100:4200`) **NÃO funciona** com WebRTC
