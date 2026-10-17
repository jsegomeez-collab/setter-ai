# Plan — Setter IA para Instagram

> Última actualización: 2026-10-17
> Estado general: **Fase 2 y Fase 3 en producción.** Flujos de comentarios atendiendo a seguidores reales; setter IA en modo **PRUEBA** (solo @josegomezlife). ManyChat desconectado.
> **En curso: Fase 4** (repasada con Jose el 2026-10-17; orden: embudo → historial de ficha → análisis masivo → pendientes técnicos). Decisión de Jose: terminar primero el programa (Fases 4-6); el marketing del setter lo pule él después.

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
| 2026-10-16 | Setter: Claude Haiku 5.5 responde y rellena la ficha; Sonnet 5.5 para el análisis masivo; nunca Opus. Solo español. Detalle en la Fase 3. |
| 2026-10-17 | **Primero terminar el programa (Fases 4-6); el marketing del setter (documento, objeciones, tono) lo pule Jose después.** |

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

### Fase 2 — Motor de flujos de comentarios (sustituir a ManyChat) ✅ (2026-10-16: en producción y ManyChat desconectado por Jose)

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

### Fase 3 — Setter con IA ✅ técnica (2026-10-16) · en producción en modo PRUEBA

**Para qué:** que cada persona que **responde** por DM hable con un setter IA que cualifica (5 preguntas del documento de Jose) y agenda llamada con Código Maestría, o ofrece la membresía si no hay presupuesto.

**Estado (2026-10-17):**
- En producción desde el 2026-10-16. Modo **PRUEBA**: solo responde a `josegomezlife`; a los demás solo les guarda los DMs. Modo público = solo con el OK de Jose.
- Código desplegado: `main` = **ff43a01**. La rama `fase3-wip` = `main` + commits de documentación (no hace falta desplegarlos). 237 pruebas.
- Documento del setter en uso: **versión #4** (= v2: con las respuestas de Jose a los huecos; "Español, tuteo"; llamada de unos 45 min). Se edita en `/setter`, nunca en el repo.
- ManyChat **desconectado** de Instagram (Jose, 2026-10-16 18:10 UTC): los DMs llegan como `message`.

**Qué hay construido:**
- `src/setter/`: `schema.ts` (mensajitos + ficha del lead), `prompt.ts` (documento + marco técnico), `brain.ts` (Claude Haiku 5.5, `effort: low`, JSON validado tras mirar `stop_reason`), `guards.ts` (solo 2 enlaces + correo, ≤4 mensajitos de ≤300 caracteres, sin precios del grupal/VIP, sin huecos, sin otros alfabetos), `reply.ts` (si no pasa el filtro, segundo intento explicando por qué; si vuelve a fallar, se retiene y se para), `service.ts` (espera 8 s, modos off/test/live, borrador, "escribiendo…" + pausa ~3-4 s por mensajito, envío por la cola), `echoes.ts` (si Jose escribe a mano, la IA se para en esa conversación), `scenarios.ts` + `simulator.ts` (simulador).
- Panel: `/setter` (modo, borrador, usuarios de prueba, documento con versiones), `/setter/simulador` (18 escenarios; otra IA hace de lead; no envía nada), `/conversaciones` (hilo, ficha, parar/reanudar).

**Verificado con datos reales (2026-10-16):** DM → 8 s → Haiku → mensajitos con "escribiendo…" → eco reconocido como nuestro (7/7) · Jose escribe a mano → "IA parada: Jose escribió a mano" · ficha rellenada sin inventar · clave de Anthropic OK · coste real ≈ 0,0003 $/respuesta con caché (≈ 0,0009 $ sin caché) · 4 vueltas del simulador: nunca precios del grupal/VIP ni su enlace, nunca citas inventadas, menor y cliente enfadado → se para, lead en inglés → responde en español.

