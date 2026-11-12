# A review of LUKE from the beginning to today

Written after the Create Images work, as the answer to *"review the project from
the beginning up to now and identify what can be upgraded."* It is deliberately
not a wish list: every item below is something that is measurably true of this
tree today, with the evidence next to it. Items are ordered by what they cost
the user, not by how interesting they are to fix.

The one thing this review does **not** claim is that the product is far from
finished. 233 validation suites pass, the image path is now correct end to end,
and the parts that exist are unusually honest about their limits (see
`image-quality-and-hardware-profiles.md` §6). What follows is the next layer.

---

## 1. Two chat components, one of them dead

`app/frontend/src/components/PersistentTextChat.jsx` is **4,825 lines** and
**1,849 lines** of `PersistentTextChat.css`. Nothing imports it.

Evidence:

```bash
grep -rn "PersistentTextChat" app/frontend/src --include=*.jsx --include=*.js
# only App.jsx:61, a lazy() that is never rendered —
grep -c "<PersistentTextChat" app/frontend/src/App.jsx     # 0
ls app/dist/assets | grep -i persistent                    # still shipped
```

Vite still emits it as a chunk (`PersistentTextChat-Br0sSvlb.js`, 108 KB, plus a
45 KB CSS file) because a dynamic `import()` is a chunk whether or not anything
renders it. So it costs build time, 153 KB of release surface, and — the real
cost — it is a second, divergent copy of the chat logic. Any future fix to
`TextChat.jsx` (4,046 lines) has to be noticed and re-applied by hand, and the
suite cannot tell you when it is not.

**Recommendation:** delete both files and the `lazyPanel` line. This is the one
item on this list I would do first, because it removes risk rather than adding
it. If the component is a half-finished redesign, keep it on a branch, not on
`main` — dead code in a repo this size reads as live code.

---

## 2. `serve.cjs` is 31,754 lines in one file

The backend is a single CommonJS file with 163 hand-written route dispatches
(`if (req.url === …)` chains). It works, and its style is consistent, but:

- Every route's helper lives in the same scope, so there is no signal about
  which functions belong to which surface. `evaluateModelMemoryBudget` and the
  image planner are 25,000 lines apart.
- A single typo anywhere is a whole-server failure, which is why `node --check`
  is a validation step rather than a formality.
- The suite has to grep the source text to test it (`test-memory-pool-explained.cjs`
  does `serve.replace("already use", "Already use")` to find a sentence). That is
  a symptom: the thing under test is a string in a monolith, not a function.

**Recommendation:** extract by surface, not by layer — the same way
`image-quality.cjs` was extracted this session and immediately became testable
from three places at once. Image generation is now two lines in `serve.cjs` and
350 in a pure module. `social-agency`, `storage`, and `text-profiles` are the
next three in descending order of how much they would repay the effort.

---

## 3. The image path had four silent failures (fixed here)

Worth recording because the pattern is the product risk, not the bugs:

| Bug | How long it was invisible |
| --- | --- |
| Steps / CFG / seed / sampler / negative prompt dropped on every text-to-image | Since the OpenAI-compatible endpoint was introduced — the request succeeded, so nothing looked wrong |
| The OpenAI-compatible *fallback* could never succeed | Always; it threw "no image" on a valid response |
| A seed of `0` became "random" | Always |
| The recorded seed was not the seed used | Since `-1` began being resolved in the browser |

None of these produced an error the user could act on. They produced *slightly
worse images*, which is the hardest class of bug to notice and the reason §2 of
`image-quality-and-hardware-profiles.md` exists.

**Recommendation:** treat "the settings I chose are the settings that ran" as a
contract with a test, for every surface. Image generation now has one. Text and
speech do not.

---

## 4. Validation is strong but centred on regressions

233 suites, and the ones added this session caught four real bugs — that is a
good ratio. The shape, though, is almost entirely *"this bug cannot come back"*.
There is little *"this feature works"*: nothing generates an image with a real
backend, nothing runs a real conversation, nothing posts to a real API.

That is a defensible choice for a local-first app whose dependencies are 4 GB
downloads (the suite blocks rather than lies when `imageio_ffmpeg` is absent —
this session saw it do exactly that, correctly). But it means the suite cannot
tell you a *new* feature is right, only that an old bug is still gone.

**Recommendation:** one opt-in end-to-end suite (`--include-live`) that loads a
tiny real checkpoint — an SD 1.5 LCM at 4 steps, 512², one image — and asserts
the file is a valid PNG of the requested size with the requested seed echoed
back. Twenty seconds of compute would have caught all four bugs in §3.

---

## 5. The offline coding-agent story is the strongest thing here

`docs/beta7/offline-coding-agents.md` describes something most local AI apps do
not have: LUKE's `llama-server` speaks both OpenAI and Anthropic Messages, so
Claude Code / OpenCode / Aider run their whole loop on the loaded GGUF, and
`luke-agent-env.sh` finds the live port and writes the environment. The
`--jinja` tool-calling detail and the 16–20K window arithmetic in
`luke-coding-models.cjs` show it was built against reality, not aspiration.

**Recommendation:** this deserves to be the headline, not a bullet on line 78 of
the README. "Your coding agent, with no account, no key, no network" is a
sharper claim than anything a general-purpose studio can make.

---

## 6. Documentation is excellent and almost invisible

There are 29 files in `docs/beta7/`, each one a real post-mortem with the
evidence and the fix. `README.md` links 17 of them inline. But there is no
index: a reader who wants "what is this product, and what does it refuse to do"
has to scroll 500 lines of README or browse a directory.

**Recommendation:** `docs/beta7/README.md` as a one-screen index, grouped by
*"when something goes wrong"*, *"how it is built"*, *"what it will not do"*. The
material is already written; it only needs a table of contents.

---

## 7. Smaller, concrete

- **`App.jsx` lazy components**: seven `lazyPanel(...)` bindings are rendered by
  name in JSX, which a grep for `<Name` undercounts. Fine, but the one that is
  genuinely unused is §1 above.
- **`Generator.jsx` is still 1,385 lines** after this session split the quality
  panel out. The next natural seams are the gallery and the export/download
  block.
- **No ESLint rule against dead exports.** `PersistentTextChat` survived long
  enough to be in the release because nothing was obliged to notice.
- **`BACKEND_RESTART_SETTING_KEYS`** correctly no longer carries `cfgScale` /
  `sampler` (they travel per request now). Worth a comment saying so, so the next
  person does not helpfully put them back — a sampler change does not need a
  backend restart and should not cause one.

---

## What I would not change

- **Local-first, free-only, no payment paths.** `no-pay-hidden-paths-audit.md`
  is the most unusual document in the repo and the product's whole position.
- **Blocking instead of skipping when a prerequisite is missing.** A suite that
  says "nothing was tested" is worth more than one that says "passed".
- **The `degraded` string on a fallback run.** Telling the user which settings
  were not applied is better than quietly producing a worse image, and it is the
  pattern the rest of the app should copy.
