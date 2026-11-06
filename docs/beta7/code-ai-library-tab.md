# AI Library → Code AI

**Status:** shipped in this branch · **Where:** AI Library → top tab *Code Models (GGUF)*, or the *Code AI* section chip
**Files:** `scripts/server/coding-agent-models.cjs` (ranking) · `app/config/coding-agent-models.json` (catalog) · `GET /api/coding-models` · `app/frontend/src/components/ModelManager.jsx`
**Related:** [offline-coding-agents.md](offline-coding-agents.md) · [chat-and-work-model-profiles.md](chat-and-work-model-profiles.md)

---

## 1. Why the library needed a code tab

The AI Library already had Text, Vision, Open Models, Video and Cloud. What it
did not have was the one section whose answer depends on the machine: **which
coding model can actually drive an agent here**.

That is a different question from "which text model should I chat with". A
coding model has to:

1. **call tools** — a chat template with function calling, or the agent writes
   `read_file({...})` as prose and never touches a file;
2. **fit beside its own KV cache** — an agent's first request already carries a
   large system prompt and tool schemas, so a 4K window is not a coding window;
3. **fit at all** — on an 18 GB Mac only 14.3 GB is addressable by Metal, so an
   18.6 GB file is not "slower", it does not load.

A leaderboard cannot answer any of that. The Code AI tab can, because every
entry is measured against *this* machine.

---

### Where it is in the UI

The library's top row is Image / Text / **Code** / Speech / TTS. Code models are
GGUF models — the same llama.cpp runtime, the same `app/llm-models` folder, the
same download, delete and load path — so the Code tab does not invent a fifth
runtime. It puts that runtime in front of the coding catalog:

```
Image Models (SD) │ Text Models (GGUF) │ Code Models (GGUF) │ Speech │ TTS
                                        └─ textLibraryMode = "code"
```

Clicking it selects the GGUF runtime *and* the Code AI section, which is also
reachable as a chip inside Text Models (Text AI / **Code AI** / Vision AI / Open /
Video / Cloud / Installed). The heading changes to **Code Model Library** while it
is open, and every GGUF already in `app/llm-models` gets a **Use for Work** button
next to Load and Delete — so an existing file does not have to be re-downloaded
to become the agent's model.

## 2. What it shows

| Column on the card | Where it comes from |
| --- | --- |
| Fits this machine / Tight / Needs more memory | `verdict` from `evaluateModel()` |
| Weights | published file size of that quant (catalog, verified 2026-11-06) |
| Window | `contextTokens` — what fits, not the model's theoretical maximum |
| KV per 4K tokens | arithmetic: `layers × kv_heads × head_dim × 2 × 1 byte`, or the MLA latent |
| Quality | editorial 0–100 for *agent* work, tool-call reliability first |
| Tool calling / licence / params | catalog fields; every entry must be tool-capable to be listed |
| Download / Downloaded | the file, and the mirror, checked on disk |

The three verdicts are the whole point:

- **Fits this machine** — weights + a 16K-or-bigger KV cache + a 1.5 GB GPU
  buffer fit the memory that is really addressable.
- **Tight — small window** — it loads, but the window that fits is under 16K, so
  the agent will truncate.
- **Needs more memory** — no window worth having fits. Listed last, still
  visible, so the gaps are honest instead of hidden.

On an 18 GB Mac (14.3 GB usable) the order is: Qwen2.5-Coder 14B Q4_K_M
(recommended, 20K window), Qwen2.5-Coder 7B Q6_K, GLM-4.7-Flash IQ2_M, and then
Qwen3-Coder 30B at Q4_K_M **as too big** at 18.6 GB. On a 64 GB machine the 30B
Q4_K_M becomes the recommendation — the tab is per machine, not a fixed list.

---

## 3. The two buttons

**Download** — the same pipeline as every other text model:
`POST /api/llm/download-model`, the same progress bar, cancel, overwrite
confirmation and storage location. Nothing about the download is special-cased.
A model with no verified file in the catalog (currently Devstral Small 2) is not
given a guessed URL: the button says *Search Hugging Face* and tells you the
query.

**Use for Work** — appears once the file is on disk. It writes the model into
the **Work slot** (`POST /api/text-profiles`) with the window the arithmetic
recommended and `temperature: 0.2`, then activates it
(`POST /api/text-profiles/activate`). So the model that the tab just proved fits
is the model Work runs on, without hunting for it in the picker afterwards. Chat
keeps its own model — see [chat-and-work-model-profiles.md](chat-and-work-model-profiles.md).