**Decisiones de Jose para la Fase 3 (no reabrir):**
- Enlaces: membresía https://buy.stripe.com/8x29AS3ZI0Uk1jg0Fpbwk1Z · agenda https://codigomaestria.com/agenda?utm_source=instagram · correo info@codigomaestria.com.
- Responde a **cualquier DM**. Arranque solo con @josegomezlife; público cuando Jose lo diga.
- **Sin aviso proactivo de IA** (solo la verdad si preguntan).
- Si Jose escribe a mano → la IA se **para indefinidamente** en esa conversación (se reanuda en el panel). Con el setter en "apagado", los ecos ajenos no paran nada.
- **Modelos:** Haiku 5.5 responde y rellena la ficha en la misma llamada; Sonnet 5.5 solo para el análisis masivo (Fase 4). **Nunca Opus.**
- **Estilo:** varios mensajitos cortos, informal sin faltas, una pregunta por turno, "escribiendo…" y pausa de ~3-4 s.
- **Solo español** (tuteo). Si escriben en otro idioma, responde en español y lo explica.
- **Precios:** solo "hay opciones desde $47 al mes hasta acompañamiento 1:1…"; nunca los del grupal/VIP por chat (bloqueado también en código).
- "Hablar con una persona" → se le pasa la agenda (la llamada es con el equipo) y la IA sigue. Pasa a Jose (se para) solo si: problema con algo pagado, queja, agresividad, o insiste tras darle la agenda. Posible menor → se despide y se para.
- **2026-10-17:** primero se termina el programa (Fases 4-6). El marketing del setter (documento, objeciones, tono) lo pule **Jose** después: no tocarlo ahora.

**Pendiente de la Fase 3 (no bloquea seguir con la Fase 4):**
- Modo público: solo con el OK de Jose, después de que pula el documento.
- Para cuando Jose pula el marketing (vistos en el simulador): con leads escépticos que piden "todo por escrito" manda al correo en vez de defender la llamada; a veces contesta algo fuera de tema (receta de pasta); alguna errata ("ola").
- Técnicos (ver Pendientes/apuntes): espera de 8 s en memoria, aprobar borradores desde el panel, reanudar no contesta lo pendiente, `listConversations` sin LIMIT en SQL, caché de 1 h opcional.

### Fase 4 — Fichas de leads, análisis masivo y medición 🔄 (rama `fase4-wip`)

**Para qué:** que cada conversación se convierta en datos útiles para vender y para crear contenido, y que todo esté medido.

**Decisiones de Jose (2026-10-17, no reabrir):**
- Orden: **1) embudo medido** (`/metricas`, sin IA, con datos reales que ya existen) → **2) historial de la ficha** (hoy `contacts.lead` se sobrescribe; sin historial no se puede medir el avance de etapa) → **3) análisis masivo** con Sonnet 5.5 → **4) pendientes técnicos** (borrado automático con "BORRAR", aprobar borradores, `listConversations` con LIMIT).
- Ficha: **la actual** (las 5 preguntas del documento de Jose: `src/setter/schema.ts`), no la lista antigua de abajo.
- Análisis masivo: **botón manual** en el panel (Jose controla el gasto).
- Permiso de Jose para **leer producción (solo lectura)** para ver el volumen real y cerrar el 8e.

Lectura de producción (2026-10-17, solo lectura, panel): 99 comentarios en 16 reels, ~30 conversaciones, clics "biblioteca" 11 y "Grupo WhatsApp" 2. Anti-ban 2/700, sin 368 visible, token hasta 2026-12-15. Neon **sin revisar**.

Hallazgos fuera del plan (decisión de Jose 2026-10-17: arreglar **antes** del paso 1):
- [ ] A. Si la persona contesta con **texto** ("si") al mensaje del flujo en vez de pulsar el botón, se queda colgada (caso real @mg_grela, 3 × "si"). Arreglar.
  - [x] Código (2026-10-17, `src/flows/text-reply.ts`): si lo último que recibió es un mensaje del flujo con **un** botón de acción y contesta un "sí" corto (lista de Jose: si, dale, ok, vale, listo, ya, quiero, porfa, mándamelo, ya te seguí/sigo + el texto del botón; ≤5 palabras), cuenta como pulsarlo. Varios "sí" al mismo mensaje = **una** vez. El DM se guarda en la conversación y el setter no contesta. Cualquier otro texto → setter, como antes. 271 pruebas.
  - [x] Desplegado 2026-10-17 (`main` = bfc7083, Render "Live").
  - [ ] Probar con @josegomezlife: comentar → escribir "si" en vez de pulsar.
