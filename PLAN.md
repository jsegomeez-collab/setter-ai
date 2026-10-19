# Plan — Setter IA para Instagram

> Última actualización: 2026-10-19 · **Fase 6 terminada; planificada la Fase 7** (diseño, documentos del setter, flujos tipo ManyChat, varias cuentas). Envíos bloqueados por Meta hasta el 19-11.
> Estado general: **Fases 2 y 3 en producción.** Flujos de comentarios atendiendo a seguidores reales; setter IA en modo **PRUEBA** (solo @josegomezlife). ManyChat desconectado.
> Fase 4 hecha salvo el paso 3 (análisis, espera conversaciones reales). Fase 5: botón de agenda e inicio del setter (5.4) **probados en real el 2026-10-17** (flujo → inicio → conversación → botón → clic medido). Setter **NO público** (Jose: "no está bien entrenado"); el tono se pulirá desde el frontend.
> **En curso: Fase 6 (frontend), rama `fase6`.** Producción = `main` (Render despliega solo al hacer push a `main`).

## Objetivo

Un sistema propio (tipo ManyChat + setter con IA), en internet 24/7, para la cuenta de Jose y, desde la Fase 7.5, también para su socio y futuros clientes (cada uno en su espacio):

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
| 2026-10-17 | Setter con **Haiku 5.5 + reglas de conversación en código** (`src/setter/rules.ts`); Sonnet se probó (≈12× más caro, mejor conversación) y Jose eligió Haiku. Setter **no público** hasta estar bien entrenado; el tono y las reglas se ajustarán desde el frontend (Fase 6). |
| 2026-10-19 | **Ya no es solo para la cuenta de Jose:** la app tendrá "espacios" separados (cada uno con su Instagram) para su socio y, en el futuro, para venderla. Detalle en la Fase 7.5. |
| 2026-10-19 | Fase 7: estilo oscuro + dorado rehecho a fondo; documentos del setter separados (lista base + propios); flujos con todo lo que permite Meta (sin moderar comentarios por ahora). |
| 2026-10-17 (tarde) | **Cambio de Jose:** la IA también escribe primero a quien **pulsó el botón del flujo** (dentro de las 24 h que abre esa pulsación), con un inicio cercano; habla con **todos los que respondan**; las 5 preguntas eran solo orientación (mejorarlas y preguntar de forma cercana); **pasar a gente real ya** (aviso dado: restricción de Meta hace <1 h). La agenda va en **botón**, nunca en texto. |

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
- ~~Enlace corto en texto~~ (cd2acf5) → Meta rechazó el mensaje (2534122). **Jose (2026-10-17): la agenda va en un BOTÓN** ("camufla el enlace y da mejor reputación con Meta"). Hecho: si un mensajito de la IA lleva la agenda, sale sin el enlace en el texto + botón "Agendar llamada" (seguimiento de siempre: clic + etiqueta "agenda"); /metricas: ofrecida = botón enviado bien → clic. Enlace corto quitado (tabla `short_links` borrada). 347 pruebas. Sin `utm_content` (GHL fuera del plan).
- [x] 5.1 Enlace **corto** a la agenda con seguimiento (`…/l/<7 caracteres>`; el firmado de los botones mide >200 caracteres y en texto queda mal): se pone en lugar del enlace de agenda en los mensajes de la IA (después de los filtros); clic → registro + etiqueta "agenda" + redirección a la agenda con `utm_content=<código>`.
- [x] 5.2 /metricas: agenda **ofrecida** a N personas → **clic** de M.
- ~~5.3 Reservas desde GHL~~ → **fuera del plan** (Jose 2026-10-17: lo hará él más adelante en su frontend; el `utm_content=<código>` ya va en el enlace).
- ⚠️ **2026-10-17 01:41 UTC — Meta rechazó el mensaje de la IA con el enlace corto:** 508/**2534122** "Link can't be shared — You can't share links at this time because your activity may not follow our Community Standards. Please refer to the Account Status page". Los botones con enlace sí salían a las 01:28. Hipótesis sin verificar: H1 Meta bloquea enlaces de texto a onrender.com (culpa del enlace corto de hoy) · H2 limitación temporal de la cuenta para compartir enlaces. Pendiente: Jose mira "Estado de la cuenta" + prueba con el enlace normal (con su permiso).
- [x] 5.4a código (205d52c) · [x] 5.4b Jose aprobó la v5 y los 5 textos de inicio · [x] 5.4c-1 (2026-10-17 ~02:10 UTC): **documento v5 cargado (versión #5)** y flujo "Réplica ManyChat": grupo → `espera_setter` (**60 s, PRUEBA**) → `inicio_setter` (5 textos); resto del flujo comprobado sin cambios. Setter aún en **modo prueba**.
  - ⏸️ **2026-10-17 ~02:24 UTC — Jose: "déjalo en borrador… hay que pulir muchas cosas aún, no está listo".** Hecho: **quitados del flujo `espera_setter` e `inicio_setter`** (el flujo vuelve a terminar en "grupo"; resto comprobado sin cambios). Setter sigue en **modo prueba**. El código del paso `setter_opener` se queda (no lo usa ningún flujo). La v5 del documento sigue cargada (solo la ve @josegomezlife en modo prueba).
  - Prueba de Jose 02:10-02:13: el inicio NO salió porque su cuenta ya había hablado con el setter (<24 h) → era la regla, pero no dejaba registro (arreglado, dcdff50).
  - **Pulido 2026-10-17 (mañana):** simulador con grupo "Inicio" (6 escenarios, coste real setter+lead). v5 → fallos (se presentaba solo, largo, repetía, vendía pronto, membresía en texto). Arreglado en código (20037e3: marco técnico, membresía en botón, `tipo_lead` + etiqueta EMPRESA DFY) y **documento v6** (#6, aprobado por Jose; empresas: "lo hacemos por ti", sin ejemplos, misma agenda). 6 simulaciones v6 ≈ 0,022 $ en total: mejor; quedan "vale, no pasa nada", algo de eco, algún mensaje largo y **nivel 2 marcado "descartar"** (investigar).
  - Para retomar: pulir con Jose (textos de inicio, tono v5, botón de agenda sin probar), poner `espera_setter` en **900 s**, probar con @josegomezlife tras BORRAR, y solo entonces Público.
- [x] **Fallo encontrado en la prueba (02:16-02:18) y arreglado (8e322c4, Jose: "arreglar ahora")**: el segundo barrido de BORRAR borraba lo que la persona hacía después (su comentario nuevo) y la recuperación de comentarios le volvió a mandar el flujo (DM + respuesta pública duplicados). Ahora el segundo barrido solo borra el rastro de la confirmación (clave + message_id) y la recuperación se salta los comentarios anteriores al borrado de quien pidió BORRAR (huella = hash del id, 24 h, tabla `deleted_people`). 360 pruebas.
- [ ] **5.4 Setteo proactivo** (decisiones de Jose arriba, tabla de decisiones): (a) paso nuevo del flujo "inicio del setter": 15 min tras el recurso, uno de los textos fijos al azar (aprobados por Jose); no sale si ya habla con el setter, si la IA está parada o si el setter está apagado · (b) textos de inicio + documento nuevo → aprobación de Jose · (c) cargar documento, añadir el paso al flujo, prueba con @josegomezlife, setter a público.
- [x] Petición de Jose (2026-10-17) que originó el 5.4: aprovechar la ventana de 24 h para empezar una conversación de setteo muy cercana con los leads que respondan y parezcan interesantes (a qué se dedica, su situación, negocio, para qué usa la IA, objetivos). Toca decisiones previas (solo con quien responde; público tras pulir marketing).
- Sin datos reales hasta que el setter sea público (se prueba con la cuenta de prueba).
- [x] **Pulido y prueba real (2026-10-17, tarde)** — `main` = e8f60cd, 399 pruebas:
  - Simulador: el lead siempre con Haiku (`LEAD_MODEL`) y coste según el modelo del setter. Prueba con Sonnet (variable `SETTER_MODEL` en Render, ya quitada): mejor conversación, ≈0,05 $/conversación frente a ≈0,004 $ con Haiku → Jose eligió **Haiku**.
  - Reglas en código (`src/setter/rules.ts` + `guards.ts`, piden otro intento y nunca retienen): membresía solo si no puede invertir o habla de precio (nunca a empresas DFY), agenda una sola vez salvo que la pida, 3 respuestas secas → despedirse, no inventar huecos de la agenda, máx. 3 mensajitos, una pregunta = un tema, muletillas ("vale", "no pasa nada", "no hay problema", "tranquilo/a", "nos vemos"), máx. 1 emoji por respuesta, no empezar igual que los 2 mensajes anteriores. Marco técnico (`prompt.ts`): recurso ≠ programa, "descartar" con reglas claras, hilo de la conversación.
  - **Prueba real con @josegomezlife (15:41-15:50 UTC) OK de punta a punta**: flujo → 1 min → texto de inicio → conversación → botón "Agendar llamada" → clic medido en /metricas.
  - **Estado del flujo `manychat`: el inicio del setter está ACTIVO con 60 s** (`espera_setter` → `inicio_setter`). En modo prueba solo le llega a los usuarios de prueba (resto: solo registro). Antes de pasar a público: ponerlo en 900 s.
  - Pendiente (marketing, desde el frontend): pregunta por ahorros y pasa la agenda en el mismo mensaje; "jaja vale" a mitad de frase; usa "vos" si el lead escribe así; los 2 últimos arreglos (una pregunta = un tema, hilo) sin simular.

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

**Decisiones de Jose (2026-10-17):**
- **React** (Vite + TypeScript + Tailwind) en el **mismo servicio de Render** (0 € extra, un solo despliegue). El panel actual sigue funcionando hasta que cada parte esté sustituida.
- **Usuarios: admin y equipo.** Admin = todo (setter, flujos, configuración, usuarios). Equipo = ver y responder conversaciones, ver contactos y métricas; no cambia el setter ni los flujos.
- **Marco técnico del setter editable solo por el admin**, con historial y "volver al original". Las reglas automáticas (`rules.ts`, `guards.ts`) se quedan en código como red de seguridad.
- **Diseño:** estilo de la referencia de Jose (panel Better Angles): tema oscuro, acento dorado, Gabarito + Inter, menú lateral + panel redondeado, tarjetas finas. Se copia el estilo, no la marca.
- Primero una **pasada de punta a punta con datos reales** (6.0 + 6.1); hasta que Jose la vea y la apruebe, no se construye lo siguiente.

Plan (en orden, cada paso probado, desplegado y enseñado a Jose):
- [x] **6.0 Base** (rama `fase6`): app React en `web/` (Vite 8 + React 19 + Tailwind 4 + React Router 8 + iconos Lucide) servida en `/app` por `src/web.ts`; API JSON en `/api` (`src/routes-api.ts`); usuarios y sesiones en `src/users.ts` (tablas `app_users`, `app_sessions`); contraseñas con scrypt y límite de 5 intentos/15 min (`src/auth.ts`); cookie HttpOnly + Secure + SameSite=Lax y solo peticiones desde la propia web. Alta del primer admin con la clave actual del panel (ADMIN_PASSWORD), solo mientras no hay usuarios. Menú por rol (equipo: Inicio, Conversaciones, Contactos, Métricas). Secciones pendientes enlazan al panel actual. Probado en local (alta, inicio, móvil, login malo/bueno, logout). 421 pruebas. `npm run build` compila servidor + web.
  - Sin probar: un usuario del equipo en la web (se podrán crear en 6.7) y la web en producción hasta desplegar.
- [x] **6.1 Setter IA** (2026-10-19): pestañas Modo · Documento · Marco técnico · Inicio · Simulador en `/app/setter` (solo admin). API `/api/setter` (`src/routes-api-setter.ts` + lógica en `src/setter/admin.ts`). **Marco técnico editable**: plantilla `DEFAULT_FRAME` en `prompt.ts` con huecos `[LINK AGENDA]`, `[LINK MEMBRESÍA]`, `[CORREO]`; versiones en `knowledge_versions` con columna `kind` ('document' | 'frame'); versión vacía = original; el setter real, el simulador y el panel antiguo usan el guardado. Textos de inicio y espera se editan sobre el flujo (validados con `flowSchema`). 434 pruebas. Probado en local con IA falsa: guardar/restaurar documento, marco propio + volver al original, espera 15 min, simulación, móvil.
  - Sin probar: en producción con la cuenta de Jose, y una simulación con Claude de verdad desde la web nueva (cuesta céntimos; misma lógica que el panel antiguo).
  - El panel antiguo sigue con su propia copia de la lógica del documento y del modo: se borrará cuando la web nueva lo sustituya todo.
- [x] **6.2 Conversaciones** (2026-10-19): `/app/conversaciones` con dos paneles (bandeja + conversación con la ficha; en el móvil, una u otra y la ficha plegable). Bandeja con búsqueda y filtros (sin responder, borrador, IA parada, por etapa); hilo tipo Instagram con origen de cada mensaje (flujo, IA, a mano) y su estado; parar/reanudar la IA; aprobar/descartar borradores; **responder a mano** (`SetterService.sendManual`, guardado como "a mano", ventana de 24 h). Admin y equipo; el bloqueo de envíos solo admin. **Bloqueo largo de envíos** (`SETTINGS.sendsBlockedUntil`): el emisor lo respeta igual que la pausa del 368 y la web lo enseña arriba. API `src/routes-api-conversations.ts`, lógica `src/inbox.ts`. 446 pruebas. Probado en local (bandeja, filtros, parar/reanudar, móvil).
  - Sin probar en real: responder a mano y aprobar borradores (bloqueo de Meta de 30 días).
  - `store.ts` va por 787 líneas (máximo 800): partirlo la próxima vez que haya que tocarlo.
- [x] **6.3 Contactos** (2026-10-19): `/app/contactos` con pestañas Personas (búsqueda y filtros por etiqueta, reel de origen y etapa) y Por reel (comentarios, personas y etiquetas con el título del reel). Ficha de cada persona `/app/contactos/:id`: etiquetas a mano (añadir/quitar), reels de origen y último, comentarios, ficha de la IA e historial, enlace a su conversación. **Exportar CSV** (solo admin; protegido contra fórmulas de Excel) y **borrar sus datos** (solo admin, escribiendo BORRAR; igual que el BORRAR por DM). API `src/routes-api-contacts.ts`, lógica `src/contacts.ts`. `store.ts` partido: contactos y comentarios en `src/store-contacts.ts` (708 + 108 líneas). 457 pruebas. Probado en local.
- [x] **6.4 Métricas** (2026-10-19): `/app/metricas` con filtro de periodo (todo / 30 / 7 días), 5 tarjetas (comentaron, DM, escribieron, cualificados, clic en la agenda), embudo en barras con % sobre el paso anterior (y los rechazados aparte, en la misma escala), líneas por día (comentaron y DM entregado; días sin comentarios = 0; tooltip al pasar el ratón), tabla por reel, etapas del setter con sus cambios y agenda. Cada gráfico tiene "Ver tabla". Gráficos en SVG propio (sin librerías); colores validados con la skill dataviz (#b98c2c y #3987e5 sobre fondo oscuro). API `src/routes-api-metrics.ts`; `fillDays` en `src/funnel.ts`. 461 pruebas. Probado en local con datos de ejemplo (escritorio y móvil). **Arreglo**: 8 de 31 reels salían sin título (solo se pedían los últimos 50 a Instagram); ahora los que falten se piden por su id y se recuerdan (`src/media-catalog.ts`, `getMedia` en el cliente), en Métricas y Contactos.
- [ ] **6.5 Constructor visual de flujos** (decisiones de Jose 2026-10-19: lienzo tipo ManyChat con React Flow; activar desde la web con confirmación; extras: vista previa tipo Instagram, crear/duplicar/borrar, probar un comentario):
  - [x] **6.5a API** `src/routes-api-flows.ts` (solo admin): listar (+ reels y bloqueo de envíos), ver, guardar (valida con `flowSchema`; guardar nunca cambia si está activo), crear (nace desactivado), duplicar ("(copia)", desactivada), activar escribiendo ACTIVAR, borrar escribiendo BORRAR (copia en el registro). Campo opcional `layout` (posición de cada caja) en `flowSchema`.
  - [x] **6.5b Lienzo** `/app/flujos` y `/app/flujos/:id` (`web/src/flows/`): React Flow 12.12.0 (MIT) cargado solo al abrir un flujo; cajas por tipo con sus salidas; arrastrar flechas o elegir el destino en el panel; añadir/quitar pasos; panel de ajustes del flujo; vista previa tipo Instagram; errores de conexión explicados en español antes de guardar; aviso del bloqueo de Meta. 478 pruebas. Probado en local (editar, guardar, añadir/conectar/quitar, activar/desactivar, duplicar, borrar, crear, móvil).
  - [x] **6.5c Probar un comentario** (sin enviar nada): botón "Probar" en el editor. Con lo que hay en el lienzo (aunque no esté guardado) dice si el comentario haría saltar el flujo y, si no, por qué (reel, modo prueba, palabras clave); avisa si está inactivo o si otro flujo activo más específico se lo quedaría. Después enseña la respuesta pública y el DM y deja recorrer el camino pulsando los botones / eligiendo "sigue o no" (la caja se marca en el lienzo). La regla es la del motor: `explainComment` en `src/flows/engine.ts` (y `commentMatches` la usa). API `POST /api/flows/:id/test`; recorrido en `web/src/flows/simulate.ts`. 485 pruebas.
- [x] **6.6 Inteligencia** (2026-10-19). Jose: "construirla ya y dejarla lista para cuando haya conversaciones; no hace falta analizar ahora". Medido en producción (solo lectura): 262 conversaciones, 33 con texto real de la persona (44 mensajes, 1.924 caracteres), 1 con el setter, 1 ficha → casi nada que analizar hasta que el setter sea público.
  - `/app/inteligencia` (solo admin). **Nuevo análisis** con botón manual: periodo, cuántas conversaciones sirven y coste "como mucho" antes de gastar; confirmar escribiendo ANALIZAR; una a la vez. Sonnet 5.5 (`src/intelligence/analyzer.ts`), una llamada, tope 300.000 caracteres (≈0,26 $). Solo lo que escribe la persona y responde el setter/Jose (fuera el flujo y los "sí").
  - **Nada inventado**: cada hallazgo (objeciones, dolores, lenguaje literal, ideas de reels con gancho, datos de mercado) lleva citas; el servidor comprueba que cada cita aparece tal cual en lo que escribió esa persona y descarta lo demás (y lo dice). Las citas enlazan a su conversación.
  - Análisis guardados (tabla `analysis_runs`, `src/store-analysis.ts`) con coste real medido. **BORRAR también quita a la persona de los análisis.**
  - **Tráfico por reel** sin IA: fichas sumadas por reel de origen (tipo, nivel, ¿invierte?, etapa).
  - 496 pruebas (incl. Postgres real). Probado en local con IA falsa. **Sin probar con Claude de verdad** (Jose: no hace falta ahora).
- [x] **6.7 Configuración** (2026-10-19). Decisiones de Jose: alta con **clave temporal**; del panel antiguo pasan el **registro de eventos** y **suscribir avisos de Meta** (el rescate de comentarios NO: desaparecerá con el panel antiguo); los **límites solo se ven** (se cambian en Render) y la pausa del 368 y el bloqueo se quitan/ponen escribiendo una palabra.
  - [x] **6.7a Usuarios** (`src/routes-api-users.ts`, `/app/configuracion`): dar acceso (correo, nombre, rol) → clave temporal de 16 caracteres que se ve una vez; mientras no la cambie, el servidor le da 403 en todo (`requireUser`) y la web le enseña "pon una tuya"; cambiar rol, nueva clave temporal (cierra sus sesiones), quitar acceso con BORRAR; nunca a uno mismo. "Mi cuenta" (`/app/cuenta`, todos): cambiar la clave (cierra las demás sesiones; 5 fallos = 15 min). Columna `must_change_password` en `app_users`.
  - [x] **6.7b Instagram y envíos** (`src/routes-api-settings.ts`): cuenta conectada, firma de Meta, seguimiento de clics, clave de Anthropic, flujos activos; token (origen, renovado, caduca en N días, último error, "Renovar ahora"); bloqueo largo (quitar con QUITAR / poner N días con BLOQUEAR), pausa del 368 (REANUDAR); envíos de la última hora frente a los límites; "Volver a suscribir los avisos de Meta"; **Registro** (200 más recientes, filtro por tipo, datos al pulsar).
  - 506 pruebas. Probado en local (alta → clave temporal → Laura entra, 403 hasta cambiarla, menú de equipo; quitar/poner bloqueo; renovar token sin clave de cifrado; registro con filtro; móvil).
- [ ] Siguiente (fuera de la 6.7, pedir OK a Jose): borrar el panel antiguo y sus rutas (`/eventos`, `/flujos`, `/setter`, `/conversaciones`, `/contactos`, `/metricas`) cuando Jose dé el visto bueno a la web nueva.

### Fase 7 — Plataforma de verdad: diseño, documentos del setter, flujos tipo ManyChat y varias cuentas ⏳ (planificada 2026-10-19)

**Para qué:** que la web se vea y se use como un producto profesional, que la IA entienda mejor el negocio, que los flujos hagan todo lo que permite Meta, y que puedan usarla el socio de Jose y, en el futuro, clientes.

**Lo que pidió Jose (2026-10-19):** "mejorar muchísimo el UI/UX… a full" con la skill `ui-ux-pro-max`; flujos con todo lo que deja hacer la API de Meta (hoy "no se puede meter tags, no hay apenas conditions, no se puede añadir flujos", "la creación es súper rara, igual con toda la plataforma"); conocimientos del setter en documentos separados (cliente ideal, oferta…) en vez de un texto fusionado; que se pueda registrar su socio y poder venderla. "Apuntarlo en el plan y luego implementarlo, no por partes."

**Decisiones de Jose (2026-10-19, no reabrir):**
- Estilo: **oscuro + dorado (referencia Better Angles), rehecho a fondo**. La skill proponía azul oscuro + verde + fuente Fira: descartado. Lo que falla hoy es la ejecución, no la paleta.
- Documentos del setter: **lista base + poder crear más**.
- Socio y venta: **cada uno con su propio Instagram** ("espacios" separados).
- Flujos: entran seguro **etiquetas, condiciones e "ir a otro flujo"**, más **historias y menciones**, **más formas de responder** y **más formas de empezar**. Moderar comentarios (ocultar/borrar): **no por ahora**.
- Saludar a los nuevos seguidores: **no se puede** con la API pública (comprobado 2026-10-19: no hay aviso de "nuevo seguidor" en la [lista oficial de avisos](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields); según fuentes no oficiales lo lanzó Meta en exclusiva con ManyChat el 22-10-2025 para cuentas que elige Meta). Revisar cada cierto tiempo.

**Qué deja hacer Meta (leído en la doc oficial el 2026-10-19; Instagram API con Instagram Login, la nuestra):**
- Avisos que podemos recibir: comentarios, comentarios en directo, menciones (dentro de comentarios), mensajes (incluye respuestas a historias), reacciones, pulsaciones de botones (postbacks), lecturas, enlaces de referencia (`messaging_referral`, p. ej. ig.me), opt-ins, handover/standby. Estadísticas de historias: **no** con nuestro login. ([campos](https://developers.facebook.com/documentation/instagram-platform/webhooks/fields))
- Lo que se puede enviar: texto (≤1000 bytes), imágenes PNG/JPEG ≤8 MB (hasta 10), audio ≤25 MB, vídeo ≤25 MB, PDF ≤25 MB, corazón, reacción con emoji, una publicación propia, responder a un mensaje concreto, plantillas. ([enviar](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/))
- Respuestas rápidas: hasta **13**, título ≤20 caracteres, solo texto, **no salen en ordenador**. ([quick replies](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies.md))
- Carrusel: hasta **10 tarjetas**, título y subtítulo ≤80, foto, hasta 3 botones (enlace o acción); no en ordenador. ([generic template](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/generic-template.md))
- Rompehielos: hasta **4 preguntas** al abrir el chat; llegan como pulsación de botón; no en ordenador. ([ice breakers](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/ice-breakers.md))
- Menú fijo del chat: enlaces o acciones (Meta recomienda ≤5); no se actualiza al momento en chats abiertos. ([persistent menu](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/persistent-menu.md))
- Ficha de la persona: nombre, usuario, foto, nº de seguidores, ¿te sigue?, ¿la sigues?, ¿verificada? — **solo si ya escribió** (o pulsó rompehielos/menú). ([user profile](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile.md))
- Ventana para escribir: 24 h desde su último mensaje (hasta 7 días si viene de un anuncio "Click-to-Direct"; 7 días con la etiqueta de agente humano).
- **Usar la app con cuentas que no son tuyas exige "Advanced Access"** (revisión de Meta). ([user profile](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile.md), [comment moderation](https://developers.facebook.com/documentation/instagram-platform/comment-moderation.md))
- Por verificar al llegar: aviso de "mención en historia" y el parámetro `ref` de los enlaces ig.me.

**Plan (en orden; cada paso probado, desplegado y enseñado a Jose antes del siguiente):**

- [x] **7.1 Sistema de diseño — hecho 2026-10-19** (Jose: "me vale"). `design-system/setter-ia/MASTER.md` (tokens medidos, componentes, estructura, contenido y los 10 fallos vistos en 28 capturas). Capturas fiables con Playwright 1.63.0 propio (`.playwright-mcp/shots.ts`, no usa el Chrome de Jose). Hecho: gris apagado #6c6c72 → #8b8b92 (contraste 3,3 → ≥4,6:1); ninguna letra < 12 px (28 sitios); foco visible, "reducir movimiento", campos 16 px en móvil; componentes `Button`, `PageHeader`/`Page`, `Toast` (notificaciones), `EmptyState`, `Skeleton`, `lib/labels.ts` (nombres legibles); sin título repetido (barra solo en móvil); ficha y modelo con nombres legibles; el bloqueo ya no se repite ni sale la fecha en formato máquina en Conversaciones; **Inicio nuevo** (para hoy: sin responder / borradores / IA parada; embudo 7 días con línea por día; estado del setter y de los flujos para admin; accesos). Pendiente para la 7.4: aplicar los componentes a fondo en cada pantalla (filtros de Conversaciones, tabla de Contactos, etc.).
- Detalle original de la 7.1 (con la skill `ui-ux-pro-max`):
  - Una sola fuente de verdad: colores, tipografía, espacios, bordes, sombras, movimiento (respetando "reducir movimiento").
  - Componentes únicos y reutilizados: botones (principal, secundario, peligro), campos con etiqueta y ayuda, errores junto al campo, desplegables, pestañas, tablas, tarjetas, ventanas, avisos, notificaciones (toasts), estados vacíos con qué hacer, carga con esqueletos.
  - Menú lateral y cabeceras rehechos; accesibilidad (contraste 4.5:1, foco visible, zonas táctiles de 44 px, teclado); probado a 375 / 768 / 1024 / 1440 px.
  - Guardarlo en `design-system/setter-ia/MASTER.md` (**.md nuevo: pedir OK a Jose antes de crearlo**).
- [x] **7.2 Documentos del setter — hecho 2026-10-19** (bfd2e8a, 522 pruebas). Setter IA → pestaña **Documentos**: documento único (el de siempre) + 7 temas base + documentos propios; cada uno con versiones, activar/desactivar, orden (subir/bajar); propios se renombran y se borran con BORRAR. La IA los recibe como "## Título" por secciones (`assembleKnowledge`); una sola función `loadKnowledge` la usan el setter real y los dos simuladores. **Modo**: la IA sigue con el documento único hasta que Jose pulse "Usar documentos separados" (escribiendo CAMBIAR); se puede volver. Código: `src/setter/knowledge-docs.ts`, `knowledge-source.ts`, `store-docs.ts` (tabla `knowledge_docs`; versiones en `knowledge_versions` con tipo `doc:<slug>`), `routes-api-setter-docs.ts`, `web/src/setter/DocsTab.tsx`. Probado con clics reales en local (`.playwright-mcp/docs-check.ts`).
  - **Propuesta de reparto del documento #6 (9.101 caracteres)**, copiado tal cual, comprobado con un programa (20 de 20 líneas, 7.524 = 7.524 caracteres sin espacios): Cliente ideal = "Perfil ideal"; Oferta y precios = "La oferta" + "Niveles" + "Empresas"; Preguntas frecuentes = "FAQS"; Objeciones = "OBJECIONES"; Tono y estilo = "Rol y objetivo" + "Cómo conversar" + "Si empezaste tú"; Lo que nunca debe decir = "REGLAS"; Casos de éxito = vacío (el documento dice "no inventes testimonios"); propio "Cómo cualificar y cuándo agendar" = "Qué quieres descubrir" + "Cuándo proponer la llamada" + "Decisión". **Pendiente de Jose:** revisarlo y pulsar "Usar documentos separados" (antes, probar en el Simulador).
- Detalle original de la 7.2 (en vez de un texto fusionado):
  - Lista base: **Cliente ideal · Oferta y precios · Preguntas frecuentes · Objeciones y respuestas · Tono y estilo · Casos de éxito · Lo que nunca debe decir** + documentos propios con título.
  - Cada uno con su historial, activar/desactivar y orden. La IA los recibe por secciones con su título (el marco técnico sigue aparte).
  - El documento actual se reparte en los nuevos: **propuesta de reparto que Jose revisa antes de activarla**. Comparar antes/después con el simulador.
- [ ] **7.3 Flujos tipo ManyChat** (motor + constructor nuevo):
  - **Cómo empieza:** comentario (todos los reels o reels elegidos, palabras clave) · DM con palabra clave · respuesta a una historia · mención (verificar) · rompehielos · menú fijo · enlace ig.me (verificar `ref`) · desde otro flujo.
  - **Qué envía:** texto · botones (3) · respuestas rápidas (13) · carrusel (10 tarjetas) · imagen / vídeo / audio / PDF · reacción con emoji · respuesta pública al comentario.
  - **Qué hace:** poner / quitar etiqueta · guardar un dato en la ficha (campos propios) · pausar / activar la IA · avisar a Jose · ir a otro flujo · empezar el setter IA · esperar.
  - **Condiciones:** ¿me sigue? · tiene / no tiene etiqueta · dato de la ficha · palabra en su mensaje · ¿verificado? · nº de seguidores · horario · al azar (prueba A/B por %).
  - **Rompehielos y menú fijo** se editan en el constructor y se publican en Meta.
  - **Crear fácil:** plantillas ("Recurso por comentario", "Recurso solo si me sigue", "Palabra clave por DM", "Respuesta a historia"), avisos en vivo de lo que falta, vista previa del chat y "Probar" para cada forma de empezar.
  - El motor sigue respetando las reglas de Meta (24 h, 1 DM por comentario, límites, nunca en frío) y las del incidente del 18-10.
  - **Por partes (2026-10-19), cada una probada y subida antes de la siguiente:**
    - [x] **7.3a Motor — hecho 2026-10-19** (583 pruebas). Formas de empezar: comentario · palabra clave por DM (contiene o exacta) · respuesta a historia · mención en historia · enlace ig.me (`ref`) · "solo desde otro flujo / rompehielos / menú" (botón `S:<flujo>`). Pasos: enviar (mensaje con botones o respuestas rápidas, carrusel, imagen/vídeo/audio/PDF, reacción, inicio del setter) · hacer (etiqueta, dato de la ficha, pausar/activar IA, avisar a Jose, ir a otro flujo, pausa) · condición (¿me sigue?, etiqueta, dato, palabra en su mensaje, verificado, seguidores, horario, A/B). Los pasos de hacer y las condiciones se ejecutan en la cola, en orden (`src/flows/steps.ts`). Campos propios: columna `contacts.fields`. Avisos para Jose: Inicio → "Avisos de tus flujos" (`GET /api/flows/notices`). Comprobado con los 2 flujos reales de producción (copiados en solo lectura): el motor nuevo planifica exactamente lo mismo que el antiguo. Código: `src/flows/nodes.ts`, `types.ts`, `engine.ts`, `steps.ts`, `src/meta/parse.ts`, `src/process.ts`, `src/sender.ts`.
    - [x] **7.3b Constructor nuevo — hecho 2026-10-19.** Botón "Añadir paso" con menú por grupos (Enviar / Hacer / Condición, cada opción con su explicación); editor de cada paso (mensaje con botones o respuestas rápidas, carrusel, archivo, reacción, etiqueta, dato, IA, aviso, ir a otro flujo, esperar, setter, ¿me sigue?, condición con sus 7 tipos y horario con días y zona horaria); "¿Cómo empieza?" con las 6 formas (y el enlace ig.me completo para copiar); avisos en vivo de lo que falta antes de guardar (mismas reglas que el servidor); vista previa tipo Instagram (respuestas rápidas, carrusel, archivo); "Probar" para cada forma de empezar (comentario, DM, historia, mención, ig.me, desde otro flujo); crear desde 6 plantillas. Arreglado de paso un fallo de la 6.5: en los campos "separados por comas" no se podía escribir una palabra con espacio («Grupo WhatsApp»). Los pasos nuevos ya no caen encima de otros. Probado con clics reales (`.playwright-mcp/flows-check.ts`).
    - [x] **7.3c Rompehielos y menú fijo — construido 2026-10-19 (sin publicar).** Flujos → pestaña "Rompehielos y menú": hasta 4 preguntas y 5 opciones de menú (empiezan un flujo o abren una web), vista previa, "Guardar borrador" (no toca Instagram) y "Publicar en Instagram" (escribiendo PUBLICAR; exige que los flujos usados estén activos; una lista vacía se borra en Instagram). Formato de la doc oficial (`/me/messenger_profile`, `platform: instagram`). Suscripción: no hace falta nada nuevo para los botones (en producción ya llegan 12 avisos de botón pulsado con `comments,messages`). **Pendiente de Jose:** decidir cuándo publicarlos (hoy los 2 flujos están desactivados y los envíos bloqueados hasta el 18-11). `ig.me` (`messaging_referral`): se comprueba en la 7.3d.
    - [ ] **7.3d Comprobar en real** la mención en historia y el `ref` de ig.me (necesita a Jose: mencionar @josenews.ai desde @josegomezlife y abrir un enlace ig.me).
  - Formatos confirmados en la doc oficial (2026-10-19): respuesta rápida pulsada = DM con `message.quick_reply.payload`; respuesta a historia = `message.reply_to.story`; mención en historia = adjunto `story_mention`; ig.me = `referral.ref` ([ejemplos de avisos](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples)); enviar imagen (`attachments` tipo image), vídeo/audio/PDF (`attachment` tipo video/audio/file), reacción (`sender_action: react` con cualquier emoji) ([enviar](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/)); perfil: `follower_count`, `is_verified_user`, `is_user_follow_business` solo con consentimiento ([perfil](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile.md)).
  - Decisiones por defecto (Jose puede cambiarlas): "avisar a Jose" = aviso dentro de la app (Inicio), sin correo; "guardar un dato" = valor fijo; el primer paso de un flujo por comentario sigue siendo el DM (texto + botones) y tras él nada se envía solo hasta que la persona responda; condiciones de perfil (verificado, seguidores) cuentan como "no" si Meta no deja saberlo.
  - Idea apuntada (sin hacer): "pregunta y guarda su respuesta en la ficha" (como el User Input de ManyChat).
- [ ] **7.4 Rediseño de todas las pantallas** con el sistema de 7.1 y formas de crear más simples: Inicio (resumen útil de verdad), Conversaciones, Contactos (+ campos propios), Métricas, Setter IA (documentos), Flujos, Inteligencia, Configuración. Revisión final con la lista de comprobación de la skill.
- [ ] **7.5 Varias cuentas ("espacios") — para el socio y para clientes.** Explicado simple:
  - Hoy hay **un espacio** (el de Jose). Después, cada persona o empresa tendrá **su espacio** con su Instagram, flujos, documentos, contactos, conversaciones y equipo. **Nadie ve lo de otro espacio.**
  - **Cómo se conecta un Instagram SIN revisión de Meta (decisión de Jose 2026-10-19: igual para el socio que para clientes; los clientes no tocan nada de Meta):** exactamente como @josenews.ai, que en la app "AI Setter" tiene el rol **"Evaluador de Instagram"** (comprobado en el panel de Meta el 2026-10-19). Pasos: (1) Jose añade el usuario de Instagram del cliente como **Evaluador de Instagram** en la app; (2) el cliente acepta la invitación en Instagram (Perfil → Aplicaciones y sitios web → invitaciones de evaluador); (3) el cliente pulsa **"Conectar Instagram"** en nuestra web (inicio de sesión de Instagram de Meta) y queda conectado. Con rol en la app basta "Standard Access" ([overview](https://developers.facebook.com/docs/instagram-platform/overview/)).
  - Límite: el panel de la app muestra **"0 de 500 evaluadores"**. Meta indica que quien acepta el rol confirma que trabaja para el dueño de la app o tiene un acuerdo con él ([app roles](https://developers.facebook.com/documentation/development/build-and-test/app-roles)) → poner ese acuerdo en los términos con cada cliente. Riesgo (avisado a Jose una vez): todos van en la misma app; si Meta la castiga, afecta a todos.
  - Pasos técnicos: (a) cada dato de la base de datos lleva su espacio; (b) registrarse / invitación crea la cuenta y su espacio; (c) botón "Conectar Instagram" (OAuth de Instagram) y token por espacio, renovado solo; (d) los avisos de Meta (una sola dirección) se reparten al espacio según la cuenta de Instagram que los envía; (e) invitar gente a tu espacio (lo de 6.7a); (f) más adelante: planes, cobro (p. ej. Stripe), límites por plan, términos y privacidad.
  - **✅ PROBADO EN REAL (2026-10-19):** @josegomezlife añadida como Evaluador de Instagram → aceptó la invitación → botón "Probar 'Conectar Instagram'" (inicio de sesión oficial de Instagram, con `force_reauth`) → **"Conectado: @josegomezlife", permisos instagram_business_basic, instagram_business_manage_messages e instagram_business_manage_comments, token de 60 días**. Sin revisión de Meta. El plan B (token desde el panel) no hace falta. Código de la prueba: `src/instagram-connect.ts` (no guarda el token). Dirección de vuelta registrada en la app: `https://setter-ai-vfle.onrender.com/oauth/instagram/callback`. ID de la app de Instagram: 1117985297673013.
  - Falta comprobar en la 7.5: que los avisos de Meta (comentarios y DMs) lleguen también de una segunda cuenta conectada así (suscribir su cuenta con su token) y repartirlos por espacio.
  - **"Proveedor de tecnología" / revisión de Meta: no hace falta ahora** (recomendación 2026-10-19, ver abajo). El botón "Conectar Instagram" es el mismo que pediría la revisión, así que lo deja preparado.
  - Va al final porque cambia toda la base de datos. Mientras tanto, el socio puede entrar como usuario del espacio de Jose (Configuración → Usuarios).
  - Por decidir al llegar: ¿una clave de Anthropic de Jose para todos o cada espacio la suya?; base de datos de pago (Neon gratis no aguanta varios clientes); nombre del producto y precios.

**Proveedor de tecnología ante Meta (pregunta de Jose 2026-10-19):** sirve para que la app atienda a empresas **sin darles un rol** (registro libre, sin límite de 500). Exige verificación del negocio + verificación de acceso + revisión de la app con vídeos de cada permiso ([create an app](https://developers.facebook.com/docs/instagram-platform/create-an-instagram-app/), [business verification](https://developers.facebook.com/docs/development/release/business-verification/), [screen recordings](https://developers.facebook.com/docs/app-review/submission-guide/screen-recordings/)). Meta no publica cuánto tarda (un hilo del foro habla de 60+ días atascado en la verificación; dato no oficial). Es gratis. Recomendación: **hacerlo cuando haya ~decenas de clientes o se quiera registro libre**, no antes; la 7.5 deja todo listo para pedirlo.

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

## ⚠️ Incidente: bloqueo de mensajes de Meta (2026-10-18)

- **Qué pasó:** error 368 el 18-10 a las 17:16 UTC ("bloqueado temporalmente por infringir las políticas"). Instagram lo atribuye a **Prácticas comerciales prohibidas** (fraude/estafas: enriquecimiento rápido, inversiones). Jose pidió revisión el 19-10: **denegada, 30 días** sin enviar mensajes.
- **Datos:** volumen bajo (~300 DMs/día, límite 750/h). Lo que añadíamos: ~720 llamadas rechazadas (2534025 + reintento con texto) y 303 comentarios del plan B "mándame un DM". Disparador del flujo = todos los reels y cualquier comentario; el DM invita al grupo de WhatsApp. Reels con ganchos "Claude puede hacerte $453 al día", "$15K a la semana" (encajan en la norma). Causa exacta **no verificada** (Meta no la da).
- **Hecho (con OK de Jose):** flujo `manychat` **desactivado**; 450 envíos pendientes cancelados; quitado el reintento con texto ante 2534025; el emisor ya no envía acciones canceladas; **plan B público desactivado** (temporal). Textos del plan B para recuperarlos: "No pude enviarte el DM 😕 escríbeme por mensaje y te lo paso" · "Intenté mandártelo por DM pero no me deja 😅 escríbeme y te lo envío" · "Instagram no me deja escribirte 🙈 mándame un DM y te lo paso".
- **Antes de reactivar el flujo (decide Jose):** responder solo en reels elegidos, sacar el grupo de WhatsApp del DM automático, evitar ganchos "$X al día/semana", ritmo más bajo.

## Para retomar en otro ordenador

- Clonar el repo, `npm install`, y comprobar: `npm test`, `npm run typecheck`, `npm run build`. Trabajar en la rama `fase6` (Fase 6); desplegar = fusionar en `main` y hacer push. Ver la web en local: `npm run build` y abrir `/app` del servidor, o `npm run dev:web` con el servidor en marcha.
- **Comprobar un despliegue:** en Render → Events buscar el texto "Deploy live for <sha>" (el "Live" de la cabecera no basta). Al desplegar hay ~30-45 s de 502.
- Los secretos (ADMIN_PASSWORD del panel, tokens) **solo** en Render → Environment. Nunca en el chat ni en el repo.
- Los scripts de Playwright (`.playwright-mcp/`) no están en el repo (ignorados); se rehacen si hacen falta.
- Neon (base de datos, plan gratis 100 h/mes): revisar el consumo al empezar cada sesión.

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
- 2026-10-17 — Setter pulido con reglas en código (Haiku), prueba real del inicio del setter y del botón de agenda OK. Setter sigue en prueba. Siguiente: Fase 6 (frontend).
- 2026-10-19 — Fase 6 terminada (6.0-6.7 en producción, 506 pruebas). Fase 7 planificada con Jose: sistema de diseño, documentos del setter, flujos tipo ManyChat (doc de Meta revisada), varias cuentas.
