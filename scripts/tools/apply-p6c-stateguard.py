#!/usr/bin/env python3
"""P6a/v3 - state-loss safeguards, tolerant of comment drift.

Intent: consult backups/ when the state file is MISSING (instead of silently
seeding 5 demo clients) and snapshot whenever state *content* changes (instead
of only when the 10-minute auto-backup clock allows). Edit B carries two
variants because the Mac tree at f3bf16a has no "// rolling safety net" comment
above _autoSnapshot() while the session tree does; each variant is ATOMIC (helper
method + `state` parameter land together) because a helper without the parameter
crashes with `ReferenceError: state is not defined` on the first write.

Every edit must match exactly once - one variant for B - otherwise NOTHING is
written. "done" text makes re-runs a no-op (SKIP). Verified with
scripts/tools/p6a-stateguard-test.cjs (7 checks) on both variants.

    python3 scripts/tools/apply-p6c-stateguard.py            # dry run
    python3 scripts/tools/apply-p6c-stateguard.py --apply
    TARGET=/other/file.cjs python3 scripts/tools/apply-p6c-stateguard.py
"""
import json
import os
import sys

DEFAULT_TARGET = "scripts/server/social-agency-runtime.cjs"
BLOB = r"""
[
  {
    "id": "A-read-recover-on-missing",
    "done": "P6a: missing file is an emergency too",
    "before": "    const raw = this._readRawTolerant();\n    if (!raw) {\n      if (fs.existsSync(this.filePath)) {\n        // state file exists but could not be read -> recover from snapshot, never seed over live data\n        const recovered = this._recoverFromSnapshots();\n        if (recovered) return recovered;\n        this._quarantineUnreadable();\n      }\n      const state = this._buildFreshState();\n      this._write(state);\n      return state;\n    }",
    "after": "    const raw = this._readRawTolerant();\n    if (!raw) {\n      // P6a: missing file is an emergency too - consult backups/ before seeding,\n      // so a deleted/renamed state file can never be replaced by demo data.\n      // _recoverFromSnapshots() keeps the unreadable original as .corrupt-* itself.\n      const recovered = this._recoverFromSnapshots();\n      if (recovered) return recovered;\n      const state = this._buildFreshState();\n      this._write(state);\n      return state;\n    }"
  },
  {
    "id": "B-helper-and-signature",
    "done": "  _snapshotFingerprint(state) {\n    try {",
    "note": "ONE atomic edit per variant: helper + `state` parameter together, never half",
    "alternatives": [
      {
        "name": "with-comment (session tree)",
        "before": "  // rolling safety net: snapshot the whole state at most every 10 minutes\n  _autoSnapshot() {",
        "after": "  // P6a: cheap content fingerprint so a real change always survives the throttle\n  _snapshotFingerprint(state) {\n    try {\n      const clients = ((state || {}).clients) || [];\n      let h = 2166136261;\n      const mix = (s) => {\n        for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }\n      };\n      for (const c of clients) {\n        mix(c.id);\n        for (const p of c.products || []) mix(p.sku);\n        for (const e of c.calendar || []) mix(`${e.date} ${e.time} ${e.sku} ${e.status}`);\n      }\n      return clients.length + \":\" + h.toString(16);\n    } catch {\n      return \"\";\n    }\n  }\n\n  // rolling safety net: snapshot the whole state at most every 10 minutes\n  _autoSnapshot(state) {"
      },
      {
        "name": "no-comment (Mac @f3bf16a)",
        "before": "  _autoSnapshot() {\n    if (process.env.LUKE_SA_AUTOBACKUP === \"off\") return;",
        "after": "  // P6a: cheap content fingerprint so a real change always survives the throttle\n  _snapshotFingerprint(state) {\n    try {\n      const clients = ((state || {}).clients) || [];\n      let h = 2166136261;\n      const mix = (s) => {\n        for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }\n      };\n      for (const c of clients) {\n        mix(c.id);\n        for (const p of c.products || []) mix(p.sku);\n        for (const e of c.calendar || []) mix(`${e.date} ${e.time} ${e.sku} ${e.status}`);\n      }\n      return clients.length + \":\" + h.toString(16);\n    } catch {\n      return \"\";\n    }\n  }\n\n  _autoSnapshot(state) {\n    if (process.env.LUKE_SA_AUTOBACKUP === \"off\") return;"
      }
    ]
  },
  {
    "id": "C-gate-on-fingerprint",
    "done": "this._lastSnapshotFingerprint = fingerprint;",
    "before": "    if (this._lastSnapshotAt && now - this._lastSnapshotAt < everyMs) return;\n    this._lastSnapshotAt = now;",
    "after": "    const fingerprint = this._snapshotFingerprint(state);\n    if (this._lastSnapshotAt && now - this._lastSnapshotAt < everyMs && fingerprint === this._lastSnapshotFingerprint) return;\n    this._lastSnapshotAt = now;\n    this._lastSnapshotFingerprint = fingerprint;"
  },
  {
    "id": "D-pass-state-to-snapshot",
    "done": "this._autoSnapshot(state);",
    "before": "    fs.renameSync(tmp, this.filePath);\n    this._autoSnapshot();",
    "after": "    fs.renameSync(tmp, this.filePath);\n    this._autoSnapshot(state);"
  }
]
"""