- B. Investigación (2026-10-17, doc oficial + 16 respuestas privadas reales de /eventos):
  - Doc de Meta: 100/2534025 = "The comment is invalid for a private reply"; solución: "Make sure that the type of data you are sending in your private reply is allowed" ([error codes](https://developers.facebook.com/documentation/business-messaging/messenger-platform/error-codes)). La guía de private replies no lo explica.
  - Datos: mismo flujo, mismo mensaje con botón y **mismo texto de comentario** ("Bolsa") → a uno le llega (@ion_hantig) y a otros dos no. Todos texto normal, sin GIF; todos comentarios principales; casi todos personas nuevas en ambos grupos. **Conclusión: depende de la persona, no del comentario ni de lo que mandamos en general.** La causa exacta (ajustes de mensajes de esa persona, edad, otra cosa) **no se puede ver** con nuestros datos ni está en la doc.
  - Decisión de Jose (2026-10-17): **1) reintento con solo texto** + **2) plan B público** si también falla.
  - [x] 1. Hecho: el respaldo de solo texto ya existía pero yo lo había excluido para 2534025 con una suposición sin comprobar ("tampoco saldría como texto"). Quitada la excepción. 272 pruebas. Sin desplegar.
  - [x] 1b. Desplegado (57a2386).
  - [x] 2. Plan B público + rescate por DM (Jose: "crealo tu" → 3 textos aprobados). Campo `dmFailedReplies` del flujo; la respuesta pública solo se encola si el DM falla del todo (nunca con 368), una vez por comentario; si esa persona escribe en 7 días y no le mandamos nada desde el fallo, el flujo le manda su primer mensaje (una vez). 285 pruebas.
    - Encontrado antes de desplegar: `listFlows` devolvía el JSON sin pasar por el esquema → los flujos antiguos no tendrían el campo nuevo y **todos** los comentarios habrían fallado. Arreglado (se pasa por el esquema) + protección en el motor + prueba con Postgres real.
  - [x] 2b. Desplegado (ffad1df, Render "Live", /healthz 200) y **activado** 2026-10-17: flujo "Réplica ManyChat" guardado con los 3 textos; el resto del flujo comprobado sin cambios.
  - [x] Prueba de Jose del "si" con @josegomezlife (2026-10-16 23:37-23:40 UTC): "texto como botón" → sigue → biblioteca → grupo ✅.
  - Tráfico real hasta 2026-10-17 00:07 UTC: reintento con texto **0 de 3 salvados** (los 3 volvieron a dar 2534025 → apunta a que el botón NO es la causa; muestra pequeña). Plan B **3 de 3 publicados** OK. Rescatados por DM: 0 (aún nadie ha escrito). En 1 caso el primer intento falló por "Service temporarily unavailable" (código 2, pasajero) y el texto por 2534025.
  - [ ] Seguir midiendo; rescate por DM sin verificar con datos reales.
  - **Conclusión (2026-10-17, datos de Jose):** ManyChat (app aprobada, Advanced Access) **perdía leads por el mismo error** → no es nuestro nivel de acceso (no hace falta App Review). **Ningún reel promocionado** (todo orgánico) → no son anuncios. El % de rechazo varía por reel del 0 % al 79 % con el mismo código y mensaje → depende de la persona (ajustes de mensajes / restricciones de cuenta; fuentes de terceros, Meta no lo documenta). **No se puede saltar por la API.** La única vía: que escriban ellos → plan B + rescate por DM (ya en producción). Medir cuántos se recuperan.
  - Sin explicar: el reel `18129515419637342` no aparece en la lista de reels del panel (lee los 50 últimos).
  - [ ] Medir tras desplegar: cuántos 2534025 se salvan con el texto (si casi ninguno, la causa no es el botón).
- [ ] B. **Error 2534025**: 9 de 16 DMs a comentarios rechazados por Meta entre 21:23 y 23:04 UTC del 16-10 (56 %). Investigar la causa con la doc oficial (solo lectura) y traerla a Jose antes de cambiar nada.

