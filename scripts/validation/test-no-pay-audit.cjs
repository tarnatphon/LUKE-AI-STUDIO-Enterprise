"use strict";

/**
 * No-pay audit — a whole-repo regression guard, not a feature test.
 *
 * "เสียตังค์" means having to PAY TO KEEP USING something. It does not mean
 * "this vendor also sells a paid plan". So a no-card free tier, a free daily
 * allowance and a card-backed trial grant are all usable free usage: LUKE uses
 * the grant fully and, when it is spent (or a provider answers 402), refuses
 * to pay and falls back to the local model / local media engines.
 *
 * The feature suites prove that behaviour. This suite asks a different
 * question: did a *payment path* sneak back in anywhere else? It walks the
 * production sources and asserts that nothing tops up, upgrades, stores card
 * data, accepts a payment field, bypasses a 402, or registers a provider that
 * needs payment from the first call. It also asserts the opposite failure —
 * that free usage was not deleted in the name of "no-pay".
 *
 * Adding a new free provider or outbound host requires deliberately editing an
 * allowlist below and saying why. A hidden paid path should never land silently.
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
process.env.LUKE_ONLINE_MEDIA_SPEND_FILE = path.join(scratch, "media-spend.json");

const aiCatalog = require(path.join(root, "scripts", "server", "ai-provider-catalog.cjs"));
const onlineSurfaces = require(path.join(root, "scripts", "server", "online-surfaces.cjs"));
const egressLedger = require(path.join(root, "scripts", "server", "egress-ledger.cjs"));
const remoteProvider = require(path.join(root, "scripts", "server", "remote-text-provider.cjs"));
const onlineMedia = require(path.join(root, "scripts", "server", "online-media.cjs"));

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

/** Hosts whose API requires payment from the FIRST call. Everything else is
 *  judged by whether the catalogue registers usable free usage, not by the
 *  vendor's price list. Social/code/model hosts are deliberately absent. */
const PREPAID_API_HOSTS = [
  "api.openai.com", "api.anthropic.com", "api.x.ai", "api.together.xyz",
  "api.fireworks.ai", "api.preview.arena.ai", "api.replicate.com",
  "api.deepseek.com", "api.perplexity.ai", "openai.azure.com",
  "api.githubcopilot.com", "bedrock-runtime",
];

/** Payment behaviour that must never appear in executable production code.
 *  `online-media.cjs` is excluded: it lists these tokens only to REJECT them. */
const PAYMENT_CODE = /\b(cardNumber|card_number|cvv|cvc|autoTopUp|topUp|paymentMethod|payment_method|paidPlan|allowPaid|cardConfirmed|paidUpgrade|creditCard|billingAddress|paymentIntent|checkoutSession)\b/i;

/** Hosts a transport with usable free usage is allowed to point at. */
const FREE_TRANSPORT_HOSTS = new Set([
  "127.0.0.1", "localhost",
  "integrate.api.nvidia.com",
  "openrouter.ai",
  "api.z.ai",
  "generativelanguage.googleapis.com",
  "api.mistral.ai",
  // Groq has a reported free plan for open models. It is registered but not in
  // DEFAULT_ORDER, and a 402 classifies it as now_paid and falls to local.
  "api.groq.com",
]);

/** Hosts whose free credit LUKE may spend until the grant is exhausted. */
const FREE_CREDIT_HOSTS = new Set([
  "fal.ai", "cloud.google.com", "stability.ai", "klingai.com",
]);

