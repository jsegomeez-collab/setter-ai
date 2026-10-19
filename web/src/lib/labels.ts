/**
 * Nombres legibles (sistema de diseño §5: nunca enseñar claves internas). Ficha del lead = src/setter/schema.ts.
 */

export const LEAD_FIELD_LABEL: Readonly<Record<string, string>> = {
  siguiente_paso: 'Siguiente paso',
  nivel: 'Nivel',
  tipo_lead: 'Tipo de lead',
  puede_invertir: '¿Puede invertir?',
  resumen: 'Resumen',
  objeciones: 'Objeciones',
  usa_ia: '¿Usa IA?',
  gano_dinero: '¿Ha ganado dinero con IA?',
  dedicacion_ubicacion: 'A qué se dedica y desde dónde',
  objetivo_6_meses: 'Objetivo a 6 meses',
  vive_en_eeuu: '¿Vive en EE. UU.?',
  es_menor: '¿Menor de edad?',
};

export const VALUE_LABEL: Readonly<Record<string, string>> = {
  formacion: 'Formación',
  empresa_dfy: 'Empresa (DFY)',
  nivel_1: 'Nivel 1',
  nivel_2: 'Nivel 2',
  no_encaja: 'No encaja',
  si: 'Sí',
  no: 'No',
  duda: 'Duda',
  desconocido: 'Sin saber',
  seguir_calificando: 'Calificando',
  agendar_llamada: 'Agendar',
  ofrecer_membresia: 'Membresía',
  descartar: 'Descartado',
  derivar_a_jose: 'Pasar a Jose',
};

export const fieldLabel = (key: string): string => LEAD_FIELD_LABEL[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export function valueLabel(value: unknown): string {
  if (Array.isArray(value)) return value.map(valueLabel).join(' · ');
  const text = String(value);
  return VALUE_LABEL[text] ?? text;
}

/** "claude-haiku-5-5" → "Claude Haiku 5.5". */
export function modelLabel(model: string): string {
  const match = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (!match) return model;
  const [, family = '', major, minor] = match;
  return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${major}.${minor}`;
}