Progreso:
- [x] 1. Embudo `/metricas` (2026-10-17, desplegado 127bb48): por reel + TOTAL + por día; periodo todo/7/30 días. Decisiones de Jose: tabla con DM rechazado/plan B/rescatados; quien comenta en 2 reels cuenta en los dos.
  - Validado con datos reales: "Comentaron" coincide reel a reel con "Personas" de /contactos (18 reels).
  - Primera foto real (todo el periodo): 104 personas → **les llegó el DM 48 (46 %)** · **DM rechazado 55 (53 %)** · pidieron el recurso 15 · siguen 15 · clic 11 · escribieron 3 · cualificados 0.
  - [x] Corregido (sin desplegar): el % de "Escribieron" se calculaba sobre "Clic" y salía 200 %; ahora sobre "Les llegó el DM". 297 pruebas.
  - Límites: pidieron/siguen/clic/escribieron son de la persona, no del reel; "Cualificados" ≈ 0 con el setter en prueba; llamadas = Fase 5.
- Hallazgo (2026-10-17): al desplegar, el servidor dio **502 durante ~30-45 s** (404 → 502 ×3 → 401). Los avisos de Meta en ese rato podrían perderse; **no verificado** si Meta los reintenta. `render.yaml` ya tiene `healthCheckPath: /healthz`.
- [x] 2. Historial de la ficha (2026-10-17): tabla `lead_history` (una fila solo si la ficha cambia; al arrancar se copia una vez la ficha actual de quien no tenga historial). En cada conversación: "Historial de la ficha". En /metricas: bloque "Setter IA" (conversaciones por etapa actual + cambios de etapa de → a). 304 pruebas (incl. Postgres real partiendo de una base "antigua").
  - Desplegado 661be72 y comprobado con datos reales: copia inicial de la ficha de @josegomezlife con su fecha original (2026-10-16 18:29); etapas: seguir_calificando 1; cambios: 0 (normal en modo prueba). % de "Escribieron" corregido en producción. El 502 al desplegar no se pudo medir esta vez.
- [ ] 3. Análisis masivo (botón manual). **Qué quiere Jose (2026-10-17):** solo la parte de **cualificación** (lo que habla el setter después del recurso, no el flujo) → ideas de reels, lenguaje literal del mercado, dolores y **qué tipo de tráfico atrae cada reel**; gasto mínimo.
  - Precios oficiales (tabla del SDK, 2026-10-06): Sonnet 5.5 $2/$10 por millón (entrada/salida); Haiku 5.5 $0,10/$0,50; Batch API al 50 %. Estimación sin medir: ~0,08 $ por 100 conversaciones con Sonnet en Batch.
  - Propuesta: "tipo de tráfico por reel" = suma de las fichas (sin IA, gratis); la IA solo para dolores, lenguaje e ideas de reels.
  - **Bloqueo:** con el setter en modo prueba no hay conversaciones de cualificación reales → no se puede probar con datos reales hasta que el setter sea público (y eso espera a que Jose pula el marketing).
