# DayFusion - Sistema de Reconhecimento Facial

Sistema completo de reconhecimento facial com captura de selfie e validação de documentos, desenvolvido com Angular 19 e .NET Core 9.

## 🚀 Tecnologias

- **Frontend:** Angular 19, PWA, TypeScript
- **Backend:** .NET Core 9, C#
- **Cloud:** AWS (S3, Rekognition, DynamoDB, Cognito)
- **UI/UX:** Interface moderna com efeitos e animações

## 📁 Estrutura do Projeto

```
desafioDayFusion/
├── backend/                 # API .NET Core 9
├── frontend/               # PWA Angular 19
├── docker-compose.yml      # Orquestração de containers
├── .env.template          # Template de variáveis de ambiente
└── README.md              # Este arquivo
```

## 🛠️ Setup Rápido

### Pré-requisitos
- .NET SDK 9.x
- Node.js 20+
- Angular CLI 19
- Docker (opcional)

### Executar Localmente

1. **Backend:**
```bash
cd backend
dotnet restore
dotnet run --urls "http://localhost:5001"
```

2. **Frontend:**
```bash
cd frontend
npm install
ng serve --host 0.0.0.0 --port 4200
```

3. **Acessar:**
- Frontend: http://localhost:4200
- Backend API: http://localhost:5001

## 🔧 Configuração AWS

1. Copie `.env.template` para `.env`
2. Configure suas credenciais AWS
3. Execute o script de setup (quando disponível)

## 📱 Funcionalidades

- ✅ Captura de selfie com câmera
- ✅ Upload de documento
- ✅ Reconhecimento facial via AWS Rekognition
- ✅ **Face Liveness 3D Anti-Spoof (Backend Pronto)**
- ✅ Interface moderna e responsiva
- ✅ PWA com offline support
- ✅ Validação em tempo real
- ✅ Painel de revisão humana

### ⚠️ Face Liveness 3D - Status
- **Backend**: ✅ API completa com AWS SDK 4.x
- **Frontend**: ⚠️ Requer AWS Amplify SDK (não instalado)
- **Endpoints**: `/api/FaceRecognition/liveness/start` e `/api/FaceRecognition/liveness/result`

## 🔒 Segurança

- Upload seguro via presigned URLs
- Autenticação JWT via AWS Cognito
- Criptografia de dados sensíveis
- Conformidade LGPD

## 📊 Monitoramento

- Logs estruturados
- Métricas de performance
- Auditoria de acessos
