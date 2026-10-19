# Sistema de diseño · Setter IA (Fase 7.1)

> Fuente única de verdad del aspecto de la web. Si una pantalla necesita algo distinto, va en `pages/<pantalla>.md` y manda sobre esto.
> Base: decisión de Jose (2026-10-19) **oscuro + dorado (referencia Better Angles), rehecho a fondo**; reglas de la skill `ui-ux-pro-max` (accesibilidad, interacción, layout, tipografía, formularios, navegación). La skill proponía azul + verde + Fira: descartado por Jose.

## 1. Dirección

Panel de operaciones **premium y tranquilo**: fondo casi negro, superficies en capas, un único acento dorado para lo importante, estados con color **y** icono + texto. Mucha información, poco ruido: jerarquía clara, nada decorativo que no ayude a decidir.

## 2. Tokens (en `web/src/styles.css`, nunca hex sueltos en componentes)

### Color
| Token | Valor | Uso |
|---|---|---|
| `base` | #0a0a0a | fondo de la app |
| `g1` / `g2` / `g3` / `g4` / `g5` | #111113 / #161618 / #1c1c1f / #232327 / #2d2d32 | capas: panel → tarjeta → campo → hover → borde fuerte |
| `snow` | #fbfbfc | títulos |
| `fog` | #e9e9ec | texto principal |
| `mist` | #c6c6cc | texto secundario |
| `ash` | #97979e | ayudas, metadatos |
| `smoke` | **#8b8b92** (antes #6c6c72) | lo más apagado que se permite en texto. Medido: ≥4,63:1 sobre todas las capas (antes 3,26-3,80: **no cumplía**) |
| `ember-300…700` | #e0bc55 · #d9ae3e · #d4a53a · #b98c2c · #8f6b1e | acento: **un** botón principal por vista, selección, foco |
| `ok` / `bad` / `warn` / `info` | #2ed38a / #ff5c6a / #f0b23e / #5ab0f5 | estados (siempre con icono + texto) |