- [x] 4. Pendientes técnicos (Jose: los 7, en este orden). Todo desplegado (`main` = 98933c5).
  - [x] 4.1 DMs sin respuesta tras un reinicio: al arrancar se contestan las conversaciones de la última hora que esperan respuesta; al apagarse (SIGTERM) se contesta ya lo que esperaba los 8 s.
  - [x] 4.2 BORRAR por DM (Jose: todo lo de esa persona, también el texto en los registros técnicos; confirmación "Listo, he borrado tus datos de nuestro sistema 🙏 Si vuelves a escribir o comentar, empezaremos de cero."). Solo la palabra BORRAR. Segundo barrido al minuto (rastro del eco de la confirmación). Lo que queda del borrado en el registro no lleva su id.
  - [x] 4.3 Al reanudar la IA se contesta lo pendiente. Los "sí"/rescates que contesta el flujo quedan marcados y el setter no los responde.
  - [x] 4.4 `listConversations` ordena y limita en SQL.
  - [x] 4.5 Comentarios perdidos al desplegar (502): 2 min tras arrancar se piden a Instagram los comentarios de los 25 últimos reels (doc oficial: `/<media>/comments`, más nuevos primero, máx. 50) y los de los 15 min anteriores al arranque que no tenemos pasan por el camino normal (flujo, plan B, una vez por persona y reel). Repetir es seguro (clave única del DM). Resumen en /eventos ("recuperacion").
  - [x] 4.2 verificado con datos reales (Jose, 00:54 UTC): evento de borrado sin id, ningún rastro del id en acciones/eventos/conversaciones/contactos, segundo barrido OK. Falta que Jose confirme que le llegó el DM de confirmación.
  - [x] Rescate de una vez (Jose: "con lista y botón", desplegado ca44aaf): /conversaciones lista a quien tuvo el DM rechazado (7 días), escribió en las últimas 24 h y no recibió nada; el botón le manda el primer mensaje del flujo (una vez). Lista real 2026-10-17 01:24 UTC: @helmuth_hg y @zymmer12. **Jose: "púlsalo tú" → pulsado 01:28 UTC: 2 de 2 aceptados por Meta** (send_message OK + eco). Primer rescate real completado; falta ver si responden y siguen el flujo.
  - Jose pidió (2026-10-17) "si falla el DM, comentario público + que el flujo se active solo cuando escriba": **ya estaba hecho** (plan B + rescate por DM, B arriba); plan B 4/4 publicados; rescate aún sin caso real.
  - [x] 4.5 verificado en producción (01:02:42 UTC): "0 recuperados; reels revisados 25, con error 0" (las 25 consultas a Instagram funcionan; no había comentarios perdidos). Sin caso real de recuperación aún.
  - [x] 4.6 Aprobar borradores (Jose: enviar o descartar, editar en la Fase 6): tarjeta "Borrador pendiente" en la conversación con "Enviar tal cual" / "Descartar". Solo los retenidos en modo borrador (no los retenidos por seguridad). Pasadas 24 h desde su último mensaje no se envía (regla de Meta). 339 pruebas. Sin probar con datos reales (necesita modo borrador + un DM de prueba).
  - [x] 4.7 Neon (2026-10-17 ~01:15 UTC, leído en su consola con Jose): plan Free (100 CU-h/mes; al acabarse **para la BD hasta el siguiente periodo**), cómputo 0,25↔2 CU, **2,67 CU-h en ~13,7 h** (≈4,7 CU-h/día ≈ 140-146/mes → se acabaría hacia el día 21 del periodo), almacenamiento 34 MB. Opciones vistas en su Billing: ampliación 10 $/mes (250 h) o Launch 0,106 $/CU-h (~15 $/mes). **Decisión de Jose: seguir gratis y vigilar.** Regla: revisar el consumo al empezar cada sesión y avisar si la proyección pasa de 100 h antes de fin de periodo (fecha de reinicio sin verificar).
  - 328 pruebas. Sin probar con datos reales: BORRAR (necesita que Jose lo pruebe) y el reinicio con un DM a medias.

Lista original (referencia):
- **Ficha por lead** (extraída por IA de cada conversación): ~~tiene negocio, tipo/nicho, facturación aproximada, problema principal,~~ objeciones, interés, etapa, resumen, reel de origen. (Sustituida por la ficha actual, decisión 2026-10-17.)
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

### Fase 5 — Ofrecer llamadas 🔄 (empezada 2026-10-17)

- Enlace de agenda solo a cualificados, medido (ofrecidas → reservadas).

**Decisiones de Jose (2026-10-17):** agenda en **GoHighLevel** (u otra CRM); **enlace con seguimiento** (más adelante con su dominio: basta cambiar `PUBLIC_BASE_URL`); "solo a cualificados" **lo decide la IA** (se mide y, si hace falta, se endurece).

Plan (orden aprobado):
- [x] 5.1 + 5.2 hechos (2026-10-17, 351 pruebas): tabla `short_links`; el setter cambia el enlace de agenda por `…/l/<7 caracteres>` al enviar cada mensajito (si falla, sale el normal); `/l/<código>` registra el clic, etiqueta "agenda" y redirige con `utm_content=<código>`; /metricas → bloque "Agenda (Fase 5)": ofrecida → clic. BORRAR también borra los enlaces cortos de esa persona. Sin probar con datos reales.
- [x] 5.1 Enlace **corto** a la agenda con seguimiento (`…/l/<7 caracteres>`; el firmado de los botones mide >200 caracteres y en texto queda mal): se pone en lugar del enlace de agenda en los mensajes de la IA (después de los filtros); clic → registro + etiqueta "agenda" + redirección a la agenda con `utm_content=<código>`.
- [x] 5.2 /metricas: agenda **ofrecida** a N personas → **clic** de M.
- [ ] 5.3 Reservas desde GHL (con Jose): workflow "cita reservada → webhook" a nuestro servidor y cruce por el código. Sin verificar que GHL guarde el `utm_content`.
- Sin datos reales hasta que el setter sea público (se prueba con la cuenta de prueba).

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

