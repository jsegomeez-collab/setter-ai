import type postgres from 'postgres';

/** Lo que comparten los módulos del almacén de Postgres (store.ts, store-contacts.ts). */

export type Sql = ReturnType<typeof postgres>;

/** Valor → JSONB (pasa por JSON para quitar undefined, fechas, etc.). */
export function toJson(sql: Sql, value: unknown) {
  return sql.json(JSON.parse(JSON.stringify(value ?? null)));
}
