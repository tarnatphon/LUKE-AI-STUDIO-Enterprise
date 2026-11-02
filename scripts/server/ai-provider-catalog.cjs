"use strict";

/**
 * The one catalogue of truth for LUKE's online surfaces.
 *
 * Free tiers rotate faster than a release cycle. Rather than sprinkling
 * "is this still free?" comments through the transport code, the facts live in
 * scripts/config/ai-provider-catalog.json with a visible `verifiedAt` date and
 * a source URL. This file only reads them; it never decides pricing by itself.
 *
 * Paid, prepaid, subscription, card-backed trial-credit and hardware entries
 * were removed from the catalogue outright. There is no "allow paid" switch
 * left anywhere: the chain only ever calls a provider whose catalogue entry
 * says free=true. An unknown id fails closed. That is what makes "use every
 * free thing, then fall back to local — never pay" structural rather than a
 * setting someone can turn off.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_CATALOG_FILE = path.join(ROOT, "scripts", "config", "ai-provider-catalog.json");

function catalogFile() {
  const override = String(process.env.LUKE_AI_PROVIDER_CATALOG || "").trim();
  return override || DEFAULT_CATALOG_FILE;
}

function readCatalog() {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogFile(), "utf8"));
    const providers = Array.isArray(parsed?.providers) ? parsed.providers : [];

    return {
      verifiedAt: String(parsed?.verifiedAt || "").trim(),
      providers: providers.filter((entry) => entry && typeof entry.id === "string"),
      path: path.relative(ROOT, catalogFile()),
    };
  } catch {
    // A missing or hand-broken catalogue fails closed: nothing is treated as
    // a free transport, so no paid endpoint can be reached by accident.
    return { verifiedAt: "", providers: [], path: path.relative(ROOT, catalogFile()) };
  }
}

function entryFor(providerId) {
  const id = String(providerId || "").trim();
  return readCatalog().providers.find((entry) => entry.id === id) || null;
}

/** Transport metadata merged into a PROVIDERS entry. */
function transportPolicy(providerId, fallback = {}) {
  const entry = entryFor(providerId);

  // Fail closed. An unknown provider is never assumed free, and `paid` is
  // derived from `free` rather than trusted as a separate field — a hand-edited
  // catalogue cannot resurrect a billable link by flipping one flag.
  const free = entry ? entry.free === true : fallback.free === true;
  return {
    free,
    paid: !free,
    modalities: entry && Array.isArray(entry.modalities)
      ? entry.modalities
      : (Array.isArray(fallback.modalities) ? fallback.modalities : ["text"]),
    uncensored: entry ? entry.uncensored === true : fallback.uncensored === true,
    verifiedAt: entry ? readCatalog().verifiedAt : "",
    // The transport's own `note` is UI copy with wording the validation suites
    // assert. The catalogue note is research prose and lives under its own key
    // so merging the facts never rewrites what the Settings panel says.
    catalogNote: entry ? String(entry.note || "") : "",
  };
}

/** What Settings shows: no keys, no secrets, just the decision table. */
function summary() {
  const catalog = readCatalog();
  const providers = catalog.providers.map((entry) => ({
    id: entry.id,
    label: entry.label,
    group: entry.group,
    kind: entry.kind,
    free: entry.free === true,
    paid: entry.free !== true,
    requiresCard: entry.requiresCard === true,
    uncensored: entry.uncensored === true,
    modalities: Array.isArray(entry.modalities) ? entry.modalities : [],
    transport: entry.transport === true,
    rateLimit: String(entry.rateLimit || ""),
    sourceUrl: String(entry.sourceUrl || ""),
    note: String(entry.note || ""),
  }));

  return {
    verifiedAt: catalog.verifiedAt,
    file: catalog.path,
    count: providers.length,
    freeCount: providers.filter((entry) => entry.free).length,
    transportCount: providers.filter((entry) => entry.transport).length,
    providers,
  };
}

module.exports = {
  catalogFile,
  readCatalog,
  entryFor,
  transportPolicy,
  summary,
  DEFAULT_CATALOG_FILE,
};
