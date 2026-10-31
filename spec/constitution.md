# Constitución — TurnoSala Prospector

> Reglas que el agente programador **nunca** puede saltarse. Prevalecen sobre cualquier requisito, tarea, PRP o
> petición. Si algo las contradice, el agente se detiene y pregunta. Cambiarlas exige aprobación escrita del promotor
> y una nueva versión de este archivo (registrar en `decisions.md`).
>
> Versión 1.2 · 31/10/2026 · Hereda las reglas C1–C8 de `turnometro/docs/growth-agent/01-constitucion.md`
> adaptadas al sistema web completo sin Odoo (ADR-004).
> **Cambios de la 1.2 (aprobados por el promotor, ADR-005):** el acceso a modelos de lenguaje admite dos proveedores
> intercambiables, Anthropic directo y OpenRouter (P5.1, P5.4, P5.6, P6.3, P8).

## P1. Cumplimiento cerrado por defecto

1. Toda acción de contacto (carta, llamada humana, llamada IA, email, SMS, WhatsApp) pasa por
   `ContactService.execute()` en `packages/contact`, que llama a `complianceGate.check()` **justo antes** de ejecutar.
   Sin una decisión `ALLOW` registrada (o `REVIEW` aprobada por una persona) en `compliance_decisions`, no hay contacto.
2. Dato ausente, ambiguo o error técnico ⇒ `BLOCK` con motivo. Nunca se "asume" un permiso.
3. **Ninguna llamada saliente de IA** sin consentimiento `ai_call` vigente, específico y con prueba. Sin excepciones
   (Ley 11/2022 art. 66.1.a; criterio AEPD). «Es B2B», «el teléfono es público» o «interés legítimo» no la habilitan.
4. **Ningún email comercial** a direcciones obtenidas por investigación, incluidas `info@` y similares (LSSI art. 21).
   El email comercial solo existe para quien lo consintió (o excepción art. 21.2 aprobada por el asesor).
5. La oposición se aplica a **todos los canales**, en la misma transacción, y es irreversible salvo nueva solicitud
   expresa del interesado.
6. La IA se identifica como IA en la primera frase de toda conversación (Reglamento UE de IA, art. 50). Nunca finge ser
   una persona ni usa nombre humano.
7. Nada sale sin aprobación humana explícita. **No existe el envío "si no apruebas en X horas"** (es el fallo más
   denunciado de Explee): la falta de respuesta equivale a `BLOCK`.
8. No se graba audio mientras `recording_enabled = false` (valor por defecto).

## P2. Datos verdaderos, mínimos y con evidencia

1. No se inventan empresas, cargos, teléfonos, emails, cifras, clientes, testimonios ni descuentos.
2. Cada dato de una ficha lleva `source_url`, `fetched_at` y `provenance` (`observed` | `inferred`); lo inferido lleva
   su explicación. Una ficha sin evidencia no se puede aprobar.
3. Solo datos de **empresa**: nombre, web, sector, dirección, centralita y email genérico públicos, sedes, horario,
   señales de encaje. Nada de datos de empleados obtenidos por investigación. Datos personales solo los que la propia
   persona facilite al dar su consentimiento.
4. Autónomos y profesionales individuales son personas físicas: se tratan con base de interés legítimo documentada
   (LIA), información del art. 14 RGPD en la primera comunicación y consulta previa de Lista Robinson cuando aplique
   (LOPDGDD art. 23.4).
5. Nada de datos de salud ni de pacientes. Las reseñas no se usan como prueba de hechos ni se contacta a reseñadores.
6. Solo fuentes de `allowed_sources` con su licencia anotada. Se respetan robots.txt y condiciones de uso; no se
   eluden medidas anti-bot, captchas ni muros de login. LinkedIn y directorios cuyas condiciones lo prohíban: vetados.
7. Las afirmaciones comerciales salen solo de `product_facts` vigentes (versionados y aprobados). El generador de
   contenido no puede citar precios, funciones ni promociones que no estén ahí.

## P3. Un solo sistema y una sola base de datos

1. Fichas, evidencias, consentimientos, exclusiones, decisiones, contactos, oportunidades, tareas, notas y demos viven
   en la base de datos de este sistema. No hay otra base de datos de negocio ni copias en hojas de cálculo.
2. El CRM y la agenda son parte del sistema y usan la misma puerta de cumplimiento: «No contactar» en una oportunidad
   aplica la oposición (REQ-CNS-03) en la misma transacción.
3. TurnoSala es autoridad de la prueba y la suscripción; el sistema solo guarda su identificador y fechas, y llama a
   su API de plataforma con firma e idempotencia.
