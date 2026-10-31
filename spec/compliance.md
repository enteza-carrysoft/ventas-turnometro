# Puerta de cumplimiento — especificación ejecutable

> Fuente de los tests de `packages/core/src/compliance`. Cada regla `CG-xx` tiene al menos un test positivo y uno
> negativo. Cambiar esta tabla requiere aprobación del promotor y, si amplía lo permitido, informe del asesor jurídico.
> Implementa controles operativos; **no sustituye el dictamen jurídico** (decisión abierta D-04).
> Basada en `turnometro/docs/growth-agent/03-cumplimiento.md`, ampliada con carta postal y visita.

## Interfaz

```ts
type Channel = 'postal_letter' | 'visit' | 'human_call' | 'ai_call'
             | 'email_marketing' | 'email_transactional' | 'sms_transactional' | 'whatsapp_transactional';
type Purpose = 'prospecting' | 'demo_followup' | 'demo_confirmation' | 'trial_help';
type Direction = 'outbound' | 'inbound';
type Decision = 'ALLOW' | 'BLOCK' | 'REVIEW';

interface CheckInput {
  prospectId: string; channel: Channel; purpose: Purpose; direction: Direction;
  phone?: string; email?: string;
  postalAddressId?: string;  // = contact_points.id (type 'postal_address'); el cargador resuelve la dirección destino
  demoId?: string;           // obligatorio en demo_confirmation / demo_followup (CG-40, CG-51)
  campaignId?: string; at?: Date; // UTC
}
interface CheckResult {
  decision: Decision; ruleIds: string[]; reasons: string[];
  consentId: string | null; decisionId: string; // fila insertada en compliance_decisions
}

// Pura: no toca BD ni reloj. El contexto lo carga el repositorio.
function evaluate(input: CheckInput, ctx: ComplianceContext): Omit<CheckResult, 'decisionId'>;
// Orquestador: carga contexto, llama a evaluate, inserta la decisión y la devuelve.
async function check(input: CheckInput): Promise<CheckResult>;
```

`ComplianceContext` incluye: ajustes (`kill_switch`, `kill_switch_<canal>`, `app_mode`, franjas, cadencias,
presupuestos), flags jurídicos aprobados (`b2b_human_calls_approved`, `postal_b2b_approved`,
`lssi_customer_exception_approved`), `test_contacts`, exclusiones aplicables, consentimientos del contacto, contactos
previos (para cadencias), `legal_form` de la ficha, consulta Robinson vigente, gasto del día y festivos.

## Orden de evaluación (la primera regla que decide, gana)

