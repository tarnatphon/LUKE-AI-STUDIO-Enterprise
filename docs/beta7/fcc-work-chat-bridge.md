# Free Claude Code as a cloud brain for Work chat

**Status:** shipped in this branch · **Applies to:** macOS (`/Volumes/AI`), Linux, Windows
**Related:** [free-claude-code](https://github.com/alishahryar1/free-claude-code) · `scripts/server/remote-text-provider.cjs` · Settings → Cloud brain (Work)

---

## 1. The theory, and what it means here

Free Claude Code (FCC) is not a model. It is a **local proxy**: one HTTP server on
your own machine that owns the provider catalogue, the keys, the retries, the
rate limits and the fallback list. A client speaks one protocol to one socket;
FCC decides which free provider actually answers.

LUKE AI STUDIO already applies the same idea in Work mode
(`scripts/server/remote-text-provider.cjs`): a chain of free cloud brains tried
in order, with **the local GGUF model as the last link**, so a spent quota never
loses a turn. This integration adds FCC as one more link — the smart one — in
front of that chain:

```
Work turn (TextChat → Work tab)
        │
        ▼
  /api/llm/chat   (scripts/server/serve.cjs)
        │
        ▼
  1. Free Claude Code  ── 127.0.0.1:8082/v1/messages ──► 61 providers, FCC's own fallbacks
        │ (not running / quota / model refused / error)
        ▼
  2. NVIDIA NIM → OpenRouter :free → Z.ai   (keys you saved in Settings)
        │ (whole chain spent)
        ▼
  3. local llama.cpp GGUF model (unchanged)

Chat tab  ──────────────────────────────► local model only, always
```

**The one real obstacle:** FCC exposes **Anthropic Messages**
(`POST /v1/messages`) and OpenAI Responses (`POST /v1/responses`). It does **not**
serve `/v1/chat/completions`, which is what LUKE's cloud chain used to send.
Pasting `http://127.0.0.1:8082/v1` into an OpenAI-shaped client therefore fails
with a 404. FCC also needs **no API key** unless you switch on its own Proxy
Authentication. Both differences are handled in code:

| Difference | Where it is handled |
| --- | --- |
| `/v1/messages` instead of `/chat/completions` | `PROVIDERS.fcc.endpoint`, `remoteEndpoint()` |
| Anthropic body: `system` outside `messages`, alternating turns, `max_tokens` required | `buildRemotePayload()` — `apiFormat: "anthropic-messages"` |
| Anthropic SSE (`content_block_start`, `content_block_delta`, `error`) | `extractDelta()`, `extractStreamError()` |
| `x-api-key` + `anthropic-version`, no bearer key | `remoteHeaders()` |
| Keyless connect, optional proxy token | `setLocalProvider()`, `isConnected()`, `hasCloudBrain()` |
| Loopback-only URL (no SSRF) | `parseBaseUrl()`, `localBaseUrlOrThrow()` |
| FCC not running → still try the next link | `code: "unreachable"` + `isRetryable()` |

FCC's `/v1/models?view=messages` is used for **List models**, so the ids shown
in Settings are ids FCC will actually route.

---

## 2. Get the code on the Mac

After this branch is merged into `main` (the branch you pull on the Mac):

```bash
cd /Volumes/AI/LUKE-AI-STUDIO-Enterprise
git fetch origin
git checkout main
git pull --ff-only
cd app/frontend && npm install && npx vite build
cd ../..
./mac.sh
```

> `app/dist/` is gitignored. **Always rebuild the frontend after `git pull`** or
> the new "Free Claude Code (this machine)" card will not appear in Settings.
>
> zsh on this Mac does not enable `interactivecomments` by default — do not
> paste a command with a Thai comment after `#` on the same line.

---

## 3. Install and start Free Claude Code (once)

FCC is a separate program installed under `~/.fcc/` with Python/uv. Nothing is
copied into the LUKE repo.

```bash
curl -fsSL "https://raw.githubusercontent.com/Alishahryar1/free-claude-code/main/scripts/install.sh" | sh
```

When the installer asks, choose at least one coding agent (or skip; LUKE only
needs the server). Then start the server on the Mac — either open **Free Claude
Code** from Applications, or keep a Terminal window open with:

```bash
fcc-server
```

Verify it answers before touching LUKE:

```bash
curl -s http://127.0.0.1:8082/health
# {"status":"healthy"}

curl -s http://127.0.0.1:8082/v1/models | head -c 300
```

Open the Admin UI printed in the server log (normally
`http://127.0.0.1:8082/admin`) and:

1. **Providers** → add a key for a free provider (the README recommends NVIDIA
   NIM: `build.nvidia.com → API keys`).
2. **Model Config** → pick `MODEL` (e.g.
   `nvidia_nim/nvidia/nemotron-3-ultra-550b-a55b`) and optionally an ordered
   **Fallback Models** list. FCC retries and falls back on its own — LUKE does
   not need to know which provider it landed on.
3. **Optional — security:** FCC binds to `0.0.0.0` by default. Either set
   `HOST=127.0.0.1` in `~/.fcc/.env`, or turn on **Proxy Authentication** in
   Admin and paste that same token into LUKE's **Proxy token** field. If you
   change `PORT`, change the URL in LUKE Settings too (or set
   `LUKE_FCC_BASE_URL` before starting `./mac.sh`).

Useful `~/.fcc/.env` keys: `HOST`, `PORT`, `PROXY_AUTH_ENABLED`,
`ANTHROPIC_AUTH_TOKEN`. Restart `fcc-server` after editing them.

---

## 4. Connect it inside LUKE

1. Open LUKE → **Settings** → **Cloud brain (Work)** → expand.
2. Find **Free Claude Code (this machine)**.
3. **Local proxy URL:** `http://127.0.0.1:8082/v1` (default). Only
   `127.0.0.1`, `localhost` or `::1` is accepted — a LAN/public URL is refused.
   The URL is saved in `app/runtime-state/text-chat/remote-text-provider.json`
   (mode `0600`, gitignored).
4. **Proxy token:** leave empty unless Proxy Authentication is on in FCC Admin.
   It is stored with the other secrets and never shown back.
5. Press **Connect (no key)** → the card becomes **link 1**. Press **Test**; it
   should say `answered through …`. Press **List models** if you want to force a
   specific FCC model id instead of letting FCC's `MODEL` decide.
6. Leave **"When every provider is spent, finish the turn on the local model"**
   ticked. That is the whole point of the theory: no quota can take your chat
   away.

**Which model name to put in the Model field**

| Value | What FCC does |
| --- | --- |
| `claude-sonnet-4-20250514` (default) | A Claude tier name → FCC maps it to the `MODEL` / `MODEL_SONNET` you chose in Admin, plus its fallback list. **Recommended**: change models in one place (FCC Admin). |
| `nvidia_nim/nvidia/nemotron-3-ultra-550b-a55b` | A direct `<provider>/<model>` ref → FCC routes to exactly that provider/model. Useful for pinning one. |
| Anything from **List models** | FCC's `view=messages` catalogue of routable ids. |

---

## 5. Use it in chat

In the sidebar choose the **Work** tab (not **Chat**) and send a message. Work
turns go to the chain; the **Chat** tab still goes straight to the local GGUF
model and never leaves this machine — no setting changes that.

The final SSE frame of a cloud answer carries
`cloud: { provider: "fcc", model: "…" }`, so you can see which link answered.

---

## 6. Verification checklist on the Mac

- [ ] `curl -s http://127.0.0.1:8082/health` → `{"status":"healthy"}`
- [ ] Settings shows **Free Claude Code (this machine)** → **connected**, **link 1**
- [ ] **Test** answers `answered through …` (no key saved)
- [ ] Work tab: ask "reply with the single word: ready" → answer arrives
- [ ] Quit `fcc-server` → Work turn still answers (from NVIDIA NIM if a key is
      saved, otherwise from the local model) instead of hanging; with local
      fallback off, the message names "start fcc-server"
- [ ] Turn FCC's Proxy Authentication **on** without pasting the token → Test
      says to paste the proxy token; paste it → Test passes again
- [ ] Try `http://192.168.1.20:8082/v1` in the URL field → refused with a clear
      message (loopback only)
- [ ] Switch back to the **Chat** tab → no request appears in FCC's log

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `Free Claude Code … is not running at … Start fcc-server` | FCC is not up, or `PORT` was changed. Check `/health`, then fix the URL in Settings. |
| `refused the proxy token` | Proxy Authentication is on in FCC Admin. Paste its token into **Proxy token**, or turn it off if FCC only listens on loopback. |
| `does not route that model` | The model id is not in FCC's catalogue. Press **List models** or restore a Claude tier name so FCC uses its configured `MODEL`. |
| Test passes but Work answers from NVIDIA NIM | FCC is connected but was skipped (unreachable / quota / error). The turn still went through the chain — read the failure list in the message when fallback is off. |
| `404` at `/v1/chat/completions` | Something is calling FCC as if it were OpenAI Chat Completions. LUKE sends `/v1/messages`; check that `apiFormat` is `anthropic-messages` for the `fcc` provider. |
| New card missing in Settings | `app/dist/` was not rebuilt after `git pull`. Run `cd app/frontend && npm install && npx vite build`. |
| Different port without editing Settings | Start the app with `LUKE_FCC_BASE_URL=http://127.0.0.1:9000/v1 ./mac.sh`. |

---

## 8. Boundaries worth knowing

- **Offline claim:** LUKE stays offline for Chat, image, Whisper and Kokoro. The
  Work chain is an explicit opt-in that calls the internet — either directly to
  NVIDIA/OpenRouter/Z.ai or through FCC on localhost.
- **Free tiers rotate.** A provider can start charging, vanish or rate-limit at
  any time. That is why the chain, FCC's own fallbacks and the local model still
  exist. FCC documents that it follows provider terms of service and removes
  integrations that stop being allowed.
- **Licensing:** FCC is **AGPL-3.0**, LUKE is MIT. No FCC code is vendored here;
  LUKE only makes HTTP requests to a program the user installed separately. Do
  not copy FCC source into this repository.
- **Keys:** provider keys live in FCC's `~/.fcc/` config. LUKE stores only its
  own optional proxy token and the existing cloud keys, mode `0600`, gitignored.
- **Tests:** `node scripts/validation/test-remote-provider-fcc.cjs` drives a
  stand-in FCC over a real socket (Anthropic SSE, keyless connect, URL guard,
  failover). `test-remote-text-provider.cjs` and `test-remote-provider-chain.cjs`
  still cover the original chain.
