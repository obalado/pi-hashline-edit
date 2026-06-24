# pi-hashline-context-edit Context

## Domain

`pi-hashline-context-edit` is a Pi extension fork of `pi-hashline-edit` that replaces the built-in `read` and `edit` tools with hashline-anchored text editing.

## Core terms

- Hashline: model-visible line prefix `LINE#HH:` where `HH` is a 2-character contextual hash.
- Anchor: `LINE#HH` token copied from normal `read` output and used by `edit` as stable edit position.
- Changed response: `edit` success text that returns only fresh anchors around affected lines.
- Details: host-only structured metadata. Model-facing text must not rely on `details` for next action.
- Canonical request: normalized edit request `{ path, edits }` after dialect convergence.

## Architecture invariants

- Runtime never relocates stale anchors or autocorrects malformed diffs; 3-way recovery may only compose deterministic non-overlapping edits from a stored normal-read snapshot.
- `normalizeEditRequest` is sole dialect-convergence layer for native Pi edit shapes and JSON-string edits.
- `assertEditRequest` validates only public request envelope; `resolveEditAnchors` owns per-edit validation.
- Successful edits return fresh anchors in text; broad file/range payloads require normal `read`.
- `read(raw: true)` is inspection-only: no hashline prefixes and no recovery snapshot update.
- All writes go through `writeFileAtomically`.
