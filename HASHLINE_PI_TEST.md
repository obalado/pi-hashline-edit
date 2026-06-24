# Manual pi -e smoke test

This repo has a local wrapper extension:

```ts
// my-extension.ts
export { default } from "./index";
```

## 1. Reset sample file

```bash
mkdir -p .tmp
cat > .tmp/hashline-pi-smoke.txt <<'EOF'
alpha
beta
gamma
EOF
```

## 2. Start pi with local extension

```bash
PI_HASHLINE_DEBUG=1 pi -e ./my-extension.ts --no-extensions --no-skills --no-context-files --no-session
```

You should see the extension load. With `PI_HASHLINE_DEBUG=1`, session start shows a `Hashline Edit mode active` notification.

## 3. Ask pi to read sample file

Paste this prompt:

```text
Use read on .tmp/hashline-pi-smoke.txt. Show me the exact output.
```

Expected shape:

```text
1#HH:alpha
2#HH:beta
3#HH:gamma
```

`HH` changes by contextual hash. It must use alphabet `ZPMQVRWSNKTXJBYH`.

## 4. Ask pi to edit using anchor

Copy line 2 anchor from read output, then prompt:

```text
Use edit on .tmp/hashline-pi-smoke.txt to replace line 2 using anchor 2#HH with line content BETA. Use op replace and lines ["BETA"].
```

Expected success text contains:

```text
--- Anchors A-B ---
...
2#HH:BETA
...
```

Verify file:

```bash
cat .tmp/hashline-pi-smoke.txt
```

Expected:

```text
alpha
BETA
gamma
```

## 5. Test stale anchor rejection

Try old line 2 anchor again:

```text
Use edit on .tmp/hashline-pi-smoke.txt with the OLD line 2 anchor from before the edit, replacing it with AGAIN.
```

Expected error starts with:

```text
[E_STALE_ANCHOR]
```

and includes fresh retry lines like:

```text
>>> 2#HH:BETA
```

## 6. Test raw read

Prompt:

```text
Use read on .tmp/hashline-pi-smoke.txt with raw true.
```

Expected raw output has no `LINE#HASH:` prefixes:

```text
alpha
BETA
gamma
```
