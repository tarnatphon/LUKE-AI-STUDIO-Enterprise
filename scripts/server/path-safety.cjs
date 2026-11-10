"use strict";

/**
 * The two path questions this app keeps asking, answered in one place.
 *
 * `isPathInside` had three copies. serve.cjs took (parent, child); the S3
 * adapter and the storage destination manager took (candidate, root) — the same
 * name, the opposite argument order, in code whose entire job is refusing a
 * download destination outside an approved root. Nothing was broken, because
 * each copy agreed with its own callers. That is the point: a containment rule
 * that exists in three shapes is one edit away from containing nothing, and the
 * copy in serve.cjs returned false for a missing argument while the other two
 * passed `undefined` straight into path.resolve.
 *
 * `expandHome` had four copies, identical to the character, in the storage
 * stack.
 *
 * Both live here now. The order is stated once, in `isPathInside(parent, child)`,
 * and callers that used the other order were changed at the call site rather
 * than given an adapter — an adapter is a second way to spell the same mistake.
 */

const os = require("node:os");
const path = require("node:path");

/**
 * `~` or `~/x` → a real path, and anything else → an absolute one.
 *
 * Three of the four copies this replaces ended with `path.resolve(text)`, and
 * their callers depend on it: the transfer queue expands a provider root before
 * comparing it with a mount and before writing under it, and a relative path
 * that stayed relative would be resolved later against whatever directory the
 * process happened to be in. The fourth copy returned the text untouched; the
 * only thing it expands is a policy value or the `~/…` default beside it, so
 * resolving cannot change its answer.
 *
 * An empty or missing value resolves to the working directory, exactly as all
 * four copies did. Callers are expected to supply a default (`|| "~/…"`), and
 * every one of them does.
 */
function expandHome(value) {
  const text = String(value || "");

  if (text === "~") {
    return os.homedir();
  }

  if (text.startsWith("~/")) {
    return path.join(os.homedir(), text.slice(2));
  }

  return path.resolve(text);
}

/**
 * Is `child` the same as, or below, `parent`?
 *
 * Both are resolved first, so `..` cannot walk out of a root that has already
 * been accepted, and a trailing separator changes nothing. The comparison is
 * segment-wise: `/data/safe` does not contain `/data/safe-elsewhere`, which is
 * the bug a plain startsWith("/data/safe") writes.
 *
 * Unknown input is never "inside": a missing path, or a non-string, answers
 * false. Refusing on bad input is the only safe default for a guard that is
 * used to deny.
 */
function isPathInside(parent, child) {
  if (typeof parent !== "string" || typeof child !== "string") {
    return false;
  }

  if (!parent || !child) {
    return false;
  }

  const root = path.resolve(parent);
  const candidate = path.resolve(child);

  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

module.exports = { expandHome, isPathInside };
