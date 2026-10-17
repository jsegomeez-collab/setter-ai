import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { Context, Hono } from 'hono';

/**
 * Sirve el frontend compilado (web/dist, Fase 6) en /app desde el mismo servidor (decisión de Jose: 0 € extra).
 * Cualquier ruta de la app devuelve index.html (la navegación la hace React). Nunca sale de la carpeta de la web.
 */

export const WEB_DIST_DIR = resolve('web/dist');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

/** No se puede meter el panel dentro de otra web, ni adivinar tipos, ni filtrar la URL a otras webs. */
const SECURITY_HEADERS = {
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
} as const;

/** Los archivos de assets/ llevan una huella en el nombre: se pueden guardar en caché para siempre. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Ruta del archivo pedido dentro de la carpeta, o null si intenta salir de ella o no existe. */
function safeFile(root: string, relative: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    return null;
  }
  const file = resolve(root, decoded);
  return file.startsWith(root + sep) && isFile(file) ? file : null;
}

export function registerWebApp(app: Hono, distDir: string = WEB_DIST_DIR): void {
  const root = resolve(distDir);
  const index = join(root, 'index.html');

  const handler = (c: Context) => {
    if (!existsSync(index)) return c.text('El frontend no está compilado todavía (npm run build).', 503, SECURITY_HEADERS);
    const relative = c.req.path.replace(/^\/app\/?/, '');
    if (extname(relative)) {
      const file = safeFile(root, relative);
      if (!file) return c.text('No encontrado', 404, SECURITY_HEADERS);
      return c.body(readFileSync(file), 200, {
        ...SECURITY_HEADERS,
        'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': relative.startsWith('assets/') ? IMMUTABLE : 'no-cache',
      });
    }
    return c.body(readFileSync(index), 200, { ...SECURITY_HEADERS, 'content-type': CONTENT_TYPES['.html']!, 'cache-control': 'no-cache' });
  };

  app.get('/app', handler);
  app.get('/app/*', handler);
}
