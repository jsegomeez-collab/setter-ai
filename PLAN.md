# Plan — Setter IA para Instagram

> Última actualización: 2026-10-16
> Estado general: **Fase 1 en curso.** Código hecho y subido (pasos 1-2). Siguiente: despliegue en Render (paso 3).

## Objetivo

Un sistema propio, en internet 24/7, que:

1. Responde a los comentarios de los reels (en público) y manda un DM con el recurso.
2. Cuando la persona **responde** al DM, un setter con IA habla con ella para cualificarla (¿tiene negocio?, ¿de qué tipo?, etc.).
3. Guarda toda la información para saber qué objeciones hay y qué tipo de personas escriben.
4. Más adelante: ofrecer llamadas a los cualificados.

Solo para la cuenta de Jose. Nunca se ofrece a otras cuentas.

## Decisiones tomadas (no reabrir sin preguntar a Jose)

| Fecha | Decisión |
|---|---|
| 2026-10-16 | App propia de Meta (Meta for Developers), intentando **no** hacer verificación de empresa ni App Review. |
| 2026-10-16 | La IA solo habla con quien **responde** un DM. Nunca escribe en frío. |
| 2026-10-16 | Hosting: **Render Starter** (siempre encendido). Ni PC ni VPS. |
| 2026-10-16 | Código propio. Referencia del lado setter: **OpenSetter** (MIT). Referencia de comentarios: **OpenReply** y **open-autodm** (MIT). |
| 2026-10-16 | ManyChat se **quita** después de confirmar en la Fase 1 que la app propia recibe los comentarios. Hasta entonces sigue funcionando. |
| 2026-10-16 | Audiencia: **USA y LATAM**. |

Datos de Jose: cuenta Creator pública (Meta Verified), cuenta de pruebas, LLC en USA con EIN, ManyChat Pro, cuentas de GitHub y Render, API key de Anthropic, oferta/FAQs/objeciones por escrito.

## Cómo funciona (al final del plan)

```
Alguien comenta en un reel
   → Meta avisa a nuestro servidor (Render)
   → respuesta pública variada + DM con el recurso (con botones / condición de seguir)
La persona responde el DM
   → Meta avisa a nuestro servidor
   → el setter IA (Claude) lee: tu oferta + FAQs + objeciones + historial del chat
   → contesta para cualificar y guarda la ficha del lead
Jose → panel web: conversaciones, fichas, objeciones más repetidas, por reel
```

Pila técnica: Node + TypeScript, base de datos Postgres (Neon gratis para empezar), Claude por API de Anthropic, Render Starter.

---

## Fases

Leyenda: ✅ hecha · 🔄 en curso · ⏳ pendiente · ❌ bloqueada

### Fase 0 — Investigación y decisiones ✅ (2026-10-16)

- Repos revisados: OpenSetter, OpenReply, open-autodm, InstaAuto, ZernFlow, ig-setter, manychat-ai-agent.
- Decisiones de arriba tomadas con Jose.

### Fase 1 — Prueba de punta a punta, sin IA 🔄

Progreso:
- [x] Pasos 1-2: código hecho (2026-10-16). 60 pruebas automáticas OK, cobertura 85,5 % de líneas. `store.ts` (Postgres) sin prueba automática: se valida en el primer arranque con Neon.
- [ ] Paso 3: despliegue en Render + Neon.
- [ ] Pasos 4-8: app de Meta (Jose).
- [ ] Pasos 9-12: prueba real.

Seguros del código (ManyChat sigue en vivo): solo actúa en el reel elegido en `/eventos`; solo contesta DMs si están activados en el panel y a remitentes autorizados (quien comentó en el reel de prueba); los `standby` solo se registran.

**Para qué:** comprobar con datos reales que Meta nos deja recibir comentarios y DMs de desconocidos **sin** App Review, antes de construir nada más.

**Yo (Claude):**
1. Crear el proyecto en esta carpeta y subirlo a un repo **privado** de GitHub.
2. Servidor con:
   - Recepción de avisos de Meta (verificación + firma de seguridad).
   - Guardar cada aviso en la base de datos.
   - Comentario de otra cuenta en el reel de prueba → respuesta pública + DM "Recibido tu comentario: …".
   - DM entrante → respuesta "Recibido: …".
   - Páginas de privacidad, términos y borrado de datos (Meta las exige para poner la app en Live).
   - Página `/eventos` con contraseña para ver todo lo que llega.
3. Desplegar en Render Starter + base de datos Neon.

**Jose (con guía paso a paso, son sus cuentas):**
4. Crear la app en Meta for Developers (caso de uso Instagram) y añadir su cuenta Creator como tester (aceptar la invitación en Instagram).
5. Generar el token de acceso en el panel de Meta y pegarlo en Render (nunca en el código).
6. Configurar el webhook (URL + token de verificación) y suscribir `comments` y `messages`.
7. Comprobar en Instagram que está activado el acceso a mensajes para herramientas conectadas (sin verificar el nombre exacto del ajuste).
8. Poner la app en **Live**.

**Prueba (sin tocar ManyChat):**
9. Usar un reel **sin** automatización de ManyChat. Comentar desde la cuenta de pruebas, que **no** tiene rol en la app (simula a un desconocido).
10. En `/eventos`: ¿llegó el comentario? ¿salió la respuesta pública? ¿llegó el DM?
11. Responder el DM desde la cuenta de pruebas: ¿llega como `messages` (bien) o como `standby` (ManyChat es la dueña de la conversación)? ¿contesta?
12. Si llega como `standby`: probar a tomar el control de la conversación. **Cambiar la app por defecto en Business Suite solo con permiso de Jose**, porque afecta a ManyChat en vivo.