Contrastes medidos (texto sobre #1c1c1f): fog 14,0 · mist 10,0 · ash 5,9 · smoke 5,0 · ember-400 8,2 · ok 8,7 · bad 5,7 · warn 9,0 · info 7,3 · texto oscuro sobre dorado 8,1.

### Tipografía
- Títulos: **Gabarito** (800). Texto: **Inter**.
- Escala: 12 (mínimo absoluto: horas, notas) · 13 (metadatos, etiquetas) · 14 (texto de interfaz) · 16 (texto largo, campos en móvil) · 18 · 22 (títulos de sección) · 28 (título de página) · 36 (cifras grandes).
- Interlineado 1,5 en texto; 1,2 en títulos. Números con `tabular-nums`.
- Etiquetas en MAYÚSCULAS solo para encabezados de sección (12 px, espaciado 0,08em), nunca para texto que haya que leer.

### Espacio, bordes, sombras, movimiento
- Espacio (base 4): 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48. Entre secciones de página: 24 (móvil) / 32 (escritorio).
- Radios: 6 (chips) · 10 (botones y campos) · 14 (tarjetas) · 20 (paneles grandes).
- Sombras solo en lo que flota (menús, ventanas, notificaciones).
- Movimiento: 150 ms (hover, pulsado) · 200 ms (abrir/cerrar) · 250 ms (paneles); `ease-out` al entrar, más rápido al salir. Con "reducir movimiento" del sistema: sin animación.
- Foco visible siempre: anillo dorado de 2 px con separación de 2 px.

## 3. Estructura de pantalla

- **Una sola cabecera por página** (`PageHeader`): título + frase de qué es + acciones a la derecha. **Sin** repetir el título en la barra de arriba.
- Dos tipos de página:
  - **Lectura/gestión** (Inicio, Contactos, Métricas, Setter, Inteligencia, Configuración): ancho máximo 1200 px, márgenes 16 / 24 / 32 px (móvil / tablet / escritorio).
  - **Espacio de trabajo** (Conversaciones, editor de Flujos): todo el ancho, paneles.
- Avisos del sistema (p. ej. bloqueo de Meta): **una vez por página**, en un banner arriba; los controles afectados se desactivan con su motivo corto, sin repetir el texto entero.
- Probado a 375 · 768 · 1024 · 1440 px. Sin scroll horizontal de la página.

## 4. Componentes (uno de cada, reutilizado en toda la web)

| Componente | Reglas |
|---|---|
| `Button` | Variantes: principal (dorado, **una por vista**), secundario, fantasma, peligro. Tamaños 32 / 40 px; en móvil zona táctil ≥44 px. Estado de carga con spinner y texto ("Guardando…"). Desactivado = sin acción y con motivo si no es obvio. |
| `IconButton` | Siempre con `aria-label` y tooltip. Zona táctil ≥40 px (≥44 en móvil). |
| `Field` | Etiqueta visible siempre (nunca solo placeholder), ayuda debajo, error **junto al campo**, contador si hay límite. |
| `Select`, `Textarea`, `Checkbox`, `Switch` | Mismo alto, borde y foco que `Field`. |
| `Tabs` / `Segmented` | Pestañas para cambiar de vista; segmentado para elegir una opción. Estado activo con algo más que color (peso + fondo). |
| `Badge` / `StatusChip` | Texto legible (≥12 px) con icono para estados; nunca valores internos (`empresa_dfy` → "Empresa (DFY)"). |
| `Card` / `Section` | Encabezado + descripción + acciones + contenido. No meter tarjetas dentro de tarjetas sin motivo. |
| `Table` | Con cabeceras, fila con hover, acciones al final; en móvil se convierte en lista de tarjetas. |
| `EmptyState` | Icono + qué falta + qué hacer (botón). Nunca un "Nada." suelto. |
| `Skeleton` | Para cargas; el "Cargando…" en texto solo si dura menos de 300 ms. |
| `Toast` | Resultado de acciones (guardado, error), arriba a la derecha, 4 s, `aria-live`. Los avisos fijos de la página no se usan para eso. |
| `Dialog` / `ConfirmDialog` | Foco dentro, Esc cierra, foco vuelve al botón. Acciones con consecuencias: escribir una palabra (ACTIVAR, BORRAR…). |
| `Drawer` | Menú y paneles laterales en móvil. |

## 5. Contenido

- **Nunca** enseñar ids, claves internas ni fechas ISO (`2026-11-18T00:00:00.000Z`, `reel-aaa`, `claude-haiku-5-5`, `siguiente_paso`). Siempre nombres legibles y `formatDate`.
- Frases cortas, en español, que digan qué pasa y qué hacer.
- Iconos: solo Lucide, trazo 2 px, tamaños 14 / 16 / 20. Sin emojis como iconos de la interfaz.

## 6. Fallos vistos en las capturas (2026-10-19, `.playwright-mcp/shots/antes-*`) — a corregir en 7.1/7.4

1. **Título repetido**: la barra de arriba y la cabecera dicen lo mismo ("Conversaciones" / "Conversaciones"); se pierde altura.
2. **Inicio no sirve para nada**: 7 tarjetas iguales con "Lista" y un texto viejo ("el panel actual sigue funcionando"). Debería resumir el día (conversaciones sin responder, borradores, embudo, estado de Meta) con accesos directos.
3. **Gris con poco contraste** (`smoke` 3,3-3,8:1) en horas, ayudas y etiquetas; muchas letras de 10-11 px (chips, horas, etiquetas).
4. **Datos internos a la vista**: "empresa_dfy", "siguiente paso", "reel-aaa", "claude-haiku-5-5", y en Conversaciones la fecha **"2026-11-18T00:00:00.000Z"** dentro del cuadro de escribir.
5. **Aviso de bloqueo repetido 3 veces** en Conversaciones (banner + cuadro de texto cortado + línea roja).
6. **Filtros de Conversaciones** en 3 filas de botones diminutos (<44 px de alto).
7. **Contactos**: tabla sin cabeceras, etiquetas diminutas, mucho vacío sin estado vacío útil.
8. **Editor de flujos**: textos de las cajas de 11-12 px, etiquetas de flechas que se pisan, una caja cortada a la derecha, 6 botones arriba con el mismo peso.
9. **Anchos y márgenes distintos** en cada pantalla (Setter estrecho, Contactos ancho, Flujos a todo lo ancho sin criterio).
10. Sin notificaciones (toasts), sin esqueletos de carga y sin estados vacíos con acción.
