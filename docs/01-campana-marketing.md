# Campaña de captación de TurnoSala: Sevilla → Andalucía → España

> Complementa `turnometro/docs/TurnoSalaVentas.md` (ICP, guiones, objeciones, marco legal), que sigue vigente.
> Aquí se fija el **despliegue por oleadas**, los canales que usa el motor y las metas medibles. Las cifras de
> conversión son **hipótesis a validar**, no previsiones.

## 1. Mensaje y oferta

- **Propuesta:** «Tu sala de espera, organizada y profesional, sin instalar un sistema caro».
- **Oferta de entrada:** demo de 15 minutos + **30 días de prueba gratuita**. Precios y promoción, solo los de
  `product_facts` aprobados (hay una discrepancia por resolver: 24/58/124 € frente a 29/69/149 €, decisión D-02).
- **No prometer** reducciones de tiempo de espera sin medición propia; el beneficio comprobable es ordenar la llamada
  e informar al cliente.

## 2. Segmentos y orden de ataque

| Prioridad | Vertical | Señales que busca el motor | Demo más persuasiva |
|---|---|---|---|
| A1 | Policlínicas y clínicas dentales con varias consultas | «consultas», «sala de espera», cita previa online, varias especialidades | Recepción registra → doctor llama → TV muestra el turno |
| A2 | Ópticas con gabinete y centros auditivos | «gabinete», «graduación», varios ópticos | Cola de mostrador + citas de gabinete |
| A3 | Fisioterapia y rehabilitación multi-box | «boxes», «sesiones», varios fisioterapeutas | Llamada por box desde el móvil |
| A4 | Laboratorios y centros de extracción | «extracciones», «sin cita», horario de mañana | Kiosco + cola compartida |
| B1 | Talleres, posventa de concesionarios, ITV privadas | «recepción de vehículos», «cita taller» | Turno por asesor |
| B2 | Veterinarios, academias, gestorías, oficinas de atención | Recepción concurrida, trámites | Pantalla por trámite |
| C | Ayuntamientos y organismos públicos | Licitaciones, registro y atención ciudadana | Canal institucional aparte (D-12) |

## 3. Oleadas

| Oleada | Territorio | Cuándo empieza | Objetivo de aprendizaje |
|---|---|---|---|
| **0. Preparación** | — | Ya (en paralelo a F0–F3) | Landings por sector, textos legales, `product_facts`, número del asistente, anuncios de prueba |
| **1. Sevilla** | Provincia de Sevilla (capital, Aljarafe, Dos Hermanas, Alcalá, Écija, Carmona, Utrera y resto) | Tras G4 (cartas) · anuncios y partners desde la oleada 0 | Qué vertical convierte, coste por demo, calidad de las fichas |
| **2. Andalucía** | Málaga, Córdoba, Granada, Cádiz, Huelva, Jaén, Almería | Cuando la oleada 1 cumpla el criterio de paso | Escalar las 2 verticales ganadoras; proveedor de cartas con API |
| **3. España** | Provincias por tamaño: Madrid, Barcelona, Valencia, Alicante, Murcia, Zaragoza, Bilbao… | Tras validar la oleada 2 | Registros sanitarios por comunidad; idioma (ca/eu/gl) en landings y cartas |

**Criterio de paso entre oleadas (propuesta):** al menos 10 demos realizadas, al menos 3 pruebas activadas, coste por
demo por debajo del umbral que fije el promotor, oposiciones/quejas < 2 % de los contactados y ninguna incidencia legal.

## 4. Canales y lo que hace el motor en cada uno

