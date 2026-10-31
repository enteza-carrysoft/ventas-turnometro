# Prompt inicial (pegar en Claude Code dentro de `ventas-turnometro`)

```
Vamos a construir TurnoSala Prospector, el motor de prospección comercial con IA de TurnoSala, con desarrollo guiado
por especificación (SDD). La especificación ya está escrita en este repositorio.

1. Lee, en este orden: CLAUDE.md, README.md, docs/00-analisis-explee.md, docs/01-campana-marketing.md,
   spec/constitution.md, spec/compliance.md, spec/requirements.md, spec/design.md, spec/data-model.sql,
   spec/tasks.md, spec/decisions.md y spec/phases/F0-cimientos.md.
   Como antecedente, en ../turnometro: docs/TurnoSalaVentas.md §4–§7 y .claude/PRPs/PRP-017-api-plataforma-pruebas.md.
2. Revisa F0-cimientos.md contra el estado real del repositorio y de las herramientas. Si ves huecos o
   contradicciones entre documentos, corrígelos en la spec y dime en 5 líneas qué cambiaste.
3. Dime en una sola lista qué necesitas de mí para F0 (decisiones D-01, D-02 y D-03, calendarios de los comerciales,
   cuentas), sin pedirme secretos en el chat. No hay Odoo: el CRM y la agenda son parte de este sistema (ADR-004).
4. Cuando apruebe la fase, ejecútala tarea a tarea con la definición de terminado de spec/tasks.md: test primero,
   verificación ejecutada, nada de dar por hecha una tarea sin su prueba. Al terminar la fase, resume qué se hizo,
   qué decidiste fuera de la spec y cómo lo pruebo (comandos de PowerShell), y pide la puerta G0.

Recuerda: APP_MODE=sandbox siempre; nada contacta a nadie fuera de packages/contact; la puerta de cumplimiento es
cerrada por defecto; usa la skill claude-api antes de escribir código contra la API de Claude.
```

## Orden de fases

F0 Cimientos y comprobaciones → F1 Investigación y fichas (piloto de 200 empresas en Sevilla, cero contactos) →
F2 Landings, consentimientos y CRM → F3 Agenda de demos y prueba de 30 días → F4 Cartas, copiloto y campañas
(primer contacto real) → F5 Agente de voz → F6 Email consentido → F7 Optimización y expansión.

**Primer contacto real con clientes:** al cerrar F4 (puerta G4, con el visto bueno del asesor jurídico).
La campaña de anuncios, las landings y los partners pueden empezar antes (oleada 0 de `docs/01-campana-marketing.md`).
