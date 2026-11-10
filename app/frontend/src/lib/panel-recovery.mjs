/**
 * "A settings panel failed to load" is usually not a broken panel.
 *
 * Every workspace panel is a separate file, fetched the first time you open its
 * tab. Vite names those files after a hash of their contents, and a rebuild
 * empties app/dist and writes new hashes — so a tab that was open before a
 * `git pull` (or before the launcher's own rebuild) still remembers the *old*
 * names. When it finally asks for `RuntimeDownloadDashboard-C-kQsBX9.js`, that
 * file is gone, the fetch fails, and React shows the error the browser gave it:
 *
 *     Failed to fetch dynamically imported module:
 *     http://localhost:1420/assets/RuntimeDownloadDashboard-C-kQsBX9.js
 *
 * Nothing is broken. That tab is simply running yesterday's build, and the fix
 * is one reload: the new index.html points at the new hashes. What made this
 * worth code is that React.lazy caches the rejected import for the lifetime of
 * the page, so "Return Home and open the tab again" stays broken, and the
 * message names a URL instead of the situation.
 *
 * So: recognise the failure, reload once per tab by ourselves, and if that does
 * not fix it, say what happened instead of echoing a URL. The reload is claimed
 * once per tab session and never twice, because a genuinely incomplete build
 * must not turn into an endless reload loop.
 *
 * This module has no React and no browser globals at import time, so the
 * validation suite can run it in plain node.
 */

export const RELOAD_FLAG = "luke:panel-recovery";

function defaultStorage() {
  try {
    return typeof globalThis !== "undefined" && globalThis.sessionStorage ? globalThis.sessionStorage : null;
  } catch {
    // A browser with storage disabled throws on the property itself.
    return null;
  }
}

function defaultReload() {
  if (typeof window !== "undefined" && window.location && typeof window.location.reload === "function") {
    window.location.reload();
  }
}

/**
 * Is this the browser failing to fetch a code-split file, rather than the panel
 * throwing? Each browser words it differently, and webpack-style bundlers throw
 * a named error instead of a message.
 */
export function isChunkLoadError(error) {
  if (!error) return false;
  const name = String(error.name || "");
  if (name === "ChunkLoadError") return true;
  const message = String(error.message || error);
  return [
    /failed to fetch dynamically imported module/i,
    /error loading dynamically imported module/i,
    /importing a module script failed/i,
    /loading chunk [\w.~-]+ failed/i,
    /unable to preload css/i,
    /expected a javascript(-or-wasm)? module script/i,
  ].some((pattern) => pattern.test(message));
}

/**
 * Take the one automatic reload this tab is allowed. True means "I took it, go
 * ahead and reload"; false means it was already spent, so show the message and
 * let the user decide.
 */
export function claimSingleReload(storage = defaultStorage()) {
  if (!storage) return false;
  try {
    if (storage.getItem(RELOAD_FLAG)) return false;
    storage.setItem(RELOAD_FLAG, String(Date.now()));
    return true;
  } catch {
    // A full or disabled quota must not break the panel; it just means no
    // automatic reload and an honest message instead.
    return false;
  }
}

/**
 * Wrap a `() => import("...")` loader for React.lazy. Successful loads pass
 * straight through. A chunk failure reloads the tab once and returns a promise
 * that never settles, which keeps Suspense's "Loading workspace…" on screen
 * while the page goes away instead of flashing an error. Anything else — a real
 * exception inside the panel, a syntax error, a 500 — is re-thrown untouched, so
 * the error boundaries keep behaving exactly as they did.
 */
export function withChunkRecovery(load, { storage, reload } = {}) {
  return () =>
    Promise.resolve()
      .then(load)
      .catch((error) => {
        if (!isChunkLoadError(error)) throw error;
        if (!claimSingleReload(storage === undefined ? defaultStorage() : storage)) throw error;
        (reload || defaultReload)();
        return new Promise(() => {});
      });
}

/**
 * The sentence shown when the automatic reload could not fix it. It names the
 * build this window is running, says why the file is gone, and gives the one
 * repair that exists if reloading does not help.
 */
export function chunkFailureAdvice(buildLabel = "") {
  const running = buildLabel ? `This window is running ${buildLabel}. ` : "";
  return (
    `${running}The panel it asked for is no longer on disk: the app was rebuilt while this window was open, ` +
    "and the files it needs were replaced by new ones with new names. Reload to load the current build — " +
    "nothing you have entered is lost. If the same panel fails again after reloading, the build on disk is " +
    "incomplete: restart LUKE (./mac.sh or ./linux.sh) so it rebuilds, then reload."
  );
}
