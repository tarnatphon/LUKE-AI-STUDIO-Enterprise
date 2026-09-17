"use strict";

/**
 * Every stylesheet the app ships, as one string.
 *
 * Workspace styles travel with their own workspace now, so a test that asks
 * "does this style exist" has to look at all of them — App.css alone only
 * holds what the first paint needs.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..", "..");
const src = path.join(root, "app", "frontend", "src");

function stylesheetPaths() {
  const files = [path.join(src, "App.css")];
  const components = path.join(src, "components");
  if (fs.existsSync(components)) {
    for (const entry of fs.readdirSync(components).sort()) {
      if (entry.endsWith(".css")) files.push(path.join(components, entry));
    }
  }
  for (const entry of fs.readdirSync(src).sort()) {
    if (entry.endsWith(".css") && entry !== "App.css") files.push(path.join(src, entry));
  }
  return files.filter((file) => fs.existsSync(file));
}

function readAllStylesheets() {
  return stylesheetPaths()
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

module.exports = { root, src, readAllStylesheets, stylesheetPaths };
