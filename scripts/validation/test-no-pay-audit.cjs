"use strict";

/**
 * No-pay audit — a whole-repo regression guard, not a feature test.
 *
 * The feature suites prove that the free chain works and that a paid-shaped
 * provider is refused over a real socket. This one asks a different question:
 * did a billable surface sneak back in anywhere else? It walks the production
 * sources, inventories every hard-coded outbound host and every switch, and
 * asserts that external media generation is deleted rather than disabled.
 *
 * The intended failure mode is deliberate: adding a new free provider or a new
 * outbound host requires editing the allowlists below and saying why. A hidden
 * paid path should never be able to land silently.
 *
 * Run: node scripts/validation/test-no-pay-audit.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "luke-no-pay-audit-"));

process.env.LUKE_ONLINE_SURFACES_FILE = path.join(scratch, "surfaces.json");
process.env.LUKE_EGRESS_LEDGER_FILE = path.join(scratch, "ledger.jsonl");
process.env.LUKE_LAN_PAIRING_FILE = path.join(scratch, "lan.json");
process.env.LUKE_CHANNEL_RELAY_FILE = path.join(scratch, "channels.json");
process.env.LUKE_REMOTE_PROVIDER_FILE = path.join(scratch, "providers.json");

const aiCatalog = require(path.join(root, "scripts", "server", "ai-provider-catalog.cjs"));
const onlineSurfaces = require(path.join(root, "scripts", "server", "online-surfaces.cjs"));
const egressLedger = require(path.join(root, "scripts", "server", "egress-ledger.cjs"));
const remoteProvider = require(path.join(root, "scripts", "server", "remote-text-provider.cjs"));

let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function readSource(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

/** Every production source file that can issue a request or render a control. */
function productionSources() {
  const out = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", "cache", "runtime-state", "__pycache__"].includes(entry.name)) continue;
        walk(full);
      } else if (/\.(cjs|mjs|jsx?|html|json|webmanifest)$/.test(entry.name)) {
        out.push({ file: path.relative(root, full), text: fs.readFileSync(full, "utf8") });
      }
    }
  }

  walk(path.join(root, "scripts", "server"));
  walk(path.join(root, "scripts", "search"));
  walk(path.join(root, "scripts", "config"));
  walk(path.join(root, "app", "frontend", "src"));
  out.push({ file: "app/frontend/public/sw.js", text: readSource("app/frontend/public/sw.js") });
  out.push({ file: "app/frontend/index.html", text: readSource("app/frontend/index.html") });
  out.push({ file: "README.md", text: readSource("README.md") });
  return out;
}

function hostsIn(text) {
  const hosts = [];
  const re = /https?:\/\/([a-zA-Z0-9._-]+)/g;
  let match;
  while ((match = re.exec(text)) !== null) hosts.push(match[1].toLowerCase());
  return hosts;
}

/** Code without comments: a doc comment explaining that a switch is banned is
 *  not evidence that the switch came back. */
function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^\s*\*.*$/gm, "");
}

/**
 * Billable AI / media API hosts. These are the services the owner asked to
 * cut out: prepaid, per-token, subscription, or card-backed trial credit.
 * Social publishing platforms and code/model hosts are deliberately absent —
 * they are the owner's own accounts and have no LUKE-side billing.
 */
const BILLABLE_HOSTS = [
  "api.openai.com", "api.anthropic.com", "api.x.ai", "api.groq.com",
  "api.together.xyz", "api.fireworks.ai", "api.cerebras.ai", "api.sambanova.ai",
  "api.cohere.com", "api.replicate.com", "api.stability.ai", "api.fal.ai",
  "api.klingai.com", "api.deepseek.com", "api.perplexity.ai",
  "openai.azure.com", "api.githubcopilot.com",
];

// api.mistral.ai is deliberately NOT in the list above: Mistral's free mode is
// one of the registered no-card tiers, not a billable endpoint.

/** Hosts a free, no-card text transport is allowed to point at. */
const FREE_TRANSPORT_HOSTS = new Set([
  "127.0.0.1", "localhost",
  "integrate.api.nvidia.com",
  "openrouter.ai",
  "api.z.ai",
  "generativelanguage.googleapis.com",
  "api.mistral.ai",
]);

/** Tokens that could only exist if external media generation came back. */
const DELETED_MEDIA_TOKENS = [
  "online-media.cjs", "/api/online-media/", "onlineMedia", "onlineMediaEnabled",
  "kling_free", "fal_trial", "veo_gcp_trial", "stability_trial",
  "cardConfirmed", "budgetConfirmed", "freeAllowance", "LUKE_ONLINE_MEDIA_SPEND_FILE",
];

