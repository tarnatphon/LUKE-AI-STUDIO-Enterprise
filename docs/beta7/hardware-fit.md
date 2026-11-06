# The best fit for this machine

**Command:** `node scripts/tools/luke-hardware-fit.cjs --profile mac-18`
**Catalogs:** `app/config/coding-agent-models.json` (Work) · `app/config/chat-model-fit.json` (Chat)
**Ranking:** `scripts/server/coding-agent-models.cjs` · `scripts/server/chat-model-fit.cjs`
**Related:** [chat-and-work-model-profiles.md](chat-and-work-model-profiles.md) · [code-ai-library-tab.md](code-ai-library-tab.md) · [offline-coding-agents.md](offline-coding-agents.md)

---

## 1. The answer for an 18 GB Mac (M3 Pro class)

14.3 GB is what Metal lets a process map; that, not 18 GB, is the budget.

| Slot | Model | Quant | Weights | Window | Sampling | Why |
| --- | --- | --- | --- | --- | --- | --- |
| **Work** | Qwen2.5-Coder 14B Instruct | Q4_K_M | 9.0 GB | 20 000 | temp 0.2 | trained for tool calls, 3.8 GB left for the app and its KV cache |
| **Chat** | Qwen3.6 27B | UD-IQ2_XXS | 9.4 GB | 8 000 is plenty | temp 0.8 | the most model that fits at all — 27B of reasoning in 9.4 GB, multilingual |

Both downloaded: **18.4 GB of disk**. Only one is resident at a time, so the
memory budget is never "both" — switching tabs reloads, which is the point of
having two slots.

Chat alternatives that also fit, if a 2-bit quant is too lossy for you:

| Model | Weights | Left after load | Trade |
| --- | --- | --- | --- |
| Llama 3.1 8B Instruct Q4_K_M | 4.9 GB | 6.4 GB | safe 4-bit, but English-first |
| Qwen3 4B Q4_K_M | 2.5 GB | 8.8 GB | instant, multilingual, less depth |
| GLM-4.7-Flash 30B-A3B IQ2_M | 11.0 GB | 0.3 GB | *tight* — fits on paper, swaps in practice |

What does **not** fit, and why that matters more than a leaderboard:

| Model | Weights | Needs | Verdict |
| --- | --- | --- | --- |
| Qwen3-Coder 30B-A3B Q4_K_M | 18.6 GB | > 14.3 GB | does not load at all |
| Qwen3-Coder 30B-A3B Q3_K_L | 14.6 GB | > 14.3 GB | weights alone exceed the budget |
| Devstral Small 2 24B Q4_K_M | 15.0 GB | > 14.3 GB | does not load |
| Mistral Small 3.2 24B Q4_K_M | 14.4 GB | 17.4 GB | the best chat model here, on a 24 GB machine |

The 30B class is not "slower on 18 GB" — it is a model that never reaches a
first token. That is the single most useful thing this table says.

---

## 2. How the two halves are computed (and why they differ)

**Work** — `evaluateModel()` in `coding-agent-models.cjs`:

```
pool     = min(systemRam, workingSet)            # 14.3 GB on an 18 GB Mac
headroom = pool − weights − 1.5 GB (compute buffers)
kv/4K    = layers × kv_heads × head_dim × 2 × 1 byte   (or the MLA latent for GLM)
max ctx  = floor(headroom × 0.85 / (kv/4K)) × 4096
verdict  = recommended  if max ctx ≥ 16 384
           tight        if max ctx ≥ 4 096
           too-big      otherwise
```

A coding agent's first request already contains its system prompt and the tool
schemas, so a window under 16K truncates mid-edit. Work therefore *forces* a
window and checks the memory survives it.

**Chat** — `evaluateChatModel()` in `chat-model-fit.cjs`:

```
needed  = weights + 2 GB (compute buffers) + 1 GB (KV for an 8K window)
headroom= pool − needed
slack   = max(0.75 GB, 8% of pool)
verdict = fits  if headroom ≥ slack
          tight if headroom ≥ 0
score   = chatQuality − 8 if the quant is 2-bit
```