def plan(src):
    """Variant order IS priority: a more specific variant (with-comment) wins when it
    matches, because its text is a strict superset of the fallback's. Only a variant
    that matches more than once is fatal."""
    rows = []
    for e in json.loads(BLOB):
        alts = e.get("alternatives") or [{"name": "primary", "before": e["before"], "after": e["after"]}]
        if e.get("done") and e["done"] in src:
            rows.append((e, alts[0], len(alts), "SKIP"))
            continue
        chosen = None
        for alt in alts:
            c = src.count(alt["before"])
            if c > 1:
                chosen = (alt, "AMBIGUOUS")
                break
            if c == 1:
                chosen = (alt, "OK")
                break
        if chosen is None:
            chosen = (alts[-1], "FAIL")
        rows.append((e, chosen[0], len(alts), chosen[1]))
    return rows


def main():
    target = os.environ.get("TARGET", DEFAULT_TARGET)
    if not os.path.exists(target):
        print("ไม่พบไฟล์เป้าหมาย: %s (ต้องรันจาก /Volumes/AI)" % target)
        return 2
    src = open(target, encoding="utf-8").read()
    rows = plan(src)
    print("target: %s (%d B, %d lines)" % (target, os.path.getsize(target), src.count(chr(10)) + 1))
    for e, alt, n_alt, state in rows:
        extra = (" via [" + alt["name"] + "]") if n_alt > 1 and state == "OK" else ""
        print("  %-26s %s%s" % (e["id"], state, extra))
    bad = [r for r in rows if r[3] in ("FAIL", "AMBIGUOUS")]
    todo = [r for r in rows if r[3] == "OK"]
    if bad:
        print()
        print("ยังไม่ได้แก้ เพราะ anchor ไม่ตรง 1 ครั้ง -> ไม่ได้แตะไฟล์เลย")
        print("ส่งผลลัพธ์นี้มาให้ดู อย่าบังคับ patch")
        return 1
    if not todo:
        print()
        print("patch ครบแล้ว (ทุกจุดเป็น SKIP) - ไม่ต้องทำอะไรเพิ่ม")
        return 0
    print()
    print("ต้องแก้ %d จุด" % len(todo))
    if "--apply" not in sys.argv:
        print("(dry-run: ยังไม่เขียนไฟล์ -> เพิ่ม --apply เมื่อพร้อม)")
        return 0
    orig = target + ".p6c-orig"
    if not os.path.exists(orig):
        open(orig, "w", encoding="utf-8").write(src)
        print("สำรองก่อนแก้: %s" % orig)
    out = src
    for e, alt, _n, _s in todo:
        out = out.replace(alt["before"], alt["after"], 1)
    open(target, "w", encoding="utf-8").write(out)
    print("แก้เสร็จ -> ตรวจต่อ: node --check " + target)
    print("             แล้วรัน: node scripts/tools/p6a-stateguard-test.cjs  (ต้อง PASS 7 ข้อ)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
