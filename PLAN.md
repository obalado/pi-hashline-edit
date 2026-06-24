# Plan de mejoras — pi-hashline-edit v0.8.0

Estado: implementado en workspace (pendiente commit/release).

Basado en análisis comparativo de:
- can1357/oh-my-pi (`@oh-my-pi/hashline` v16.1.16 — original)
- RimuruW/pi-hashline-edit (v0.7.0 — este repo)
- JerryAZR/pi-hashline-edit (v0.11.4 — fork)

---

## Objetivo v0.8.0

Hacer anchors más resistentes a corrimientos, añadir lectura raw opcional y preparar recuperación segura de stale anchors sin romper semántica estricta.

## Invariantes que se mantienen

- Hash visible sigue siendo `LINE#HH` con 2 chars. ADR 0001 sigue vigente.
- Runtime no relocaliza anchors por aproximación.
- `lines` en `edit` sigue siendo contenido literal; no se autocorrigen prefijos `LINE#HASH:` ni diff markers.
- Success de `edit` sigue devolviendo anchors frescos visibles; payloads grandes requieren `read`.
- `details` sigue siendo host-only; modelo no depende de `details`.
- Todas las escrituras siguen pasando por `writeFileAtomically`.

## Cambios de contrato esperados

- Hashes cambian entre v0.7 y v0.8. Anchors de sesiones viejas quedan inválidos.
- `read({ raw: true })` no devuelve anchors y no habilita edición por anchors.
- Recuperación 3-way, si se implementa, es “safe compose only”: éxito solo si cambio stale y cambio externo no se solapan. Si hay ambigüedad, error `[E_STALE_ANCHOR]`.

---

## Fase 0: Guardrails antes de tocar código

1. Correr baseline:
   - `npm run check`
   - `npm audit --omit=dev`
   - `npm pack --dry-run`
2. Crear/actualizar ADR para recuperación segura:
   - reemplaza invariant absoluto “stale anchors fail” por “stale anchors fail unless deterministic non-overlap 3-way recovery succeeds”.
3. Marcar decisiones en README/CONTEXT antes de merge recovery.
4. Mantener tests por fase; no dejar “Tests” solo al final.

---

## Fase 1: Modelo de líneas + hash contextual (`src/hashline.ts`)

### 1.1 Definir modelo único de archivo hashline

Problema actual: varios módulos hacen `split("\n")` con semánticas distintas. Con hash contextual, `read(offset/limit)` necesita prev/next reales fuera del slice.

Crear helpers internos claros:

```ts
type HashlineFile = {
  normalizedContent: string;
  visibleLines: string[];      // sin línea vacía sintética por trailing newline
  hasTerminalNewline: boolean;
  hashVersion: "fnv1a-context-v1";
};
```

Reglas:
- `visibleLines` es autoridad para `read`, anchors, diffs y changed response.
- `buildLineIndex` puede conservar forma interna para edición, pero debe documentar diferencia con `visibleLines`.
- Hashes de rangos parciales se calculan contra `visibleLines` completas, no contra slice.
- BOF/EOF usan sentinels explícitos (`<BOF>`, `<EOF>`), no string vacío.

### 1.2 Reemplazar xxHash32 por FNV-1a contextual

Problema: hash por línea sola. Editar línea 5 no invalida hash de línea 6.

Solución:

```ts
hashInput = lineNumber + "\0" + norm(prev) + "\0" + norm(curr) + "\0" + norm(next)
hash = fnv1a32(hashInput)
visible = alphabet[hash & 0xff]
```

Decisiones:
- Mantener alphabet `ZPMQVRWSNKTXJBYH`.
- Mantener 2 chars.
- Mantener compat de normalización de línea: quitar `\r` y `trimEnd()` antes de hashear.
- El viejo seed especial para líneas sin alfanuméricos queda reemplazado por contexto + `lineNumber`.

API sugerida:

```ts
computeLineHashAt(lines: readonly string[], lineNumber: number): string // lineNumber 1-based
computeLineHashes(lines: readonly string[]): string[]
formatHashlineRegionFromFile(lines, startLine, endLine)
```

Evitar firma ambigua `computeLineHash(lines, index)`.

### 1.3 Actualizar consumidores de hashes

Archivos afectados:
- `src/hashline.ts`
- `src/read.ts`
- `src/edit-diff.ts`
- `src/edit-response.ts`
- tests con hashes hardcodeados

Casos obligatorios:
- `read(offset, limit)` muestra hashes calculados con contexto fuera del slice.
- `formatMismatchError` muestra retry anchors con hashes calculados contra archivo actual completo.
- Changed response muestra anchors correctos para región + contexto.
- Diff preview no calcula hash con slice parcial.

### 1.4 Boundary duplication warning

Ya existe en `validateAnchorEdits`. Mantener y reforzar tests si se toca lógica cercana.

---

## Fase 2: Herramientas existentes

### 2.1 `src/read.ts` — raw mode

Añadir parámetro:

```ts
raw?: boolean
```

