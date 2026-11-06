# Offline coding agents — OpenCode and Claude Code on LUKE's local model

**Status:** shipped in this branch · **Applies to:** macOS (`/Volumes/AI`), Linux, Windows
**Related:** `scripts/tools/luke-agent-env.sh` · `scripts/server/llm-tool-calling.cjs` · `docs/beta7/online-surfaces-and-differentiation.md`

Claude Code and OpenCode are *clients*. They do not contain a model, they contain
a loop: read a file, propose a patch, run a test, repeat. Point that loop at a
server that speaks its protocol and the whole thing runs on this machine, with no
account, no key and no network. LUKE already runs that server — this document is
the wiring, plus the two things in LUKE that had to change for it to work.

---

## 1. The sockets, and which one actually answers

| Address | What it is | Answers offline? |
| --- | --- | --- |
| `http://127.0.0.1:1420` | LUKE's UI, `/api/*`, and the `/v1/chat/completions` **external gateway** | UI yes · gateway **no** |
| `http://127.0.0.1:10086` | `llama-server` — LUKE's text engine, with the loaded GGUF | **yes** |
| `http://127.0.0.1:1420/v1/messages` | nothing | no |

**The gateway is not the offline path.** `/v1/chat/completions` on 1420 borrows
the *free cloud chain* (`remoteTextProvider.streamRemoteChain`); when no provider
answers it replies `503 — No free cloud provider answered`. With the network off
that is exactly what happens. It exists for cloud-first Work turns, not for local
inference.

**The local path is the engine's own port.** LUKE starts
`llama-server --host 127.0.0.1 --port 10086 …` and that process is a complete
OpenAI- and Anthropic-compatible server. The port is not guaranteed: if 10086 is
busy LUKE moves into `28121–28160`. Always read it instead of assuming:

```bash
curl -s http://127.0.0.1:1420/api/llm/status    # {"ready":true,"port":10086,"settings":{...}}
curl -s http://127.0.0.1:10086/v1/models        # {"data":[{"id":"…/qwen3-coder-30b-a3b.gguf"}]}
```

### Why no translation proxy is needed

