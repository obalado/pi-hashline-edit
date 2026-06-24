![pi-hashline-edit](assets/banner.jpeg)

# pi-hashline-edit

A [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that replaces the built-in `read` and `edit` tools with a hash-anchored line-editing workflow.

## Fork notice

This project is a fork of `pi-hashline-edit`, itself inspired by [oh-my-pi](https://github.com/can1357/oh-my-pi). This fork keeps the strict hashline editing contract and adds v0.8 changes focused on safer stale-context detection, optional raw reads, and deterministic stale-anchor recovery.

Notable fork changes:

- Contextual FNV-1a hashes: anchors now include line number plus previous/current/next visible line context, so changing one line invalidates nearby stale anchors.
- Removed `xxhashjs`; hashing is inline and dependency-free.
- Added `read({ raw: true })` for unanchored inspection/token-saving output.
- Added normal-read snapshot cache and safe 3-way stale-anchor merge recovery for non-overlapping external file changes.
- Updated diff previews and edit success anchors to compute hashes against the full post-edit file context.
- Updated docs, prompts, ADRs, tests, and package metadata for v0.8.

Every line returned by normal `read` carries a short contextual hash. Edits reference these hashes instead of raw text, so the tool can detect stale context and reject outdated changes before they reach the file.

## Installation

```bash
# From npm
pi install npm:pi-hashline-edit

# From a local checkout
pi install /path/to/pi-hashline-edit
```

## How It Works

### `read` — tagged line output

Text files are returned with a `LINE#HASH:` prefix on every line. Line numbers may be left-padded within each returned block so the `#HASH:` columns align:

```text
 8#VR:function hello() {
 9#KT:  console.log("world");
10#BH:}
```

- `LINE` — 1-indexed line number.
- `HASH` — 2-character contextual hash from the alphabet `ZPMQVRWSNKTXJBYH`.

Optional parameters:
- `offset` — start reading from this line number (1-indexed).
- `limit` — maximum number of lines to return.
- `raw` — return raw file lines without `LINE#HASH:` prefixes. Use this for inspection/token saving only; use normal `read` before anchor edits.

Images (JPEG, PNG, GIF, WebP) are passed through as attachments and do not participate in the hashline protocol. Binary and directory paths are rejected with a descriptive error. Empty files return an advisory suggesting `prepend`/`append` instead of a synthetic anchor.

### `edit` — hash-anchored modifications

Edits use the `LINE#HASH` anchors from `read` output to target lines precisely:

```json
{
  "path": "src/main.ts",
  "edits": [
    { "op": "replace", "pos": "11#KT", "lines": ["  console.log('hashline');"] }
  ]
}
```

| Op | Purpose | Fields |
|---|---|---|
| `replace` | Replace one line (`pos`) or an inclusive range (`pos` + `end`). | `pos` required, `end` optional, `lines` |
| `append` | Insert lines after `pos`. Omit `pos` to append at EOF. | `pos` optional, `lines` |
| `prepend` | Insert lines before `pos`. Omit `pos` to prepend at BOF. | `pos` optional, `lines` |
| `replace_text` | Replace an exact unique substring anywhere in the file. Fails if the text is not found or matches more than once. | `oldText`, `newText` |

All edits in a single call validate against the same pre-edit snapshot and apply bottom-up, so line numbers stay consistent across operations.

### Chained edits

After a successful edit in the default `changed` return mode, the result text includes an `--- Anchors A-B ---` block with fresh `LINE#HASH` references for the changed region. These can be used directly in the next `edit` call on the same file without a full re-read, provided the next edit targets the same or nearby lines. For distant changes, use `read` first.

### Diff preview

The full diff is stored in `details.diff` for the host UI. The model-visible text stays compact and focuses on fresh anchors, warnings, and retry guidance.

## Design Decisions

- **Stale anchors fail or merge safely.** A hash mismatch means the file has changed since the last `read`. If the last normal `read` snapshot is available and the requested edit does not overlap current file changes, the edit may be merged with warning `[W_MERGED_STALE_ANCHORS]`. Otherwise the error includes fresh `LINE#HASH` retry snippets.
- **No fallback relocation.** Mismatched anchors are never silently relocated to a "close enough" line. Merge recovery composes non-overlapping changes only; conflicts still fail.
- **Strict patch content.** If `lines` contains `LINE#HASH:` display prefixes or diff `+`/`-` markers, the edit is rejected with `[E_INVALID_PATCH]`. The model must send literal file content; the runtime does not silently strip accidental prefixes.
- **Native edit normalization.** When a caller sends a top-level `oldText`/`newText` payload (the built-in edit format), the request is normalized into `op: "replace_text"` and uses the same strict exact-unique-match semantics as any other `replace_text` edit. Inexact or non-unique matches are rejected; there is no fuzzy legacy fallback or separate compatibility notifier.
- **Atomic writes.** Files are written via temp-file-then-rename to avoid corruption from interrupted writes. Symlink chains are resolved so the target file is updated without replacing the symlink. Hard-linked files are updated in place to preserve the shared inode. File permissions are preserved across atomic renames.
- **Per-file mutation queue.** Edits queue by the canonical write target, so concurrent edits through different symlink paths still serialize onto the same underlying file.

## Hashing

Hashes use an inline FNV-1a 32-bit hash over line number plus neighboring context:

```text
lineNumber \0 previousLine \0 currentLine \0 nextLine
```

The low byte maps to a 2-character string from the custom alphabet `ZPMQVRWSNKTXJBYH`, which excludes hex digits, common vowels, and visually ambiguous letters (D/G/I/L/O). A reference like `5#MQ` stays compact and unambiguous.

Because hashes include previous and next visible lines, changing one line also invalidates anchors for its immediate neighbors. This catches common line-shift/stale-context mistakes while keeping anchors short.

## Development

Requires [Node.js](https://nodejs.org) and npm.

```bash
npm install
npm test
```

Set `PI_HASHLINE_DEBUG=1` to show an "active" notification at session start.

## Credits

Thanks to [can1357](https://github.com/can1357) for the original [oh-my-pi](https://github.com/can1357/oh-my-pi) implementation and the hashline concept.

## License

[MIT](LICENSE)
