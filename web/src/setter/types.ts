/** Lo que devuelve la API del Setter IA (src/routes-api-setter.ts). */

export type SetterMode = 'off' | 'test' | 'live';

export interface VersionSummary {
  readonly id: number;
  readonly createdAt: string;
  readonly chars: number;
  readonly preview: string;
  readonly isDefault: boolean;
}

export interface OpenerStep {
  readonly flowId: string;
  readonly flowName: string;
  readonly nodeId: string;
  readonly texts: readonly string[];
  readonly delayNodeId: string | null;
  readonly delaySeconds: number | null;
}

export interface ScenarioInfo {
  readonly id: string;
  readonly group: string;
  readonly title: string;
  readonly persona: string;
  readonly check: string;
  readonly opener: string | null;
}

export interface SetterData {
  readonly mode: SetterMode;
  readonly draft: boolean;
  readonly testUsernames: readonly string[];
  readonly model: string;
  readonly knowledge: { readonly id: number; readonly text: string; readonly createdAt: string } | null;
  readonly knowledgeVersions: readonly VersionSummary[];
  readonly frame: { readonly id: number | null; readonly text: string; readonly isDefault: boolean };
  readonly frameVersions: readonly VersionSummary[];
  readonly openers: readonly OpenerStep[];
  readonly scenarios: readonly ScenarioInfo[];
  readonly simulator: { readonly available: boolean; readonly reason: string | null };
  /** Enlaces del setter de este espacio (Fase 7.5c). */
  readonly links: SetterLinks;
}

export interface SetterLinks {
  readonly agenda: string;
  readonly membership: string;
  readonly contactEmail: string;
  /** 'saved' = puestos en la web; 'default' = los de reserva. */
  readonly source: 'saved' | 'default';
}

export interface SimTurn {
  readonly who: 'lead' | 'setter';
  readonly texts: readonly string[];
  readonly note?: string;
}

export interface SimulationResponse {
  readonly scenario: { readonly id: string; readonly title: string; readonly persona: string; readonly check: string };
  readonly turns: readonly SimTurn[];
  readonly lead: Record<string, unknown> | null;
  readonly endReason: string;
  readonly stopped: boolean;
  readonly verdict: { readonly ok: boolean; readonly detail: string } | null;
  readonly cost: { readonly setter: number; readonly lead: number; readonly total: number };
  readonly model: string;
}

/** Respuesta de las acciones que guardan algo. */
export interface SaveResponse {
  readonly ok: true;
  readonly id?: number;
  readonly unchanged?: boolean;
}
