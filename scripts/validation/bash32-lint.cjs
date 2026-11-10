"use strict";

/**
 * macOS ships bash 3.2 (2007), and under `set -u` it treats an expansion of an
 * empty array as an unbound variable:
 *
 *   set -u
 *   PASSTHROUGH=()
 *   node run-all.cjs "${PASSTHROUGH[@]}"
 *   → PASSTHROUGH[@]: unbound variable
 *
 * Bash 4.4 fixed this. Every Linux box and every CI image therefore runs the
 * line happily, and the one machine that matters — the Mac the app is launched
 * from — dies before the first test. That is exactly how ./validate.sh shipped
 * broken: it passed on the machine that wrote it and failed on the machine that
 * used it, and nothing in between could tell, because the shell was newer.
 *
 * Two safe spellings:
 *
 *   node run-all.cjs ${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}      # expands to nothing when empty
 *   if [[ ${#STATE[@]} -gt 0 ]]; then … "${STATE[@]}" … fi       # guarded
 *
 * `${#arr[@]}` is fine on 3.2 — it is the element expansion that raises.
 */

/** Names declared as an empty array (`NAME=()`) in this source. */
function emptyArrayNames(source) {
  const names = new Set();
  for (const line of String(source || "").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=\(\s*\)\s*(#.*)?$/.exec(line);
    if (match) names.add(match[1]);
  }
  return names;
}

/** Names given at least one element somewhere (`NAME=( … )` or `NAME+=(`). */
function populatedArrayNames(source) {
  const names = new Set();
  for (const line of String(source || "").split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const literal = /^\s*([A-Za-z_][A-Za-z0-9_]*)=\((.+)\)\s*$/.exec(line);
    if (literal && literal[2].trim()) names.add(literal[1]);
    const appended = /^\s*([A-Za-z_][A-Za-z0-9_]*)\+=\(/.exec(line);
    if (appended) names.add(appended[1]);
    // A multi-line literal that is filled in on the following lines.
    const open = /^\s*([A-Za-z_][A-Za-z0-9_]*)=\(\s*$/.exec(line);
    if (open) names.add(open[1]);
  }
  return names;
}

function usesStrictUnset(source) {
  return /^\s*set\s+-[a-z]*u/m.test(String(source || ""));
}

/**
 * Every bare `${name[@]}` expansion of an array that is declared empty and
 * never filled, in a script that runs under `set -u`.
 *
 * Deliberately narrow: an array that is populated anywhere, or whose expansion
 * is guarded (`${#name[@]}`, the `+` form), is not reported. A lint that cries
 * wolf on working code gets switched off, and then it protects nothing.
 */
function findUnsafeArrayExpansions(source) {
  const text = String(source || "");
  if (!usesStrictUnset(text)) return [];

  const empty = emptyArrayNames(text);
  const populated = populatedArrayNames(text);
  const findings = [];
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    if (/^\s*#/.test(line)) return;
    const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)\[@\]\}/g;
    let match;
    while ((match = pattern.exec(line))) {
      const name = match[1];
      if (!empty.has(name) || populated.has(name)) continue;
      // `${NAME[@]+"${NAME[@]}"}` is the safe spelling: the `+` alternative
      // makes the whole line safe, inner expansion included.
      if (new RegExp(`\\$\\{${name}\\[@\\]\\+`).test(line)) continue;
      // Guarded by a count check just above (`if [[ ${#NAME[@]} -gt 0 ]]`).
      const window = lines.slice(Math.max(0, index - 6), index).join("\n");
      if (new RegExp(`\\$\\{#${name}\\[@\\]\\}`).test(window)) continue;
      findings.push({ line: index + 1, name, text: line.trim() });
    }
  });

  return findings;
}

/**
 * Constructs bash 3.2 does not have at all — a louder failure than an unbound
 * variable, but the same cause: written on a newer shell, run on the Mac's.
 */
const MODERN_BASHISMS = [
  { pattern: /\bdeclare\s+-A\b/, phrase: "declare -A (associative arrays, bash 4.0)" },
  { pattern: /\b(mapfile|readarray)\b/, phrase: "mapfile/readarray (bash 4.0)" },
  { pattern: /\$\{[A-Za-z_][A-Za-z0-9_]*(,,|\^\^)\}/, phrase: "case conversion ${x,,} / ${x^^} (bash 4.0)" },
  { pattern: /\blocal\s+-n\b/, phrase: "local -n namerefs (bash 4.3)" },
  { pattern: /\bwait\s+-n\b/, phrase: "wait -n (bash 4.3)" },
  { pattern: /&>>/, phrase: "&>> (bash 4.0)" },
  { pattern: /\[\[\s+-v\s+/, phrase: "[[ -v name ]] (bash 4.2)" },
];

function findModernBashisms(source) {
  const findings = [];
  String(source || "").split("\n").forEach((line, index) => {
    if (/^\s*#/.test(line)) return;
    for (const { pattern, phrase } of MODERN_BASHISMS) {
      if (pattern.test(line)) findings.push({ line: index + 1, phrase, text: line.trim() });
    }
  });
  return findings;
}

module.exports = { findUnsafeArrayExpansions, findModernBashisms, emptyArrayNames, usesStrictUnset };
