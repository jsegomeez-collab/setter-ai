# Plan — Setter IA para Instagram

> Última actualización: 2026-10-16
> Estado general: **Fase 2 en producción** (réplica de ManyChat atendiendo a seguidores reales desde el 2026-10-16 14:53 UTC). Vigilando 24-48 h. Siguiente: Fase 3 (setter IA) — necesito oferta/FAQs/objeciones de Jose.
> ManyChat sigue conectado a Instagram (sin disparador). Para la Fase 3 Jose autoriza desconectarlo.

## Objetivo

Un sistema propio (tipo ManyChat + setter con IA), en internet 24/7, **solo para la cuenta de Jose**:

1. **Automatización de comentarios:** responde en público a los comentarios de los reels y manda un DM con el recurso, con **botones** (enlaces o acciones) y **condiciones** (p. ej. "¿me sigue?").
2. **Setter con IA (corazón del proyecto):** con la información del negocio de Jose (oferta, FAQs, objeciones), habla con quien **responde** por DM como lo haría un setter: crea rapport, cualifica (¿tiene negocio?, tipo, facturación…) y más adelante ofrece llamada.
3. **Inteligencia comercial y de contenido, 100 % medida:** todas las conversaciones se analizan **masivamente** con IA para extraer objeciones nuevas, datos de mercado y **ángulos de contenido**; y todo se mide (por reel, por etiqueta, por etapa del embudo).
4. **Software de gestión completo (fase final):** un frontend con **todas** las funciones: constructor visual de flujos (condiciones, botones a enlaces…), conversaciones, contactos, setter IA, análisis, métricas y configuración. Desde ahí se gestiona absolutamente todo.

## Decisiones tomadas (no reabrir sin preguntar a Jose)

| Fecha | Decisión |
|---|---|
| 2026-10-16 | App propia de Meta ("AI Setter"), **publicada con Standard Access, sin App Review ni verificación** (funciona: probado en Fase 1). |
| 2026-10-16 | La IA solo habla con quien **responde** un DM. Nunca escribe en frío. |
| 2026-10-16 | Hosting: **Render Starter** (siempre encendido). Ni PC ni VPS. |
| 2026-10-16 | Código propio. Referencias MIT: **OpenSetter** (setter), **OpenReply** y **open-autodm** (comentarios). |
| 2026-10-16 | ManyChat se apaga cuando la Fase 2 iguale su flujo actual en un reel real. Hasta entonces sigue en vivo. |
| 2026-10-16 | Audiencia: **USA y LATAM**. |
| 2026-10-16 | **Fase final = frontend completo (software de gestión de todo)**, incluido el constructor visual de flujos. Los flujos se guardan desde la Fase 2 en un formato de nodos genérico para que el constructor solo tenga que editarlos. |
| 2026-10-16 | **Todo medido:** cada comentario guarda su reel de origen; cada clic, etiqueta y paso del flujo queda registrado. Las conversaciones se analizan en masa (objeciones, mercado, ángulos de contenido). |

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
- [x] 8b: prueba real 14:15-14:17 UTC: rama "no sigue" ✅ (×2), "Ya te seguí" → sí ✅, biblioteca ✅, clic → etiqueta "biblioteca" ✅, pausa 2 min → mensaje del grupo ✅. Sin registrar: clic en "UNIRME AL GRUPO" (¿no se pulsó?).
- [x] Datos reales recibidos: biblioteca https://biblioteca.codigomaestria.com, grupo https://chat.whatsapp.com/B7CxsuLbf82IyJmT6LJ2BE (ambos responden 200), 5 respuestas públicas de ManyChat, disparador = todos los posts + cualquier comentario.
- [x] Origen por reel (petición de Jose): tabla `comments` + reel de origen/último en contactos + resumen por reel en /contactos. Se registra en TODOS los comentarios, salte o no un flujo. 132 pruebas.
- [x] 8c (2026-10-16 ~14:35 UTC): Jose apagó el disparador #59 de ManyChat → réplica **EN PRODUCCIÓN** (todos los reels, cualquier comentario, sin modo prueba, una vez por persona **y por reel** = opción B de Jose, commit e0bd013). Enlaces reales.
- [x] 8c-corrección: la activación real fue a las **14:53 UTC** (no 14:35). Entre 13:46 y 14:53 nadie respondió (ManyChat pausado y nuestro flujo en prueba): 16 personas/17 comentarios.
- [x] Rescate (opción a de Jose): 15 en cola → 14 respuestas públicas, 9 DMs OK, **5 DMs rechazados por Meta** (100/2534025 "comentario no válido para respuesta privada") que recibieron igualmente "mira tus DMs" (fallo de diseño corregido después).
- [x] 8d: confirmado en producción con @josegomezlife (14:55) y con seguidores reales (15:24 "Oficina": DM → luego respuesta pública).
- [x] Límites revisados con la doc oficial (commit 16e329d): DMs a comentarios 700/h (Meta 750), respuestas públicas 700/h, seguimientos 3000/h; dos colas; si se llega al límite o hay pausa 368 la cola ESPERA (no descarta); acciones reservadas al encolar y retomadas tras reinicio; **primero el DM y la respuesta pública solo si el DM salió**. 140 pruebas.
- [ ] 8e: vigilar 24-48 h con tráfico real (errores 2534025, límites, consumo de Neon R6).
- [x] Renovación de token: funcionó el mismo día (Meta no exigió las 24 h que dice la doc).

