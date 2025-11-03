
# 🧠 DayFusion — POC de Reconhecimento Facial 3D + FaceMatch com Documento

## 🛰️ Visão Geral
O **DayFusion** é uma POC que integra **AWS Rekognition** e **.NET 8 + Angular 19**, realizando:
- **Verificação 3D (Liveness)** → valida se a pessoa está viva, evitando spoof.
- **Captura de Documento (2D)** → obtém imagem do RG/CNH.
- **Comparação Facial (FaceMatch)** → compara a selfie 3D com a foto do documento.
- **Armazenamento** no **S3** (imagens) e **DynamoDB** (sessões e metadados).

---

## ⚙️ Arquitetura Geral

```
[ Angular Frontend ]
     |
     |--> Captura 3D (WebRTC / Amplify UI)
     |--> Upload Documento
     |--> Exibição dos Resultados
     |
[ .NET 8 API Layer ]
     |
     |--> Rekognition (CreateFaceLivenessSession / GetResults)
     |--> Rekognition (CompareFaces)
     |--> DynamoDB (armazenamento)
     |--> S3 (upload / leitura)
```

---

## 🧩 Componentes Principais

### 🔹 1. Captura 3D (Liveness)

**Fluxo:**
1. Front chama:
   ```
   POST /api/liveness/start
   ```
2. API → AWS Rekognition:
   ```csharp
   CreateFaceLivenessSession
   ```
3. AWS retorna `SessionId`.
4. Front inicia sessão via WebRTC e captura frames.
5. Backend consulta o resultado:
   ```csharp
   GetFaceLivenessSessionResults
   ```

**Resposta esperada:**
```json
{
  "SessionId": "12345abc",
  "Status": "SUCCEEDED",
  "Confidence": 72.19,
  "ReferenceImage": "s3://dayfusion-bucket/liveness/ref_12345abc.jpg",
  "AuditImages": [
    "s3://dayfusion-bucket/liveness/audit_1.jpg",
    "s3://dayfusion-bucket/liveness/audit_2.jpg"
  ]
}
```

**Frontend:**
- Exibir **confiança (%)**, **status**, e **thumbnails** das imagens auditadas.  
- Mostrar **qualidade (POOR / GOOD / EXCELLENT)** conforme o score.

---

### 🔹 2. Captura de Documento

**Fluxo:**
1. Usuário fotografa ou faz upload do documento (RG/CNH frente).  
2. Front envia:
   ```
   POST /api/document/upload
   ```
3. API salva no **S3** (`dayfusion-bucket/docs/{sessionId}_front.jpg`)  
4. DynamoDB armazena metadados:
   ```json
   {
     "SessionId": "12345abc",
     "DocumentUrl": "https://s3.amazonaws.com/dayfusion-bucket/docs/12345abc_front.jpg",
     "Timestamp": "2025-11-02T20:00Z"
   }
   ```

---

### 🔹 3. Comparação Facial (FaceMatch)

**Fluxo:**
1. API realiza:
   ```csharp
   CompareFaces
   ```
   **SourceImage:** rosto extraído do documento  
   **TargetImage:** ReferenceImage (captura 3D)

2. **Resposta:**
   ```json
   {
     "Similarity": 94.7,
     "FaceMatches": [
       {
         "BoundingBox": { "Width": 0.3, "Height": 0.4 },
         "Confidence": 99.1
       }
     ]
   }
   ```

3. **Backend** grava o resultado:
   ```json
   {
     "SessionId": "12345abc",
     "LivenessConfidence": 72.19,
     "FaceMatchConfidence": 94.7,
     "Status": "VERIFIED",
     "Timestamp": "2025-11-02T20:15Z"
   }
   ```

---

## 🧠 Interface Angular — Layout de Resultados

### **Página: `/capture3d`**
- **Título:** Verificação 3D Concluída  
- **Status da Sessão:** `CREATED | SUCCEEDED | FAILED`
- **Confiança:** Exibir `%` com gradiente
- **Análise Detalhada:**
  - Qualidade (POOR / GOOD / EXCELLENT)
  - Thumbnails: `ReferenceImage` + `AuditImages`
- **Razões para Score Baixo:**
  - Confiança < 50%
  - Sessão criada mas não concluída
  - Possível spoof detectado

---

### **Página: `/review` (Comparação Documento)**
- Exibir lado a lado:
  - Selfie 3D (`ReferenceImage`)
  - Foto do Documento (`DocumentImage`)
- Mostrar barra de Similaridade (%)
- Status Final: ✅ **Verificado** | ❌ **Falha**

---

## 🧾 Modelos de Dados

### DynamoDB — `dayfusion_transactions`
```json
{
  "SessionId": "string",
  "Status": "string",
  "LivenessConfidence": "number",
  "FaceMatchConfidence": "number",
  "DocumentUrl": "string",
  "ReferenceImageUrl": "string",
  "AuditImages": ["string"],
  "CreatedAt": "datetime"
}
```

---

## 🔐 IAM Policy Recomendada

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RekognitionAccess",
      "Effect": "Allow",
      "Action": [
        "rekognition:CreateFaceLivenessSession",
        "rekognition:GetFaceLivenessSessionResults",
        "rekognition:CompareFaces"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3Access",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::dayfusion-bucket/*"
    },
    {
      "Sid": "DynamoAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:DescribeTable",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:DeleteItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:405234571075:table/dayfusion_transactions"
    }
  ]
}
```

---

## 🚀 Próximos Passos

1. ✅ Finalizar o fluxo de **renderização dos thumbnails** no Angular  
2. ✅ Implementar **upload do documento** com preview  
3. ✅ Adicionar endpoint `/api/facematch` para comparação facial  
4. ⚙️ Armazenar resultados no DynamoDB  
5. 📊 Exibir histórico de sessões no menu “Transações”