Claude Code speaks **Anthropic Messages** (`POST /v1/messages`), which is the one
thing an OpenAI-only backend cannot answer. llama.cpp added that route upstream on
2025-11-28 (PR #17570, streaming and `tool_use` conversion included), and LUKE
pins a build from **2026-06-16**:

```bash
scripts/setup/setup-llama.sh:8  RELEASE="${LLAMA_RELEASE:-b9668}"
```

So the bundled backend already speaks Claude Code's protocol, in both directions.
No LiteLLM, no claude-code-router, no bridge process to babysit. If you pointed
Claude Code at `:1420` you would see the 503 above; if you pointed it at a
pre-2026 backend you would see `404 /v1/messages`. `check` (section 6) tells the
two apart in five seconds.

---

## 2. The one flag that makes tools work

This is the part that fails silently, so it is worth stating plainly:

> llama-server accepts the `tools` array but **ignores it** unless it renders the
> prompt with the model's own chat template — `--jinja`. Without the flag the
> agent gets a perfectly polite prose answer, calls no tool, and edits no file.
> It looks like a weak model. It is a missing flag.

LUKE now passes it when the bundled build advertises it
(`scripts/server/llm-tool-calling.cjs` probes `llama-server --help` once and
caches the answer, because an older build would *exit* on an unknown argument and
take the whole Text workspace with it). The result is recorded on the running
settings as `toolCalling: true|false`, visible in `/api/llm/status`.

| Situation | What LUKE does |
| --- | --- |
| Build lists `--jinja` (b9668 does) | appends `--jinja`, `toolCalling: true` |
| Build does not list it | starts without it, tools stay decorative |
| `LUKE_LLM_NO_JINJA=1` before `./mac.sh` | never appends it (for a model whose template misbehaves) |

Verify with a real tool call rather than a chat message — `luke-agent-env.sh check`
does it, or by hand:

```bash
curl -s http://127.0.0.1:10086/v1/messages \
  -H 'content-type: application/json' \
  -d '{"model":"local","max_tokens":96,
       "tools":[{"name":"read_file","description":"Read a file",
                 "input_schema":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"]}}],
       "messages":[{"role":"user","content":"Use the read_file tool to read README.md"}]}'
```

A `"type":"tool_use"` block means the loop will work. A `"type":"text"` block
means the model has no tool section in its template (or the flag is missing) —
try another coder model before blaming the agent.

---

## 3. Give the agent room: context, model, memory

An agent's first request is not "hello". It is a system prompt, a dozen tool
schemas and three files, before it has learned anything. Three numbers decide
whether that fits.

### 3.1 Context window

| Value | Where it comes from |
| --- | --- |
| 16384 | ceiling of the automatic planner (`context-size-planner.cjs`) |
| **20000** | default ceiling for an explicitly chosen window |
| 20000 | maximum the Model settings slider offers |
| `LUKE_LLM_MAX_CONTEXT=N` | raises the ceiling, on purpose, for this machine |

```bash
LUKE_LLM_MAX_CONTEXT=65536 ./mac.sh        # macOS / Linux
set LUKE_LLM_MAX_CONTEXT=65536 && windows.bat   # Windows
```

It is a *ceiling*, not a request: the saved or auto-planned window still wins, so
raise it **and** set the context size in **Model settings → Context** (or send
`{"model":"…","contextSize":32768}` to `POST /api/llm/start`) to the value you want. llama.cpp
prints the real cost at start-up
(`KV self size = … MiB`) and LUKE remembers it per model, which is why a larger
window is a measurement rather than a guess — if the machine cannot afford it,
the model fails to load instead of silently swapping.

Rules of thumb for agent work: **≥32768** for Claude Code (its own prompt is a
large slice of the budget), **≥16384** for OpenCode with a small model and
`AGENTS.md` kept short.

### 3.2 Model

Tool calling needs a template that *has* tools, and an agent needs 10–50
sequential requests per task, so tokens/second matters more than a benchmark
score. In practice:

| Model (GGUF) | Feel | Notes |
| --- | --- | --- |
| `Qwen3-Coder-30B-A3B` | fast even on CPU-heavy machines | MoE, ~3B active; the best default here |
| `Qwen2.5-Coder-32B` | slower, steadier edits | dense, wants a real GPU |
| `Devstral-Small-24B` | good multi-file edits | agent-trained, tool template included |
| `Qwen2.5-Coder-7B` | usable for small diffs | falls apart past ~2 files |
| anything non-coder | avoid | no tool template, or tool calls in prose |

`/api/llm/status` → `settings.toolCalling` is the honest signal from the backend
side; `check` is the honest signal from the model side.

### 3.3 One request at a time

LUKE launches the engine with `--parallel 1`. That is deliberate (one slot, one
KV cache, no VRAM surprises) and it has two consequences for an agent:

- one agent session at a time: a second client waits, it does not fail;
- parallel sub-agents queue behind each other, so a "fan out to five helpers"
  prompt takes five times as long.

Keep the **Text** workspace active while an agent works. Switching LUKE to Image
generation unloads the model and the port disappears mid-task.

---

## 4. Claude Code

### 4.1 The one command that sets it up

```bash
cd /path/to/the/work/project
eval "$(/path/to/LUKE-AI-STUDIO-Enterprise/scripts/tools/luke-agent-env.sh env)"
claude
```

`env` asks LUKE for the live port and model id, then prints `export` lines.
Behind it, these are the variables that matter:

| Variable | Value | Why |
| --- | --- | --- |
| `ANTHROPIC_BASE_URL` | `http://127.0.0.1:10086` | **no `/v1` suffix** — Claude Code appends `/v1/messages` itself |
| `ANTHROPIC_AUTH_TOKEN` | `luke-local` | llama-server accepts any non-empty value |
| `ANTHROPIC_API_KEY` | *(empty)* | a real key here would win over the token |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` / `_OPUS_` / `_HAIKU_` | the id from `/v1/models` | Claude Code asks for tiers; these map them to your GGUF |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | `1` | no telemetry, no update check, no phone home |
| `API_TIMEOUT_MS` | `600000` | local generation is slower than the hosted API |
| `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `DISABLE_AUTOUPDATER` | `1` | belt and braces for the offline claim |

The model id is the file path llama-server reports, e.g.
`/Volumes/AI/…/Qwen3-Coder-30B-A3B-Q4_K_M.gguf`. Any Claude tier name also works
because the server ignores it and uses the loaded model.

### 4.2 Make it stick for a project

`~/.claude/settings.json` (per user) or `.claude/settings.json` (per project, so
the whole team gets it — commit that one, never a key):

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:10086",
    "ANTHROPIC_AUTH_TOKEN": "luke-local",
    "ANTHROPIC_API_KEY": "",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "qwen3-coder-30b-a3b.gguf",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "qwen3-coder-30b-a3b.gguf",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "API_TIMEOUT_MS": "600000"
  }
}
```

If the port moves (another program took 10086), fix the URL in one place — the
script prints the right one — rather than hunting through the project.

### 4.3 Working in a real project

- Start Claude Code **inside the folder** you want it to edit; it cannot wander
  outside it, and `--add-dir` is the explicit way to include a second one.
- Local models hallucinate APIs more often than frontier ones. Keep the loop
  short: one file per request, run the tests between requests, and let the agent
  read the failure output rather than describing it.
- `tests/`, `node_modules/`, `app/dist/` and model folders do not belong in its
  context; add them to `.gitignore`-style ignore lists (`.claudeignore`,
  `CLAUDE.md` conventions) so a request is not spent reading your build output.
- Write the project's rules once, in a short `CLAUDE.md` at the repo root: stack,
  commands to run tests, style. Every local model benefits far more from that
  file than a frontier model does.

---

## 5. OpenCode

OpenCode speaks OpenAI-compatible chat natively, so it needs no environment
variables at all — one file at the project root (`opencode.json`), or
`~/.config/opencode/opencode.json` for every project. Project files win, and
`OPENCODE_CONFIG` points at a file of your choosing.

```bash
cd /path/to/the/work/project
/path/to/LUKE-AI-STUDIO-Enterprise/scripts/tools/luke-agent-env.sh opencode .
```

That writes (it refuses to overwrite an existing file):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "luke": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LUKE AI STUDIO (local)",
      "options": {
        "baseURL": "http://127.0.0.1:10086/v1"
      },
      "models": {
        "/Volumes/AI/llm-models/qwen3-coder-30b-a3b.gguf": {
          "name": "LUKE local GGUF",
          "limit": { "context": 20000, "output": 4096 }
        }
      }
    }
  },
  "model": "luke//Volumes/AI/llm-models/qwen3-coder-30b-a3b.gguf"
}
```

