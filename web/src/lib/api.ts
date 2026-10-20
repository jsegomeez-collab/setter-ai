/** Llamadas a la API del servidor (/api). La sesión va en una cookie HttpOnly: el navegador la manda solo. */

export type Role = 'admin' | 'team';

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  /** Entró con una clave temporal: tiene que cambiarla antes de usar nada (Fase 6.7). */
  readonly mustChangePassword: boolean;
}

/** Espacio de la sesión (Fase 7.5). null = el principal (el de Jose). */
export interface SessionWorkspace {
  readonly id: string;
  readonly name: string;
}

export interface SessionInfo {
  readonly needsSetup: boolean;
  readonly user: SessionUser | null;
  readonly workspace?: SessionWorkspace | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** La respuesta entera (p. ej. la lista de errores al guardar un flujo). */
    readonly data: unknown = null,
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
    throw new ApiError(typeof message === 'string' ? message : `Error ${response.status}`, response.status, data);
  }
  return data as T;
}

export const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', team: 'Equipo' };
