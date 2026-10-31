# Análisis de Explee y qué adaptamos

Consultado el 31/10/2026 en explee.com y en reseñas públicas (Salesforge, aidirectori.es, SourceForge, Trustpilot y G2
citados por ellas). Las cifras de resultados son afirmaciones de marketing de Explee, no datos verificados.

## 1. Qué es Explee

Servicio B2B (EE. UU., fundado en 2024) que se anuncia como «un agente de IA 24/7 que encuentra clientes mientras
duermes». Flujo:

1. **Alta:** introduces tu web; el agente aprende qué vendes y a quién.
2. **Investigación de mercado:** estudia competidores y propone segmentos ICP con un % de encaje (p. ej. «92 %
   diseñadores de eventos»).
3. **Prospección:** filtra por sector, cargo, tamaño y ubicación sobre su base propia (dice tener más de 105 M de
   empresas y 80 M de decisores, además de un conjunto de Google Maps de más de 218 M de registros), con búsqueda en
   lenguaje natural y empresas «parecidas a».
4. **Redacción:** un email personalizado por persona, en 30 idiomas, con seguimientos.
5. **Envío:** desde su propio grupo de buzones precalentados (SPF/DKIM/DMARC, un buzón por prospecto, pausa
   automática si hay listas negras o rebotes). Dice tener un 97 % de entrega en bandeja de entrada.
6. **Respuestas:** las recoge, detecta interés y envía tu enlace de reserva.
7. **Optimización:** coste por lead por campaña; escala lo que funciona y pausa lo que no.

**Precio:** buscar es gratis; pagas por email enviado (≈ 0,03–0,04 $), con presupuesto diario y 30 $ de crédito
inicial. Coste por lead anunciado: 1–20 $ (mediana 9 $).

**Puntos débiles según reseñas:** poco control una vez lanzada la campaña; un usuario denuncia que **empezó a enviar
a las 2 h sin que aprobara los leads**; ofertas incorrectas, conversaciones extrañas de la IA y respuestas mal
marcadas como interesadas; problemas para cancelar y cobros dobles. Sin información pública sobre RGPD, base
jurídica ni consentimiento. Solo canal email (sin llamadas ni LinkedIn). Muestra de reseñas muy pequeña
(5 en G2, 5/5; 6 en Trustpilot, 2,4/5).

## 2. Por qué no se puede copiar tal cual en España

| Práctica de Explee | En España / UE | Consecuencia en nuestro diseño |
|---|---|---|
| Email comercial en frío a direcciones verificadas, también corporativas | **Prohibido** sin consentimiento previo (LSSI art. 21), salvo clientes previos con producto similar | Email comercial solo a quien lo consiente en nuestras landings (CG-30/32) |
| Base de datos de «decisores» con nombre y email | Datos personales: hace falta base jurídica, información del art. 14 RGPD y minimización; comprar o raspar perfiles de personas es de alto riesgo | Solo datos de **empresa**; nada de empleados (P2.3) |
| Envío automático sin aprobación | Riesgo jurídico y de reputación (es su queja principal) | Nada sale sin aprobación explícita; el silencio bloquea (P1.7) |
| Llamadas (Explee no las hace; nuestro objetivo sí) | Llamadas automatizadas con fines comerciales sin intervención humana: **consentimiento previo** (Ley 11/2022 art. 66.1.a). IA identificada como tal desde el 2/08/2026 (Reglamento de IA art. 50) | Voz IA solo **entrante** o **saliente con consentimiento `ai_call`** (CG-10/11/12) |
| Datos de Google Maps almacenados | Las condiciones de Google Maps Platform limitan qué se puede guardar | Solo `place_id`; la ficha se construye con la web de la empresa y registros abiertos |

## 3. Qué adaptamos (y mejoramos)