**Necesito de Jose (al final de la fase):** cómo es hoy su flujo de ManyChat (textos, botones, condición de seguir, recurso) para replicarlo.

**Hecha cuando:** un reel real funciona igual que con ManyChat → Jose decide apagar ManyChat.

### Fase 3 — Setter con IA 🔄 (preparación)

**Para qué:** que cada persona que **responde** por DM hable con un setter IA que cualifica (5 preguntas del documento de Jose) y agenda llamada con Código Maestría, o ofrece la membresía si no hay presupuesto.

**Recibido de Jose (2026-10-16, versión temporal para probar):** documento con rol, reglas, oferta, niveles, 5 preguntas de calificación, perfil ideal, FAQs y objeciones. Tiene huecos marcados [LINK AGENDA], [LINK MEMBRESÍA], [CONFIRMAR…] y [COMPLETAR] → la IA NUNCA rellena esos huecos: deriva a la llamada o a info@codigomaestria.com.

Pasos (en orden, comprobando cada uno):
1. **Conversaciones**: guardar cada DM entrante y saliente (historial propio, no depender de Meta) + página /conversaciones.
2. **Base de conocimiento editable** desde el panel (el documento de Jose, con historial de versiones). No se guarda en el repo.
3. **Motor del setter**: DM de texto → espera unos segundos por si escribe varios mensajes → Claude con documento + historial → respuesta corta → cola de seguimientos. En la misma llamada extrae datos del lead (respuestas a las 5 preguntas, nivel, presupuesto, objeción) → base de la Fase 4.
4. **Seguros**: modo prueba (solo usuarios autorizados), modo borrador opcional, la IA se calla si Jose escribe a mano, solo los 2 enlaces permitidos (cualquier otro enlace se bloquea antes de enviar), nunca menores, no responde a ecos ni a pulsaciones de botón (eso es del flujo).
5. **Desconectar ManyChat** (autorizado por Jose) para que los DMs lleguen como `messages` y no `standby`.
6. **Prueba**: 10-20 conversaciones con @josegomezlife cubriendo perfiles y objeciones; Jose valida.

**Hecha cuando:** las conversaciones de prueba salen bien según Jose y pasa a producción con el público.

**Decisiones de Jose para la Fase 3 (2026-10-16):**
- Enlaces: membresía https://buy.stripe.com/8x29AS3ZI0Uk1jg0Fpbwk1Z · agenda https://codigomaestria.com/agenda?utm_source=instagram
- El setter responde a **cualquier DM** (venga de flujo o no).
- Arranque **solo con @josegomezlife**; público cuando Jose dé el visto bueno.
- **Sin aviso proactivo de IA** (solo decir la verdad si preguntan). Decisión de Jose, no reabrir.
- Si Jose escribe a mano en una conversación → la IA se **para indefinidamente** en esa conversación hasta que Jose la reanude en el panel.
- **Modelos:** responder mensajes = **Claude Haiku 5.5** (`claude-haiku-5-5`, configurable por variable). Analizar/extraer datos y conclusiones = **Claude Sonnet 5.5** (`claude-sonnet-5-5`). **Nunca Opus** (caro).
- `ANTHROPIC_API_KEY`: Jose la pega en Render (pantalla preparada con Playwright).
- Sin `fallbacks` de servidor (no documentado con salidas estructuradas): si Claude rechaza/falla → conversación parada y marcada para Jose.

