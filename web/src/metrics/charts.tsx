import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { SERIES } from './types';

/**
 * Gráficos de Métricas (Fase 6.4), en SVG/HTML sin librerías. Reglas de la skill dataviz: barras de ≤24 px con la punta
 * redondeada (4 px) y la base pegada al eje, líneas de 2 px, cuadrícula tenue, textos en colores de texto (nunca en el
 * de la serie), leyenda cuando hay 2 series, y capa de hover (tooltip) en todo.
 */

export interface BarRow {
  readonly key: string;
  readonly label: string;
  readonly value: number;
  /** Texto junto al número (p. ej. "45 %"). */
  readonly note?: string;
  /** Explicación del tooltip (p. ej. "45 % de Les llegó el DM"). */
  readonly hint?: string;
}

/** Barras horizontales de una sola serie: la longitud es el número; el número y el % van escritos al final. */
export function HBars({ rows, label, scaleMax }: { rows: readonly BarRow[]; label: string; /** Para que dos grupos de barras compartan escala. */ scaleMax?: number }) {
  const max = Math.max(1, scaleMax ?? 0, ...rows.map((row) => row.value));
  return (
    <ul aria-label={label} className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key} className="group relative grid items-center gap-x-3 gap-y-1 sm:grid-cols-[170px_minmax(0,1fr)_96px]">
          <span className="truncate text-[13px] text-mist">{row.label}</span>
          <span className="relative h-[18px] rounded-[4px] bg-white/[0.04]">
            <span
              className="absolute inset-y-0 left-0 rounded-r-[4px] transition-opacity group-hover:opacity-80"
              style={{ width: row.value > 0 ? `max(3px, ${(row.value / max) * 100}%)` : 0, background: SERIES.first }}
            />
          </span>
          <span className="text-[13px] tabular-nums text-fog sm:text-right">
            {row.value}
            {row.note && <span className="ml-1.5 text-xs text-ash">{row.note}</span>}
          </span>
          <span
            role="tooltip"
            className="pointer-events-none absolute -top-8 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-g4 px-2 py-1 text-xs text-fog shadow-lg group-hover:block"
          >
            {row.label}: {row.value} persona(s){row.hint ? ` · ${row.hint}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface LineSeries {
  readonly label: string;
  readonly color: string;
  readonly values: readonly number[];
}

const HEIGHT = 230;
const PAD = { left: 34, right: 14, top: 14, bottom: 28 } as const;
const MAX_X_LABELS = 6;

/** Ancho del contenedor (el SVG se dibuja a su tamaño real: así el texto y las líneas no se deforman). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Primera medida ya (en una pestaña oculta el ResizeObserver no avisa hasta que se ve).
    setWidth(Math.round(node.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

/** Escala "redonda" del eje Y: 4 tramos de 1, 2, 5 o 10 × 10^n. */
function niceMax(value: number): number {
  const raw = Math.max(1, value) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power;
  return Math.max(4, Math.ceil(step) * 4);
}

const shortDay = (key: string): string => new Date(`${key}T12:00:00Z`).toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Líneas por día (un solo eje Y). Al pasar el ratón: línea vertical, puntos y tooltip con los dos valores. */
export function DayLines({ days, series, label }: { days: readonly string[]; series: readonly LineSeries[]; label: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const x = (i: number) => PAD.left + (days.length > 1 ? (i / (days.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + (1 - v / max) * plotH;
  const ticks = [0, 1, 2, 3, 4].map((t) => (max / 4) * t);
  // Fechas del eje X: según el ancho (≈1 cada 64 px), siempre la última, y sin que la penúltima la pise.
  const every = Math.max(1, Math.ceil(days.length / Math.min(MAX_X_LABELS, Math.max(2, Math.floor(plotW / 64)))));
  const labeled = days.map((_, i) => i).filter((i) => i % every === 0);
  if (labeled.at(-1) !== days.length - 1) {
    if (days.length - 1 - (labeled.at(-1) ?? 0) < every / 2 + 0.5) labeled.pop();
    labeled.push(days.length - 1);
  }

  const onMove = (event: PointerEvent<SVGSVGElement>) => {
    const left = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const index = days.length > 1 ? Math.round(((left - PAD.left) / plotW) * (days.length - 1)) : 0;
    setHover(Math.min(days.length - 1, Math.max(0, index)));
  };

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-4" aria-label="Leyenda">
        {series.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs text-mist">
            <span className="h-[3px] w-4 rounded-full" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="block touch-none">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-smoke text-[10px] tabular-nums">
                  {Math.round(t)}
                </text>
              </g>
            ))}
            {labeled.map((i) => (
              <text key={days[i]} x={x(i)} y={HEIGHT - 8} textAnchor={i === 0 && days.length > 1 ? 'start' : i === days.length - 1 && days.length > 1 ? 'end' : 'middle'} className="fill-smoke text-[10px]">
                {shortDay(days[i] ?? '')}
              </text>
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="rgba(255,255,255,0.22)" />}
            {series.map((s) => (
              <g key={s.label}>
                {days.length > 1 && (
                  <path d={s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                )}
                {(days.length === 1 || hover !== null) && (
                  <circle cx={x(hover ?? 0)} cy={y(s.values[hover ?? 0] ?? 0)} r={4.5} fill={s.color} stroke="#121214" strokeWidth={2} />
                )}
              </g>
            ))}
          </svg>
        )}
        {hover !== null && days[hover] && (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-lg border border-white/10 bg-g4 px-3 py-2 text-xs shadow-lg"
            style={{ left: Math.min(Math.max(0, x(hover) + 12), Math.max(0, width - 170)) }}
          >
            <p className="mb-1 font-semibold text-fog">{shortDay(days[hover])}</p>
            {series.map((s) => (
              <p key={s.label} className="flex items-center justify-between gap-3 text-mist">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </span>
                <span className="tabular-nums text-fog">{s.values[hover] ?? 0}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
