# Plan — Setter IA para Instagram

> Última actualización: 2026-10-16
> Estado general: **Fase 2 en curso** (motor de flujos de comentarios). Fase 1 terminada ✅.
> Modo seguro activo en producción: DMs desactivados y reel de prueba = "00000" (no responde a nada).

## Objetivo

Un sistema propio (tipo ManyChat + setter con IA), en internet 24/7, **solo para la cuenta de Jose**:

1. **Automatización de comentarios:** responde en público a los comentarios de los reels y manda un DM con el recurso, con **botones** (enlaces o acciones) y **condiciones** (p. ej. "¿me sigue?").
2. **Setter con IA (corazón del proyecto):** con la información del negocio de Jose (oferta, FAQs, objeciones), habla con quien **responde** por DM como lo haría un setter: crea rapport, cualifica (¿tiene negocio?, tipo, facturación…) y más adelante ofrece llamada.
3. **Inteligencia comercial:** guarda todo para saber qué objeciones hay, qué tipo de personas escriben y qué reel trae mejores leads.
4. **Constructor visual de flujos (fase final):** una web para crear flujos sin tocar código: condiciones de seguimiento, botones a enlaces, mensajes, pasos hacia el setter IA, etc.

## Decisiones tomadas (no reabrir sin preguntar a Jose)

| Fecha | Decisión |
|---|---|
| 2026-10-16 | App propia de Meta ("AI Setter"), **publicada con Standard Access, sin App Review ni verificación** (funciona: probado en Fase 1). |
| 2026-10-16 | La IA solo habla con quien **responde** un DM. Nunca escribe en frío. |
| 2026-10-16 | Hosting: **Render Starter** (siempre encendido). Ni PC ni VPS. |
| 2026-10-16 | Código propio. Referencias MIT: **OpenSetter** (setter), **OpenReply** y **open-autodm** (comentarios). |
| 2026-10-16 | ManyChat se apaga cuando la Fase 2 iguale su flujo actual en un reel real. Hasta entonces sigue en vivo. |
| 2026-10-16 | Audiencia: **USA y LATAM**. |
| 2026-10-16 | **Fase final = frontend constructor visual de flujos.** Los flujos se guardan desde la Fase 2 en un formato de nodos genérico para que el constructor solo tenga que editarlos. |

Datos de Jose: cuenta Creator pública @josenews.ai (Meta Verified), cuenta de pruebas @josegomezlife, LLC en USA con EIN, ManyChat Pro, GitHub + Render + Neon, API key de Anthropic, oferta/FAQs/objeciones por escrito.

Infra: servidor https://setter-ai-vfle.onrender.com · repo `jsegomeez-collab/setter-ai` · app Meta ID 1416642890618916 (Instagram "AI Setter-IG").

## Cómo funciona (al final del plan)

```
Alguien comenta en un reel
   → Meta avisa a nuestro servidor
   → el FLUJO del reel: respuesta pública variada + DM (texto + botones)
   → botones: enlace al recurso, o acción → condición "¿me sigue?" → recurso / "sígueme primero"
La persona RESPONDE por DM
   → SETTER IA (Claude): lee oferta + FAQs + objeciones + historial
   → crea rapport, cualifica, guarda la ficha del lead, (más adelante) ofrece llamada
Jose → web: constructor de flujos, conversaciones, fichas, objeciones, estadísticas por reel
```

Pila técnica: Node + TypeScript (Hono), Postgres (Neon), Claude (API de Anthropic), Render Starter.

---

## Fases

Leyenda: ✅ hecha · 🔄 en curso · ⏳ pendiente · ❌ bloqueada

### Fase 0 — Investigación y decisiones ✅ (2026-10-16)

### Fase 1 — Prueba de punta a punta, sin IA ✅ (2026-10-16)

- Servidor en Render + Neon, panel `/eventos`, páginas legales. 60 pruebas automáticas.
- App de Meta creada, conectada y **publicada** (hecho con Playwright).
- Prueba real: @josegomezlife (sin rol) comentó → respuesta pública ✅ → DM privado ✅ → respondió "Hola" → llegó como `messages` (no standby) ✅ → contestación ✅. ManyChat estaba pausado.

### Fase 2 — Motor de flujos de comentarios (sustituir a ManyChat) 🔄

**Para qué:** que un reel real funcione igual (o mejor) que con ManyChat, con el formato de flujos que luego usará el constructor visual.

1. **Modelo de flujo genérico (nodos)** guardado en la base de datos:
   - Disparador: reels concretos o todos + palabras clave (o cualquier comentario).
   - Respuestas públicas variadas (se elige una al azar).
   - Nodos: `mensaje` (texto + hasta 3 botones: enlace o acción) y `condición de seguir` (si sigue → nodo A; si no → nodo B).
   - Modo prueba por flujo: solo responde a usuarios concretos (p. ej. @josegomezlife) mientras ManyChat siga activo.
