# 🔐 User Authorization & Management (Angular + .NET)

Implementação completa de autenticação, autorização e aprovação de usuários para o projeto **DayFusion**, com controle de acesso administrativo e validação por login.

---

## 🧩 1. Estrutura de papéis (Roles)

| Role | Descrição |
|------|------------|
| **Admin (Master)** | Pode aprovar/rejeitar novos usuários, acessar tela de gerenciamento |
| **User (Padrão)** | Só acessa o aplicativo após aprovação |

---

## ⚙️ 2. Fluxo geral de autorização

### 1️⃣ Cadastro
Usuário cria conta (via `/auth/register`).  
→ `IsApproved = false` é salvo no banco.

### 2️⃣ Aprovação
Admin acessa `/admin/users` → visualiza lista de cadastros pendentes → **Aprova** ou **Rejeita**.

### 3️⃣ Login
API `/auth/login` valida:
- Credenciais corretas  
- `IsApproved === true`  
Se não estiver aprovado → `"Aguardando aprovação do administrador"`

### 4️⃣ Autorização
JWT contém `role: "Admin"` ou `"User"`.  
Angular guarda no `localStorage` e usa **AuthGuard** para proteger rotas.

---

## 🧱 3. Backend (.NET 6/7) — Exemplo

### Modelo

```csharp
public class User
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = "User"; // Admin, User
    public bool IsApproved { get; set; } = false;
}
```

### Login com verificação

```csharp
if (!user.IsApproved)
    return Unauthorized("Aguardando aprovação do administrador");
```

### Endpoints administrativos

```csharp
[Authorize(Roles = "Admin")]
[HttpPut("users/{id}/approve")]
public IActionResult ApproveUser(int id)
{
    var user = _context.Users.Find(id);
    if (user == null) return NotFound();
    user.IsApproved = true;
    _context.SaveChanges();
    return Ok();
}
```

---

## 🧩 4. Front-end (Angular 19)

### AuthGuard (protege telas admin)

```ts
import { Injectable } from '@angular/core';
import { CanActivate, Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private router: Router) {}

  canActivate(): boolean {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role === 'Admin') return true;
    this.router.navigate(['/dashboard']);
    return false;
  }
}
```

---

## 🖥️ 5. Tela de gerenciamento de usuários (`/admin/users`)

### HTML

```html
<div class="p-6">
  <h2 class="text-2xl font-semibold mb-4">Gerenciamento de Usuários</h2>
  <table class="table-auto w-full text-left">
    <thead>
      <tr class="border-b border-gray-700">
        <th>Email</th>
        <th>Role</th>
        <th>Status</th>
        <th>Ações</th>
      </tr>
    </thead>
    <tbody>
      <tr *ngFor="let u of users" class="border-b border-gray-800">
        <td>{{ u.email }}</td>
        <td>{{ u.role }}</td>
        <td>
          <span [class.text-green-400]="u.isApproved" [class.text-red-400]="!u.isApproved">
            {{ u.isApproved ? 'Aprovado' : 'Pendente' }}
          </span>
        </td>
        <td>
          <button class="btn-approve" (click)="approve(u.id)">Aprovar</button>
          <button class="btn-reject" (click)="reject(u.id)">Rejeitar</button>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

### TS

```ts
import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-user-management',
  templateUrl: './user-management.component.html',
})
export class UserManagementComponent implements OnInit {
  users: any[] = [];
  constructor(private http: HttpClient) {}
  ngOnInit() {
    this.load();
  }
  load() {
    this.http.get<any[]>('/api/users').subscribe(data => (this.users = data));
  }
  approve(id: number) {
    this.http.put(`/api/users/${id}/approve`, {}).subscribe(() => this.load());
  }
  reject(id: number) {
    this.http.put(`/api/users/${id}/reject`, {}).subscribe(() => this.load());
  }
}
```

---

## 🔒 6. Proteção visual no Angular

`app-routing.module.ts`:

```ts
{
  path: 'admin/users',
  component: UserManagementComponent,
  canActivate: [AuthGuard],
}
```

---

## 🌐 7. Integração AWS Cognito (opcional)

Se usar Cognito:
- Adicione `custom:isApproved` no User Pool.  
- Somente usuários com `custom:isApproved=true` obtêm credenciais via **Pre Token Generation Trigger (Lambda)**.

---

## ✅ 8. Benefícios do modelo

- Controle total de quem acessa o sistema.  
- Reforça segurança e conformidade (LGPD / ISO).  
- Escalável: fácil integrar a Cognito, AD ou SSO futuramente.  

---

## ▶️ 9. Teste rápido

1. Crie usuário com `IsApproved=false`.  
2. Faça login → deve receber “Aguardando aprovação do administrador”.  
3. Aprove o usuário → login deve liberar acesso.  
4. Teste rota `/admin/users` → bloqueada para `User`.  

---
