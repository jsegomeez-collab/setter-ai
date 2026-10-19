import { z } from 'zod';

/**
 * Lo que devuelve Sonnet en el análisis (Fase 6.6). Cada hallazgo trae citas LITERALES de lo que escribió la
 * persona, con el código de su conversación (C1, C2…): el servidor las comprueba (verify.ts) y descarta lo inventado.
 */

const evidence = z.object({
  conversacion: z.string().describe('Código de la conversación de la que sale (C1, C2…).'),
  cita: z.string().describe('Frase COPIADA tal cual de lo que escribió la PERSONA (no el setter). Corta: 3-20 palabras.'),
});

const finding = z.object({
  titulo: z.string().describe('El hallazgo en pocas palabras.'),
  detalle: z.string().describe('Una frase que lo explica. Vacío si no hace falta.'),
  evidencias: z.array(evidence).describe('Todas las conversaciones donde aparece (una cita por conversación).'),
});

const idea = finding.extend({
  gancho: z.string().describe('Primera frase del reel (el gancho), con el lenguaje de la gente.'),
});

export const AnalysisOutputSchema = z.object({
  resumen: z.string().describe('3-5 frases: quién escribe, qué quiere y qué le frena.'),
  objeciones: z.array(finding).describe('Lo que les frena para avanzar o comprar (precio, confianza, tiempo…).'),
  dolores: z.array(finding).describe('Problemas que cuentan de su trabajo o negocio.'),
  lenguaje: z.array(finding).describe('Expresiones literales que repite la gente (útiles para guiones y anuncios). El título es la expresión.'),
  ideas_reels: z.array(idea).describe('Ideas de reels sacadas de lo que preguntan, cuentan u objetan.'),
  datos_mercado: z.array(finding).describe('Datos del mercado: a qué se dedican, tamaño de negocio, de dónde son, qué herramientas usan, qué quieren conseguir.'),
});

export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;
