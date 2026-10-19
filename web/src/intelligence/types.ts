/** Lo que devuelve la API de Inteligencia (src/routes-api-intelligence.ts). */

export interface Evidence {
  readonly igId: string;
  readonly username: string | null;
  readonly quote: string;
}

export interface Finding {
  readonly title: string;
  readonly detail: string | null;
  readonly hook?: string;
  readonly count: number;
  readonly evidence: readonly Evidence[];
}

export type SectionKey = 'objeciones' | 'dolores' | 'lenguaje' | 'ideas' | 'mercado';

export interface AnalysisRunSummary {
  readonly id: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly period: string;
  readonly conversations: number;
  readonly costUsd: number;
  readonly findings: number;
}

export interface AnalysisRun extends AnalysisRunSummary {
  readonly skipped: number;
  readonly chars: number;
  readonly model: string;
  readonly result: {
    readonly summary: string;
    readonly sections: Readonly<Record<SectionKey, readonly Finding[]>>;
    readonly dropped: { readonly findings: number; readonly quotes: number };
  };
}

export interface Preview {
  readonly period: 7 | 30 | 'all';
  readonly conversations: number;
  readonly skipped: number;
  readonly chars: number;
  readonly estimatedCostUsd: number;
  /** false si falta la clave de Anthropic en el servidor. */
  readonly available: boolean;
  readonly running: boolean;
}

export interface ReelTraffic {
  readonly mediaId: string;
  readonly label: string;
  readonly people: number;
  readonly withLead: number;
  readonly tipo: Readonly<Record<string, number>>;
  readonly nivel: Readonly<Record<string, number>>;
  readonly invertir: Readonly<Record<string, number>>;
  readonly paso: Readonly<Record<string, number>>;
}

export const SECTIONS: readonly { readonly key: SectionKey; readonly label: string; readonly hint: string }[] = [
  { key: 'objeciones', label: 'Objeciones', hint: 'Lo que les frena para avanzar o comprar.' },
  { key: 'dolores', label: 'Dolores', hint: 'Problemas que cuentan de su trabajo o negocio.' },
  { key: 'lenguaje', label: 'Lenguaje literal', hint: 'Expresiones que repite la gente: para guiones y anuncios.' },
  { key: 'ideas', label: 'Ideas de reels', hint: 'Sacadas de lo que preguntan, cuentan u objetan.' },
  { key: 'mercado', label: 'Datos de mercado', hint: 'A qué se dedican, tamaño, de dónde son, qué usan, qué quieren.' },
];

/** Nombres legibles de los valores de la ficha: comunes a toda la web (lib/labels.ts). */
export { VALUE_LABEL } from '../lib/labels';

export const money = (usd: number): string => `${(usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)).replace('.', ',')} $`;