**Hecha cuando:** el ciclo comentario → respuesta pública → DM → respuesta del usuario → contestación funciona con la cuenta de pruebas y se ve en `/eventos`.

**Si los comentarios NO llegan:** decide Jose entre:
- Plan B: preguntar a Meta cada minuto por comentarios nuevos (endpoint oficial `GET /{media-id}/comments`).
- Plan C: App Review + verificación de empresa con la LLC.

### Fase 2 — Comentarios completos (sustituir a ManyChat) ⏳

- Reglas por reel: palabra clave o cualquier comentario, texto del DM, recurso, botones y **condición de seguir** (como el flujo actual de ManyChat; referencia OpenReply).
- Respuestas públicas **variadas**.
- Protecciones anti-ban:
  - Esperas aleatorias de unos segundos; envíos de uno en uno.
  - Un solo DM por persona y comentario (bloqueado en la base de datos).
  - Límite propio por hora, muy por debajo del de Meta.
  - Si Meta devuelve el error 368 (bloqueo por política): pausa automática de 24 h.
- Renovación automática del token de Meta.
- Pantalla para crear y editar las reglas de cada reel.

**Hecha cuando:** un reel real funciona igual que con ManyChat. Entonces Jose decide apagar ManyChat.

### Fase 3 — Setter con IA ⏳

- Claude con la base de conocimiento de Jose (oferta, FAQs, objeciones).
- Instrucciones de setter: tono, objetivo (cualificar) y preguntas clave.
- Lógica tomada de OpenSetter:
  - Esperar unos segundos si mandan varios mensajes seguidos.
  - Callarse si Jose escribe a mano.
  - Filtro de temas delicados en **español e inglés**.
  - No comprometer precios ni fechas.
  - Modo borrador / automático.
- Aviso de IA (ver Riesgos) — decide Jose.

**Hecha cuando:** 10-20 conversaciones de prueba con la cuenta de pruebas salen bien según Jose.

### Fase 4 — Fichas de leads y panel ⏳

- Ficha por lead: tiene negocio, tipo/nicho, facturación aproximada, problema principal, objeciones, interés, etapa, resumen y reel de origen.
- Panel: conversaciones, fichas, ranking de objeciones, datos por reel, pausar la IA por conversación y aprobar borradores.

### Fase 5 — Ofrecer llamadas ⏳ (más adelante)

- Enlace de agenda solo a los cualificados. Se detalla cuando lleguemos.

---

## Reglas de Meta (verificadas en la doc oficial)

- DM a quien comenta: **1 solo mensaje por comentario**, dentro de **7 días**. Seguir solo si responde, dentro de **24 h** desde su mensaje. ([private replies](https://developers.facebook.com/docs/instagram-platform/private-replies))
- Responder un comentario: `POST /{comment-id}/replies`. ([comment moderation](https://developers.facebook.com/docs/instagram-platform/comment-moderation))
- La app tiene que estar en **Live** para recibir avisos, y la cuenta tiene que ser pública. ([webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks))

## Riesgos abiertos

| # | Riesgo | Qué hacemos |
|---|---|---|
| R1 | La doc de Meta se contradice: los avisos de comentarios piden "Advanced Access" ([webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks)), pero para tu propia cuenta basta "Standard Access" ([overview](https://developers.facebook.com/docs/instagram-platform/overview)). | Lo resuelve la Fase 1. Planes B y C preparados. |
| R2 | Instagram da cada conversación a **una sola app**. Mientras ManyChat siga conectado, puede quedarse con los DMs. | Fase 1, paso 11-12. Nunca cambiar el reparto sin Jose. |
| R3 | Ban por comportamiento de spam. Meta no publica sus umbrales. | Protecciones anti-ban de la Fase 2. Solo API oficial. |
| R4 | Ley de California (§17941): prohíbe usar un bot que **engañe** sobre ser un bot para empujar una venta. Si se avisa de que es un bot, no hay responsabilidad. ([texto](https://california.public.law/codes/ca_bus_and_prof_code_section_17941)) | Decidir en la Fase 3 cómo avisar. Leyes de LATAM: **no verificadas**. No es asesoramiento legal. |
| R5 | El token de Meta caduca. | Renovación automática en la Fase 2. |
| R6 | La base de datos Neon gratis se apaga tras 5 min sin uso y da 100 horas de cómputo al mes por proyecto ([precios](https://neon.com/pricing)). Puede no bastar si el sistema la usa sin parar. | Vale para la Fase 1. Revisar antes de producción. |

## Costes aproximados al mes

- Render Starter: ~7 $ por servicio (fuentes de terceros, no oficial).
- Neon: 0 $ al principio.
- API de Anthropic: según uso.
- ManyChat Pro: hasta que se apague en la Fase 2.

## Pendientes / apuntes (cosas a decidir más adelante)

- [ ] Fase 2: ¿respuestas públicas de una lista fija o generadas con IA?
- [ ] Fase 3: qué modelo de Claude y si empezamos en modo borrador o automático.
- [ ] Fase 3: texto exacto del aviso de IA.
- [ ] Fase 3: si Jose vive u opera desde la UE, revisar si la Ley de IA europea (art. 50, aviso de IA) le aplica aunque la audiencia sea USA/LATAM. **No verificado.**
- [ ] Antes de producción: base de datos definitiva (Neon de pago o Render Postgres).
- [ ] La página `/data-deletion` dice que se borran los datos si escriben "BORRAR" por DM: hoy eso es **manual** (lo haría Jose). Automatizarlo en la Fase 2 o 4.
- [ ] Añadir prueba automática de `store.ts` contra una base de datos real.

## Registro de cambios

- 2026-10-16 — Plan creado. Fase 0 terminada.
- 2026-10-16 — Fase 1: código del servidor de prueba subido a GitHub (commit 48c4377).