Chat carries no tool schemas, so it does not need the same precision — but it
does need slack: a model that leaves 0.3 GB in a 14.3 GB pool looks fine in
arithmetic and stutters in the app, because macOS, the UI and LUKE's own buffers
live in the same pool. That is the difference between `fits` and `tight`, and it
is why GLM-4.7-Flash is not the Chat pick despite the higher raw score.

**Chat quality is ranked per gigabyte, not per leaderboard.** A 27B at 2 bits
scores 70 here; an 8B at 4 bits scores 60; the 24B at 4 bits scores 84 and does
not run at all. Those three numbers in one list is the whole argument.

---

## 3. Other machines

| Profile | Work | Chat |
| --- | --- | --- |
| `mac-18` (14.3 GB) | Qwen2.5-Coder 14B Q4_K_M | Qwen3.6 27B IQ2_XXS |
| `mac-32` (25.6 GB) | Qwen3-Coder 30B-A3B Q4_K_M | Mistral Small 3.2 24B Q4_K_M |
| `pc-24` (24 GB VRAM) | Qwen3-Coder 30B-A3B Q4_K_M | Mistral Small 3.2 24B Q4_K_M |
| `pc-48` (48 GB) | Qwen3-Coder 30B-A3B Q4_K_M | Mistral Small 3.2 24B Q4_K_M |

```bash
node scripts/tools/luke-hardware-fit.cjs                # this machine
node scripts/tools/luke-hardware-fit.cjs --profile mac-18
node scripts/tools/luke-hardware-fit.cjs --ram 18
node scripts/tools/luke-hardware-fit.cjs --ram 32 --working-set 25.6
node scripts/tools/luke-hardware-fit.cjs --json
```

`--working-set` matters on Apple Silicon: without it the tool assumes 80% of RAM
(`14.4 GB` on 18 GB), while the measured value LUKE records from llama.cpp
(`14.3 GB`) is used whenever the server is asked instead
(`GET /api/coding-models`). Both are close; the measured one is the truth.

---

## 4. Applying it

1. **Work** — AI Library → Code AI → *Use for Work* on the recommended card. It
   writes the model, a 20 000-token window and temperature 0.2 into the Work
   slot, then loads it.
2. **Chat** — pick the chat model once in the Chat tab; the pick is saved to the
   Chat slot, so switching tabs never asks again.
3. Nothing is downloaded twice, and only one model is ever resident.

From a shell, the same thing:

```bash
curl -s -X POST http://127.0.0.1:1422/api/text-profiles \
  -H 'content-type: application/json' \
  -d '{"profile":"work","model":"qwen2.5-coder-14b-instruct-q4_k_m.gguf","contextSize":20000,"temperature":0.2}'
curl -s -X POST http://127.0.0.1:1422/api/text-profiles/activate \
  -H 'content-type: application/json' -d '{"profile":"work"}'
```

---

## 5. Verification

- [ ] `node scripts/tools/luke-hardware-fit.cjs --profile mac-18` prints the 14B for Work and the 27B for Chat
- [ ] `--ram 32` changes both answers (30B and Mistral 24B)
- [ ] `--json` is parseable and names the same picks
- [ ] the "does not fit" list includes the 18.6 GB Q4 and the 14.4 GB Mistral
- [ ] in the app, `GET /api/coding-models` names the same Work pick as the CLI

Tests: `node scripts/validation/test-hardware-fit.cjs`.

---

## 6. Boundaries

- **Not a benchmark.** Quality scores are editorial, for this class of machine,
  and stated as such in the catalogs; the fit arithmetic is the part that is
  exact.
- **Sizes are published file sizes**, verified 2026-11-06 against the quantizer's
  repository. A different quantizer's file differs by a few hundred MB.
- **One machine at a time.** The numbers describe a model loaded alone; LUKE
  unloads the other slot before loading this one.
- **The catalog is the source of truth.** Changing a recommendation means editing
  a catalog entry with evidence, not editing this page.