2. **Motor:** comentario → flujo → respuesta pública + DM privado con el primer mensaje; pulsación de botón (`messaging_postbacks`) → siguiente nodo.
3. **Condición de seguir:** `is_user_follow_business`. Meta exige "consentimiento" (que la persona haya escrito). **Hay que probar** si pulsar un botón cuenta. Si no se puede saber → se entrega el recurso igualmente (como OpenReply) y se registra.
4. **Protecciones anti-ban:** cola de envíos de uno en uno, espera aleatoria de 2-5 s, una sola vez por persona y flujo, límite propio por hora, pausa automática de 24 h si Meta devuelve el error 368.
5. **Token:** guardarlo en la base de datos y renovarlo solo (`refresh_access_token`, válido 60 días, necesita ≥24 h de antigüedad — verificado en la doc oficial).
6. **Panel sencillo** (el bonito es la Fase 6): lista de flujos, formulario "plantilla tipo ManyChat" (reel, palabras, respuestas públicas, mensaje, botón, condición de seguir, recurso), activar/desactivar. Más: quitar reel de prueba, reconocer avisos `read`/`seen`.
7. **Prueba real** con @josegomezlife en un reel de poco tráfico (ManyChat pausado un momento).

Progreso:
- [x] 1-6 hechos (2026-10-16, commit 86c1dbf): tipos + motor + formulario + emisor anti-ban + token cifrado/renovable + panel `/flujos`. 97 pruebas (incl. Postgres real con PGlite), 92,6 % líneas. Desplegado; `TOKEN_ENCRYPTION_KEY` creada por el Blueprint.
- [x] Flujo de prueba creado en producción: "PRUEBA Fase 2 - reel agente n8n" (id PlNFjBYQ), solo @josegomezlife, condición de seguir, recurso de prueba = perfil de Jose.
- [x] 7: prueba real 2026-10-16 13:52-13:53 UTC con @josegomezlife (ManyChat pausado): comentario → respuesta pública ✅ → **DM privado CON botones** ✅ (Meta los acepta; sin respaldo) → botón llega a nuestra app ✅ → `is_user_follow_business=true` ✅ → recurso ✅.
  - Sin probar: rama "no sigue" y consentimiento con alguien que NUNCA ha escrito (@josegomezlife ya había escrito "Hola").
  - Observado: con ManyChat activo, los DMs nos llegan como **standby** (R2 confirmado).
- [x] 8a (2026-10-16, commit 6495937): para igualar el flujo de ManyChat de Jose (captura) se añadieron: nodo **pausa** (máx. 23 h), **siguiente paso** automático, **etiquetas al pulsar enlaces** (enlaces con seguimiento firmados `/l/…`), tabla **contactos**, pausas persistentes (`scheduled_jobs`, sin sondear la BD), **editor JSON** de flujos avanzados y página **/contactos**. 129 pruebas, 92,75 % líneas.
- [x] Renovación automática del token **comprobada en producción** (13:40 UTC: origen BD, caduca 2026-12-15).
- [x] Réplica del flujo de ManyChat creada en producción (id `manychat`, modo prueba @josegomezlife, reel de prueba). URLs de biblioteca y WhatsApp = **provisionales** (faltan las reales).
- [ ] 8b: prueba real de la réplica (incl. rama "no sigue", clic en enlaces → etiquetas, pausa de 2 min → mensaje del grupo).
- [ ] 8c: con las URLs/respuestas reales de Jose → quitar modo prueba, pasar a "todos los reels" y apagar ManyChat a la vez (decide Jose).
- [x] Renovación de token: funcionó el mismo día (Meta no exigió las 24 h que dice la doc).

**Necesito de Jose (al final de la fase):** cómo es hoy su flujo de ManyChat (textos, botones, condición de seguir, recurso) para replicarlo.

**Hecha cuando:** un reel real funciona igual que con ManyChat → Jose decide apagar ManyChat.

### Fase 3 — Setter con IA ⏳

- Base de conocimiento de Jose (oferta, FAQs, objeciones) + instrucciones de setter (tono, rapport, preguntas de cualificación).
- Claude responde a quien escribe por DM tras el flujo (o por su cuenta).
- Lógica tomada de OpenSetter: esperar si mandan varios mensajes seguidos, callarse si Jose escribe a mano, filtro de temas delicados en español e inglés, no comprometer precios ni fechas, modo borrador / automático.
- Aviso de IA (ver R4) — decide Jose.
- Antes: comprobar si con ManyChat activo los DMs llegan como `messages` o `standby` (R2).

**Hecha cuando:** 10-20 conversaciones de prueba salen bien según Jose.