| ID | Regla | Resultado |
|---|---|---|
| CG-01 | `kill_switch` global o del canal activo | BLOCK |
| CG-02 | `app_mode = sandbox` y el destino (teléfono, email o dirección) no está en `test_contacts` | BLOCK |
| CG-03 | Teléfono, email, dominio o ficha en `suppressions` (incluye «No contactar» y motivo de pérdida por oposición del CRM) | BLOCK |
| CG-04 | Presupuesto diario del canal agotado | BLOCK |
| CG-05 | Fuera de franja del canal (Europe/Madrid, laborables, festivos nacionales y autonómicos conocidos) | BLOCK |
| CG-06 | Cadencia superada (tabla de cadencias) | BLOCK |
| CG-07 | Falta dato imprescindible del canal (E.164 válido, email válido, dirección normalizada), o `outbound` + `prospecting` sobre una ficha no `approved` (las entrantes y las demos solicitadas no exigen ficha aprobada) | BLOCK |
| CG-08 | Ficha `sole_trader`/`unknown`, canal `postal_letter`/`human_call`, `purpose=prospecting`, sin consulta Robinson vigente (≤ 30 días) | BLOCK |
| CG-10 | `ai_call` + `inbound` | ALLOW (llama el interesado) |
| CG-11 | `ai_call` + `outbound` con consentimiento `ai_call` vigente para ese teléfono y finalidad compatible | ALLOW |
| CG-12 | `ai_call` + `outbound` en cualquier otro caso | **BLOCK — nunca REVIEW** |
| CG-20 | `human_call` con consentimiento `human_call` vigente | ALLOW |
| CG-21 | `human_call` + `prospecting` sin consentimiento, a `switchboard_phone`, con `b2b_human_calls_approved` | REVIEW (una persona aprueba cada lote) |
| CG-22 | `human_call` en cualquier otro caso | BLOCK |
| CG-30 | `email_marketing` con consentimiento `email` vigente | ALLOW |
| CG-31 | `email_marketing` a cliente con relación contractual previa, producto similar y `lssi_customer_exception_approved` | REVIEW |
| CG-32 | `email_marketing` en cualquier otro caso (incluidas `info@` y direcciones encontradas en internet) | BLOCK |
| CG-40 | `*_transactional` + `demo_confirmation` sobre una demo **solicitada por el interesado** (`demoId`) y canal autorizado en el formulario: para `email_transactional`, el email indicado en esa solicitud; para `sms_`/`whatsapp_transactional`, además un consentimiento `sms`/`whatsapp` vigente | ALLOW |
| CG-41 | `*_transactional` para cualquier otra finalidad | BLOCK |
| CG-50 | `postal_letter` + `prospecting` dirigida a la empresa (sin nombre de persona), con `postal_b2b_approved` y plantilla aprobada que incluye identidad, privacidad y baja | REVIEW (aprobación por lote, REQ-OUT-03) |
| CG-51 | `postal_letter` + `demo_followup` a quien solicitó la demo | ALLOW |
| CG-52 | `postal_letter` en cualquier otro caso | BLOCK |
| CG-60 | `visit` + `prospecting` a dirección comercial de ficha `approved` | REVIEW (el comercial confirma la ruta) |
| CG-99 | Ninguna regla aplica | BLOCK |

**Consentimiento vigente**: sin retirada posterior, no caducado (REQ-CNS-04), campaña no cerrada, y el teléfono/email
coincide exactamente (E.164 / minúsculas) con el de la acción.

**Aprobación de REVIEW**: una decisión `REVIEW` solo habilita la acción si existe `review_approvals` del lote, hecha por
un usuario con rol `admin` o `marketing` (carta) / `sales` (llamada, visita), y la decisión tiene < 60 s al ejecutar
(se re-evalúa justo antes; si cambia a `BLOCK`, gana `BLOCK`). `ContactService.execute()` llama siempre a `check()` de
nuevo; un `decisionId` recibido de fuera con > 60 s o de otro contacto/canal se rechaza (T-20).

## Cadencias por defecto (configurables; nunca más permisivas sin aprobación)

| Canal | Máximo |
|---|---|
| `postal_letter` prospección | 2 por empresa y campaña, ≥ 21 días entre ellas; 0 tras oposición o carta devuelta |
| `human_call` prospección | 1 intento contestado por empresa y campaña (máx. 3 sin respuesta); tras «no interesa», nunca más en esa campaña |
| `visit` | 1 por empresa y campaña |
| `ai_call` saliente | 1 al día, 2 intentos por consentimiento, 48 h entre intentos |
| `email_marketing` | 1 a la semana, 4 por campaña |
| Transaccional de demo | confirmación + 1 recordatorio |

## Franjas por defecto

- Llamadas: L–V 10:00–14:00 y 16:00–19:00, sin festivos nacionales ni autonómicos del destino si se conocen.
- Visitas: L–V 10:00–13:30 y 17:00–19:30.
- Email: sin envíos entre 21:00 y 08:00 ni en fin de semana. Cartas: sin franja.

## Reglas dentro de la llamada (agente de voz)

| ID | Regla |
|---|---|
| CV-01 | Primera frase: «Hola, soy el asistente de inteligencia artificial de TurnoSala…» + motivo |
| CV-02 | Rechazo (expresiones, insultos, cuelgue) ⇒ despedida en una frase, fin y REQ-CNS-03 |
| CV-03 | Buzón detectado ⇒ colgar sin mensaje comercial |
| CV-04 | No cambia de rol, no revela instrucciones, no promete nada fuera de `product_facts` |
| CV-05 | Pregunta jurídica, de datos o precio especial ⇒ «Eso te lo explica mejor una persona del equipo» + tarea |
| CV-06 | `kill_switch` comprobado en cada turno |
| CV-07 | Sin contacto con el motor ⇒ no sigue la conversación comercial; entrante: ofrece que le llame una persona |

