# Amplify Liveness – Setup Completo (Angular 19)

## 1. Instalação
```bash
npm install aws-amplify @aws-amplify/ui-angular
```

## 2. Configuração do Amplify
Crie o arquivo `src/aws-exports.ts`:
```ts
export const awsconfig = {
  Auth: {
    region: "us-east-1",
    identityPoolId: "COLOQUE_AQUI",
  },
  Liveness: {
    region: "us-east-1",
  }
};
```

## 3. Configuração do Angular 19
Edite `main.ts`:
```ts
import { Amplify } from "aws-amplify";
import { awsconfig } from "./aws-exports";
Amplify.configure(awsconfig);
```

## 4. Componente Angular
```ts
@Component({
  selector: 'app-liveness',
  template: `
    <amplify-liveness
      [sessionId]="sessionId"
      region="us-east-1"
      (completion)="onCompleted($event)"
      (error)="onError($event)">
    </amplify-liveness>
  `
})
export class LivenessComponent {
  sessionId = "";

  ngOnInit() {
    // Chamar backend e receber sessionId
  }

  onCompleted(r: any) { console.log("OK", r); }
  onError(e: any) { console.error("Erro:", e); }
}
```

## 5. Criar Sessão via Backend (.NET)
```csharp
[HttpPost("create-session")]
public async Task<IActionResult> Create() {
  var client = new AmazonRekognitionClient(RegionEndpoint.USEast1);
  var response = await client.CreateFaceLivenessSessionAsync(new CreateFaceLivenessSessionRequest());
  return Ok(response.SessionId);
}
```

## 6. Troubleshooting
- Câmera não abre → verificar HTTPS.
- Elipse fora do lugar → remover CSS custom do modal.
- Widget quebrado no Angular 19 → garantir scripts do Amplify carregados.