---

## 4. Endpoint

```http
GET /api/coding-models
GET /api/coding-models?systemRamGb=64     # re-rank for a hypothetical machine
```

```json
{
  "ok": true,
  "machine": { "id": "detected", "label": "this machine (18.0 GB, 14.3 GB usable)",
               "systemRamGb": 18, "workingSetGb": 14.3, "source": "measured" },
  "catalogVersion": "1.0.0",
  "verifiedAt": "2026-11-06",
  "backend": { "engine": "llama.cpp", "pinnedRelease": "b9668", "requiresJinja": true },
  "pick": { "id": "qwen2.5-coder-14b-q4_k_m", "verdict": "recommended", "contextTokens": 20000 },
  "models": [
    {
      "id": "qwen2.5-coder-14b-q4_k_m",
      "name": "Qwen2.5-Coder 14B Instruct — Q4_K_M",
      "verdict": "recommended",
      "weightGb": 9, "kvGbPer4096": 1.05, "contextTokens": 20000, "maxContextTokens": 32768,
      "quality": 62, "riskLevel": "low", "toolCalling": true, "license": "Apache-2.0",
      "download": { "url": "https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/qwen2.5-coder-14b-instruct-q4_k_m.gguf",
                    "filename": "qwen2.5-coder-14b-instruct-q4_k_m.gguf", "sizeGb": 9,
                    "mirrorFilename": "Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf" },
      "installed": ""
    }
  ]
}
```

`installed` is the file name found in the model library (primary or mirror), or
`""`. The URL is **built from the catalog's own repo+file**, so the download and
the recommendation can never drift apart, and the browser never supplies the
thing the server fetches.

`systemRamGb` is a ranking override (used by tests and by the CLI parity check);
without it the server reads `os.totalmem()` and the *measured* working set from
`memoryCalibration`, not 80% of RAM.

---

## 5. Where the models come from

`app/config/coding-agent-models.json` — the same catalog
`scripts/tools/luke-coding-models.cjs` prints and
`docs/beta7/offline-coding-agents.md` §3.2 documents. Adding a model means
adding a catalog entry (with its size, layers, KV heads, licence, tool-calling
evidence and a verified repo+file), not editing the UI. The suite fails if an
entry claims to be installable without a well-formed
`https://huggingface.co/<repo>/resolve/main/<file>.gguf` whose basename matches
the filename the server will store.

---

## 6. Verification

- [ ] AI Library → **Code Models (GGUF)** opens the coding catalog (heading: Code Model Library)
- [ ] Text Models (GGUF) goes back to the general library, and the *Code AI* chip inside it opens the same view
- [ ] an already-downloaded GGUF in the local list has a *Use for Work* button
- [ ] the hero names the recommendation for this machine
- [ ] an 18 GB Mac lists the 14B as *Fits this machine* and the 30B Q4 as *Needs more memory*
- [ ] `GET /api/coding-models?systemRamGb=64` promotes the 30B Q4 to the pick
- [ ] Download starts, shows the same progress bar as a text model, and ends with *Downloaded*
- [ ] *Use for Work* on a downloaded model makes it the Work slot (visible in the banner above the composer in the Work tab)
- [ ] Devstral's card offers *Search Hugging Face* instead of inventing a URL

Tests: `node scripts/validation/test-code-model-library.cjs` — the ranking, the
URL invariants, installed detection (including mirrors), the route wiring, the
tab wiring, this document, and the live endpoint on a throwaway checkout.

---

## 7. Boundaries

- **Not a leaderboard.** A model that is better on paper but does not fit is
  listed last and labelled, never recommended.
- **Quant risk is stated, not hidden.** A 2-bit quant that mangles tool calls
  appears with `higher-risk quant` and a lower rank even when its quality score
  is higher.
- **One model resident.** Downloading three coding models is fine; loading two at
  once is not. The Work slot keeps one.
- **Direct downloads, not the curated catalog queue.** Entries link to the
  publisher's own repository; the signed-catalog/publisher allowlist
  (`app/config/text-models/catalog-policy.json`) still governs the curated text
  catalog, and widening that is a separate decision.
