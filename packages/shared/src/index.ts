// Delte typer mellom portal og api

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
