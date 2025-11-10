export interface UserManagement {
  cpf: string;
  name: string;
  role: string;
  isApproved: boolean;
  hasFaceId: boolean;
  createdAt: string;
  lastLoginAt?: string;
}

export interface ApproveUserRequest {
  cpf: string;
  approve: boolean;
}

export interface UpdateRoleRequest {
  cpf: string;
  role: 'Admin' | 'User';
}