function main() {
  const sources = productionSources();
  const byName = new Map(sources.map((s) => [s.file, s.text]));
  const serve = byName.get("scripts/server/serve.cjs") || "";
  const catalogSource = byName.get("scripts/config/ai-provider-catalog.json") || "";
  const remoteSource = byName.get("scripts/server/remote-text-provider.cjs") || "";
  const surfacesSource = byName.get("scripts/server/online-surfaces.cjs") || "";
  const panelSource = byName.get("app/frontend/src/components/OnlineSurfacesPanel.jsx") || "";
  const settingsSource = byName.get("app/frontend/src/components/Settings.jsx") || "";

  // ── 1. There is no switch that could turn paying on ───────────────────────
  section("1. No-pay is an invariant, not a setting");
  check("NO_PAY is exported as true", onlineSurfaces.NO_PAY === true);
  check("the policy has exactly seven switches",
    Object.keys(onlineSurfaces.DEFAULTS).length === 7,
    Object.keys(onlineSurfaces.DEFAULTS).join(", "));
  check("no freeOnly / paid / billing switch exists in the policy",
    !Object.keys(onlineSurfaces.DEFAULTS).some((key) => /freeOnly|paid|bill|credit|card/i.test(key)));
  onlineSurfaces.setConfig({ freeOnly: false, paidAllowed: true, budgetConfirmed: true });
  const stored = onlineSurfaces.getConfig();
  check("a hand-edited config cannot persist an allow-paid switch",
    !("freeOnly" in stored) && !("paidAllowed" in stored) && !("budgetConfirmed" in stored));
  check("no freeOnly literal survives in the live server, policy or chain code",
    !/freeOnly/.test(codeOnly(serve) + codeOnly(surfacesSource) + codeOnly(remoteSource)));
  check("the gateway advertises the invariant, not a toggle",
    /noPay: onlineSurfaces\.NO_PAY/.test(serve));
  check("the chain contains the fail-closed free check",
    /provider\?\.free !== true/.test(remoteSource)
    && /no-pay invariant: this provider is not a registered free tier/.test(remoteSource));

  // ── 2. The catalogue and transport registry contain nothing billable ──────
  section("2. Every registered provider is free and card-free");
  const catalog = aiCatalog.readCatalog();
  check("the catalogue parses and is non-empty", catalog.providers.length >= 8, String(catalog.providers.length));
  check("every entry is free, unpaid and card-free",
    catalog.providers.every((e) => e.free === true && e.paid === false && e.requiresCard === false));
  check("every entry is a recurring free tier or a local engine",
    catalog.providers.every((e) => ["free-tier", "local"].includes(e.kind)));
  const REMOVED = [
    "groq", "arena", "openai", "anthropic", "xai", "azure", "aws", "gcp", "oci",
    "amd", "cerebras", "sambanova", "github_models", "huggingface", "together",
    "fireworks", "coreweave", "cohere",
  ];
  check("no deleted billable id is registered",
    REMOVED.every((id) => !catalog.providers.some((e) => e.id === id)
      && !catalogSource.includes(`"${id}"`)));
  check("an unknown provider fails closed to paid",
    aiCatalog.transportPolicy("totally-unknown").free === false
    && aiCatalog.transportPolicy("totally-unknown").paid === true);
  const transports = Object.values(remoteProvider.PROVIDERS);
  check("every transport is free and unpaid", transports.length > 0
    && transports.every((p) => p.free === true && p.paid === false));
  check("Groq and the paid Arena router are not in the transport registry",
    !remoteProvider.PROVIDERS.groq && !remoteProvider.PROVIDERS.arena);
  check("every transport host is on the free allowlist",
    transports.every((p) => FREE_TRANSPORT_HOSTS.has(hostsIn(p.baseUrl || "")[0])),
    transports.map((p) => `${p.id}=${p.baseUrl}`).join(" | "));

  // ── 3. No billable endpoint is hard-coded anywhere in production code ─────
  section("3. Hidden billable endpoints");
  const allHosts = new Set(sources.flatMap((s) => hostsIn(s.text)));
  const billableFound = BILLABLE_HOSTS.filter((host) => allHosts.has(host)
    || sources.some((s) => s.text.includes(`${host}`)));
  check("no known billable AI/media API host is referenced",
    billableFound.length === 0, billableFound.join(", "));
  check("the free Gemini and NVIDIA hosts are still allowed",
    allHosts.has("generativelanguage.googleapis.com") && allHosts.has("integrate.api.nvidia.com"));
  const freeTextHosts = ["api.mistral.ai", "openrouter.ai", "api.z.ai"];
  check("the remaining text transports are the researched free tiers",
    freeTextHosts.every((h) => hostsIn(remoteSource).includes(h)));
  check("the search core uses DuckDuckGo only",
    hostsIn(byName.get("scripts/search/providers.js") || "").every((h) => /duckduckgo\.com/.test(h)));
  check("S3-compatible storage has no hard-coded endpoint",
    !hostsIn(byName.get("scripts/server/s3-compatible-storage-adapter.cjs") || "")
      .some((h) => !/^(localhost|127\.0\.0\.1)$/.test(h)));
  check("the PWA shell does not load an external font CDN",
    !/fonts\.googleapis\.com/.test(byName.get("app/frontend/index.html") || ""));

  // ── 4. External media generation is deleted, not disabled ────────────────
  section("4. External media generation");
  check("the online-media module does not exist",
    !fs.existsSync(path.join(root, "scripts", "server", "online-media.cjs")));
  const offenders = [];
  for (const token of DELETED_MEDIA_TOKENS) {
    for (const source of sources) {
      if (source.text.includes(token)) offenders.push(`${source.file}: ${token}`);
    }
  }
  check("no deleted media token survives in any production source",
    offenders.length === 0, offenders.slice(0, 6).join(" | "));
  check("no online-media route remains in serve.cjs", !/online-media/.test(serve));
  check("the panel shows exactly seven switches",
    (panelSource.match(/\{ key: "/g) || []).length === 7);
  check("Settings counts seven switches", /count=\{7\}/.test(settingsSource));
  check("the panel says media is produced locally",
    /Media stays on this machine/i.test(panelSource));
  check("the local engines are still wired in",
    /whisper/i.test(serve) && /kokoro/i.test(serve)
    && /stable-diffusion/i.test(serve) && /image-to-video/i.test(serve));
  check("the ledger attestation says media never leaves the machine",
    /Media generation\s+is local only/.test(egressLedger.report().attestation));

  // ── 5. The local model is still the last resort ──────────────────────────
  section("5. When the free tiers are exhausted, LUKE falls back to local");
  check("the chain still exposes a local fallback",
    typeof remoteProvider.setLocalProvider === "function" && /useLocalFallback/.test(remoteSource));
  check("the local bridge route still exists",
    serve.includes("/api/text-runtime/remote-provider/local"));
  check("Chat is online-first by default",
    onlineSurfaces.cloudDecision("chat").allowed === true
    && onlineSurfaces.cloudDecision("work").allowed === true);
  check("air-gap mode refuses the cloud turn and does not buy anything",
    (() => {
      onlineSurfaces.setConfig({ airGapMode: true });
      const d = onlineSurfaces.cloudDecision("chat");
      onlineSurfaces.setConfig({ airGapMode: false });
      return d.allowed === false;
    })());
  check("the no-filter lane stays on the local GGUF model",
    (() => {
      onlineSurfaces.setConfig({ uncensoredMode: true });
      const d = onlineSurfaces.cloudDecision("chat");
      onlineSurfaces.setConfig({ uncensoredMode: false });
      return d.allowed === false && /local GGUF/.test(d.reason);
    })());
  check("turning off online-first Chat keeps the local model",
    (() => {
      onlineSurfaces.setConfig({ cloudForChat: false });
      const d = onlineSurfaces.cloudDecision("chat");
      onlineSurfaces.setConfig({ cloudForChat: true });
      return d.allowed === false && onlineSurfaces.cloudDecision("work").allowed === true;
    })());
  check("an empty ledger attests to zero paid endpoints",
    egressLedger.clear() && /Paid endpoints called: 0/.test(egressLedger.report().attestation));

  // ── 6. Documentation states the boundary, not a wish ─────────────────────
  section("6. Documentation");
  const readme = byName.get("README.md") || "";
  check("README says no paid provider is registered at all",
    /No paid provider is registered at all/.test(readme));
  check("README no longer advertises online media generation",
    !/online media|trial-credit media|consent-gated trial/i.test(readme));
  const doc = readSource("docs/beta7/online-surfaces-and-differentiation.md");
  check("the differentiation doc states that media is local only",
    /สื่อ.*local|local.*สื่อ|media.*local/i.test(doc));
  check("the doc no longer lists an online-media API",
    !/\/api\/online-media\//.test(doc));
}

main();
fs.rmSync(scratch, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
