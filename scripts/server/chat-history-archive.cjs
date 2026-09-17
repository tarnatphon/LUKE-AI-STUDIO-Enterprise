"use strict";

/**
 * The conversation's memory on disk.
 *
 * A long chat cannot stay in the model's context forever, and it should not
 * have to: the transcript is archived here, turn by turn, and only the parts
 * that are actually needed are read back.
 *
 * Three rules hold here:
 *
 * 1. The archive is append-only and lives inside the app folder, so it sits on
 *    the same external disk as everything else the app owns. A part file is
 *    only ever added to, never rewritten, so a crash costs at most one turn
 *    and never corrupts the ones before it.
 * 2. Only a finished turn is archived. A turn that is still being generated,
 *    or one the user cancelled, has no business in history.
 * 3. Searching is cheap and reading is deliberate. The archive is never sent
 *    whole; a search returns the smallest slices that matched, with the turn
 *    numbers attached so the model can say where it found something.
 */

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const HISTORY_DIR = path.join(ROOT, "app", "runtime-state", "text-chat", "history");
const MAX_PART_BYTES = 8 * 1024 * 1024;
const MAX_SLICES = 6;
const SLICE_CHARS = 1400;
const MAX_QUERY_CHARS = 400;
const ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;

function reject(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clean(value, maxLength = 200) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/** The archive belongs to one conversation, and the id may not wander. */
function historyFile(conversationId, part = 1) {
  const id = String(conversationId || "").trim();
  if (!ID_PATTERN.test(id)) throw reject("That conversation id is not usable.", 400);
  const name = part === 1 ? `${id}.md` : `${id}.part${part}.md`;
  const file = path.join(HISTORY_DIR, name);
  const inside = path.resolve(file).startsWith(path.resolve(HISTORY_DIR) + path.sep);
  if (!inside) throw reject("That conversation id is not usable.", 400);
  return file;
}

async function parts(conversationId) {
  const id = String(conversationId || "").trim();
  if (!ID_PATTERN.test(id)) throw reject("That conversation id is not usable.", 400);
  let entries = [];
  try {
    entries = await fsp.readdir(HISTORY_DIR);
  } catch {
    return [];
  }
  const owned = entries
    .filter((name) => name === `${id}.md` || new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.part\\d+\\.md$`).test(name))
    .sort((a, b) => {
      const pa = Number((a.match(/\.part(\d+)\.md$/) || [0, 1])[1]);
      const pb = Number((b.match(/\.part(\d+)\.md$/) || [0, 1])[1]);
      return pa - pb;
    });
  return owned.map((name) => path.join(HISTORY_DIR, name));
}

async function currentPart(conversationId) {
  const existing = await parts(conversationId);
  if (existing.length === 0) return historyFile(conversationId, 1);
  const last = existing[existing.length - 1];
  try {
    const size = (await fsp.stat(last)).size;
    if (size < MAX_PART_BYTES) return last;
  } catch {
    return last;
  }
  const next = Number((path.basename(last).match(/\.part(\d+)\.md$/) || [0, 1])[1]) + 1;
  return historyFile(conversationId, next);
}

// Two turns finishing at the same moment would read the same turn number and
// both write it. Each conversation gets its own queue so appends are strictly
// one after another.
const queues = new Map();

function serialise(conversationId, task) {
  const previous = queues.get(conversationId) || Promise.resolve();
  const next = previous.then(task, task);
  queues.set(conversationId, next.then(() => {}, () => {}));
  return next;
}

function turnNumber(text) {
  const headings = text.match(/^## Turn (\d+)/gm) || [];
  const last = headings[headings.length - 1];
  return last ? Number(last.replace("## Turn ", "")) : 0;
}

/**
 * Archive one finished exchange. Both sides go in together: a question whose
 * answer was cancelled is a question nobody can learn from.
 */
async function appendExchange({ conversationId, userText, assistantText, model = null, meta = null }) {
  const id = String(conversationId || "").trim();
  if (!ID_PATTERN.test(id)) throw reject("A conversation is required before anything can be archived.", 400);
  const you = String(userText == null ? "" : userText).trim();
  const luke = String(assistantText == null ? "" : assistantText).trim();
  if (!you && !luke) return { archived: false, reason: "There is nothing to archive." };

  await fsp.mkdir(HISTORY_DIR, { recursive: true });
  return serialise(id, async () => writeTurn({ id, you, luke, model, meta }));
}

async function writeTurn({ id, you, luke, model, meta }) {
  await fsp.mkdir(HISTORY_DIR, { recursive: true });
  const file = await currentPart(id);
  const existing = await fsp.readFile(file, "utf8").catch(() => "");
  // The number comes from the file itself, after the queue let us in, so two
  // turns can never claim the same one.

  const turn = turnNumber(existing) + 1;
  const stamp = new Date().toISOString();
  const heading = `## Turn ${turn} · ${stamp}${model ? ` · model: ${clean(model, 80)}` : ""}${meta ? ` · ${clean(meta, 120)}` : ""}`;
  const body = [`\n${heading}\n`, you ? `### You\n\n${you}\n` : "", luke ? `\n### LUKE\n\n${luke}\n` : ""].join("\n");
  await fsp.appendFile(file, body, "utf8");
  return {
    archived: true,
    turn,
    conversationId: id,
    file: path.relative(ROOT, file),
    chars: body.length,
  };
}

function slicesFromTurns(turns, terms, maxSlices) {
  const scored = [];
  for (const turn of turns) {
    const haystack = turn.text.toLowerCase();
    let hits = 0;
    for (const term of terms) {
      if (haystack.includes(term)) hits += 1;
    }
    if (hits === 0) continue;
    let at = 0;
    for (const term of terms) {
      const found = haystack.indexOf(term);
      if (found > at) at = found;
    }
    const start = Math.max(0, at - Math.floor(SLICE_CHARS / 3));
    const snippet = turn.text.slice(start, start + SLICE_CHARS).trim();
    scored.push({
      turn: turn.number,
      heading: turn.heading,
      hits,
      snippet: `${start > 0 ? "…" : ""}${snippet}${turn.text.length > start + SLICE_CHARS ? "…" : ""}`,
    });
  }
  scored.sort((a, b) => b.hits - a.hits || b.turn - a.turn);
  return scored.slice(0, maxSlices);
}

/** Read back the smallest slices that match — never the whole archive. */
async function searchHistory({ conversationId, query, maxSlices = MAX_SLICES, includeRecent = false }) {
  const id = String(conversationId || "").trim();
  if (!ID_PATTERN.test(id)) throw reject("A conversation is required before searching.", 400);
  const question = String(query == null ? "" : query).trim().slice(0, MAX_QUERY_CHARS);
  if (!question && !includeRecent) throw reject("Ask for something before searching the archive.");

  const files = await parts(id);
  if (files.length === 0) return { conversationId: id, query: question, turns: 0, slices: [] };

  let text = "";
  for (const file of files) {
    text += await fsp.readFile(file, "utf8").catch(() => "");
  }
  const chunks = text.split(/^## Turn /m).slice(1);
  const turns = chunks.map((chunk) => {
    const newline = chunk.indexOf("\n");
    const heading = `Turn ${chunk.slice(0, newline).trim()}`;
    const number = Number((chunk.match(/^(\d+)/) || [0, 0])[1]);
    return { number, heading, text: chunk };
  });

  // Thai is written without spaces, so a term is matched as a run of text
  // rather than a word. Anything shorter than two characters is noise.
  const terms = Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((term) => term.length >= 2)
        .concat(question.length >= 2 ? [question.toLowerCase()] : []),
    ),
  );
  const limit = Math.min(Math.max(Number(maxSlices) || MAX_SLICES, 1), 12);
  const slices = terms.length ? slicesFromTurns(turns, terms, limit) : [];

  // "อันก่อนหน้าบอกว่าอะไร" names nothing to search for, so a question that
  // points backwards also gets the turns it is pointing at.
  if (includeRecent && slices.length < limit) {
    const have = new Set(slices.map((slice) => slice.turn));
    for (const turn of turns.slice(-3).reverse()) {
      if (have.has(turn.number) || slices.length >= limit) continue;
      const body = turn.text.replace(/^Turn \d+[^\n]*\n/, "").trim();
      slices.push({
        turn: turn.number,
        heading: turn.heading,
        hits: 0,
        recent: true,
        snippet: body.length > SLICE_CHARS ? `…${body.slice(-SLICE_CHARS).trim()}` : body,
      });
    }
  }

  return { conversationId: id, query: question, turns: turns.length, slices };
}

const THAI_REFERENCES = [
  "ก่อนหน้า", "เมื่อกี้", "เมื่อสักครู่", "ที่เคย", "ที่บอกไว้", "ที่บอก", "ตอนแรก", "ข้อความก่อน",
  "เมื่อก่อน", "อันเก่า", "อันเก่า", "ที่คุยกัน", "ก่อนนี้", "ตอนนั้น", "อันนั้น", "ที่ว่ามา",
  "ประวัติ", "ย้อนกลับ", "เมื่อคืน", "คราวก่อน", "รอบก่อน", "อันก่อน",
];
const ENGLISH_REFERENCES = [
  "earlier", "before", "previous", "last time", "as you said", "as we said", "you mentioned",
  "we discussed", "above", "remember", "history", "that answer", "your last",
];
const EXPLICIT = ["@history", "#history", "ค้นประวัติ", "ค้นหาประวัติ", "จากประวัติ"];

/**
 * Does this message point backwards? Deciding this without asking the model
 * keeps the common case free: nothing is read from disk for a question that
 * does not need it.
 */
function pastReference(text) {
  const message = String(text == null ? "" : text).toLowerCase();
  if (!message.trim()) return { isReference: false, matched: [] };
  const matched = [];
  for (const phrase of EXPLICIT) {
    if (message.includes(phrase)) matched.push(phrase);
  }
  for (const phrase of THAI_REFERENCES) {
    if (message.includes(phrase)) matched.push(phrase);
  }
  for (const phrase of ENGLISH_REFERENCES) {
    if (message.includes(phrase)) matched.push(phrase);
  }
  return { isReference: matched.length > 0, matched: Array.from(new Set(matched)).slice(0, 8), explicit: matched.some((m) => EXPLICIT.includes(m)) };
}

async function status(conversationId) {
  const id = String(conversationId || "").trim();
  if (!ID_PATTERN.test(id)) throw reject("A conversation is required.", 400);
  const files = await parts(id);
  let bytes = 0;
  let turns = 0;
  for (const file of files) {
    try {
      const stat = await fsp.stat(file);
      bytes += stat.size;
      const text = await fsp.readFile(file, "utf8");
      turns += (text.match(/^## Turn /gm) || []).length;
    } catch {}
  }
  return { conversationId: id, archived: files.length > 0, turns, bytes, parts: files.length, dir: path.relative(ROOT, HISTORY_DIR) };
}

module.exports = {
  HISTORY_DIR,
  ROOT,
  appendExchange,
  pastReference,
  searchHistory,
  status,
  statusSync: (conversationId) => {
    const id = String(conversationId || "").trim();
    if (!ID_PATTERN.test(id)) return { archived: false };
    const file = historyFile(id, 1);
    if (!fs.existsSync(file)) return { archived: false, conversationId: id };
    const text = fs.readFileSync(file, "utf8");
    return {
      archived: true,
      conversationId: id,
      turns: (text.match(/^## Turn /gm) || []).length,
      bytes: fs.statSync(file).size,
    };
  },
};
