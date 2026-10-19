import { Bot, BrainCircuit, Contact, LayoutGrid, MessagesSquare, Settings, TrendingUp, Workflow, type LucideIcon } from 'lucide-react';
import type { Role } from '../lib/api';

export interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Quién lo ve (decisión de Jose: el equipo no toca el setter, los flujos ni la configuración). */
  readonly roles: readonly Role[];
  /** Paso del plan en el que se construye; null = ya hecho. */
  readonly step: string | null;
  /** Página del panel antiguo que lo hace mientras tanto. */
  readonly legacyPath: string | null;
  readonly description: string;
}

const ALL: readonly Role[] = ['admin', 'team'];
const ADMIN: readonly Role[] = ['admin'];

export const NAV: readonly NavItem[] = [
  { path: '/', label: 'Inicio', icon: LayoutGrid, roles: ALL, step: null, legacyPath: null, description: 'Resumen y accesos.' },
  { path: '/setter', label: 'Setter IA', icon: Bot, roles: ADMIN, step: null, legacyPath: '/setter', description: 'Documento, marco técnico, textos de inicio, modo y simulador.' },
  { path: '/conversaciones', label: 'Conversaciones', icon: MessagesSquare, roles: ALL, step: null, legacyPath: '/conversaciones', description: 'Bandeja, fichas, pausar la IA, borradores y responder a mano.' },
  { path: '/contactos', label: 'Contactos', icon: Contact, roles: ALL, step: null, legacyPath: '/contactos', description: 'Fichas, etiquetas, reel de origen e historial.' },
  { path: '/metricas', label: 'Métricas', icon: TrendingUp, roles: ALL, step: null, legacyPath: '/metricas', description: 'Embudo por reel y por día, setter y agenda.' },
  { path: '/flujos', label: 'Flujos', icon: Workflow, roles: ADMIN, step: null, legacyPath: '/flujos', description: 'Constructor visual: disparadores, mensajes, botones, condiciones y pausas.' },
  { path: '/inteligencia', label: 'Inteligencia', icon: BrainCircuit, roles: ADMIN, step: null, legacyPath: null, description: 'Objeciones, datos de mercado y ángulos de contenido.' },
  { path: '/configuracion', label: 'Configuración', icon: Settings, roles: ADMIN, step: null, legacyPath: '/eventos', description: 'Usuarios, cuenta de Instagram, token y límites.' },
];

export function navFor(role: Role): readonly NavItem[] {
  return NAV.filter((item) => item.roles.includes(role));
}