| Canal | Para quién | Qué hace la IA | Qué hace una persona |
|---|---|---|---|
| **Carta personalizada + QR** | Fichas aprobadas (empresa; autónomos solo tras consultar la Lista Robinson) | Redacta la carta con un gancho basado en evidencia («vuestra web indica 6 consultas en…»), crea la landing `/c/<token>` y el QR | Aprueba el lote; imprime o envía; recibe las cartas devueltas |
| **Landing por sector y personalizada** | Tráfico de cartas, anuncios y SEO | Genera textos y FAQ con `product_facts` | Aprueba y publica |
| **Agente de voz entrante** | Quien llama al número de la carta o del anuncio | Se identifica como IA, cualifica (3 preguntas) y reserva la demo | Hace la demo |
| **Voz IA saliente** | Solo quien marcó «llamada de un asistente de IA» | Devuelve la llamada en la franja permitida | Revisa los resúmenes en la fase de escalado |
| **Llamada humana con copiloto** | Centralitas de empresa, solo si el asesor valida el supuesto B2B (`REVIEW` por lote) | Guion por sector, objeciones, resumen | Llama |
| **Visita presencial** | Fichas aprobadas cerca de la base (Sevilla) | Rutas por municipio, argumentario y material | Visita |
| **Email** | Solo quien lo consintió | Secuencia corta, clasificación de respuestas, baja automática | Contesta las respuestas |
| **Publicidad segmentada** | Audiencias por zona y sector en Meta, Google Search y LinkedIn (sin subir listas raspadas) | Creatividades y variantes A/B | Aprueba el gasto y publica |
| **Partners** | Software de gestión de clínicas, distribuidores de TV/impresoras, asociaciones y colegios, Cámara de Comercio | Lista de partners con evidencias y propuesta | Negocia |
| **SEO local** | Búsquedas «sistema de turnos clínica Sevilla» | Landings por sector y provincia (no por municipio, para no crear páginas puerta) | Aprueba |

## 5. Calendario de la oleada 1 (Sevilla), 8 semanas desde G4

| Semana | Trabajo | Resultado |
|---|---|---|
| 1 | Investigación de 400 empresas A1–A3 en la provincia; revisión | 200 fichas aprobadas |
| 2 | Lote 1: 50 cartas A1 (Sevilla capital y Aljarafe); anuncios de bajo presupuesto | Primeros escaneos del QR |
| 3 | Lote 2: 50 cartas A2/A3; visitas en Dos Hermanas y Alcalá | Llamadas entrantes al asistente |
| 4 | Lectura: escaneos, solicitudes y demos por vertical; ajuste de la carta (A/B) | Vertical ganadora provisional |
| 5 | Lote 3: 100 cartas a la vertical ganadora; segunda carta a quien escaneó y no pidió demo | — |
| 6 | Voz IA saliente para consentidos (≤ 20/día); webinar para clínicas | Demos |
| 7 | Seguimiento de pruebas (activación) | Pruebas activas |
| 8 | Informe de coste y conversión → decisión de paso a la oleada 2 | Go / no-go |

## 6. Presupuesto orientativo de la oleada 1 (hipótesis, sin IVA)

| Partida | Importe |
|---|---|
| Cartas (200–300 con impresión propia y franqueo, a confirmar en F0) | 250–450 € |
| Anuncios Meta + Google Search (8 semanas) | 600–1.200 € |
| LLM (investigación, cartas, voz) dentro del presupuesto diario | 150–400 € |
| Telefonía (número, minutos) | 50–150 € |
| Lista Robinson (servicio de consulta) | según tarifa (D-08) |
| **Total variable** | **≈ 1.050–2.200 €** sin desarrollo ni personal |

## 7. Indicadores

Fichas verificadas · % aprobadas en revisión · coste por ficha · cartas enviadas · % de escaneo del QR · solicitudes
de demo · llamadas entrantes · demos reservadas y realizadas · pruebas creadas y activadas · pagos · coste por demo y
por cliente · oposiciones y quejas · precisión de extracción (conjunto dorado). El informe semanal (REQ-OBS-02)
separa los datos medidos de las hipótesis.

**Hipótesis a validar en Sevilla (no son metas comprometidas):** 2–5 % de las cartas generan una solicitud de demo;
40–60 % de las demos pasan a prueba; 20–35 % de las pruebas pasan a pago. Con 300 cartas saldrían ≈ 6–15 demos y
0–3 clientes: la oleada 1 sirve para **aprender**, no para rentabilizarse. La comparación que importa es el coste por
cliente frente a su valor de vida (por ejemplo, un plan Profesional de 69 €/mes durante 24 meses ≈ 1.650 €); el
umbral de paso lo fija el promotor con los datos de la oleada 1.
