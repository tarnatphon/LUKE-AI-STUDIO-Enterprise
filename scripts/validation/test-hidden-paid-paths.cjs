"use strict";

/**
 * Hidden paid paths — closes the blind spots left by test-no-pay-audit.cjs.
 *
 * "เสียตังค์" = having to PAY TO KEEP USING. Free tiers, no-card daily
 * allowances and card-backed trial grants are usable free usage until spent;
 * then LUKE falls back to local. The older audit already proves the policy,
 * but its source walk covered only four directories and its denylist missed
 * payment processors, upgrade handles and pricing URLs. It also never read
 * the catalogue's own _readme, which still claimed (from PR #80) that
 * card-backed trial credit had been deleted — a stale instruction that could
 * make a contributor repeat an overbroad deletion the owner explicitly
 * corrected in PR #82.
 *
 * This suite walks the WHOLE production tree, refuses the extended payment
 * vocabulary, pins the catalogue's self-description to its real data, and
 * exercises consent / dry-run / exhaustion / 402 behaviour for every provider.
 *
 * Run: node scripts/validation/test-hidden-paid-paths.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "luke-hidden-paid-paths-"));

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

// ── Whole production tree ──────────────────────────────────────────────────
// test-no-pay-audit.cjs only walked scripts/server, scripts/search,
// scripts/config and app/frontend/src. The updater runs on EVERY launch, the
// social-agency token helpers talk to Graph/LinkedIn, and the public PWA
// shell can carry an outbound URL — none of them were scanned.
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "runtime-state", "__pycache__", ".git",
  "validation", ".cache", ".pytest_cache", "Unselected files",
]);
const SOURCE_EXT = /\.(cjs|mjs|js|jsx|py|json|webmanifest|html|sh)$/;

function productionSources() {
  const out = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(full);
      } else if (SOURCE_EXT.test(entry.name)
        && !/package-lock\.json$/.test(entry.name)
        && !/\.min\.js$/.test(entry.name)) {
        out.push({ file: path.relative(root, full), text: fs.readFileSync(full, "utf8") });
      }
    }
  }
  walk(path.join(root, "scripts"));
  walk(path.join(root, "app", "frontend", "src"));
  walk(path.join(root, "app", "frontend", "public"));
  for (const name of ["mac.sh", "linux.sh", "start.sh", "sync.sh", "validate.sh", "README.md"]) {
    const full = path.join(root, name);
    if (fs.existsSync(full)) out.push({ file: name, text: fs.readFileSync(full, "utf8") });
  }
  const indexHtml = path.join(root, "app", "frontend", "index.html");
  if (fs.existsSync(indexHtml)) {
    out.push({ file: "app/frontend/index.html", text: fs.readFileSync(indexHtml, "utf8") });
  }
  return out;
}

function codeOnly(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/^\s*\*.*$/gm, "")
    .replace(/^\s*#.*$/gm, "");
}

const PAYMENT_PROCESSOR_HOSTS = [
  "api.stripe.com", "checkout.stripe.com", "js.stripe.com", "buy.stripe.com",
  "paypal.com", "api-m.paypal.com", "api.paddle.com", "checkout.paddle.com",
  "api.lemonsqueezy.com", "lemonsqueezy.com", "gumroad.com", "api.gumroad.com",
];
const PAYMENT_ENV = /process\.env\.[A-Z0-9_]*(STRIPE|PAYPAL|PADDLE|PAYMENT|BILLING|CHECKOUT|SUBSCRIPTION)[A-Z0-9_]*/;
const PRICING_URL = /https?:\/\/[^\s"'`)}]*\/(checkout|billing|subscribe|upgrade|pricing|pay|donate|purchase|plans)\b/i;
const UPGRADE_FIELDS = /\b(buyCredits|addCredits|subscriptionId|paymentUrl|checkoutUrl|billingKey|priceId|planId|autoRenew|creditCard|cardToken|paymentToken|stripe|paypal|paddle|lemonsqueezy|gumroad)\b/;

/** Strip ONLY the rejection denylist declaration, so a real use of one of its
 *  words anywhere else in online-media.cjs is still caught. */
function withoutDenylistDeclaration(text) {
  const begin = text.indexOf("const PAYMENT_FIELDS = Object.freeze([");
  if (begin < 0) return text;
  const end = text.indexOf("]);", begin);
  if (end < 0) return text;
  return text.slice(0, begin) + text.slice(end + 3);
}

async function main() {
  console.log("hidden paid paths validation");
  const sources = productionSources();
  const byName = new Map(sources.map((s) => [s.file, s.text]));
  const mediaSource = byName.get("scripts/server/online-media.cjs") || "";
  const remoteSource = byName.get("scripts/server/remote-text-provider.cjs") || "";
  const serve = byName.get("scripts/server/serve.cjs") || "";
  const panel = byName.get("app/frontend/src/components/OnlineSurfacesPanel.jsx") || "";

  section("1. The audit can actually see the whole production tree");
  check("the walk is not empty", sources.length > 100, String(sources.length));
  for (const file of [
    "scripts/updater/update.cjs",
    "scripts/cloud-doctor.cjs",
    "scripts/social-agency-fb-token.cjs",
    "scripts/social-agency-linkedin-token.cjs",
    "scripts/setup/check-frontend-build.sh",
    "app/frontend/public/manifest.webmanifest",
    "app/frontend/index.html",
    "scripts/config/ai-provider-catalog.json",
    "README.md",
  ]) {
    check(`scans ${file}`, byName.has(file));
  }
  check("the updater (runs on every launch) is inside the audit's reach",
    (byName.get("scripts/updater/update.cjs") || "").includes("manifestUrl"));

  section("2. No payment processor, env var, pricing URL or upgrade handle");
  const allCode = sources.map((s) => codeOnly(s.text)).join("\n");
  const processors = PAYMENT_PROCESSOR_HOSTS.filter((host) => allCode.includes(host));
  check("no payment processor host appears in production code",
    processors.length === 0, processors.join(", "));
  check("no payment/billing environment variable is read", !PAYMENT_ENV.test(allCode));
  const pricing = sources
    .filter((s) => PRICING_URL.test(codeOnly(s.text)))
    .map((s) => s.file);
  check("no outbound URL points at checkout/billing/subscribe/upgrade/pricing",
    pricing.length === 0, pricing.join(", "));
  // `planId` in storage-lifecycle-manager.cjs names a CLEANUP plan
  // ("cleanup-plan-created" event), not a billing/subscription plan. Every
  // other occurrence of this vocabulary is a real payment handle.
  const NON_BILLING_PLAN = new Set(["scripts/server/storage-lifecycle-manager.cjs"]);
  const upgradeOffenders = sources
    .filter((s) => !NON_BILLING_PLAN.has(s.file))
    .filter((s) => UPGRADE_FIELDS.test(codeOnly(
      s.file === "scripts/server/online-media.cjs" ? withoutDenylistDeclaration(s.text) : s.text)))
    .map((s) => `${s.file}:${(codeOnly(s.text).match(UPGRADE_FIELDS) || [])[0]}`);
  check("payment-processor and upgrade handles appear ONLY in the rejection denylist",
    upgradeOffenders.length === 0, upgradeOffenders.join(", "));
  check("the extended denylist is actually enforced before the quote",
    onlineMedia.PAYMENT_FIELDS.includes("priceId")
    && onlineMedia.PAYMENT_FIELDS.includes("stripe")
    && mediaSource.indexOf("assertNoPaymentFields(request);") < mediaSource.indexOf("const quoted = quote("));

  section("3. The catalogue describes the data it actually holds");
  const catalogRaw = JSON.parse(fs.readFileSync(path.join(root, "scripts", "config", "ai-provider-catalog.json"), "utf8"));
  const readme = catalogRaw._readme.join("\n");
  check("the stale PR #80 claim that trial credit was removed is gone",
    !/removed outright|no payment card|requiresCard=false|kind is only 'free-tier' or 'local'/.test(readme));
  check("the catalogue still declares the owner's definition of เสียตังค์",
    /PAY TO KEEP USING/.test(catalogRaw.policy.meaning) || /ต้องจ่ายตังค์มาใช้ต่อ/.test(catalogRaw.policy.meaning));
  check("the catalogue explains that card-backed trial credit is usable free usage",
    /trial-credit/.test(readme) && /trial grant/.test(readme));
  check("requiresCard is documented as informational, never a gate",
    /INFORMATIONAL only/.test(readme) && /never uses requiresCard as a gate/.test(readme));
  const catalog = aiCatalog.readCatalog();
  check("every invariant the readme states is true of the data",
    catalog.providers.every((e) => e.free === true && e.paid === false && e.neverPays === true)
    && catalog.providers.every((e) => ["free-tier", "trial-credit", "local"].includes(e.kind))
    && catalog.providers.filter((e) => e.kind !== "local")
      .every((e) => e.exhaustion === "local" && typeof e.allowance === "string")
    && catalog.providers.filter((e) => e.requiresCard)
      .every((e) => e.kind === "trial-credit" && e.cardBoundOnProviderSite === true
        && e.freeWhileCreditsLast === true));
  check("the readme lists the three suites that guard it",
    /test-online-surfaces\.cjs/.test(readme) && /test-no-pay-audit\.cjs/.test(readme)
    && /test-hidden-paid-paths\.cjs/.test(readme));

  section("4. requiresCard never becomes a gate");
  // A normalisation (`requiresCard: entry.requiresCard === true`) and a UI
  // display ternary (`item.requiresCard ? "(card on provider site)" : ""`)
  // are not gates. Only a control-flow condition or an eligibility decision
  // would turn the informational flag into a payment path.
  const REQUIRES_CARD_GATE = /(?:if|else if|while)\s*\([^)]*requiresCard|requiresCard[^\n]*\b(?:eligible|allowed|blocked|disabled|throw|return false)\b/i;
  const gateOffenders = sources
    .filter((s) => /\.(cjs|mjs|jsx?)$/.test(s.file))
    .filter((s) => REQUIRES_CARD_GATE.test(codeOnly(s.text)))
    .map((s) => s.file);
  check("no executable condition branches on requiresCard",
    gateOffenders.length === 0, gateOffenders.join(", "));
  check("requiresCard only reaches the UI as a label, not a decision",
    /item\.requiresCard \?/.test(panel) && !/requiresCard.*(eligible|allowed|disabled)/i.test(panel));

  section("5. Consent, dry run and payment-field refusal (behaviour)");
  onlineMedia.resetSpend();
  const base = { providerId: "kling_free", kind: "image", prompt: "cat" };
  const calls = [];
  const transport = async () => { calls.push(1); return { status: 200, body: "ok" }; };
  const reject = async (extra, code) => {
    try {
      await onlineMedia.generate({ ...base, ...extra }, { transport });
      return false;
    } catch (error) { return error.code === code; }
  };
  check("no explicitConsent → consent_required, no dispatch",
    await reject({}, "consent_required") && calls.length === 0);
  check("no creditConfirmed → credit_confirmation_required, no dispatch",
    await reject({ explicitConsent: true }, "credit_confirmation_required") && calls.length === 0);
  const dry = await onlineMedia.generate({
    ...base, explicitConsent: true, creditConfirmed: true,
  }, { transport });
  check("the default is a consented dry run: nothing sent, no credit spent",
    dry.dryRun === true && dry.neverPaid === true && calls.length === 0
    && onlineMedia.quote("kling_free", "image").remaining === 6);
  for (const field of ["priceId", "stripe", "subscriptionId", "paid"]) {
    check(`a '${field}' field is refused with fallback local`,
      await (async () => {
        try {
          await onlineMedia.generate({
            ...base, explicitConsent: true, creditConfirmed: true, live: true, [field]: true,
          }, { transport });
          return false;
        } catch (error) {
          return error.code === "payment_field_rejected" && error.fallback === "local";
        }
      })());
  }
  check("no transport ran during any refusal", calls.length === 0, String(calls.length));
  const live = await onlineMedia.generate({
    ...base, explicitConsent: true, creditConfirmed: true, live: true,
  }, { transport });
  check("live:true is the only thing that dispatches", calls.length === 1 && live.neverPaid === true);

  section("6. Every provider's free grant is spent, then local — never a payment");
  for (const [id, provider] of Object.entries(onlineMedia.PROVIDERS)) {
    onlineMedia.resetSpend();
    let dispatched = 0;
    const job = {
      providerId: id, kind: "image", prompt: "cat",
      explicitConsent: true, creditConfirmed: true, live: true,
    };
    const options = { transport: async () => { dispatched += 1; return { status: 200, body: "ok" }; } };
    let used = 0;
    for (let i = 0; i < provider.grantedCredits; i += 1) {
      await onlineMedia.generate(job, options);
      used += 1;
    }
    let refused = null;
    try { await onlineMedia.generate(job, options); }
    catch (error) { refused = error; }
    check(`${id}: all ${provider.grantedCredits} free credits were used (${used} jobs)`,
      dispatched === provider.grantedCredits, String(dispatched));
    check(`${id}: the next job is 409 free_credit_exhausted → local, no extra dispatch`,
      refused?.statusCode === 409 && refused?.code === "free_credit_exhausted"
      && refused?.fallback === "local" && dispatched === provider.grantedCredits);
    check(`${id}: the spent state holds no payment or card data`,
      (() => {
        const state = JSON.parse(fs.readFileSync(onlineMedia.spendFile(), "utf8"));
        return Object.keys(state).every((k) => ["spent", "day", "savedAt"].includes(k))
          && !/card|cvv|payment|topup|stripe|paid/i.test(JSON.stringify(state));
      })());
  }

  section("7. A 402 never becomes an upsell or a paid ledger entry");
  const classified = remoteProvider.classifyRemoteError({ status: 402, body: "Payment Required", providerId: "groq" });
  check("402 is classified now_paid", classified.code === "now_paid");
  check("the message offers another free model or local, never an upgrade",
    !/upgrade|subscribe|buy|checkout|card|top.?up|purchase/i.test(classified.message)
    && /local model/.test(classified.message));
  check("now_paid is retryable so the chain walks to the next free link / local",
    remoteProvider.isRetryable("now_paid") === true);
  check("the chain still fails closed on any provider that is not a registered free tier",
    /provider\?\.free !== true/.test(remoteSource));
  egressLedger.clear();
  egressLedger.record({ decision: "blocked", paid: true, reason: "would be paid, refused" });
  check("a blocked 'would be paid' entry never counts as a paid endpoint call",
    egressLedger.stats().paidCalls === 0
    && /Paid endpoints called: 0/.test(egressLedger.report().attestation));
  onlineMedia.resetSpend();
  let paidLedger = 0;
  const paidAware = await (async () => {
    try {
      await onlineMedia.generate({
        providerId: "fal_trial", kind: "video", prompt: "cat",
        explicitConsent: true, creditConfirmed: true, live: true,
      }, {
        transport: async () => ({ status: 402, body: "Payment Required" }),
        recordEgress: (entry) => { if (entry.paid === true && entry.decision === "allowed") paidLedger += 1; },
      });
      return false;
    } catch (error) { return error; }
  })();
  check("a 402 refuses with fallback local and marks the grant spent",
    paidAware?.code === "now_paid" && paidAware?.fallback === "local"
    && onlineMedia.quote("fal_trial", "video").remaining === 0,
    JSON.stringify(paidAware?.code || paidAware));
  check("no allowed paid egress was recorded", paidLedger === 0, String(paidLedger));

  section("8. No billing route, no upgrade UI, invariant stays a constant");
  const billingRoutes = [...serve.matchAll(/"\/api\/[a-z0-9/_-]*(bill|pay|checkout|subscri|upgrade|topup|purchase|order)[a-z0-9/_-]*"/gi)]
    .map((m) => m[0]);
  check("no /api route name suggests billing, checkout, subscription or upgrade",
    billingRoutes.length === 0, billingRoutes.join(", "));
  const uiText = sources.filter((s) => s.file.startsWith("app/frontend/"))
    .map((s) => s.text).join("\n");
  check("the UI never says Upgrade / Subscribe / Buy credits / Add card",
    !/\b(Upgrade|Subscribe|Buy credits|Add card|Pay now|Billing portal)\b/i.test(uiText));
  check("no-pay is still an invariant, not a persisted switch",
    onlineSurfaces.NO_PAY === true
    && !Object.keys(onlineSurfaces.DEFAULTS).some((k) => /paid|bill|card|freeOnly/i.test(k)));
  onlineSurfaces.setConfig({ priceId: "price_123", stripe: true, paidAllowed: true });
  const stored = onlineSurfaces.getConfig();
  check("a hand-edited config cannot persist any payment handle",
    !("priceId" in stored) && !("stripe" in stored) && !("paidAllowed" in stored));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    failed += 1;
    console.error(error);
  })
  .finally(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });
