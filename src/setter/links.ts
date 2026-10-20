import { z } from 'zod';
import { SETTINGS, type Store } from '../store.js';
import type { SetterLinks } from './prompt.js';

/**
 * Enlaces del setter de cada espacio (Fase 7.5c): agenda, membresía y correo de contacto. Se guardan en la base del
 * espacio. Sin guardar, se usan los "de reserva": en el espacio de Jose, los de las variables de Render (como
 * siempre); en un espacio nuevo, ninguno, y entonces su setter no responde (nunca con los enlaces de Jose).
 */

export const setterLinksSchema = z.object({
  agenda: z.url({ protocol: /^https?$/ }),
  membership: z.url({ protocol: /^https?$/ }),
  contactEmail: z.email(),
});

export interface ResolvedLinks {
  readonly links: SetterLinks;
  /** 'saved' = puestos en la web; 'default' = los de reserva. */
  readonly source: 'saved' | 'default';
}

export async function readSetterLinks(store: Pick<Store, 'getSetting'>, fallback: SetterLinks): Promise<ResolvedLinks> {
  const raw = await store.getSetting(SETTINGS.setterLinks);
  if (raw) {
    try {
      const parsed = setterLinksSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return { links: parsed.data, source: 'saved' };
    } catch {
      // Guardado roto: se usan los de reserva.
    }
  }
  return { links: fallback, source: 'default' };
}

/** Lanza si algún enlace o el correo no es válido. */
export async function saveSetterLinks(store: Pick<Store, 'setSetting'>, links: SetterLinks): Promise<void> {
  const parsed = setterLinksSchema.parse(links);
  await store.setSetting(SETTINGS.setterLinks, JSON.stringify(parsed));
}

/** Los tres puestos: sin ellos el setter no responde (le faltarían la agenda, la membresía o el correo). */
export const linksComplete = (links: SetterLinks): boolean => Boolean(links.agenda && links.membership && links.contactEmail);
