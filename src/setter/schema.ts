import { z } from 'zod';

/**
 * Lo que devuelve Claude en cada turno: la respuesta para la persona y la ficha del lead.
 * Sin límites de longitud en el esquema (la API no los admite): la longitud la controla guards.ts.
 */

const UNKNOWN = 'desconocido';

export const LeadSchema = z.object({
  usa_ia: z.string().nullable().describe('Pregunta 1: si usa alguna IA y para qué, resumido con sus palabras. null si aún no lo ha dicho.'),
  gano_dinero: z.string().nullable().describe('Pregunta 2: si ya ganó dinero con IA o vendió algún servicio. null si aún no lo ha dicho.'),
  dedicacion_ubicacion: z.string().nullable().describe('Pregunta 3: a qué se dedica y desde dónde trabaja. null si aún no lo ha dicho.'),
  objetivo_6_meses: z.string().nullable().describe('Pregunta 4: qué quiere conseguir con la IA en 6 meses. null si aún no lo ha dicho.'),
  puede_invertir: z.enum(['si', 'no', 'duda', UNKNOWN]).describe('Pregunta 5: si está en posición de invertir ahora.'),
  nivel: z.enum(['nivel_1', 'nivel_2', 'no_encaja', UNKNOWN]).describe('Nivel según el perfil ideal del documento.'),
  vive_en_eeuu: z.enum(['si', 'no', UNKNOWN]).describe('Si vive o trabaja en EE.UU.'),
  es_menor: z.enum(['si', 'no', UNKNOWN]).describe('Si hay señales de que es menor de edad.'),
  siguiente_paso: z
    .enum(['seguir_calificando', 'agendar_llamada', 'ofrecer_membresia', 'descartar', 'derivar_a_jose'])
    .describe('Qué toca ahora según la decisión del documento.'),
  objeciones: z.array(z.string()).describe('Objeciones que ha puesto, con sus palabras. Lista vacía si ninguna.'),
  resumen: z.string().describe('Resumen de 1-2 frases de quién es y en qué punto está.'),
});

export const SetterOutputSchema = z.object({
  messages: z
    .array(z.string())
    .describe('Mensajitos para la persona, en orden, como los mandaría alguien por chat: de 1 a 4, cada uno de 1-2 frases cortas. Lista vacía solo si no se debe responder.'),
  needs_human: z.boolean().describe('true si Jose tiene que intervenir en esta conversación.'),
  needs_human_reason: z.string().nullable().describe('Por qué tiene que intervenir Jose. null si needs_human es false.'),
  lead: LeadSchema,
});

export type Lead = z.infer<typeof LeadSchema>;
export type SetterOutput = z.infer<typeof SetterOutputSchema>;
