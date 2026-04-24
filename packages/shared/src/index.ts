// Delte typer og utilities mellom portal, api og kommende worker

export * from './format';

export interface User {
  id: string;
  name: string;
  email: string;
  roles: string[];
}

export interface PowerBiReport {
  id: string;
  name: string;
  workspaceId: string;
  embedUrl?: string;
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  uptime: number;
  version: string;
}
