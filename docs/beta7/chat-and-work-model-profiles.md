# Chat and Work keep separate models

**Status:** shipped in this branch · **Applies to:** macOS, Linux, Windows
**Files:** `app/config/text-profiles.json` (defaults) · `app/runtime-state/text-profiles.json` (your choice) · `scripts/server/text-profiles.cjs` · `docs/beta7/offline-coding-agents.md`

---

## 1. Why one model cannot do both jobs

Until now there was one text model, and it had to be two things at once:

- **Work** needs a model trained to *call tools*, served cold (temperature ~0.2),
  with the largest window the machine can hold — a coding agent's own prompt and
  tool schemas eat most of it before a file is read.
- **Chat** needs none of that. It wants a conversational model, wider sampling,
  and a window that leaves room for the GPU.

Pick a 30B coder to make Work usable and Chat is answered by a terse code model
at 0.2 — ask it for a poem and it writes a docstring. Pick a chat model and Work
stops calling tools: it writes `read_file({"path": …})` as prose, which is the
whole reason the "this model is too small for tools" warning exists.

So there are two slots now. Each stores **its own model, window, temperature and
top-p**, and only one of them is loaded at a time — an 18 GB Mac cannot hold two
GGUFs, and pretending otherwise is how swap storms start.

```
        Chat tab                              Work tab
            │                                     │
            ▼                                     ▼
  slot "chat"                          slot "work"
  model: any chat GGUF                 model: a coding GGUF (tool calling)
  ctx 8192 · temp 0.80                 ctx 20000 · temp 0.20
            │                                     │
            └──────────────┬──────────────────────┘
                           ▼
             POST /api/text-profiles/activate
                           ▼
        llama-server (one process, one GGUF, port 10086)
```

Switching tabs is what triggers the swap: `switched: false` when the right model
is already resident, `switched: true` when it had to load. Both slots naming the
same GGUF is allowed (and is what a small machine should do) — then nothing ever
reloads.

---

## 2. Defaults

| Slot | Model | Context | Temperature | Top-p | Tool calling |
| --- | --- | --- | --- | --- | --- |
| `chat` | *(you pick)* | 8192 | 0.80 | 0.95 | not required |
| `work` | *(you pick)* | 20000 | 0.20 | 0.95 | **required** |

No default model is invented: a slot with no model is inert, and activation
refuses with `NO_PROFILE_MODEL` rather than loading something the machine may not
have. That also means this feature changes nothing until you use it.

`work` carries the two rules that make an agent work, as numbers rather than
prose: `minContextTokens: 16384` and `maxTemperature: 0.6`. Configuring outside
them is allowed and returns a warning explaining what will go wrong.

---

## 3. API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/text-profiles` | both slots, what is resident, which slot is active, warnings |
| POST | `/api/text-profiles` | save one slot: `{profile, model, contextSize, temperature, topP}` |
| POST | `/api/text-profiles/activate` | make that slot resident (loads/swaps the GGUF) |

```bash
curl -s http://127.0.0.1:1420/api/text-profiles

curl -s -X POST http://127.0.0.1:1420/api/text-profiles \
  -H 'content-type: application/json' \
  -d '{"profile":"work","model":"qwen2.5-coder-14b-instruct-q4_k_m.gguf","contextSize":20000,"temperature":0.2}'

curl -s -X POST http://127.0.0.1:1420/api/text-profiles/activate \
  -H 'content-type: application/json' -d '{"profile":"work"}'
# {"ok":true,"profile":"work","switched":true,"model":"…","port":10086,"settings":{…}}
```

`GET` answers with the slots, the resident engine and warnings:

```json
{
  "ok": true,
  "profiles": { "chat": {…}, "work": {…} },
  "resident": { "model": "…", "port": 10086, "ready": true, "toolCalling": true, "contextSize": 20000 },
  "activeProfile": "work",
  "warnings": { "chat": [], "work": [] }
}
```

`warnings` is per slot (`{chat, work}`); a `POST` also returns `slotWarnings` —
the warnings produced by the slot you just wrote.

Warning codes: `no-model`, `small-context`, `warm-sampling`, `no-tool-calling`.

**Validation is not cosmetic.** The value travels from the browser into a file the
server opens, so `normalizeModel()` accepts only a `.gguf` *file name*: a path
(`../../secrets.gguf`) is reduced to its base name and a non-GGUF is refused with
`400`. Context is clamped to 512–262144, temperature to 0–2, top-p to 0.01–1.

---

## 4. In the app

- Switching between **Chat** and **Work** activates that slot; the model picker
  follows it.
- Picking a model by hand saves it to the slot you are in, so Chat keeps a chat
  model and Work keeps a coding model without you re-picking every time.