Semántica:
- `raw: false` o omitido: comportamiento actual con `LINE#HASH:`.
- `raw: true`: salida sin prefijos, respeta `offset`/`limit` y truncation.
- `raw: true` no actualiza snapshot de recuperación, para no destruir último read con anchors.
- Imagen/binario/directorio mantienen comportamiento actual.

Docs/prompts:
- Raw sirve para inspección/token saving.
- Para editar, usar `read` normal antes de `edit`.

### 2.2 `src/edit-diff.ts` — diff con hashes contextuales

Objetivo: diff model-visible/UI con additions y context lines anotadas:

```text
 5#MQ:function greet(name) {
+6#VR:  return `Hello, ${name}`;
-6    return oldGreet(name);
```

Reglas:
- Context y additions usan hashes del archivo nuevo completo.
- Removed lines no usan hash o usan formato sin `#HH`, porque ya no existen.
- Mantener primer char `+`, `-`, espacio para render/color actual.
- Si se usa `structuredPatch`, no usarlo como base para merge fuzzy.

### 2.3 Edits adyacentes

Situación actual: prompt pide “no overlap or touch adjacent lines”. Engine detecta conflictos por overlap, pero no necesariamente adjacency.

Decisión v0.8:
- Preferir mantener contrato estricto y bloquear edits que tocan misma boundary, salvo caso seguro.
- Auto-merge solo si todos son `replace` contiguos, en orden original, sin inserts entre medias, y sin cambiar semántica de noop/warnings.
- Si complica métricas o warnings, diferir a v0.9.

---

## Fase 3: Snapshot store de contenido leído

### 3.1 Nuevo `src/read-snapshot.ts`

No usar single-entry cache. Usar LRU por canonical path.

Contenido sugerido:

```ts
type ReadSnapshot = {
  canonicalPath: string;
  normalizedContent: string;
  visibleLines: string[];
  hashes: string[];
  snapshotId: string;
  hashVersion: "fnv1a-context-v1";
  createdAt: number;
};
```

Política:
- Key: canonical mutation target (`resolveMutationTargetPath`), mismo criterio que queue de edición.
- Max entries: pequeño (`32` por defecto).
- Max bytes total: configurable o constante (`8–32 MiB`).
- Evict LRU al superar límites.
- Ignorar snapshots con hashVersion distinto.

### 3.2 Hooks de escritura/lectura

- `read` normal guarda snapshot después de normalizar LF y calcular hashes.
- `read(raw: true)` no guarda snapshot.
- `edit` exitoso actualiza snapshot con contenido post-edit y `snapshotId` nuevo, porque chained anchors vienen de `edit` response.
- `edit` noop puede conservar snapshot si contenido/snapshotId siguen válidos.

### 3.3 Separar `snapshot.ts` vs `read-snapshot.ts`

`snapshot.ts` actual = stat fingerprint host-only.

`read-snapshot.ts` nuevo = contenido base para recovery. Nombres y imports deben evitar confusión.

---

## Fase 4: Recovery 3-way seguro

### 4.1 Matching exacto de anchors

Decisión de implementación: no crear `fuzzy-match.ts` ni `anchor-match.ts` por ahora. Recovery valida el request completo aplicándolo contra el snapshot guardado con la misma ruta `applyHashlineEdits`, evitando una segunda implementación de reglas de anchor validation.

Si más adelante se extrae un matcher, debe ser exacto (no fuzzy relocation) y reutilizar la misma lógica de mismatch/retry que `applyHashlineEdits`.

### 4.2 Pipeline nuevo en `src/edit.ts`

Flujo seguro:

```text
1. Resolver request y leer current.
2. Intentar apply normal contra current.
3. Si ok → escribir normal.
4. Si falla por [E_STALE_ANCHOR]:
   a. buscar snapshot por canonical path
   b. si no existe → devolver error original
   c. validar TODOS los anchors contra snapshot
   d. si no todos matchean snapshot → devolver error original con retry lines current
   e. aplicar request completo sobre snapshot → baseEdited
   f. threeWayMerge(snapshot, baseEdited, current)
   g. si merge ok → escribir merged + warning [W_MERGED_STALE_ANCHORS]
   h. si merge fail → devolver error original
```

Regla importante: no partir request en matched/unmatched. Mezclar anchors current + snapshot puede duplicar cambios. Recovery trabaja con request completo contra snapshot o falla.

### 4.3 `src/merge.ts` — deterministic diff3, no fuzzy relocation

Evitar `applyPatch(current, patch, fuzzFactor=0)` como autoridad principal: puede depender de contexto repetido.

Semántica deseada:

```ts
threeWayMerge(base, baseEdited, current)
  → { ok: true; content: string; changedRange } | { ok: false; reason: string }
```

Reglas:
- Trabajar en LF normalizado.
- Calcular spans base→baseEdited.
- Calcular spans base→current.
- Si spans se solapan o tocan misma insertion boundary → conflict.
- Si no solapan, componer cambios de baseEdited sobre current traduciendo offsets por cambios current previos.
- Si hay ambigüedad por líneas repetidas/contexto insuficiente → conflict, no relocación.

Warning visible en éxito:

```text
[W_MERGED_STALE_ANCHORS] Anchors were stale, but your edit was merged with non-overlapping current file changes. Re-read before further distant edits.
```

### 4.4 Error behavior

- Recovery nunca oculta retry guidance original.
- Si falla merge, devolver `[E_STALE_ANCHOR]` con `>>>` current anchors igual que hoy.
- No introducir success silencioso.

---

## Fase 5: Docs, prompts, ADRs

Actualizar:
- `README.md`
- `CONTEXT.md`
- `prompts/read.md`
- `prompts/read-guidelines.md`
- `prompts/edit.md`
- `prompts/edit-guidelines.md`
- nueva ADR sobre recovery 3-way seguro

Mensajes clave:
- Anchors son opacos; no calcular.
- Hashes son contextuales; editar una línea invalida vecinos.
- `raw` no sirve para obtener anchors.
- Stale anchors normalmente fallan; merge recovery solo si cambios no se solapan.

---

## Fase 6: Package, audit, release

1. Después de reemplazar imports, remover:
   - `xxhashjs`
   - `@types/xxhashjs`
2. Subir `file-type` mínimo a versión sin advisories directas (`>=21.3.4` si compatible).
3. Revisar peer/dev deps Pi:
   - probar contra `@earendil-works/pi-coding-agent` actual.
   - no subir peer mínimo salvo API requerida.
4. Correr:
   - `npm run check`
   - `npm audit --omit=dev`
   - `npm pack --dry-run`
5. Actualizar changelog/release notes:
   - breaking: hash algorithm changed.
   - feature: raw read.
   - feature/experimental: safe stale-anchor merge recovery, si entra.

---

## Tests por fase

### Hash contextual

- Neighbor hash cambia cuando cambia línea anterior.
- Neighbor hash cambia cuando cambia línea siguiente.
- `read(offset/limit)` usa contexto fuera del slice.
- BOF/EOF hashes estables.
- Trailing newline no crea anchor sintético.
- Trailing whitespace mantiene comportamiento decidido (`trimEnd`).
- Líneas con solo `}`/punctuation siguen diferenciándose por contexto/lineNumber.

### Read raw

- Raw sin prefijos.
- Raw respeta `offset`/`limit`/truncation.
- Raw no guarda snapshot ni pisa snapshot anterior.
- Raw mantiene imagen/binary/dir errors.

### Diff/render

- Additions/context tienen `LINE#HASH` válido del resultado completo.
- Removed lines no parecen anchors copiables.
- Render UI sigue coloreando `+`/`-`.

### Snapshot store

- Store por canonical path.
- Symlink y path real comparten snapshot.
- LRU evict por entries/bytes.
- Snapshot se actualiza después de edit aplicado.
- Snapshot hashVersion mismatch se ignora.

### Merge recovery

- Current sin cambios: fast path normal.
- Cambio externo no solapado + stale edit: merge ok + warning.
- Cambio externo solapado: `[E_STALE_ANCHOR]`.
- Mixed anchors current/snapshot pero request completo no matchea snapshot: fail.
- Contexto repetido no causa aplicación en bloque equivocado.
- Insertions en misma boundary conflictúan.
- Merge preserva line endings/BOM vía pipeline existente.

---

## Archivos afectados

| Archivo | Acción |
|---------|--------|
| `package.json` | remover `xxhashjs`, actualizar `file-type` |
| `package-lock.json` | actualizar |
| `src/hashline.ts` | cambio mayor: line model, FNV contextual, validation |
| `src/read.ts` | raw mode, hashes con contexto, snapshot hook |
| `src/edit.ts` | pipeline recovery, snapshot post-edit |
| `src/edit-diff.ts` | diff con hashes contextuales |
| `src/edit-response.ts` | anchors con line model nuevo, warnings merge |
| `src/edit-render.ts` | validar formato diff actualizado |
| `src/snapshot.ts` | sin cambio conceptual; stat fingerprint |
| `src/read-snapshot.ts` | nuevo: LRU content snapshots |
| `src/anchor-match.ts` | no creado; matching exacto queda cubierto por validación existente + recovery contra snapshot completo |
| `src/merge.ts` | nuevo: deterministic 3-way compose |
| `README.md`/`CONTEXT.md`/`prompts/*` | actualizar contrato |
| `docs/adr/*.md` | nueva ADR recovery |
| `test/**` | actualizar/agregar por fase |

---

## Orden de implementación recomendado

1. Fase 0 baseline + ADR draft.
2. Fase 1 line model + FNV contextual + tests.
3. Remover `xxhashjs` cuando compile sin import.
4. Fase 2.1 raw read + tests.
5. Fase 2.2 diff/render update + tests.
6. Fase 3 snapshot store + hooks + tests.
7. Fase 4 safe merge recovery + tests.
8. Fase 5 docs/prompts/ADR final.
9. Fase 6 package/audit/release.

## Criterio de done

- `npm run check` pasa.
- `npm pack --dry-run` incluye solo archivos esperados.
- No advisories directas pendientes en runtime deps si existe fix compatible.
- README + prompts describen `raw`, hash contextual y recovery real.
- Tests cubren todos los casos listados arriba.