### Fase 4 — Fichas de leads e inteligencia comercial ⏳

- Ficha por lead: tiene negocio, tipo/nicho, facturación aproximada, problema principal, objeciones, interés, etapa, resumen, reel de origen.
- Panel: conversaciones, fichas, ranking de objeciones, estadísticas por reel, pausar la IA por conversación, aprobar borradores.

### Fase 5 — Ofrecer llamadas ⏳

- Enlace de agenda solo a cualificados. Se detalla al llegar.

### Fase 6 (FINAL) — Frontend constructor visual de flujos ⏳

- Web para crear y editar flujos sin código: disparadores, mensajes, **botones a enlaces**, **condiciones de seguimiento**, esperas, pasar al setter IA, etiquetas…
- Edita el mismo formato de nodos creado en la Fase 2.
- Une en una sola web todo lo de las fases 2-5 (flujos, conversaciones, fichas, estadísticas).

---

## Reglas de Meta (verificadas en la doc oficial)

- DM a quien comenta: **1 solo mensaje por comentario**, dentro de **7 días**. Seguir solo si responde, dentro de **24 h**. ([private replies](https://developers.facebook.com/docs/instagram-platform/private-replies))
- Responder un comentario: `POST /{comment-id}/replies`. ([comment moderation](https://developers.facebook.com/docs/instagram-platform/comment-moderation))
- Botones: 1-3 por mensaje, `web_url` o `postback`; texto ≤ 640 caracteres; al pulsar un `postback` llega `messaging_postbacks`. ([button template](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/button-template))
- `is_user_follow_business` requiere consentimiento del usuario (que haya escrito). ([user profile](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile))
- Token: `GET /refresh_access_token?grant_type=ig_refresh_token`, válido 60 días, token ≥ 24 h. ([refresh](https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token))
- La app tiene que estar publicada para recibir avisos. ([webhooks](https://developers.facebook.com/docs/instagram-platform/webhooks))

## Riesgos abiertos

| # | Riesgo | Qué hacemos |
|---|---|---|
| R1 | ✅ RESUELTO 2026-10-16: con la app publicada (Standard Access) llegan comentarios y DMs de cuentas sin rol. | — |
| R2 | **CONFIRMADO 2026-10-16:** con ManyChat activo, los DMs nos llegan como `standby` (ManyChat es dueño). | Apagar/desconectar ManyChat al terminar la Fase 2, antes del setter IA. Nunca cambiar el reparto sin Jose. |
| R3 | Ban por comportamiento de spam. Meta no publica sus umbrales. | Protecciones anti-ban de la Fase 2. Solo API oficial. |
| R4 | Ley de California (§17941): bot que **engaña** sobre ser bot para vender. Avisar evita la responsabilidad. ([texto](https://california.public.law/codes/ca_bus_and_prof_code_section_17941)) | Decidir en Fase 3 cómo avisar. LATAM: **no verificado**. No es asesoramiento legal. |
| R5 | El token caduca a los 60 días. | Renovación automática (Fase 2). |
| R6 | Neon gratis: se apaga tras 5 min sin uso y 100 h de cómputo/mes ([precios](https://neon.com/pricing)). | Revisar consumo antes de producción. |
| R7 | Consulta "¿te sigue?" funcionó con @josegomezlife, pero ya había escrito antes: no está demostrado que el botón solo dé "consentimiento". | Probar con una cuenta que nunca haya escrito. Plan B ya programado: entregar el recurso igualmente. |

## Costes aproximados al mes

- Render Starter: ~7 $ por servicio (fuentes de terceros, no oficial).
- Neon: 0 $ al principio.
- API de Anthropic: según uso (desde la Fase 3).
- ManyChat Pro: hasta que se apague.

## Pendientes / apuntes

- [ ] Fase 2: ¿respuestas públicas de una lista fija o generadas con IA? (de momento lista fija)
- [ ] Fase 3: modelo de Claude; empezar en borrador o automático; texto del aviso de IA.
- [ ] Fase 3: si Jose vive u opera desde la UE, revisar si le aplica la Ley de IA europea (art. 50). **No verificado.**
- [ ] Antes de producción: base de datos definitiva (Neon de pago o Render Postgres).
- [ ] `/data-deletion` promete borrar datos si escriben "BORRAR": hoy es **manual**. Automatizar (Fase 4).
- [ ] Prueba automática de `store.ts` contra una base de datos real.

## Registro de cambios

- 2026-10-16 — Plan creado. Fase 0 terminada.
- 2026-10-16 — Fase 1: código subido (48c4377), app de Meta publicada y conectada, prueba punta a punta OK.
- 2026-10-16 — Plan reorganizado: el setter IA es el corazón; nueva Fase 6 final = constructor visual de flujos. Empieza la Fase 2.
