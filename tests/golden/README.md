# Conjunto dorado de extracción (F1.10)

50 webs de empresas **anotadas a mano por una persona** para medir la extracción con datos reales. No las puede anotar el modelo: sería circular.
La puerta de F1 exige **≥ 90 % de precisión** y que el coste real por ficha esté medido.

## Cómo anotar una web

1. Congela el texto de la web (rastreo educado: `robots.txt`, 1 petición/s, ≤ 6 páginas; los nombres de personas y emails personales ya salen sustituidos):

       npm run golden:snapshot -- clinica-sol https://www.clinicasol.es

   Esto crea `snapshots/clinica-sol.json` y `snapshots/clinica-sol.txt` (local, **fuera de git**: es texto de terceros) y la plantilla `entries/clinica-sol.json`.
2. Lee `snapshots/clinica-sol.txt` y completa `entries/clinica-sol.json` (ver `entries/_plantilla.json`). **Anota solo lo que ese texto dice.**
3. Rellena `annotated_by` y `annotated_at` (AAAA-MM-DD). Una entrada sin esos datos se considera sin anotar y no se evalúa.

## Reglas de anotación

- **Sé exhaustivo.** Lo que la web dice y no anotas cuenta como un error del modelo (una afirmación de más baja la precisión).
- `fields`: `name`, `phone`, `address`, `sites_count`, `opening_hours`, `specialties`, `consultation_rooms`. Los números, como texto entero (`"3"`).
- `signals`: solo claves del modelo de puntuación (`varias_consultas`, `sala_espera`, `tv_en_sala`, …).
- `contact_points`: solo de la **empresa** (centralita, móvil de empresa, email genérico como `info@`, dirección, formulario, URL de reserva). Nunca personas.
- `legal_form`: `company`, `sole_trader`, `public_body` o `unknown`.
- Una cifra o un dato **no dicho** en el texto no se anota, aunque lo sepas por otra vía: se evalúa lo que el modelo puede ver.

## Evaluar

    npm run eval:extract -- --dry-run          # valida las anotaciones; no llama al modelo ni gasta
    npm run eval:extract -- --max-eur 5        # evalúa con el modelo de la ruta `enrich.extract`
    npm run eval:extract -- --model <slug>     # compara otro modelo de OpenRouter solo en esta ejecución

**Gasta dinero real**: necesita `OPENROUTER_API_KEY` (créala tú; nunca la pegues en el chat) y `DATABASE_URL`. Pide aprobación del tope antes de ejecutarlo.

## Qué mide

- **Precisión** = aciertos / devueltos (campos + señales + contactos + forma jurídica), sobre lo que **sobrevive a la verificación literal**.
- **Exhaustividad** = aciertos / anotados.
- **Tasa de rechazo literal** = citas inventadas descartadas / propuestas (calidad del prompt; se informa aparte porque ya no llegan a la ficha).
- **Coste por ficha** (€ medidos por el proveedor), para validar o corregir la estimación de la fase.