| Capacidad de Explee | En TurnoSala Prospector | Requisito |
|---|---|---|
| Aprende tu producto desde la web | `product_facts` versionados y aprobados; el contenido no puede salirse de ellos | REQ-MKT-01 |
| Segmentos ICP con % de encaje | Igual, con fuentes y justificación, aprobados por marketing | REQ-MKT-02 |
| — (no existe) | **Dimensionamiento** del mercado por municipio, provincia y comunidad | REQ-MKT-03 |
| Base propia de 105 M de empresas | Descubrimiento en vivo en registros oficiales (REGCESS, registros autonómicos), OpenStreetMap, APIs de mapas con licencia y búsqueda web; ficha basada en la web de la empresa | REQ-RES-01/02 |
| Datos sin trazabilidad visible | **Evidencia por campo** (URL, fecha, fragmento literal, observado/inferido) y rechazo de lo que no aparece en la fuente | REQ-ENR-01 |
| Verificación de email | Normalización E.164, MX, web viva, deduplicación contra fichas, clientes actuales y exclusiones | REQ-VER |
| Encaje por segmento | Puntuación 0–100 calculada por código a partir de señales (reproducible) | REQ-SCO-01 |
| Aprobación opcional | **Cola de revisión humana** obligatoria con muestreo | REQ-REV |
| Email frío personalizado | **Carta postal personalizada** a la empresa con QR a una landing propia (`/c/<token>`), donde el interesado da su consentimiento | REQ-LET, REQ-CNS-01 |
| Seguimientos por email | Secuencias multicanal: carta → llamada humana con copiloto (si el asesor la valida) → visita; email y voz IA solo con consentimiento | REQ-OUT, REQ-COP |
| Envía tu enlace de reserva | Agenda de demos propia con reserva pública sin doble reserva; el agente de voz ofrece dos huecos reales y reserva | REQ-AGE, REQ-DEM-01, REQ-VOZ-03 |
| Bandeja de respuestas (no es un CRM) | CRM propio: oportunidades por etapas, tareas, línea de tiempo, hasta la prueba y el pago | REQ-CRM |
| — | **Agente de voz** que atiende el número de las cartas y anuncios, y devuelve llamadas consentidas | REQ-VOZ |
| — | **Prueba de 30 días** creada en TurnoSala desde el CRM | REQ-TRI-01 |
| Coste por lead por campaña | Coste por ficha, por demo y por prueba, con presupuesto diario y `kill_switch` | REQ-OBS |
| Búsqueda en lenguaje natural y «parecidas» | Igual sobre nuestras fichas (fase de optimización) | REQ-MKT-04 |

**Lo que ganamos:** fichas mejor justificadas (evidencia por campo), un canal de primer contacto legal y con poca
competencia (casi nadie envía cartas personalizadas a clínicas), un agente de voz que Explee no tiene, y un ciclo
cerrado hasta la prueba y el pago en TurnoSala.

**Lo que perdemos frente a Explee:** volumen y coste por contacto. Una carta cuesta mucho más que un email
(estimación a confirmar en F0: en torno a 1–1,5 € por carta con franqueo e impresión propia frente a ~0,04 $ por
email). Con un ticket de 29–149 €/mes y un cliente que dura años, 200 cartas bien elegidas en Sevilla son asumibles;
hay que medir conversión desde la primera oleada (ver `01-campana-marketing.md`).

## Fuentes

- https://explee.com
- https://www.salesforge.ai/blog/explee-review (lo publica un competidor; tomarlo con cautela)
- https://www.aidirectori.es/blog/explee-review
- https://www.sourceforge.net/software/product/Explee-AI
- Condiciones de Google Maps Platform: https://cloud.google.com/maps-platform/terms/maps-service-terms/
- Marco legal: ver `turnometro/docs/TurnoSalaVentas.md` §6 (LSSI art. 21, Ley 11/2022 art. 66, Circular AEPD 1/2023, FAQ AEPD, Reglamento de IA art. 50)
