/**
 * A link the interface renders from content it does not own.
 *
 * The chat renders markdown links straight out of model output, the search
 * panel renders source URLs out of indexed content, and the model manager
 * renders page URLs out of the model list. None of that content is written
 * by the app, so a link in it is a value to be checked, not a command to be
 * obeyed.
 *
 * The danger is the scheme: href="javascript:…" executes in the app's own
 * origin when clicked, and browsers strip tabs, newlines and other control
 * characters from an href before they parse the scheme — so
 * "java\tscript:alert(1)" runs just as well. The check therefore strips
 * those characters first and only then looks at the scheme, and allows
 * exactly three: http, https, mailto — plus a base64 raster data: URL, which
 * is how the app hands its own generated image to the browser as a link.
 * Everything else becomes a plain, non-clickable value.
 */

export function safeExternalUrl(url) {
  if (typeof url !== "string") return "";

  // Browsers remove ASCII control characters and whitespace from an href
  // before parsing it. A value that is safe with them and dangerous without
  // them is not safe; parse the value the way the browser will.
  const cleaned = url.replace(/[\u0000-\u0020]+/g, "");

  if (!cleaned) return "";

  // A raster image the app generated itself: the workflow builder's image step
  // answers with data:image/png;base64,… and that value is a navigation target
  // as well as a picture, so it is allowed on its own terms rather than waved
  // through. Only raster types are on the list — an SVG can carry script, and a
  // data: URL that runs in the app's own origin is exactly what this guard
  // exists to prevent. The payload is matched as base64 so that nothing can
  // ride along behind the first comma.
  if (/^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|avif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(cleaned)) {
    return cleaned;
  }

  const schemeMatch = cleaned.match(/^([a-z][a-z0-9+.\-]*):/i);

  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https" && scheme !== "mailto") {
      return "";
    }
  }

  return cleaned;
}