Then open the folder and pick the model with `/models`.

| Detail | Why it matters |
| --- | --- |
| model key = the id from `GET /v1/models` | llama-server reports the file path; a friendly name will not resolve |
| `limit.context` | OpenCode will not ask for more than this, which keeps requests inside LUKE's window |
| `@ai-sdk/openai-compatible` | OpenCode loads this adapter on demand — install it once **while online**, otherwise the first offline run fails with "cannot find package" |
| `baseURL` ends at `/v1` | that is the OpenAI-compatible prefix of the engine |
| keep `opencode.json` out of the commit if paths are personal | it contains your absolute model path |

`opencode.json` is also where a team pins behaviour (`model`, agents,
permissions). Check the keys against `opencode --help` for the version you have
installed rather than copying a schema from a blog: it moves.

Other OpenAI-shaped tools need nothing new — Aider, Continue, LM Studio's
"connect to a server", a Python script with `openai`:

```bash
export OPENAI_BASE_URL=http://127.0.0.1:10086/v1
export OPENAI_API_KEY=luke-local
```

---

## 6. Prove it is offline

Four checks, in the order that fails fastest:

```bash
scripts/tools/luke-agent-env.sh check
```

Expect five lines: LUKE API, llama-server, OpenAI route, Anthropic route, tool
calling. The last two are the ones a coding agent needs.

Then, for the claim itself:

1. **Settings → Online surfaces:** switch *Online-first Chat* off, or turn on
   *Air-gap proof mode*. Every turn then stays on this machine, and a refusal
   would be written to the ledger rather than silently sent.
2. **Turn the network off** (Wi-Fi off, cable out) and run a real task: open a
   file, change it, run the tests. Nothing in this path needs a socket beyond
   loopback — the engine is a local process.
3. **Read the ledger:** `GET /api/egress/report?format=text`. While an agent
   works it should show nothing new. If something appears, the agent — not
   LUKE — made the call: check the `DISABLE_*` variables in section 4.1 and any
   MCP server or plugin the agent itself installed.
4. **Confirm with the OS** (optional, and only if you like proof):
   `lsof -i -P -n | grep ESTABLISHED` on macOS/Linux, `netstat -ano | findstr ESTABLISHED`
   on Windows. Loopback pairs are fine; a connection to a public address
   is not.

The egress ledger covers LUKE's own surfaces. An agent is a separate program with
its own ideas about telemetry, which is why the agent side gets its own switches
rather than a promise.

---

## 7. The work project, specifically

- **LUKE's Work-folder grants are not involved.** Those govern LUKE's own Work
  tab (`work-folder-grants.cjs`, restored per session). A CLI agent edits files
  directly, with your user's permissions, in the folder you started it in. If the
  folder lives on an external SSD, that is fine — the grant system is simply not
  in this path.
