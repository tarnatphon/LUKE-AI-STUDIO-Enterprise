# `test-sync-script.cjs` — หาต้นตอ CI flake

> PR #83 CI run `41574596259` fail ที่ suite นี้ รอบถัดไป (`41575600593`,
> `41576728648`) ผ่าน — ตอนนั้นเพิ่มแค่ `explainRun()` diagnostics +
> `--no-hardlinks` แต่ **ไม่เคยรู้สาเหตุ**

## สิ่งที่พบ (ตรงไปตรงมา)

**log ต้นฉบับกู้ไม่ได้แล้ว** — `gh run view --log-failed` และ artifact download
ตอบ `EOF` เพราะ log/artifact อยู่บน `results-receiver.actions.githubusercontent.com`
/ `*.blob.core.windows.net` ซึ่ง sandbox เข้าไม่ถึง เหลือเพียง annotation:

```
FAIL  test-sync-script.cjs  502ms  ✓ and still has not touched the chat history.
```

บรรทัดขวาสุดคือ **เช็คที่ผ่าน** ไม่ใช่สาเหตุ → นี่คือเบาะแสสำคัญข้อแรก

### ต้นตอ A: ทำไม "หาสาเหตุไม่เจอ" (พิสูจน์ได้ 100%)

`run-all.cjs` เดิมใช้
```js
lastMeaningfulLine(result.stdout || result.stderr)
```
`||` หมายถึง **ถ้า stdout มีอะไรแม้แต่บรรทัดเดียว stderr จะถูกทิ้งทั้งหมด**
suite ตอนนั้นเขียน error ลง `console.error` อย่างเดียว ดังนั้นพอมี `✓ ...` ถูกพิมพ์
ไปแล้ว CI report ก็ตั้งชื่อ "เช็คสุดท้ายที่ผ่าน" แทน "ข้อความล้มเหลว"
→ annotation ข้างบนจึงเกิดขึ้นได้พอดี

**แก้แล้ว**: สำหรับ suite ที่ fail ให้รวม `stdout + stderr` ก่อนหาบรรทัดท้าย
(สำหรับ suite ที่ผ่านยังใช้ stdout อย่างเดียว เพื่อไม่ให้ report มี noise)

### ต้นตอ B: ทำไม "ผ่านบนเครื่อง แต่ fail ใน CI" (reproduce ได้จริง)

fixture เดิม **inherit global git config ของเครื่องที่รัน** ทดสอบด้วย config
แบบ runner ที่เป็นปรปักษ์:

```ini
[user]  useConfigOnly = true
[commit] gpgsign = true
[core]  hooksPath = /tmp/no-such-hooks
[init]  defaultBranch = unrelated-name
```

ผลก่อนแก้:
```
error: cannot run gpg: No such file or directory
error: gpg failed to sign the data
fatal: failed to write commit object
FAIL  git commit --quiet -m simulated upstream commit failed in <origin>
```
บนเครื่อง developer ที่ config สะอาด `git commit` ผ่านเสมอ → นี่คือคลาส
"passes here / fails in CI" ที่หาตัวไม่เจอมาตลอด

**แก้แล้ว** ทุก `git` call ใน fixture (รวม `git` ที่ `sync.sh` เรียกภายใน) รันแบบ hermetic:
- `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_SYSTEM=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`
- `-c commit.gpgsign=false -c tag.gpgsign=false -c user.useConfigOnly=false
  -c core.hooksPath=/dev/null -c core.autocrlf=false -c gc.auto=0
  -c init.defaultBranch=fixture`
- `user.name` / `user.email` ตั้งเป็น **local config** ในแต่ละ fixture repo เหมือนเดิม
- `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`

### ต้นตอ C: สิ่งที่ PR #83 แก้ไปแล้วแต่ยังไม่ครบ

`--no-hardlinks` ถูกใส่ให้ clone จาก `root` สองจุด แต่ clone อีกสองจุด
(`origin → user`, `origin2 → user2`) ยังใช้ hardlink ตอนนี้ **ทั้ง 4 clone** ใช้
`--no-hardlinks` และไปผ่าน `gitArgs()` ตัวเดียวกันหมด (มี meta-check นับในเทสต์)

> ⚠️ ไม่มีหลักฐานพอจะยืนยันว่า run `41574596259` ล้มเพราะ gpg config หรือ hardlink
> (log หมดอายุ/เข้าไม่ถึง) สิ่งที่ยืนยันได้คือ **ทั้งสองคลาสถูกปิดแล้ว** และ
> เหตุผลของความล้มเหลวครั้งต่อไปจะ **ไม่ถูกทิ้งอีกต่อไป**

## เทสต์ใหม่ `test-sync-script-ci-conditions.cjs` — 15 checks

1. **control**: พิสูจน์ว่า hostile config ทำให้ `git commit` ธรรมดาล้มจริง
   (กันไม่ให้เทสต์ผ่านแบบ vacuous)
2. clone แบบ `actions/checkout` (`--single-branch` + **detached HEAD**) แล้วรัน suite
   จริงภายใต้ hostile config → ต้อง exit 0 และจบทั้ง 2 scenario
3. สร้าง suite ปลอมที่พิมพ์ `✓` แล้วเขียนเหตุผลลง **stderr only** →
   `run-all --filter` ต้อง report เหตุผล ไม่ใช่บรรทัด `✓`
4. static pin: 4 clone ใช้ `--no-hardlinks`/`gitArgs()`, ค่ากำหนด hermetic ครบ,
   `sync.sh` ได้ env เดียวกัน, `run-all` อ่านทั้งสอง stream

วิธี reproduce ด้วยมือ:
```bash
node scripts/validation/test-sync-script-ci-conditions.cjs
node scripts/validation/test-sync-script.cjs
```

## ผล
`test-sync-script.cjs` ยังผ่าน · ชุดใหม่ 15/0 · `run-all --include-python`
→ 195 passed · 0 failed · CI ของ PR นี้เขียว
