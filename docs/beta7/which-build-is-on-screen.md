# "I rebuilt it and the new tab is still not there"

**Command:** `node scripts/tools/luke-which-build.cjs`
**In the app:** a warning card at the top of AI Library when what is on screen is older than what is on disk
**Related:** [code-ai-library-tab.md](code-ai-library-tab.md) · [frontend-build-self-heal.md](frontend-build-self-heal.md)

---

## 1. Four causes, one symptom

A missing tab looks the same in all four cases. They have completely different
fixes, which is why guessing costs an afternoon:

| What is true | What you see | Fix |
| --- | --- | --- |
| The checkout is older than the feature | no new tab, anywhere | `git fetch && git switch <branch> && git pull` |
| `app/dist` was never rebuilt | source has it, the app does not | `npm --prefix app/frontend run build` |
| The server on :1420 runs from **another folder** | you edit one copy, the other one serves | start the app from the folder you are editing |
| The bundle is current, the browser is not | the tab is in `app/dist` and still not on screen | hard reload (a service worker caches the shell) |

`app/dist` is the important one: the server sends the **built** bundle. Editing
`app/frontend/src` changes nothing until it is built, which is exactly what
"แตะไฟล์แล้วยังไม่ขึ้น" almost always means.

---

### 2.0 `Cannot find module ... luke-which-build.cjs`

That message means the command was run somewhere that is **not the checkout** —
a models drive, a volume with only weights on it, or an older clone that predates
the file. It says nothing about the app. Find the folder the app really runs
from:

```bash
curl -s http://localhost:1420/api/health | python3 -c \
  'import json,sys; d=json.load(sys.stdin); print(d["root"]); print(d["source"]["shortCommit"], "→", d["frontend"]["shortCommit"], "stale:", d["frontend"]["stale"])'
```

That prints the folder the server loaded from and whether its bundle matches the
checkout. Then run the doctor from there — or from anywhere, with `--root`:

```bash
node /path/to/LUKE/scripts/tools/luke-which-build.cjs --root /Volumes/AI
```

If `/Volumes/AI` is only where models are stored, the verdict says
*"is not a LUKE checkout"* and prints the app's real root instead of pretending
to diagnose a bundle that is not there.

## 2. The doctor

```bash
node scripts/tools/luke-which-build.cjs
node scripts/tools/luke-which-build.cjs --port 1422
node scripts/tools/luke-which-build.cjs --feature "AI Library"
node scripts/tools/luke-which-build.cjs --root /Volumes/AI     # another folder
node scripts/tools/luke-which-build.cjs --json
```

```
checkout       /Users/you/LUKE-AI-STUDIO-Enterprise
               arena/c58b4d5e… @ 7cabe02 — AI Library: a Code Models (GGUF) tab…
app/dist       built from 46d7cba · contains "Code Models (GGUF)"
server         http://127.0.0.1:1420 · root=/Users/you/LUKE-AI-STUDIO-Enterprise
               source=7cabe02 · bundle=46d7cba · stale=true · restartRequired=false

VERDICT        The bundle is older than the checkout.
               bundle 46d7cba · checkout 7cabe02

DO THIS
  npm --prefix app/frontend run build
  Restart the app, then hard-reload the page
```

It compares four things and stops at the first one that explains the symptom:

1. **is a server listening** at that port, and is its `root` this folder?
2. **does `app/dist` contain the marker string** — the tab's own label? If the
   string is not in the served JavaScript, no reload will ever produce the tab.
3. **is the server handing out the bundle that is on disk** (same
   `assets/index-*.js`)? If not, the server is serving another build.
4. **`/api/health`** → `frontend.stale` (bundle older than checkout) and
   `restartRequired` (the backend process loaded an older commit than the
   checkout — new endpoints 404 until it restarts).

`--feature` takes any string that only exists in the new UI, so this works for
future features too, not just this one.

---

### 2.1 "timed out" is not "not running"

The probe waits 8 s by default. A port that accepts a connection but does not
answer means the app **is** there and is still starting (a first boot after a pull
scans models, repairs the bundle and warms the runtime) — restarting it mid-boot
makes things worse. The doctor says so, and offers:

```bash
node scripts/tools/luke-which-build.cjs --timeout 20
lsof -nP -iTCP:1420 -sTCP:LISTEN     # who owns the port
```

`connection refused` is the different case: nothing is listening at all.

## 3. In the app

When `/api/health` says the bundle is older than the checkout, AI Library shows a
card above the tabs:

> **This screen is older than the app on disk** — the interface was built from
> `46d7cba`, but this folder is at `7cabe02`. A tab added since then cannot
> appear until the frontend is rebuilt.
> `npm --prefix app/frontend run build → restart the app → hard reload`
> **[Reload UI]**

**Reload UI** unregisters the service worker (DevTools → Application →
Service Workers → Unregister does the same by hand) and reloads, which is the fix
for the one case the build cannot solve by itself. If the *backend* is the stale
half, the same card says so instead ("the server is older than the app on disk")
and its advice is to restart the app.

The card is deliberately small and only appears when the numbers actually
disagree: `frontend.stale` is unknown for a bundle without a stamp, and unknown
is not the same as stale.

---

## 4. Why this is not just a message

- `frontend.commit` vs `source.commit` is read by `/api/health` on every request
  (15 s cache), so a `git pull` while the app runs is noticed immediately.
- The bundle's stamp is written by `vite.config.js` at build time; two builds of
  the same commit are byte-identical, which is what
  `test-frontend-dist-freshness.cjs` relies on.
- The doctor's verdicts are unit-tested (`test-build-doctor.cjs`) against all
  four causes rather than being prose in a document.

---

## 5. Verification

- [ ] `node scripts/tools/luke-which-build.cjs` prints a verdict, not a wall of JSON
- [ ] with the app stopped, it says `No LUKE server answered` and how to start one
- [ ] after `npm --prefix app/frontend run build`, `app/dist` line says the marker is present
- [ ] `/api/health` → `frontend.stale: false` once the bundle matches the checkout
- [ ] the AI Library card disappears when `stale` is false

Tests: `node scripts/validation/test-build-doctor.cjs`.
