export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'owner' | 'collaborator';
  status: 'active' | 'suspended';
  mfaEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface LoginCredentials {
  email: string;
  password: string;
  mfaCode?: string;
}

export interface RegisterData {
  name: string;
  email: string;
  password: string;
}
