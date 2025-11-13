# 🎥 DayFusion - Compressão Segura de Vídeo via Backend (Lambda / .NET)

## 🎯 Objetivo
Implementar compressão de vídeo **sem afetar compatibilidade com DynamoDB e AWS Rekognition**, realizando o processamento no **backend (AWS Lambda ou .NET API)**, garantindo integridade e formato válido (`.mp4` com codec H.264).

---

## ☁️ 1. Fluxo de Compressão Backend

```mermaid
graph LR
A[Usuário grava vídeo (MediaRecorder)] --> B[Upload direto para S3 via Signed URL]
B --> C[Evento S3: ObjectCreated]
C --> D[AWS Lambda / API .NET com FFmpeg]
D --> E[Compressão e salvamento de versão reduzida]
E --> F[Atualização do registro no DynamoDB]
```

---

## ⚙️ 2. Etapas Técnicas

### 2.1. Upload original para o S3
O front-end envia o vídeo bruto via **URL pré-assinada**:
```typescript
await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': 'video/mp4' },
  body: file
});
```
Esse arquivo é salvo em `s3://dayfusion-bucket/uploads/raw/...`.

---

### 2.2. Evento de disparo no S3
Configure o bucket S3 com evento **ObjectCreated** para acionar a função Lambda:

```json
{
  "LambdaFunctionConfigurations": [
    {
      "LambdaFunctionArn": "arn:aws:lambda:us-east-1:xxxx:function:DayFusionVideoCompressor",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [{ "Name": "prefix", "Value": "uploads/raw/" }]
        }
      }
    }
  ]
}
```

---

### 2.3. Compressão via Lambda (Node.js exemplo)
Use **ffmpeg-static** + **child_process**:

```javascript
import { spawn } from "child_process";
import ffmpeg from "ffmpeg-static";
import AWS from "aws-sdk";

const s3 = new AWS.S3();

export const handler = async (event) => {
  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key);

  const input = `/tmp/input.mp4`;
  const output = `/tmp/output.mp4`;

  // Baixa o vídeo original
  const original = await s3.getObject({ Bucket: bucket, Key: key }).promise();
  require("fs").writeFileSync(input, original.Body);

  // Executa ffmpeg com compressão segura
  await new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, [
      "-i", input,
      "-vf", "scale=640:480",
      "-b:v", "800k",
      "-c:v", "libx264",
      "-movflags", "faststart",
      output
    ]);

    proc.on("close", (code) => code === 0 ? resolve() : reject());
  });

  // Envia o arquivo comprimido para S3
  const compressed = require("fs").readFileSync(output);
  const compressedKey = key.replace("uploads/raw/", "uploads/compressed/");

  await s3.putObject({
    Bucket: bucket,
    Key: compressedKey,
    Body: compressed,
    ContentType: "video/mp4"
  }).promise();

  // Atualiza o registro no DynamoDB (opcional)
  const db = new AWS.DynamoDB.DocumentClient();
  await db.update({
    TableName: "DayFusionSessions",
    Key: { SessionId: key.split("/").pop().replace(".mp4", "") },
    UpdateExpression: "set CompressedKey = :k",
    ExpressionAttributeValues: { ":k": compressedKey }
  }).promise();
};
```

---

### 2.4. Alternativa em .NET
Caso prefira API .NET, use o pacote `Xabe.FFmpeg`:

```csharp
var conversion = await FFmpeg.Conversions.FromSnippet.Convert(
    "input.mp4",
    "output.mp4",
    options: "-vf scale=640:480 -b:v 800k -movflags faststart"
);
await conversion.Start();
```

---

## 🧠 3. Configuração Recomendável

| Parâmetro | Valor sugerido |
|------------|----------------|
| Codec | H.264 |
| Resolução | 640×480 |
| Bitrate | 800 kbps |
| Container | MP4 |
| Flag | `-movflags faststart` |

Esses ajustes garantem compatibilidade com Rekognition, CloudFront e players HTML5.

---

## ✅ 4. Benefícios
- Nenhum risco de corromper o vídeo no front-end  
- Upload original mantido para auditoria  
- Compressão 60–70% mais leve  
- Integridade total com DynamoDB e Rekognition  
- Processo automático e escalável via AWS Lambda  

---

> **Autor:** Raphael Dutra  
> **Projeto:** DayFusion – Backend Video Compression  
> **Data:** Novembro 2025  
> **Versão:** 1.0
