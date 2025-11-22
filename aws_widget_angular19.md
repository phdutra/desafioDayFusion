# AWS Face Liveness Widget - Guia Completo (Angular 19)

## 1. Instalar dependências

``` bash
npm install amazon-cognito-identity-js @aws-sdk/client-cognito-identity
```

## 2. Importar script do widget

Adicione no `index.html`:

``` html
<script src="https://d2vvq1ykw7p3zk.cloudfront.net/faceLiveness/latest/faceLiveness.js"></script>
```

## 3. Container HTML

``` html
<div id="liveness-container"></div>
```

## 4. Carregar widget no componente

``` ts
declare var AwsLiveness: any;

ngAfterViewInit() {
  const widget = new AwsLiveness({
    sessionId: 'SEU_SESSION_ID',
    region: 'us-east-1',
    onComplete: (r)=>console.log(r),
    onError:(e)=>console.error(e)
  });

  widget.render('#liveness-container');
}
```

## 5. Criar SessionId no .NET

``` csharp
var client = new AmazonRekognitionClient(RegionEndpoint.USEast1);
var response = await client.CreateFaceLivenessSessionAsync(new CreateFaceLivenessSessionRequest());
return response.SessionId;
```

## 6. Ativar CORS

``` csharp
builder.Services.AddCors(o=>o.AddPolicy("AllowAll",p=>p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));
app.UseCors("AllowAll");
```

## 7. Permissões IAM necessárias

-   rekognition:CreateFaceLivenessSession
-   rekognition:GetFaceLivenessSessionResults

## 8. HTTPS obrigatório

-   https://localhost:4200 ✓
-   http://localhost ✗
