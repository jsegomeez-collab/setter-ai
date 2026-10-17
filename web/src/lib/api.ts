/** Llamadas a la API del servidor (/api). La sesión va en una cookie HttpOnly: el navegador la manda solo. */

export type Role = 'admin' | 'team';

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
}

export interface SessionInfo {
  readonly needsSetup: boolean;
  readonly user: SessionUser | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, options: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const hasBody = options.body !== undefined;
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    throw new ApiError(typeof message === 'string' ? message : `Error ${response.status}`, response.status);
  }
  return data as T;
}

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', team: 'Equipo' };