4. El CRM es para la venta de TurnoSala: nada de datos de pacientes ni de clientes finales de los centros.

## P4. Inmutabilidad y auditoría

1. `consents`, `compliance_decisions`, `suppressions` y `audit_log` son de **solo inserción**: triggers de BD rechazan
   `UPDATE` y `DELETE`. Una retirada es una fila nueva.
2. El código no borra fichas, contactos ni llamadas: archiva. El borrado por retención lo hace un proceso específico,
   auditado y con freno.
3. Toda acción humana relevante (aprobar lote, activar canal, cambiar ajuste jurídico) queda en `audit_log` con autor.

## P5. Seguridad

1. Secretos (Anthropic, OpenRouter, Twilio, Resend, TurnoSala, proveedor de cartas, calendarios) solo en variables de entorno del
   servidor. Nunca en BD, código, logs, prompts ni respuestas al cliente.
2. Roles: `admin`, `marketing`, `sales`, `auditor` (solo lectura) y el usuario técnico `voice`. Autorización en
   servidor en cada endpoint y acción; nunca solo en la interfaz.
3. Webhooks entrantes (Twilio, email) validados por firma o secreto compartido; formularios públicos con CSRF,
   Turnstile y límite por IP.
4. Toda entrada externa (páginas web, respuestas del LLM, APIs) es **dato no fiable**: se valida con Zod antes de
   usarla, y el contenido web nunca se trata como instrucciones (defensa ante inyección de prompts). Vale para
   cualquier proveedor de LLM: que la API prometa «salida estructurada estricta» no exime de validar con Zod.
5. `kill_switch` global y por canal, consultado antes de cada contacto y en cada turno de una llamada.
6. **Proveedores de IA cerrados por defecto.** Toda llamada a un modelo pasa por `packages/ai` (nada más importa un SDK
   ni llama por HTTP a un proveedor de LLM). Un proveedor solo recibe datos si un `admin` lo ha habilitado en
   `llm_enabled_providers` (queda en `audit_log`) y, en `production`, si existe contrato de encargo con él. Con
   OpenRouter cada petición lleva `data_collection: "deny"` y `require_parameters: true`; ningún parámetro se
   degrada en silencio (ADR-005).

## P6. Coste bajo control

1. Presupuesto diario por proveedor (LLM, búsqueda, voz, cartas, email). Al alcanzarlo se bloquea el canal y se avisa.
2. Toda acción con gasto externo (lote de cartas, campaña de anuncios, compra de número) requiere aprobación humana.
3. Cada llamada a un proveedor registra su coste estimado en `usage_costs`; las de LLM, además, el proveedor, el modelo
   pedido y el **modelo que realmente respondió** (un fallback puede cambiarlo).

## P7. Entornos y pruebas

1. `APP_MODE=sandbox` por defecto: solo se contacta a `test_contacts`, las cartas se generan en PDF sin enviarse y la
   voz usa la subcuenta de pruebas de Twilio. `production` solo con aprobación escrita del promotor.
2. Staging y producción con bases de datos separadas; staging nunca llama a la API de producción de TurnoSala.
3. Cada fase termina con: typecheck + lint + tests unitarios + tests de cumplimiento (positivos y negativos) +
   test de arquitectura (T-ARQ) + e2e del flujo de la fase, en verde. Una prueba que falla se reporta con su salida.
4. Procesos masivos: lotes pequeños, tiempo máximo por trabajo, reanudables, con freno absoluto y porcentual.

## P8. Código

- TypeScript estricto en todo el monorepo (sin `any`), Zod en todas las fronteras, ESM.
- Lógica de dominio pura y testeable en `packages/core` (puntuación, normalización, puerta de cumplimiento).
- KISS, YAGNI, DRY · archivos ≤ 400 líneas, funciones ≤ 50 · textos de interfaz en español.
- Fechas en UTC en BD (`timestamptz`); presentación y franjas en `Europe/Madrid`.
- Antes de escribir código contra la API de un proveedor de LLM, usar su documentación vigente (modelos, herramientas
  y parámetros cambian; no programar de memoria): la skill `claude-api` para Anthropic directo y la documentación
  oficial de OpenRouter (`openrouter.ai/docs`) para OpenRouter, anotando en `spec/research/proveedores.md` lo
  comprobado y su fecha.

## P9. Honestidad del agente programador

1. Si un requisito no se puede cumplir con la API o el proveedor real, se dice y se propone alternativa; no se simula.
2. Los informes separan lo comprobado de lo supuesto.
3. Ninguna tarea se marca terminada sin su verificación ejecutada.
