/** El formato de un flujo, igual que en el servidor (src/flows/types.ts). El servidor lo valida al guardar. */

export type Button =
  | { readonly type: 'url'; readonly title: string; readonly url: string; readonly tags: readonly string[] }
  | { readonly type: 'postback'; readonly title: string; readonly next: string };

export type FlowStep =
  | { readonly id: string; readonly type: 'message'; readonly text: string; readonly buttons: readonly Button[]; readonly next?: string }
  | { readonly id: string; readonly type: 'follow_gate'; readonly ifFollowing: string; readonly ifNotFollowing: string; readonly ifUnknown: string }
  | { readonly id: string; readonly type: 'delay'; readonly seconds: number; readonly next: string }
  | { readonly id: string; readonly type: 'setter_opener'; readonly texts: readonly string[] };

export type StepType = FlowStep['type'];
export type Position = { readonly x: number; readonly y: number };

export interface Flow {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: { readonly mediaIds: 'all' | readonly string[]; readonly keywords: readonly string[] };
  readonly publicReplies: readonly string[];
  readonly dmFailedReplies: readonly string[];
  readonly startNodeId: string;
  readonly nodes: readonly FlowStep[];
  readonly testUsernames: readonly string[];
  readonly oncePerUser: boolean;
  readonly onceScope: 'media' | 'flow';
  readonly template?: string;
  readonly layout?: Readonly<Record<string, Position>>;
}

export interface FlowSummary {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly steps: number;
  readonly trigger: Flow['trigger'];
  readonly testUsernames: readonly string[];
}

export interface FlowsResponse {
  readonly flows: readonly FlowSummary[];
  readonly reels: readonly { readonly mediaId: string; readonly label: string }[];
  /** Bloqueo de envíos vigente (p. ej. el de Meta), o null. */
  readonly sendsBlockedUntil: string | null;
}

/** Límites de Meta (los mismos que valida el servidor). */
export const MAX_BUTTONS = 3;
export const MAX_TEMPLATE_TEXT = 640;
export const MAX_PLAIN_TEXT = 1000;
export const MAX_DELAY_SECONDS = 23 * 60 * 60;
export const MAX_STEPS = 50;

export const STEP_LABEL: Readonly<Record<StepType, string>> = {
  message: 'Mensaje',
  follow_gate: '¿Me sigue?',
  delay: 'Pausa',
  setter_opener: 'Inicio del setter IA',
};