- [ ] (Idea de Jose 2026-10-17, FUERA del plan, no mezclar) Mandar audios con un clon de su voz (ElevenLabs u otro) en la fase de cualificación.

- [ ] (2026-10-17, Jose: "apuntar y seguir") 3 personas reales escribieron por DM y no recibieron respuesta (setter en modo prueba): @mg_grela ("si" ×3), @helmuth_hg ("No he recibido nasa", sin DM del flujo en su hilo), @zymmer12 ("El Instagram me.pidio un montos de cuidado con tu cuenta" → **posible aviso de spam de Instagram**, sin verificar).

- [ ] Fase 2: ¿respuestas públicas de una lista fija o generadas con IA? (de momento lista fija)
- [x] Fase 3: modelo de Claude (Haiku 5.5), arranque en modo prueba, sin aviso proactivo de IA. Resuelto 2026-10-16.
- [ ] Fase 3: si Jose vive u opera desde la UE, revisar si le aplica la Ley de IA europea (art. 50). **No verificado.**
- [ ] Antes de abrir el setter al público: base de datos definitiva (Neon de pago o Render Postgres) y revisar el consumo de Neon (R6).
- [ ] `/data-deletion` promete borrar datos si escriben "BORRAR": hoy es **manual**. Automatizar (Fase 4).
- [x] Prueba automática de `store.ts` contra una base de datos real (PGlite, `tests/store.integration.test.ts`). Hecho 2026-10-16.
- [ ] Setter (marketing, lo pule Jose): objeción "lo quiero todo por escrito"; no contestar fuera de tema; erratas.
- [ ] Setter: caché de 1 h para respuestas lentas (hoy 5 min; diferencia de céntimos con poco volumen).
- [ ] `listConversations` (store.ts) lee todos los mensajes y corta después: irá lenta con miles. Pasar el límite a la consulta SQL.
- [ ] Panel: aprobar y enviar un borrador retenido (hoy el modo borrador solo deja leer lo que diría la IA). Fuera del paso 4; ¿Fase 4/6?
- [ ] Panel: al reanudar la IA no contesta al mensaje que quedó pendiente; espera al siguiente mensaje de la persona.
- [ ] Setter: la espera de 8 s vive en memoria. Si el servidor se reinicia en esos segundos, el DM queda guardado pero sin respuesta. Arreglo propuesto (paso 5): al arrancar, responder a las conversaciones cuyo último mensaje sea de la persona y reciente.

## Registro de cambios

- 2026-10-16 — Plan creado. Fase 0 terminada.
- 2026-10-16 — Fase 1: código subido (48c4377), app de Meta publicada y conectada, prueba punta a punta OK.
- 2026-10-16 — Plan reorganizado: el setter IA es el corazón; nueva Fase 6 final = constructor visual de flujos. Empieza la Fase 2.
- 2026-10-16 — Plan ampliado (Jose): Fase 4 = análisis masivo de conversaciones (objeciones, mercado, ángulos de contenido) + medición 100 %; Fase 6 = software de gestión completo. Origen por reel implementado.
- 2026-10-16 — Réplica de ManyChat en producción (opción B: una vez por persona y por reel). Jose autoriza desconectar ManyChat en la Fase 3.
- 2026-10-16 — Fase 3 en producción (modo prueba): setter IA con Haiku, panel `/setter` + `/conversaciones` + simulador. ManyChat desconectado. Prueba real con @josegomezlife OK; 4 vueltas de 18 escenarios simulados. Documento del setter v4 (= v2).
- 2026-10-17 — Decisión de Jose: terminar el programa (Fases 4-6) antes de pulir el marketing del setter. Siguiente: Fase 4.
- 2026-10-17 — Fase 4 repasada con Jose: embudo primero, ficha actual, análisis con botón manual. Rama `fase4-wip`.