- **No keys, no `.env`.** Local mode authenticates with a placeholder string.
  Nothing secret belongs in `opencode.json` or `.claude/settings.json`; if a
  teammate finds a key there, it went in by accident.
- **Keep the model out of the repo.** Weights belong in `app/llm-models/` (or a
  storage location, see `docs/beta7/storage-locations.md`), never in the project
  tree the agent is indexing.
- **One workspace at a time.** LUKE keeps the text engine resident while you use
  it. Generating an image in the same session is fine; switching LUKE to the
  Image workspace unloads the GGUF, and the agent's next request gets a
  connection refused. Re-load the model in Text Chat and continue.
- **Same machine, or a paired one.** Everything above is loopback. Serving the
  engine to another machine means `--host 0.0.0.0` and a token, which is a
  different (and deliberate) decision — the LAN pairing surface
  (`/api/lan/pair`) is the supported way to do that for LUKE's own UI.

---

## 8. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `503 No free cloud provider answered` | You pointed the agent at `:1420`. That is the cloud gateway; use the engine port from `/api/llm/status` (§1). |
| `404` on `POST /v1/messages` | Backend older than the pinned build. Re-run `scripts/setup/setup-llama.sh`, then `./mac.sh`. |
| Agent answers, never edits a file | `--jinja` missing or the model has no tool template. Run `check`; see §2. |
| `connection refused` on the engine port | No GGUF loaded, or LUKE is on the Image workspace, or the port moved (10086 busy → 28121+). Read `/api/llm/status`. |
| First token takes forever | Prompt is being processed: a large system prompt plus files on a CPU backend. Lower context per request, use an A3B/MoE model, keep `--batch-size` at 512. |
| Requests hang behind each other | `--parallel 1`. One agent at a time; stop any generation running in LUKE's own chat. |
| `context length exceeded` / truncated edits | Raise `LUKE_LLM_MAX_CONTEXT`, set Context in Model settings, or send fewer files per request (§3.1). |
| OpenCode: `cannot find package '@ai-sdk/openai-compatible'` | The adapter is fetched on demand. Install once while online, then run offline. |
| OpenCode never selects the model | Model key must equal the id in `GET /v1/models`, and `"model": "luke/<id>"` must match it (§5). |
| Claude Code still asks to log in | `ANTHROPIC_API_KEY` must be empty; only `ANTHROPIC_AUTH_TOKEN` is set. Start a fresh shell after exporting. |
| Answers are fluent nonsense | Too small a model for a multi-file edit. Smaller task, or a coder model from §3.2. |

---

## 9. Verification checklist

- [ ] `curl -s http://127.0.0.1:1420/api/llm/status` → `ready: true`, a port
- [ ] `curl -s http://127.0.0.1:<port>/v1/models` → your GGUF's id
- [ ] `scripts/tools/luke-agent-env.sh check` → five `ok` lines
- [ ] `/api/llm/status` → `settings.toolCalling: true`
- [ ] `eval "$(scripts/tools/luke-agent-env.sh env)"` then `claude` answers
- [ ] `luke-agent-env.sh opencode .` then `/models` lists "LUKE local GGUF"
- [ ] with Flight Mode on, one file is read, edited and a test run
- [ ] `GET /api/egress/report?format=text` → nothing recorded during that task
- [ ] after restarting LUKE, `luke-agent-env.sh port` still finds the engine

---

## 10. Boundaries worth knowing

- **Local ≠ frontier.** A 30B model at `Q4_K_M` will write working code and will
  also invent an API now and then. The value here is privacy and independence
  from a quota, not parity.
- **The Anthropic route is young.** llama.cpp's `/v1/messages` is a translation
  layer over its own chat path; some Anthropic parameters (`thinking` budgets,
  prompt caching headers, per-request timings) are accepted and ignored. Claude
  Code works; it does not get Claude-specific features for free.
- **No money, no top-up.** Nothing in this path has a paid tier to fall back to.
  The engine either runs on this machine or the request fails with a message that
  says so.
- **Licence:** LUKE is MIT. Claude Code and OpenCode are separate programs under
  their own licences, installed by the user; no third-party source is vendored
  here, and nothing in this document requires one to be.
- **Tests:** `node scripts/validation/test-offline-coding-agents.cjs` — the
  `--jinja` probe against real fake binaries, the context ceiling, the helper
  script against a stand-in LUKE over a real socket, and this document's claims.
