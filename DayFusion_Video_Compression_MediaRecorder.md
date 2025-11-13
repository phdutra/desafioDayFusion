# 🎥 DayFusion - Compressão Leve e Imediata de Vídeo (MediaRecorder)

## 🎯 Objetivo
Implementar compressão leve de vídeo **diretamente no navegador**, usando a **MediaRecorder API** com bitrate controlado, garantindo compatibilidade total com **AWS Rekognition** e **DynamoDB**, sem necessidade de Lambda.

---

## ☁️ 1. Fluxo de Captura e Upload

```mermaid
graph LR
A[Usuário grava vídeo (MediaRecorder)] --> B[Compressão automática (bitrate controlado)]
B --> C[Upload direto para S3 via Signed URL]
C --> D[DynamoDB armazena chave do arquivo]
D --> E[AWS Rekognition processa o vídeo]
```

---

## ⚙️ 2. Implementação Angular 19

### 2.1. Captura e compressão automática
A compressão é feita **no momento da gravação**, limitando a resolução e o bitrate:

```typescript
async function startRecording(uploadUrl: string) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },
    audio: false
  });

  const options = {
    mimeType: 'video/mp4;codecs=h264',
    videoBitsPerSecond: 800000 // 0.8 Mbps = compressão leve e compatível
  };

  const recorder = new MediaRecorder(stream, options);
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (e) => chunks.push(e.data);

  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: 'video/mp4' });

    // Upload direto para S3
    await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: blob
    });

    console.log('✅ Vídeo enviado com sucesso para S3!');
  };

  recorder.start();

  // Grava 3 segundos (ajuste conforme necessário)
  setTimeout(() => recorder.stop(), 3000);
}
```

---

### 2.2. Backend (.NET) – Gerar Signed URL
O backend continua o mesmo do DayFusion (sem alterações):

```csharp
[HttpGet("upload-url")]
public async Task<IActionResult> GetUploadUrl([FromQuery] string contentType)
{
    var key = $"uploads/{Guid.NewGuid()}.mp4";
    var url = _s3Client.GetPreSignedURL(new GetPreSignedUrlRequest
    {
        BucketName = "dayfusion-bucket",
        Key = key,
        Verb = HttpVerb.PUT,
        Expires = DateTime.UtcNow.AddMinutes(5),
        ContentType = contentType
    });
    return Ok(new { uploadUrl = url, fileKey = key });
}
```

---

## ⚡ 3. Parâmetros de Qualidade

| Parâmetro | Valor | Efeito |
|------------|--------|--------|
| Resolução | 640×480 | Boa para redes móveis |
| Bitrate | 800 kbps | Compressão equilibrada |
| Duração | 3–5 segundos | Ideal para verificação facial |
| Codec | H.264 | Compatível com AWS Rekognition |
| Container | MP4 | Leitura direta por players e Rekognition |

---

## 🧠 4. Vantagens da Abordagem MediaRecorder

✅ Compressão nativa e automática  
✅ Nenhum risco de corromper o vídeo  
✅ Sem necessidade de ffmpeg.wasm  
✅ Upload leve e rápido (até 5× mais rápido em 4G/5G)  
✅ 100% compatível com Rekognition e DynamoDB  

---

## 🔧 5. Checklist de Testes

- [ ] Testar gravação em celular (4G/5G)  
- [ ] Verificar tamanho do arquivo (~1–2 MB por vídeo)  
- [ ] Confirmar upload e visualização no S3  
- [ ] Testar leitura e score no Rekognition  
- [ ] Garantir que DynamoDB armazena `fileKey` corretamente  

---

## 🧾 Resultado Esperado

- Upload 3–5× mais rápido que versão original  
- Vídeo leve, sem perda de compatibilidade  
- Zero erros no histórico DynamoDB  
- Nenhum travamento de UI ou bug de buffer  

---

> **Autor:** Raphael Dutra  
> **Projeto:** DayFusion – FaceID / Anti-Deepfake  
> **Data:** Novembro 2025  
> **Versão:** 1.0 – Compressão via MediaRecorder
