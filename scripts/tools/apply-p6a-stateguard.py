#!/usr/bin/env python3
"""P6a - state-loss safeguards for scripts/server/social-agency-runtime.cjs

Background (2026-09-26): a `git merge --ff-only` deleted
app/runtime-state/social-agency/thai-modern-bags.json from the working tree.
_read() treats a MISSING file as "first boot" and seeds the 5 demo clients,
and the 10-minute auto-snapshot throttle meant the good state (93 SKUs +
October plan) had never been written to backups/ - so the catalog was lost.

  A. _read(): consult _recoverFromSnapshots() when the file is MISSING too
     (previously only "exists but unparseable" did). Demo seeding now happens
     only when no readable snapshot exists.
  B/C. _autoSnapshot(): skip the time throttle whenever the content
     fingerprint (client/product/calendar ids) changed - so every destructive
     batch write leaves a snapshot behind.
  D. _write() passes the state it just persisted into _autoSnapshot().

Writes a copy of the pre-patch file to <target>.p6a-orig. Idempotent: an edit
whose "after" text is already present is reported SKIP, not FAIL.

    python3 scripts/tools/apply-p6a-stateguard.py            # dry run
    python3 scripts/tools/apply-p6a-stateguard.py --apply
    TARGET=/other/path.cjs python3 scripts/tools/apply-p6a-stateguard.py
"""
import json
import os
import sys

DEFAULT_TARGET = "scripts/server/social-agency-runtime.cjs"
BLOB = r"""
[
  {
    "id": "A-read-recover-on-missing",
    "before": "    const raw = this._readRawTolerant();\n    if (!raw) {\n      if (fs.existsSync(this.filePath)) {\n        // state file exists but could not be read -> recover from snapshot, never seed over live data\n        const recovered = this._recoverFromSnapshots();\n        if (recovered) return recovered;\n        this._quarantineUnreadable();\n      }\n      const state = this._buildFreshState();\n      this._write(state);\n      return state;\n    }",
    "after": "    const raw = this._readRawTolerant();\n    if (!raw) {\n      // P6a: missing file is an emergency too - consult backups/ before seeding,\n      // so a deleted/renamed state file can never be replaced by demo data.\n      // _recoverFromSnapshots() keeps the unreadable original as .corrupt-* itself.\n      const recovered = this._recoverFromSnapshots();\n      if (recovered) return recovered;\n      const state = this._buildFreshState();\n      this._write(state);\n      return state;\n    }"
  },
  {
    "id": "B-fingerprint-helper",
    "before": "  // rolling safety net: snapshot the whole state at most every 10 minutes\n  _autoSnapshot() {\n    if (process.env.LUKE_SA_AUTOBACKUP === \"off\") return;\n    if (this._writingSnapshot) return;\n    const everyMs = Number(process.env.LUKE_SA_AUTOBACKUP_EVERY_MS || 600000) || 600000;\n    const now = Date.now();",
    "after": "  // P6a: cheap content fingerprint so a real change always survives the throttle\n  _snapshotFingerprint(state) {\n    try {\n      const clients = ((state || {}).clients) || [];\n      let h = 2166136261;\n      const mix = (s) => {\n        for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }\n      };\n      for (const c of clients) {\n        mix(c.id);\n        for (const p of c.products || []) mix(p.sku);\n        for (const e of c.calendar || []) mix(`${e.date} ${e.time} ${e.sku} ${e.status}`);\n      }\n      return clients.length + \":\" + h.toString(16);\n    } catch {\n      return \"\";\n    }\n  }\n\n  // rolling safety net: snapshot the whole state at most every 10 minutes\n  _autoSnapshot(state) {\n    if (process.env.LUKE_SA_AUTOBACKUP === \"off\") return;\n    if (this._writingSnapshot) return;\n    const everyMs = Number(process.env.LUKE_SA_AUTOBACKUP_EVERY_MS || 600000) || 600000;\n    const now = Date.now();"
  },
  {
    "id": "C-gate-on-fingerprint",
    "before": "    if (this._lastSnapshotAt && now - this._lastSnapshotAt < everyMs) return;\n    this._lastSnapshotAt = now;",
    "after": "    const fingerprint = this._snapshotFingerprint(state);\n    if (this._lastSnapshotAt && now - this._lastSnapshotAt < everyMs && fingerprint === this._lastSnapshotFingerprint) return;\n    this._lastSnapshotAt = now;\n    this._lastSnapshotFingerprint = fingerprint;"
  },
  {
    "id": "D-pass-state-to-snapshot",
    "before": "    fs.renameSync(tmp, this.filePath);\n    this._autoSnapshot();",
    "after": "    fs.renameSync(tmp, this.filePath);\n    this._autoSnapshot(state);"
  }
]
"""


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def analyse(src):
    rows = []
    for e in json.loads(BLOB):
        after_present = e["after"] in src
        count = src.count(e["before"])
        if after_present:
            state = "SKIP"
        elif count == 1:
            state = "OK"
        elif count == 0:
            state = "FAIL"
        else:
            state = "AMBIGUOUS"
        rows.append((e, count, state))
    return rows


def main():
    target = os.environ.get("TARGET", DEFAULT_TARGET)
    if not os.path.exists(target):
        print("ไม่พบไฟล์เป้าหมาย: %s (ต้องรันจาก /Volumes/AI)" % target)
        return 2
    src = read(target)
    rows = analyse(src)
    print("target: %s (%d B)" % (target, os.path.getsize(target)))
    for e, count, state in rows:
        print("  %-30s anchor=%-2s %s" % (e["id"], count, state))
    bad = [r for r in rows if r[2] in ("FAIL", "AMBIGUOUS")]
    todo = [r for r in rows if r[2] == "OK"]
    if bad:
        print()
        print("ยังไม่ได้แก้ เพราะ anchor ไม่ตรง 1 ครั้ง -> ไม่ได้แตะไฟล์เลย")
        print("แปลว่าไฟล์บนเครื่องต่างจากที่เครื่องมือนี้เตรียมไว้ ส่งผลลัพธ์นี้มาให้ดู อย่าบังคับ patch")
        return 1
    if not todo:
        print()
        print("patch ครบแล้ว (ทุกจุดเป็น SKIP) - ไม่ต้องทำอะไรเพิ่ม")
        return 0
    print()
    print("ต้องแก้ %d จุด: %s" % (len(todo), ", ".join(r[0]["id"] for r in todo)))
    if "--apply" not in sys.argv:
        print("(dry-run: ยังไม่เขียนไฟล์ -> เพิ่ม --apply เมื่อพร้อม)")
        return 0
    orig = target + ".p6a-orig"
    if not os.path.exists(orig):
        with open(orig, "w", encoding="utf-8") as fh:
            fh.write(src)
        print("สำรองก่อนแก้: %s" % orig)
    out = src
    for e, _count, _state in todo:
        out = out.replace(e["before"], e["after"], 1)
    with open(target, "w", encoding="utf-8") as fh:
        fh.write(out)
    print("แก้เสร็จ -> ตรวจ: node --check %s && python3 scripts/tools/p5w-audit.py ." % target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
