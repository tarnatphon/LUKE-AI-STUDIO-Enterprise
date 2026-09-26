// P6a behavioural test: run after applying scripts/tools/apply-p6a-stateguard.py --apply
//   node scripts/tools/p6a-stateguard-test.cjs
// Proves (A) a missing state file is recovered from backups/ instead of being
// replaced by demo seed data, and (B/C) a content change snapshots even inside
// the 10-minute auto-backup throttle.
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "p6a-"));
const RUNTIME = process.env.LUKE_SA_RUNTIME
  || path.join(__dirname, "..", "server", "social-agency-runtime.cjs");
const { SocialAgencyRuntime } = require(RUNTIME);

const STATE = path.join(ROOT, "app/runtime-state/social-agency/thai-modern-bags.json");
const DIR = path.join(ROOT, "app/runtime-state/social-agency/backups");
const list = () => (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".json")) : []).length;
const rd = () => JSON.parse(fs.readFileSync(STATE, "utf8"));
const cli = (st) => st.clients.find((x) => x.id === "thai-modern-bags");

let fail = 0;
const check = (name, cond, extra) => {
  console.log((cond ? "PASS" : "FAIL") + " | " + name + (extra ? "  -> " + extra : ""));
  if (!cond) fail += 1;
};

fs.mkdirSync(DIR, { recursive: true });
const rt = new SocialAgencyRuntime({ root: ROOT });

check("boot seeds demo when no snapshot exists", cli(rt._read()).products.length === 2,
  "products=" + cli(rt._read()).products.length);

rt.addProduct("thai-modern-bags", { name: "กระเป๋าทดสอบ P6A TST-001", sku: "TST-001" });
check("addProduct reaches the state file", cli(rd()).products.length === 3,
  "products=" + cli(rd()).products.length);

const n1 = list();
rt._lastSnapshotAt = Date.now();                       // inside the throttle window
rt.addProduct("thai-modern-bags", { name: "ใบที่สอง TST-002", sku: "TST-002" });
const n2 = list();
check("B/C: content change snapshots despite the throttle", n2 > n1, n1 + " -> " + n2);

const n3 = list();
rt._lastSnapshotAt = Date.now();
rt._write(rt._read());                                 // rewrite, nothing changed
check("B/C: unchanged rewrite adds no snapshot", list() === n3, n3 + " -> " + list());

fs.rmSync(STATE);                                      // simulate the merge that deleted it
const recovered = rt._read();
check("A: missing file recovers from snapshot, not from seed", cli(recovered).products.length === 4,
  "products=" + cli(recovered).products.length + " (expected 4 = 2 demo + 2 added)");
check("A: state file was rewritten", fs.existsSync(STATE));
check("A: SKUs added before the deletion survive", cli(rd()).products.some((p) => p.sku === "TST-002"));

fs.rmSync(ROOT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