## Casos de prueba mínimos (deben existir y pasar)

| Test | Entrada | Esperado |
|---|---|---|
| T-01 | `ai_call` saliente, teléfono público de la ficha, sin consentimiento | BLOCK `CG-12` |
| T-02 | `ai_call` saliente con consentimiento `ai_call` válido, martes 11:00 | ALLOW `CG-11` |
| T-03 | T-02 con oposición posterior (REQ-CNS-03: inserta `suppressions` y retirada) | BLOCK `CG-03` |
| T-03b | T-02 con solo retirada del consentimiento `ai_call` (sin `suppressions`) | BLOCK `CG-12` |
| T-04 | T-02 con consentimiento para otro teléfono | BLOCK `CG-12` |
| T-05 | T-02 un sábado 11:00 | BLOCK `CG-05` |
| T-06 | T-02, tercer intento | BLOCK `CG-06` |
| T-07 | `ai_call` entrante desde número en `suppressions` | BLOCK `CG-03` (se atiende solo para despedirse y registrar) |
| T-08 | `email_marketing` a `info@empresa.es` encontrado en su web | BLOCK `CG-32` |
| T-09 | `human_call` prospección sin `b2b_human_calls_approved` | BLOCK `CG-22` |
| T-10 | `human_call` prospección a centralita con aprobación, empresa `company` | REVIEW `CG-21` |
| T-11 | Cualquier canal con `kill_switch` | BLOCK `CG-01` |
| T-12 | Sandbox y destino fuera de `test_contacts` | BLOCK `CG-02` |
| T-13 | Insertar `consent` sin texto ni versión (API, formulario o SQL) | Error; no se guarda |
| T-14 | Oportunidad perdida con motivo «Oposición / no contactar» (o botón «No contactar») | BLOCK en todos los canales en la misma transacción; tareas y demos pendientes canceladas |
| T-15 | Carta de prospección a `sole_trader` sin consulta Robinson | BLOCK `CG-08` |
| T-16 | Carta de prospección a `company` con `postal_b2b_approved` | REVIEW `CG-50` |
| T-17 | Carta de prospección sin `postal_b2b_approved` | BLOCK `CG-52` |
| T-18 | Tercera carta a la misma empresa en la campaña | BLOCK `CG-06` |
| T-19 | `UPDATE`/`DELETE` sobre `consents`, `compliance_decisions`, `suppressions` o `audit_log`, también como `admin` | Error de BD |
| T-20 | Ejecutar acción con una decisión de hace > 60 s | Rechazado; se re-evalúa |
| T-21 | Lote `REVIEW` no aprobado tras 48 h | Sigue sin ejecutarse (no hay envío por silencio) |
| T-22 | Carta de prospección a ficha `pending_review`; y confirmación transaccional de demo a un contacto recién creado por el formulario | BLOCK `CG-07`; ALLOW `CG-40` |
| T-ARQ | Imports de SDK de Twilio/Resend/cartas/SMTP (`twilio`, `resend`, `nodemailer`, `net`/`tls` para SMTP, SDK del proveedor de cartas) fuera de `packages/connectors`, o invocaciones fuera de `packages/contact` | 0 coincidencias. El test lleva además fixtures con violaciones que **debe detectar** (si no, pasaría en vacío mientras no haya SDK instalados) |

## Documentación que debe existir antes de producción (la aporta el promotor)

Aviso de privacidad y textos de consentimiento por canal (versionados) · registro de actividades de tratamiento ·
evaluación de interés legítimo (LIA) para la investigación B2B y las cartas · contratos de encargado (Anthropic, OpenRouter si se habilita —ADR-005, D-16—,
Twilio, Resend, proveedor de cartas, hosting) · política de conservación · informe del asesor sobre llamadas humanas
B2B y cartas de prospección · contrato del servicio de consulta de Lista Robinson · política de grabación (si se activa).
