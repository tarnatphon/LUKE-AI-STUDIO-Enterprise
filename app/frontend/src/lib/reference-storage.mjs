/**
 * Reference-image persistence.
 *
 * A reference image is a full-resolution photo, and the Generator used to keep
 * every one of them in localStorage as a base64 data URL. That has three costs
 * nobody sees until it bites:
 *
 *   1. localStorage is about 5 MB per origin, so three or four phone photos
 *      fill it. The write then throws, and because the failure is caught and
 *      logged as a warning the user simply loses every reference on reload.
 *   2. The same base64 blobs were re-sent with *every* generate request — 20
 *      references is roughly 30 MB of JSON per image, for a backend that reads
 *      none of it.
 *   3. The same blobs were written into each output's metadata JSON.
 *
 * The upload route (`POST /api/references/upload`) already stores the file on
 * disk under `app/outputs/references/` and returns an asset record. So the
 * browser only has to remember *where* the file is, not the bytes:
 *
 *   - references with a disk copy persist as metadata + `url` (no `src`)
 *   - the full-resolution source is fetched back on load (`hydrate`)
 *   - anything with no disk copy (upload failed, server offline) still keeps
 *     its inline source, but under a shared byte budget, newest first
 *
 * Nothing is silently dropped: `toPersistedReferences` reports which sources
 * were left out so the UI can say so, and `referencesNeedingHydration` names
 * what has to be fetched back.
 */

/** Same key the Generator has always used, so existing references still load. */
export const REFERENCE_STORAGE_KEY = "image-generator-references";

/**
 * How many bytes (characters) of inline base64 may be written. localStorage
 * stores UTF-16, so the real cost is about twice this — leaving room for the
 * settings blob and the other keys in the same origin.
 */
export const REFERENCE_SOURCE_BUDGET_BYTES = 1_600_000;

const REFERENCE_FILE_ROUTE = "/api/reference-file";

export function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

/** The file name inside a path, whoever wrote the path. */
export function referenceFileName(pathOrUrl) {
  const raw = String(pathOrUrl || "").trim();
  if (!raw) return "";
  // `/api/reference-file?filename=ref-a.png` names the file in its query, not in
  // its path — the path segment there is just the route.
  const query = raw.match(/[?&]filename=([^&#]+)/);
  if (query) return decodeURIComponent(query[1]);
  const withoutQuery = raw.split("?")[0].split("#")[0];
  const parts = withoutQuery.split(/[\\/]/).filter(Boolean);
  return parts.length ? decodeURIComponent(parts[parts.length - 1]) : "";
}

/**
 * The URL that serves one stored reference image. `GET /api/reference-file`
 * takes a plain file name (it is the disk-backed twin of `/api/output-file`,
 * which cannot reach into a subfolder), so only the last path segment survives.
 */
export function referenceFileUrl(pathOrUrl) {
  const name = referenceFileName(pathOrUrl);
  if (!name) return "";
  return `${REFERENCE_FILE_ROUTE}?filename=${encodeURIComponent(name)}`;
}

/**
 * A reference's disk URL, from whatever the upload route (or an older record)
 * left behind: an explicit `url`, an asset's `existingPath`, or a bare path.
 */
export function referenceUrlFromAsset(input) {
  if (!input) return "";
  const direct = typeof input.url === "string" ? input.url.trim() : "";
  if (direct.startsWith(REFERENCE_FILE_ROUTE)) return direct;
  const path =
    (typeof input === "object" && (input.existingPath || input.path || input.file || input.image)) || "";
  if (!path) return "";
  return referenceFileUrl(path);
}

/**
 * The persisted shape of the reference list.
 *
 * @param {Array<object>} items       the in-memory references
 * @param {object} [options]
 * @param {number} [options.budgetBytes] inline base64 budget
 * @returns {{items: Array<object>, droppedSourceIds: string[], keptSourceIds: string[], sourceBytes: number}}
 *   `items` is a new array; the input is never mutated. An item that lost its
 *   inline source comes back with `sourceMissing: true` so the panel can ask for
 *   the file again instead of generating from nothing.
 */
export function toPersistedReferences(items, options = {}) {
  const budget = Number.isFinite(options.budgetBytes)
    ? Math.max(0, Number(options.budgetBytes))
    : REFERENCE_SOURCE_BUDGET_BYTES;

  const list = Array.isArray(items) ? items : [];
  const droppedSourceIds = [];
  const keptSourceIds = [];
  let sourceBytes = 0;

  // Newest first wins: the reference somebody just added is the one they expect
  // to still be there after a reload.
  const order = list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const at = Date.parse(a.item?.createdAt || "") || 0;
      const bt = Date.parse(b.item?.createdAt || "") || 0;
      if (bt !== at) return bt - at;
      return b.index - a.index;
    });

  const spend = new Map();
  for (const { item } of order) {
    const src = typeof item?.src === "string" ? item.src : "";
    if (!isDataUrl(src)) continue;
    const hasDiskCopy = Boolean(referenceUrlFromAsset(item));
    if (hasDiskCopy) {
      // The bytes are already on disk; the browser does not need them.
      spend.set(item, "disk");
      continue;
    }
    if (sourceBytes + src.length <= budget) {
      sourceBytes += src.length;
      keptSourceIds.push(item?.id);
      spend.set(item, "keep");
    } else {
      droppedSourceIds.push(item?.id);
      spend.set(item, "drop");
    }
  }

  const persisted = list.map((item) => {
    const src = typeof item?.src === "string" ? item.src : "";
    const url = referenceUrlFromAsset(item) || (typeof item?.url === "string" ? item.url : "");
    const decision = spend.get(item);
    const next = { ...item };

    if (url) next.url = url;
    else delete next.url;

    if (!isDataUrl(src)) {
      delete next.src;
      return next;
    }

    if (decision === "keep") return next;

    if (decision === "disk") {
      // The bytes are on disk and the URL points at them: dropping the inline
      // copy loses nothing, so this is not a "missing source".
      delete next.src;
      return next;
    }

    // Disk-backed, or over budget: the bytes do not belong in localStorage.
    delete next.src;
    next.sourceMissing = true;
    return next;
  });

  return { items: persisted, droppedSourceIds, keptSourceIds, sourceBytes };
}

/**
 * References that are remembered by URL (or asset id) only and need their bytes
 * fetched back. A record written before this module existed carries an
 * `assetId` but no `url`; the caller resolves that through the asset registry.
 */
export function referencesNeedingHydration(items, { attempted = [] } = {}) {
  const tried = new Set(Array.isArray(attempted) ? attempted : []);
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!item || isDataUrl(item.src)) return false;
    if (!referenceUrlFromAsset(item) && !item.assetId) return false;
    return !tried.has(item.id);
  });
}

/** Blob → data URL. `FileReader` is injected so the module stays testable in node. */
export function blobToDataUrl(blob, readerFactory = () => new FileReader()) {
  return new Promise((resolve, reject) => {
    const reader = readerFactory();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read the reference image."));
    reader.readAsDataURL(blob);
  });
}
