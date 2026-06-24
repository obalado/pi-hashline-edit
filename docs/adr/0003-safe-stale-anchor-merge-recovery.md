# ADR 0003: Allow deterministic stale-anchor merge recovery

## Status

Accepted

## Context

Contextual hashes intentionally make anchors go stale when neighboring lines change. This catches line-shift mistakes, but it can also reject edits that are still semantically safe: the requested edit targets one base range while an external process changed a non-overlapping base range.

Older invariants said all stale anchors fail. That maximized safety but forced unnecessary retries for independent changes.

## Decision

Allow stale-anchor recovery only when all conditions hold:

1. A stored snapshot from a normal (non-raw) `read` exists for the canonical file path.
2. The full edit request validates and applies against that snapshot.
3. A deterministic 3-way compose of `snapshot -> snapshotEdited` with `snapshot -> current` succeeds.
4. Edited ranges and current ranges do not overlap or target the same insertion boundary.

No fuzzy relocation is allowed. If any step is ambiguous or conflicting, return the original `[E_STALE_ANCHOR]` with current retry anchors.

Successful recovery emits visible warning `[W_MERGED_STALE_ANCHORS]`.

## Consequences

- Safe independent changes can be merged without a full re-read/retry loop.
- Stale-anchor behavior remains conservative for conflicts and repeated-context ambiguity.
- Normal `read` stores recovery snapshots; `read(raw: true)` does not.
- Successful `edit` updates the stored snapshot so chained anchors remain usable.