async function main() {
  const sources = productionSources();
  const byName = new Map(sources.map((s) => [s.file, s.text]));
  const serve = byName.get("scripts/server/serve.cjs") || "";
  const remoteSource = byName.get("scripts/server/remote-text-provider.cjs") || "";
  const surfacesSource = byName.get("scripts/server/online-surfaces.cjs") || "";
  const mediaSource = byName.get("scripts/server/online-media.cjs") || "";
  const panelSource = byName.get("app/frontend/src/components/OnlineSurfacesPanel.jsx") || "";
  const settingsSource = byName.get("app/frontend/src/components/Settings.jsx") || "";

  // ── 1. No-pay is an invariant, not a setting ──────────────────────────────
  section("1. No-pay is an invariant, not a setting");
  check("NO_PAY is exported as true", onlineSurfaces.NO_PAY === true);
  check("the policy has exactly eight switches",
    Object.keys(onlineSurfaces.DEFAULTS).length === 8,
    Object.keys(onlineSurfaces.DEFAULTS).join(", "));
  check("no freeOnly / paid / billing switch exists in the policy",
    !Object.keys(onlineSurfaces.DEFAULTS).some((key) => /freeOnly|paid|bill|card/i.test(key)));
  onlineSurfaces.setConfig({ freeOnly: false, paidAllowed: true, allowPaid: true });
  const stored = onlineSurfaces.getConfig();
  check("a hand-edited config cannot persist an allow-paid switch",
    !("freeOnly" in stored) && !("paidAllowed" in stored) && !("allowPaid" in stored));
  check("no freeOnly literal survives in the live server, policy or chain code",
    !/freeOnly/.test(codeOnly(serve) + codeOnly(surfacesSource) + codeOnly(remoteSource)));
  check("the gateway advertises the invariant, not a toggle",
    /noPay: onlineSurfaces\.NO_PAY/.test(serve));
  check("the chain contains the fail-closed free check",
    /provider\?\.free !== true/.test(remoteSource)
    && /no-pay invariant: this provider is not a registered free tier/.test(remoteSource));
  check("a 402 is classified as now_paid and walks away, never upsells",
    /code === 402/.test(remoteSource) && /code: "now_paid"/.test(remoteSource)
    && /fall back to the local model/.test(remoteSource));

  // ── 2. The catalogue registers usable free usage, not paid-only vendors ───
  section("2. Every registered provider has usable free usage");
  const catalog = aiCatalog.readCatalog();
  check("the catalogue parses and is non-empty", catalog.providers.length >= 8, String(catalog.providers.length));
  check("every entry is free, unpaid and marked neverPays",
    catalog.providers.every((e) => e.free === true && e.paid === false && e.neverPays === true));
  check("a card is allowed only for a free trial grant bound on the provider site",
    catalog.providers.every((e) => e.requiresCard !== true
      || (e.kind === "trial-credit" && e.cardBoundOnProviderSite === true)));
  check("only free tiers, free trial credit and local engines remain",
    catalog.providers.every((e) => ["free-tier", "trial-credit", "local"].includes(e.kind)));
  check("every non-local entry says exhausted free usage goes to local",
    catalog.providers.filter((e) => e.kind !== "local")
      .every((e) => e.exhaustion === "local" && typeof e.allowance === "string"));
  check("free trial grants are free only while the credit lasts",
    catalog.providers.filter((e) => e.kind === "trial-credit")
      .every((e) => e.freeWhileCreditsLast === true));
  const PAID_ONLY = [
    "arena", "openai", "anthropic", "xai", "oci", "together", "fireworks",
    "coreweave", "github_models", "amd",
  ];
  check("no prepaid / paid-from-first-call id is registered",
    PAID_ONLY.every((id) => !catalog.providers.some((e) => e.id === id)));
  check("card-backed trial credit was restored, not cut",
    ["azure", "aws", "gcp", "cerebras"].every((id) => catalog.providers.some((e) => e.id === id)));
  check("an unknown provider fails closed to paid",
    aiCatalog.transportPolicy("totally-unknown").free === false
    && aiCatalog.transportPolicy("totally-unknown").paid === true);
  const transports = Object.values(remoteProvider.PROVIDERS);
  check("every transport is free and unpaid", transports.length > 0
    && transports.every((p) => p.free === true && p.paid === false));
  check("the prepaid Arena router is deleted; Groq is free but not auto-enabled",
    !remoteProvider.PROVIDERS.arena && remoteProvider.PROVIDERS.groq?.free === true
    && !remoteProvider.DEFAULT_ORDER.includes("groq"));
  check("every transport host is on the free-usage allowlist",
    transports.every((p) => FREE_TRANSPORT_HOSTS.has(hostsIn(p.baseUrl || "")[0])),
    transports.map((p) => `${p.id}=${p.baseUrl}`).join(" | "));

  // ── 3. No payment path exists anywhere in production code ────────────────
  section("3. Hidden payment paths");
  const allText = sources.map((s) => s.text).join("\n");
  const prepaidFound = PREPAID_API_HOSTS.filter((host) => allText.includes(host));
  check("no prepaid AI/media API host is referenced in production code",
    prepaidFound.length === 0, prepaidFound.join(", "));
  const paymentOffenders = sources
    .filter((s) => /\.(cjs|mjs|jsx?)$/.test(s.file) && !s.file.endsWith("online-media.cjs"))
    .filter((s) => PAYMENT_CODE.test(codeOnly(s.text)))
    .map((s) => s.file);
  check("no executable code accepts card, top-up, upgrade or billing fields",
    paymentOffenders.length === 0, paymentOffenders.join(", "));
  check("the media module lists those fields only in a rejection denylist",
    /const PAYMENT_FIELDS = Object\.freeze\(\[/.test(mediaSource)
    && /assertNoPaymentFields\(request\);/.test(mediaSource)
    && mediaSource.indexOf("assertNoPaymentFields(request);") < mediaSource.indexOf("const quoted = quote("));
  check("cardConfirmed is a rejected field, not a gate",
    onlineMedia.PAYMENT_FIELDS.includes("cardConfirmed")
    && !/request\.cardConfirmed === true/.test(mediaSource));
  const freeTextHosts = ["api.mistral.ai", "openrouter.ai", "api.z.ai", "api.groq.com"];
  check("the text transports are the researched free tiers",
    freeTextHosts.every((h) => hostsIn(remoteSource).includes(h)));
  check("the free Gemini and NVIDIA hosts are still allowed",
    hostsIn(remoteSource).includes("generativelanguage.googleapis.com")
    && hostsIn(remoteSource).includes("integrate.api.nvidia.com"));
  check("every free-credit media host is on the allowlist",
    Object.values(onlineMedia.PROVIDERS).every((p) => FREE_CREDIT_HOSTS.has(hostsIn(p.host)[0])),
    Object.values(onlineMedia.PROVIDERS).map((p) => p.host).join(" | "));
  check("the search core uses DuckDuckGo only",
    hostsIn(byName.get("scripts/search/providers.js") || "").every((h) => /duckduckgo\.com/.test(h)));
  check("S3-compatible storage has no hard-coded endpoint",
    !hostsIn(byName.get("scripts/server/s3-compatible-storage-adapter.cjs") || "")
      .some((h) => !/^(localhost|127\.0\.0\.1)$/.test(h)));
  check("the PWA shell does not load an external font CDN",
    !/fonts\.googleapis\.com/.test(byName.get("app/frontend/index.html") || ""));

  // ── 4. Free credit is usable, and exhaustion goes to local ────────────────
  section("4. Free credit is used normally; exhausting it never pays");
  check("the free-credit media module exists",
    fs.existsSync(path.join(root, "scripts", "server", "online-media.cjs")));
  const mediaProviders = Object.values(onlineMedia.PROVIDERS);
  check("four free-credit providers are registered, all unpaid",
    mediaProviders.length === 4 && mediaProviders.every((p) => p.paid === false
      && p.freeWhileCreditsLast === true && p.exhaustion === "local"));
  check("card-backed trial grants are usable free usage",
    mediaProviders.filter((p) => p.requiresCard).length === 3
    && mediaProviders.filter((p) => p.requiresCard).every((p) => p.cardBoundOnProviderSite === true));
  onlineMedia.resetSpend();
  check("a card-backed trial can be quoted without any card flag",
    onlineMedia.quote("fal_trial", "video").eligible === true);
  check("a quote reports free credit, not a price",
    onlineMedia.quote("kling_free", "video").neverPays === true
    && onlineMedia.quote("kling_free", "video").fallback === "local");

  const reject = async (extra, code) => {
    try {
      await onlineMedia.generate({ providerId: "kling_free", kind: "video", prompt: "cat", ...extra });
      return false;
    } catch (error) { return error.code === code; }
  };
  check("a card number is refused before any ledger entry",
    await reject({ cardNumber: "4242" }, "payment_field_rejected"));
  check("an auto top-up flag is refused", await reject({ autoTopUp: true }, "payment_field_rejected"));
  check("a paid-plan flag is refused", await reject({ paidPlan: "pro" }, "payment_field_rejected"));

  onlineMedia.resetSpend();
  const dispatched = [];
  const options = { transport: async () => { dispatched.push(1); return { status: 200, body: "ok" }; } };
  const consent = { providerId: "kling_free", kind: "image", prompt: "cat", explicitConsent: true, creditConfirmed: true, live: true };
  for (let index = 0; index < onlineMedia.PROVIDERS.kling_free.grantedCredits; index += 1) {
    await onlineMedia.generate(consent, options);
  }
  check("the whole free grant is used before LUKE stops", dispatched.length === 6, String(dispatched.length));
  check("the job after the grant is spent is refused with fallback local",
    await (async () => {
      try { await onlineMedia.generate(consent, options); return false; }
      catch (error) { return error.statusCode === 409 && error.code === "free_credit_exhausted" && error.fallback === "local"; }
    })());
  check("and no extra dispatch was attempted", dispatched.length === 6, String(dispatched.length));

  onlineMedia.resetSpend();
  check("a 402 marks the grant spent and refuses instead of paying",
    await (async () => {
      try {
        await onlineMedia.generate({ ...consent, providerId: "fal_trial" },
          { transport: async () => ({ status: 402, body: "Payment Required" }) });
        return false;
      } catch (error) {
        return error.code === "now_paid" && error.fallback === "local"
          && onlineMedia.quote("fal_trial", "video").remaining === 0;
      }
    })());

  onlineMedia.resetSpend();
  const spendState = JSON.parse(fs.readFileSync(onlineMedia.spendFile(), "utf8"));
  check("the spend file holds a credit counter and no card or payment data",
    Object.keys(spendState).every((key) => ["spent", "day", "savedAt"].includes(key))
    && !/card|cvv|payment|topup/i.test(JSON.stringify(spendState)));
  check("the three free-credit routes are declared and gated by their own switch",
    ["/api/online-media/providers", "/api/online-media/quote", "/api/online-media/generate"]
      .every((route) => serve.includes(route))
    && /onlineSurfaces\.policy\(\)\.onlineMediaEnabled/.test(serve));
  check("the panel shows eight switches and Settings counts eight",
    (panelSource.match(/\{ key: "/g) || []).length === 8
    && /count=\{8\}/.test(settingsSource));
  check("the panel explains that exhausted credit falls back to local",
    /fall back to the local|local engines/i.test(panelSource));
  check("the local engines are still wired in",
    /whisper/i.test(serve) && /kokoro/i.test(serve)
    && /stable-diffusion/i.test(serve) && /image-to-video/i.test(serve));
  check("the ledger attestation says free credit only and never pays",
    /free credit only: LUKE never pays/.test(egressLedger.report().attestation)
    && /falls back to the local|local\s+engines/i.test(egressLedger.report().attestation));

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
  check("free-credit media is off until the owner switches it on",
    onlineSurfaces.DEFAULTS.onlineMediaEnabled === false);
  check("an empty ledger attests to zero paid endpoints",
    egressLedger.clear() && /Paid endpoints called: 0/.test(egressLedger.report().attestation));

  // ── 6. Documentation states the boundary, not a wish ─────────────────────
  section("6. Documentation");
  const readme = byName.get("README.md") || "";
  check("README says free usage is used until it is spent, then local",
    /Free usage is used until it is spent, then local/i.test(readme));
  check("README says no provider requiring payment from the first call is registered",
    /No provider that requires payment from the first call is registered/i.test(readme));
  check("README explains card-backed trial grants are usable free usage",
    /card-backed/i.test(readme) && /never tops up or pays/i.test(readme));
  const doc = readSource("docs/beta7/online-surfaces-and-differentiation.md");
  check("the differentiation doc states the owner's definition of เสียตังค์",
    /ต้องจ่ายตังค์มาใช้ต่อ/.test(doc));
  check("the doc lists the free-credit media API again",
    /\/api\/online-media\/generate/.test(doc));
  check("the doc says the credit is used until spent, then local",
    /หมด.*local|local.*หมด|exhaust/i.test(doc));
}

main()
  .catch((error) => {
    failed += 1;
    console.error(error);
  })
  .finally(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  });
