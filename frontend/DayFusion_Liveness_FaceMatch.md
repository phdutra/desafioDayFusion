
# 🚀 Projeto DayFusion Liveness + Face Match (KYC)

O **DayFusion** é uma solução completa de **validação biométrica e verificação de identidade** baseada na **AWS**.  
Ele utiliza IA para confirmar se o usuário é uma pessoa real (Liveness 3D) e compara a face capturada com o documento oficial (RG, CNH, Passaporte).

---

## ☁️ Arquitetura AWS

| Serviço | Função | Por que usar |
|----------|--------|--------------|
| **Amazon Rekognition Face Liveness** | Detecta se a pessoa está presente em 3D, com movimentos naturais. | Evita uso de fotos, vídeos ou deepfakes. |
| **Amazon Rekognition CompareFaces** | Compara selfie capturada com foto do documento. | Confirma identidade real da pessoa. |
| **Amazon S3** | Armazena imagens e vídeos capturados durante o fluxo. | Escalável, seguro e econômico. |
| **Amazon Cognito** | Gera credenciais temporárias para upload direto no S3. | Evita exposição de chaves secretas. |
| **AWS IAM** | Controla permissões de cada parte do sistema. | Mantém segurança e isolamento. |
| **Amazon DynamoDB (futuro)** | Armazena resultados de validação e metadados. | Banco NoSQL rápido e escalável. |

---

## Etapas de Execução (Checklist)

### 🧩 Configuração AWS
- Identity Pool no Cognito criado
- Roles Auth/Unauth configuradas
- Policies aplicadas (Rekognition, Kinesis, S3)
- Bucket S3 criado com CORS configurado
- Teste de upload manual realizado

### 💻 Desenvolvimento Front-end
- Amplify e Cognito configurados no Angular
- FaceLivenessDetector implementado
- Modal DayFusionLiveness criado
- Upload automático para S3 testado
- Logs de status (WebRTC e Rekognition) verificados

### ⚙️ Desenvolvimento Back-end
- Endpoints criados: `/api/liveness`, `/api/compare-faces`
- AWS SDK configurado (.NET ou Node)
- Integração CompareFaces implementada
- Score e resultado armazenados (DynamoDB opcional)

### 🧪 Testes
- Liveness: HTTPS + score > 90%
- Face Match: similarity ≥ 85%
- Logs no CloudWatch
- Rejeição automática testada

### 📊 Integração Final
1. Captura vídeo + fotos (Liveness)
2. Envio ao S3
3. Validação AWS Rekognition
4. Upload documento
5. Comparação Face Match
6. Resultado consolidado (Liveness + Similarity)

---

## 💡 Em uma frase

O **DayFusion Liveness + Match Face** combina **IA + biometria AWS** para validar se a pessoa está viva e se ela é realmente quem diz ser — com segurança, escalabilidade e experiência moderna.
