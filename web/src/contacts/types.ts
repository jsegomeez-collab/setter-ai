/** Lo que devuelve la API de Contactos (src/routes-api-contacts.ts). */

export interface ContactItem {
  readonly igId: string;
  readonly username: string | null;
  readonly tags: readonly string[];
  readonly sourceMediaId: string | null;
  readonly sourceLabel: string | null;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly stage: string | null;
  readonly aiPaused: boolean;
  /** Campos propios (Fase 7.4): los guarda el paso "Guardar un dato" de un flujo o se ponen a mano. */
  readonly fields: Readonly<Record<string, string>>;
}

export interface ContactsResponse {
  readonly items: readonly ContactItem[];
  readonly total: number;
  readonly tags: readonly { readonly tag: string; readonly n: number }[];
  readonly reels: readonly { readonly mediaId: string; readonly label: string }[];
}

export interface ContactDetail {
  readonly contact: ContactItem & { readonly lead: Record<string, unknown> | null; readonly lastLabel: string | null; readonly lastMediaId: string | null };
  readonly comments: readonly { readonly commentId: string; readonly text: string; readonly createdAt: string; readonly reelLabel: string | null }[];
  readonly leadHistory: readonly { readonly lead: Record<string, unknown> | null; readonly createdAt: string }[];
  readonly hasConversation: boolean;
}

export interface ReelRow {
  readonly mediaId: string;
  readonly label: string;
  readonly permalink: string | null;
  readonly comments: number;
  readonly people: number;
  readonly tagged: Readonly<Record<string, number>>;
}