**Estado del código (trabajo en curso, NO desplegado):**
- `@anthropic-ai/sdk` 0.135.0 instalado (helper `zodOutputFormat` en `@anthropic-ai/sdk/helpers/zod`, `client.messages.parse` + `output_config: {effort, format}`).
- `src/store.ts`: añadidas tablas `messages`, `knowledge_versions`, columnas de contacto `ai_paused`, `ai_paused_reason`, `lead` y métodos (addMessage, setMessageStatus, listMessages, listConversations, getContact, setAiPaused, saveLead, findActionByMessageId, saveKnowledge, getKnowledge, listKnowledgeVersions). **Falta**: helpers de prueba, compilar.
- Pendiente de escribir: `src/setter/` (esquema lead con zod, prompt con documento + enlaces, cerebro Haiku, guardas de enlaces/longitud, servicio con espera 8 s y "callarse si Jose escribe" vía ecos: si el `mid` del eco no está en `actions` tras ~5 s → humano → pausa), rutas `/setter` (documento + versiones + activar + usuarios de prueba) y `/conversaciones` (lista, hilo, pausar/reanudar, ficha), cableado en `index.ts`/`process.ts`, pruebas, desconectar ManyChat, prueba con @josegomezlife.
- El documento de Jose (temporal) está en la conversación; se cargará en la BD desde el panel, no en el repo.

### Fase 4 — Fichas de leads, análisis masivo y medición ⏳

**Para qué:** que cada conversación se convierta en datos útiles para vender y para crear contenido, y que todo esté medido.

- **Ficha por lead** (extraída por IA de cada conversación): tiene negocio, tipo/nicho, facturación aproximada, problema principal, objeciones, interés, etapa, resumen, reel de origen.
- **Análisis masivo de conversaciones** (por lotes, sobre todas las conversaciones):
  - **Objeciones**: catálogo vivo, objeciones nuevas detectadas, frecuencia y tendencia.
  - **Datos de mercado**: nichos, tamaño de negocio, dolores, deseos, lenguaje literal que usa la gente.
  - **Ángulos de contenido**: ideas de reels/ganchos sacadas de lo que pregunta y objeta la gente, con ejemplos reales.
  - Cada hallazgo enlazado a las conversaciones de las que sale (trazable, nada inventado).
- **Medición 100 %:**
  - Embudo: comentario → DM → botón → sigue → clic en recurso → responde → cualificado → llamada.
  - Por reel, por flujo, por etiqueta y por día. (Base ya creada en Fase 2: reel de origen, comentarios, clics, etiquetas.)
  - Rendimiento del setter IA: respuestas, tiempos, conversaciones que avanzan de etapa.
- Panel (provisional hasta la Fase 6): conversaciones, fichas, objeciones, ángulos, estadísticas, pausar la IA por conversación, aprobar borradores.

### Fase 5 — Ofrecer llamadas ⏳

- Enlace de agenda solo a cualificados, medido (ofrecidas → reservadas). Se detalla al llegar.

### Fase 6 (FINAL) — Software de gestión completo (frontend) ⏳

**Para qué:** una sola web, como un software profesional, desde la que se gestiona **absolutamente todo**.

- **Constructor visual de flujos**: disparadores, mensajes, **botones a enlaces**, **condiciones de seguimiento**, pausas, etiquetas, pasar al setter IA… (edita el formato de nodos de la Fase 2).
- **Bandeja de conversaciones**: ver, filtrar, responder a mano, pausar/activar la IA, aprobar borradores.
- **Contactos / CRM**: fichas, etiquetas, reel de origen, historial completo.
- **Setter IA**: base de conocimiento (oferta, FAQs, objeciones), instrucciones, modo borrador/automático.
- **Inteligencia**: objeciones, datos de mercado, ángulos de contenido, con su evidencia.
- **Métricas y embudo**: todo lo medido en la Fase 4, con gráficos y filtros.
- **Configuración**: cuenta de Instagram, token, anti-ban, límites, estado del sistema.
- Acceso seguro (login) desde cualquier dispositivo.

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
| R3 | Ban/límites. **Doc oficial (2026-10-16):** respuestas privadas 750/h por cuenta; Send API 100/s (otra página dice 300/s); llamadas generales 4800 × impresiones/24 h; >72.000 mensajes enviados+recibidos → Instagram retrasa/bloquea (periodo no indicado). La doc NO describe baneos por usar la API dentro de límites, pero tampoco exime de las normas anti-spam. | Límites por tipo pegados a Meta con margen; la cola espera en vez de descartar; pausa 24 h ante error 368. |
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
- 2026-10-16 — Plan ampliado (Jose): Fase 4 = análisis masivo de conversaciones (objeciones, mercado, ángulos de contenido) + medición 100 %; Fase 6 = software de gestión completo. Origen por reel implementado.
- 2026-10-16 — Réplica de ManyChat en producción (opción B: una vez por persona y por reel). Jose autoriza desconectar ManyChat en la Fase 3.
