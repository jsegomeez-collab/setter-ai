import { describe, expect, it } from 'vitest';
import { buildAnalysisInput, estimateAnalysisCost, type AnalysisMessageRow } from '../src/intelligence/input.js';
import { reelTraffic } from '../src/intelligence/traffic.js';
import { scrubPerson, verifyFindings } from '../src/intelligence/verify.js';
import type { AnalysisOutput } from '../src/intelligence/schema.js';

/** Inteligencia (Fase 6.6): qué se manda a la IA, que nada sea inventado y el tráfico por reel sin IA. */

const at = (minute: number) => new Date(Date.UTC(2026, 9, 18, 10, minute));
const msg = (igId: string, minute: number, direction: 'in' | 'out', source: AnalysisMessageRow['source'], text: string): AnalysisMessageRow => ({
  igId,
  username: `user_${igId}`,
  direction,
  source,
  text,
  createdAt: at(minute),
});

const rows: AnalysisMessageRow[] = [
  msg('a', 1, 'out', 'flow', 'Hola, pulsa el botón'),
  msg('a', 2, 'in', 'user', 'si mándamelo'),
  msg('a', 3, 'in', 'user', 'Tengo una peluquería y no me da la vida con el WhatsApp'),
  msg('a', 4, 'out', 'ai', '¿Cuántas citas gestionas al día?'),
  msg('a', 5, 'in', 'user', 'unas 40, pero me da miedo que la IA suene robótica'),
  msg('b', 6, 'in', 'user', 'ok'),
  msg('c', 7, 'in', 'user', '¿Esto cuánto cuesta?'),
];

describe('buildAnalysisInput', () => {
  it('quita el flujo y los "sí" cortos; deja solo conversaciones donde la persona dijo algo; la más reciente primero', () => {
    const input = buildAnalysisInput(rows, { maxChars: 10_000 });
    expect(input.conversations.map((c) => [c.code, c.igId])).toEqual([
      ['C1', 'c'],
      ['C2', 'a'],
    ]);
    expect(input.text).toContain('### C2 (@user_a)\nPersona: Tengo una peluquería');
    expect(input.text).toContain('Setter: ¿Cuántas citas gestionas al día?');
    expect(input.text).not.toContain('pulsa el botón');
    expect(input.text).not.toContain('si mándamelo');
    expect(input.skipped).toBe(0);
  });

  it('respeta el tope de caracteres (se queda con las más recientes) y dice cuántas se dejó', () => {
    const input = buildAnalysisInput(rows, { maxChars: 60 });
    expect(input.conversations.map((c) => c.igId)).toEqual(['c']);
    expect(input.skipped).toBe(1);
  });

  it('el coste estimado sube con el texto (Sonnet 5.5) y es 0 sin conversaciones', () => {
    expect(estimateAnalysisCost(0)).toBe(0);
    expect(estimateAnalysisCost(300_000)).toBeGreaterThan(estimateAnalysisCost(30_000));
  });
});

describe('verifyFindings (nada inventado)', () => {
  const input = buildAnalysisInput(rows, { maxChars: 10_000 });
  const output: AnalysisOutput = {
    resumen: 'Dueños de negocio con mucho WhatsApp.',
    objeciones: [
      { titulo: 'Miedo a que suene robótico', detalle: 'Temen perder el trato humano.', evidencias: [{ conversacion: 'C2', cita: 'me da miedo que la IA suene robotica' }] },
      { titulo: 'Inventada', detalle: '', evidencias: [{ conversacion: 'C2', cita: 'no tengo dinero ahora' }] },
    ],
    dolores: [{ titulo: 'WhatsApp desbordado', detalle: '', evidencias: [{ conversacion: 'C9', cita: 'no me da la vida' }, { conversacion: 'C2', cita: 'no me da la vida con el WhatsApp' }] }],
    lenguaje: [],
    ideas_reels: [{ titulo: 'Peluquerías y WhatsApp', detalle: '', gancho: '¿40 citas al día por WhatsApp?', evidencias: [{ conversacion: 'C2', cita: 'unas 40' }] }],
    datos_mercado: [{ titulo: 'Preguntan el precio pronto', detalle: '', evidencias: [{ conversacion: 'C1', cita: '¿Esto cuánto cuesta?' }] }],
  };

  it('solo quedan las citas que aparecen de verdad en lo que escribió la persona; un hallazgo sin citas válidas se descarta', () => {
    const result = verifyFindings(output, input.conversations);
    expect(result.sections.objeciones.map((f) => f.title)).toEqual(['Miedo a que suene robótico']);
    expect(result.sections.objeciones[0]?.evidence).toEqual([{ igId: 'a', username: 'user_a', quote: 'me da miedo que la IA suene robotica' }]);
    expect(result.sections.dolores[0]?.evidence.map((e) => e.igId)).toEqual(['a']);
    expect(result.sections.ideas[0]).toMatchObject({ title: 'Peluquerías y WhatsApp', hook: '¿40 citas al día por WhatsApp?', count: 1 });
    expect(result.sections.mercado[0]?.evidence[0]?.igId).toBe('c');
    expect(result.dropped).toEqual({ findings: 1, quotes: 2 });
  });
});

describe('scrubPerson (BORRAR también limpia los análisis guardados)', () => {
  it('quita sus citas, recalcula cuántas conversaciones y descarta los hallazgos que se quedan sin citas', () => {
    const verified = verifyFindings(
      {
        resumen: 'x',
        objeciones: [{ titulo: 'Precio', detalle: '', evidencias: [{ conversacion: 'C1', cita: 'cuánto cuesta' }, { conversacion: 'C2', cita: 'me da miedo' }] }],
        dolores: [{ titulo: 'Solo de a', detalle: '', evidencias: [{ conversacion: 'C2', cita: 'no me da la vida' }] }],
        lenguaje: [],
        ideas_reels: [],
        datos_mercado: [],
      },
      buildAnalysisInput(rows, { maxChars: 10_000 }).conversations,
    );
    const scrubbed = scrubPerson(verified, 'a');
    expect(scrubbed.sections.objeciones).toEqual([{ title: 'Precio', detail: null, count: 1, evidence: [{ igId: 'c', username: 'user_c', quote: 'cuánto cuesta' }] }]);
    expect(scrubbed.sections.dolores).toEqual([]);
    expect(JSON.stringify(scrubbed)).not.toContain('user_a');
  });
});

describe('reelTraffic (sin IA)', () => {
  it('suma las fichas por reel de origen (sin contar "desconocido")', () => {
    const traffic = reelTraffic([
      { sourceMediaId: 'r1', lead: { tipo_lead: 'empresa_dfy', nivel: 'nivel_1', puede_invertir: 'si', siguiente_paso: 'agendar_llamada' } },
      { sourceMediaId: 'r1', lead: { tipo_lead: 'formacion', nivel: 'desconocido', puede_invertir: 'duda', siguiente_paso: 'seguir_calificando' } },
      { sourceMediaId: 'r1', lead: null },
      { sourceMediaId: null, lead: { tipo_lead: 'formacion' } },
    ]);
    expect(traffic).toEqual([
      {
        mediaId: 'r1',
        people: 3,
        withLead: 2,
        tipo: { empresa_dfy: 1, formacion: 1 },
        nivel: { nivel_1: 1 },
        invertir: { si: 1, duda: 1 },
        paso: { agendar_llamada: 1, seguir_calificando: 1 },
      },
    ]);
  });
});