- A quiet banner above the composer names the model serving the tab (`ctx` and
  `temp` included) and says whether the other tab keeps its own — the split is
  visible instead of inferred.
- Generation temperature follows the active slot. If no model is saved for the
  slot, the **Settings → temperature** value stays in charge — existing setups
  keep behaving exactly as before.
- The "Work needs a model trained for tools" warning is suppressed once the Work
  slot has a model: an explicit choice beats a heuristic based on file names.

---

## 5. Work's model is still a coding model

The slots decide *which* model; they do not make a model good at agents. Work
still needs tool calling on the backend (`--jinja`, see
[offline-coding-agents.md](offline-coding-agents.md) §2) and a model whose chat
template has tools. Two checks, in this order:

```bash
node scripts/tools/luke-coding-models.cjs --profile mac-18   # which free model fits this machine
scripts/tools/luke-agent-env.sh check                        # does it actually call a tool
```

The quickest way to fill the Work slot is the library: **AI Library → Code AI**
lists the coding models that fit this machine and its *Use for Work* button
writes the model, window and temperature into the slot
([code-ai-library-tab.md](code-ai-library-tab.md)).

`GET /api/llm/status` → `settings.toolCalling` says whether the *backend* is
capable; `check` says whether the *model* is. The Work slot's warning
`no-tool-calling` appears when the former is false.

---

## 6. What the local-Claude-Code guides agreed on

This feature came out of reading what people actually run (Unsloth's Claude Code
guide, the community gists, and the "Vibe Coding" videos that walk through
llama.cpp + a local coder). The parts that matter, and where each one lives now:

| Their finding | Why | Where it is handled |
| --- | --- | --- |
| `--jinja` is mandatory | without it `tools` is silently ignored | `scripts/server/llm-tool-calling.cjs` (probed, not assumed) |
| Context, not model, is the usual failure | a 4K window cannot hold the agent's own prompt | Work's `minContextTokens` + warning; `LUKE_LLM_MAX_CONTEXT` |
| Cold sampling for agents | tool calls stay in one shape | Work's `temperature: 0.2`, `maxTemperature: 0.6` |
| `CLAUDE_CODE_ATTRIBUTION_HEADER=0` | reported as a large slowdown on local endpoints | emitted by `scripts/tools/luke-agent-env.sh` |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` must be ≤ the server's window | declaring more than the server allocated re-breaks it | emitted from the live `/v1/models` + status |
| Auto-compaction below the window | so the agent compacts before it truncates | `CLAUDE_CODE_AUTO_COMPACT_WINDOW` when the window allows |
| Thinking mode off for agents | a reasoning model spends the budget deliberating | `--reasoning off` when LUKE's "enable thinking" is off |
| One model at a time on small machines | two GGUFs do not fit | one resident engine, two saved slots |

The last row is the reason this document exists at all.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `409 No model is set for the work profile` | Activate needs a saved model. Pick one in Work, or `POST /api/text-profiles`. |
| Switching tabs reloads a 9 GB model every time | The two slots name different models. That is the feature; if it is too slow, point both slots at the same GGUF. |
| Work answers in prose, never edits | Model has no tool template, or backend started without `--jinja` (`no-tool-calling`). See offline-coding-agents.md §2. |
| Chat feels "flat" after using Work | Check `activeProfile` — if Chat still shows Work's model, the chat slot has no model saved. |
| `400 A model must be a .gguf file name, not a path` | By design; the value becomes a file the server opens. |
| Temperature ignores the Settings slider | A slot with a saved model owns sampling; leave the slot empty to hand control back to Settings. |

---

## 8. Verification

- [ ] `GET /api/text-profiles` → two slots, `warnings.chat/work`
- [ ] save a chat model and a work model (different GGUFs)
- [ ] switch to Work → `activate` returns `switched: true`, `port` changes to the live engine port
- [ ] switch back to Chat → `switched: true` again, and the chat GGUF is resident
- [ ] point both slots at the same GGUF → switching returns `switched: false`
- [ ] stop the model → `GET /api/text-profiles` → `activeProfile: null`
- [ ] in Work, one agent turn still produces `tool_use` (see `check`)

Tests: `node scripts/validation/test-text-profiles.cjs` — the store, the
validation that refuses a path, the warnings, the swap wiring, the UI wiring and
this document.

---

## 9. Boundaries

- **One engine.** Two slots, one `llama-server`. Two resident GGUFs is not a
  supported configuration on consumer memory, and it is not coming.
- **Not a router.** Automatic model-per-task routing (a small model for
  classification, a big one for the edit) is a different feature; this one is
  explicit and predictable.
- **The slot choice is not a safety control.** Work's file access is still
  governed by the Work folder grants and the approval mode, not by which model is
  loaded.
- **Sampling is per mode, not per conversation.** Editing temperature inside a
  chat session still uses the slot's value as the base.
