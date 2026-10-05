"use strict";

/**
 * The resource governor — hands a loaded engine back when the machine asks for it.
 *
 * Why this exists
 * ---------------
 * The app never released anything it had loaded. A chat model stayed resident
 * until the user unloaded it by hand, so a machine that had been used for one
 * question an hour ago was still carrying 4 GB of weights while macOS compressed
 * other processes' memory and started swapping. The arena pool was the only
 * exception (`idleUnloadMinutes`, 45 by default), and the arena's "release the
 * chat model to make room for this round, reload it on the next message" proved
 * the pattern works end to end.
 *
 * What it deliberately does not do
 * --------------------------------
 * It does not act because a percentage looks big. macOS keeps RAM full on
 * purpose — free memory is wasted memory — so "used 16 of 18 GB" says nothing.
 * The signals here are the ones that mean the machine is actually short:
 *
 *   darwin  swap in use (`sysctl vm.swapusage`) and the memory compressor
 *           (`vm_stat`, "Pages occupied by compressor")
 *   linux   MemAvailable from /proc/meminfo, plus SwapTotal-SwapFree
 *   win32   os.freemem() only — no cheap swap query, so the governor stays out
 *           of the way rather than guess
 *
 * And it only releases an engine that can come back by itself. Text qualifies:
 * a chat request goes through the server, which already restores a released
 * model before answering (`restoreReleasedMainModel`). The image backend does
 * not qualify, because generation is driven from the browser straight to
 * stable-diffusion.cpp — the server would not see the request that needs it, and
 * a silently killed backend would surface as a failed generation. It is listed
 * here as ungoverned *with that reason*, so the next reader does not have to
 * rediscover it.
 *
 * Everything is pure: the platform, the clock and the memory numbers arrive as
 * arguments, so a machine that never swaps can still be tested, and CI can
 * decide what an 8 GB Mac would do without being one.
 */

const GIB = 1024 ** 3;

/**
 * Per-tier defaults. The tier comes from getHardwareSpecs(), which on Apple
 * Silicon is about unified memory size — a 16 GB M-series Mac is "high" even
 * though its GPU can only address ~78% of that. So the tier sets how *patient*
 * the governor is, while the decision itself always comes from the pressure
 * signals: a big machine that starts swapping is still a machine that is short.
 */
const TIER_POLICIES = {
  low: {
    idleMinutes: 10,
    tightSwapGb: 0.25,
    criticalSwapGb: 1,
    tightCompressorGb: 0.5,
    criticalCompressorGb: 1.5,
    availableRatioTight: 0.15,
    availableRatioCritical: 0.08,
  },
  mid: {
    idleMinutes: 20,
    tightSwapGb: 0.5,
    criticalSwapGb: 2,
    tightCompressorGb: 1,
    criticalCompressorGb: 2.5,
    availableRatioTight: 0.12,
    availableRatioCritical: 0.06,
  },
  high: {
    idleMinutes: 45,
    tightSwapGb: 1,
    criticalSwapGb: 4,
    tightCompressorGb: 2,
    criticalCompressorGb: 4,
    availableRatioTight: 0.1,
    availableRatioCritical: 0.05,
  },
};

const DEFAULT_POLICY = {
  enabled: true,
  sweepMs: 60000,
  // A release is worth the reload only if it actually gives something back.
  minimumReleaseGb: 0.5,
  ...TIER_POLICIES.mid,
};

function toGb(bytes) {
  const value = Number(bytes);
  return Number.isFinite(value) && value > 0 ? value / GIB : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

/**
 * Merges the tier defaults with this machine's own overrides. Numbers are
 * clamped rather than trusted: a zero or negative idle time means "no timer",
 * and a negative threshold would make every machine look critical.
 */
function policyFor({ tier = "mid", overrides = null } = {}) {
  const base = { ...DEFAULT_POLICY, ...(TIER_POLICIES[tier] || TIER_POLICIES.mid) };
  const source = overrides && typeof overrides === "object" ? overrides : {};
  const policy = { ...base };

  for (const key of Object.keys(base)) {
    if (!(key in source)) continue;
    const value = source[key];
    if (key === "enabled") {
      policy.enabled = value !== false;
      continue;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) continue;
    policy[key] = number;
  }

  policy.tier = tier;
  return policy;
}

/** Linux: MemAvailable and the swap pair, in bytes. Missing lines read as null. */
function parseMeminfo(text) {
  const value = (key) => {
    const match = String(text || "").match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, "m"));
    return match ? Number(match[1]) * 1024 : null;
  };
  const swapTotal = value("SwapTotal");
  const swapFree = value("SwapFree");
  return {
    availableBytes: value("MemAvailable"),
    swapUsedBytes: swapTotal !== null && swapFree !== null ? Math.max(0, swapTotal - swapFree) : null,
  };
}

/**
 * macOS: `sysctl vm.swapusage` prints
 * `vm.swapusage: total = 2048.00M  used = 384.50M  free = 1663.50M  (encrypted)`.
 */
function parseSwapUsage(text) {
  const match = String(text || "").match(/used\s*=\s*([\d.]+)\s*([KMG])B?/i);
  if (!match) return null;
  const scale = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }[match[2].toUpperCase()];
  const bytes = Number(match[1]) * scale;
  return Number.isFinite(bytes) ? bytes : null;
}

/** macOS: the compressor's pages from `vm_stat`, converted with its page size. */
function parseCompressorBytes(text) {
  const source = String(text || "");
  const pageMatch = source.match(/page size of (\d+) bytes/);
  const pageSize = pageMatch ? Number(pageMatch[1]) : 16384; // arm64 macOS default
  const pages = source.match(/Pages occupied by compressor:\s+(\d+)/);
  if (!pages) return null;
  const bytes = Number(pages[1]) * pageSize;
  return Number.isFinite(bytes) ? bytes : null;
}

/**
 * Reads the signals that are available and says whether the machine is short.
 * Returns a level, and the reason in the words that will be logged — a governor
 * that takes memory away has to say why it did.
 */
function assessMemoryPressure({
  platform = "",
  policy = DEFAULT_POLICY,
  totalRamBytes = 0,
  availableBytes = null,
  swapUsedBytes = null,
  compressorBytes = null,
} = {}) {
  const availableGb = toGb(availableBytes);
  const swapUsedGb = toGb(swapUsedBytes);
  const compressorGb = toGb(compressorBytes);
  const availableRatio = totalRamBytes > 0 && availableBytes !== null
    ? Math.max(0, Number(availableBytes)) / Number(totalRamBytes)
    : null;

  const reasons = [];
  const notes = [];
  let level = "ok";
  const raise = (to, reason) => {
    reasons.push(reason);
    if (to === "critical" || (to === "tight" && level === "ok")) level = to;
  };

  // Active signals first: these fall again once the pressure passes, so they say
  // what the machine is doing *now*.
  if (compressorBytes !== null && compressorGb > 0) {
    if (compressorGb >= policy.criticalCompressorGb) {
      raise("critical", `memory compressor holding ${round(compressorGb)} GB (critical at ${policy.criticalCompressorGb} GB)`);
    } else if (compressorGb >= policy.tightCompressorGb) {
      raise("tight", `memory compressor holding ${round(compressorGb)} GB (tight at ${policy.tightCompressorGb} GB)`);
    }
  }

  if (availableRatio !== null) {
    const percent = Math.round(availableRatio * 100);
    if (availableRatio <= policy.availableRatioCritical) {
      raise("critical", `only ${percent}% of RAM available (${round(availableGb)} GB of ${round(toGb(totalRamBytes))} GB)`);
    } else if (availableRatio <= policy.availableRatioTight) {
      raise("tight", `only ${percent}% of RAM available (${round(availableGb)} GB of ${round(toGb(totalRamBytes))} GB)`);
    }
  }

  // Swap is a lagging signal: macOS in particular keeps swap allocated long
  // after the spike that caused it, so "swap in use" on its own means "this
  // machine was short recently", not "it is short now". Acting on that alone
  // would take a model away from somebody whose machine has already recovered.
  // Past the critical mark it is bad enough to act on by itself; below it, it
  // only confirms pressure an active signal already showed.
  if (swapUsedBytes !== null && swapUsedGb > 0) {
    if (swapUsedGb >= policy.criticalSwapGb) {
      raise("critical", `swap in use: ${round(swapUsedGb)} GB (critical at ${policy.criticalSwapGb} GB)`);
    } else if (swapUsedGb >= policy.tightSwapGb) {
      if (level === "ok") {
        notes.push(
          `swap in use (${round(swapUsedGb)} GB) but nothing is compressed or short right now — ` +
            "swap outlives the spike that caused it, so this alone is not a reason to release anything"
        );
      } else {
        reasons.push(`swap confirms it: ${round(swapUsedGb)} GB in use`);
      }
    }
  }

  if (!reasons.length) {
    const signalCount = [availableBytes, swapUsedBytes, compressorBytes].filter((value) => value !== null).length;
    reasons.push(
      signalCount === 0
        ? `no pressure signal available on ${platform || "this platform"} — the governor stays out of the way`
        : notes.length
          ? notes.join(" · ")
          : "the machine has room"
    );
  }

  return {
    level,
    reason: reasons.join(" · "),
    reasons,
    notes,
    availableGb: round(availableGb),
    swapUsedGb: round(swapUsedGb),
    compressorGb: round(compressorGb),
    availableRatio: availableRatio === null ? null : round(availableRatio, 3),
    signals: {
      available: availableBytes !== null,
      swap: swapUsedBytes !== null,
      compressor: compressorBytes !== null,
    },
  };
}

/**
 * Chooses the one engine to release, or explains why nothing is released.
 *
 * `engines` entries: { id, label, resident, restorable, busy, sizeGb, lastUsedAt }.
 * Never more than one per sweep: the pressure is measured again on the next one,
 * so a machine that recovers stops losing engines immediately.
 */
function planRelease({ now = Date.now(), engines = [], pressure = null, policy = DEFAULT_POLICY } = {}) {
  const refuse = (code, reason) => ({ engine: null, code, reason });

  if (policy.enabled === false) return refuse("DISABLED", "the resource governor is switched off");
  const level = pressure?.level || "ok";
  if (level === "ok") return refuse("NO_PRESSURE", pressure?.reason || "the machine has room");

  const candidates = engines.filter(
    (engine) => engine && engine.resident && engine.restorable && !engine.busy &&
      Number(engine.sizeGb) >= Number(policy.minimumReleaseGb || 0)
  );
  if (candidates.length === 0) {
    const resident = engines.filter((engine) => engine && engine.resident);
    return refuse(
      "NOTHING_RESTORABLE",
      resident.length === 0
        ? "nothing is loaded"
        : `loaded but not restorable automatically: ${resident.map((engine) => engine.id).join(", ")}`
    );
  }

  const idleFor = (engine) => (engine.lastUsedAt ? Math.max(0, now - Number(engine.lastUsedAt)) : Infinity);
  const ranked = [...candidates].sort((a, b) => idleFor(b) - idleFor(a));
  const chosen = ranked[0];
  const idleMinutes = idleFor(chosen) === Infinity ? null : Math.round(idleFor(chosen) / 60000);

  // Critical means the machine is hurting now: idle time stops mattering.
  if (level === "critical") {
    return {
      engine: chosen,
      code: "MEMORY_CRITICAL",
      reason:
        `${pressure.reason} — releasing ${chosen.label || chosen.id} ` +
        `(${round(Number(chosen.sizeGb))} GB${idleMinutes === null ? "" : `, idle ${idleMinutes} min`}); ` +
        `it reloads by itself the next time it is asked for`,
      idleMinutes,
    };
  }

  const idleLimitMinutes = Number(policy.idleMinutes);
  if (idleLimitMinutes <= 0) {
    return refuse("TIMER_OFF", `${pressure.reason}, but the idle timer is switched off on this machine`);
  }
  if (idleMinutes === null || idleMinutes < idleLimitMinutes) {
    return refuse(
      "STILL_IN_USE",
      `${pressure.reason}, but ${chosen.label || chosen.id} was used ` +
        `${idleMinutes === null ? "never" : `${idleMinutes} min ago`} (the governor waits ${idleLimitMinutes} min)`
    );
  }

  return {
    engine: chosen,
    code: "MEMORY_TIGHT_IDLE",
    reason:
      `${pressure.reason} — ${chosen.label || chosen.id} has been idle ${idleMinutes} min ` +
      `(over the ${idleLimitMinutes} min limit for a ${policy.tier || "mid"}-tier machine), releasing ` +
      `${round(Number(chosen.sizeGb))} GB; it reloads by itself the next time it is asked for`,
    idleMinutes,
  };
}

/**
 * Load-time make-room.
 *
 * The sweep above only touches engines whose use the server can see, so it can
 * tell how long they have been idle. A load that is about to be refused is a
 * different situation: the user asked for something right now, and the refusal
 * tells them to go and unload a model by hand. If an engine that starts again on
 * demand is holding exactly that room, taking it turns a dead end into a load.
 *
 * All or nothing: if what may be released would not cover the gap, nothing is
 * released, because a killed engine plus a refused load is worse than the
 * refusal alone.
 */
function planMakeRoom({ shortfallGb = 0, engines = [], policy = DEFAULT_POLICY } = {}) {
  const refuse = (code, reason) => ({ engines: [], code, reason, freedGb: 0 });

  if (policy.enabled === false) return refuse("DISABLED", "the resource governor is switched off");

  const gap = Number(shortfallGb) || 0;
  if (!(gap > 0)) return refuse("NO_SHORTFALL", "the load already fits");

  const candidates = engines.filter(
    (engine) => engine && engine.resident && engine.makeRoom && !engine.busy && Number(engine.sizeGb) > 0
  );
  if (candidates.length === 0) {
    const resident = engines.filter((engine) => engine && engine.resident);
    return refuse(
      "NOTHING_TO_RELEASE",
      resident.length === 0
        ? "nothing else is loaded"
        : `loaded but not releasable to make room: ${resident.map((engine) => engine.id).join(", ")}`
    );
  }

  // Biggest first, so the fewest engines give up their memory for one load.
  const ranked = [...candidates].sort((left, right) => Number(right.sizeGb) - Number(left.sizeGb));
  const chosen = [];
  let freedGb = 0;
  for (const engine of ranked) {
    if (freedGb >= gap) break;
    chosen.push(engine);
    freedGb += Number(engine.sizeGb) || 0;
  }

  if (freedGb < gap) {
    return refuse(
      "CANNOT_MAKE_ROOM",
      `${ranked.map((engine) => engine.label || engine.id).join(" + ")} would free about ${round(freedGb)} GB, ` +
        `still short of the ${round(gap)} GB this load needs`
    );
  }

  return {
    engines: chosen,
    code: "MAKE_ROOM",
    freedGb: round(freedGb),
    reason:
      `${chosen.map((engine) => engine.label || engine.id).join(" + ")} gives up ${round(freedGb)} GB ` +
      `so a load short by ${round(gap)} GB can start; each of them starts again on demand`,
  };
}

/**
 * Why each engine is or is not governed. Kept here rather than in serve.cjs so
 * the reasoning is in one place and the suite can hold it true.
 *
 * `holdsProcess` is the fact the rest follows from: an engine only has memory to
 * give back if something of it stays alive between requests.
 * `restorable` is what the idle sweep may act on; `makeRoom` is what a load that
 * would otherwise be refused may act on — a narrower question with a stricter
 * answer, so image is false for one and true for the other.
 */
const ENGINE_RULES = {
  text: {
    holdsProcess: true,
    restorable: true,
    makeRoom: true,
    reason: "a chat request reaches the server, which restores a released model before answering",
  },
  arena: {
    holdsProcess: true,
    restorable: true,
    makeRoom: true,
    reason: "the pool unloads and reloads its own models",
  },
  image: {
    holdsProcess: true,
    restorable: false,
    makeRoom: true,
    reason:
      "generation is driven from the browser straight to the backend, so the server never sees an interactive " +
      "generation and cannot tell how long the engine has been idle — only a load that would otherwise be " +
      "refused may take it, and the Generator starts it again on the next generation",
  },
  speech: {
    holdsProcess: false,
    restorable: false,
    makeRoom: false,
    reason:
      "nothing stays resident to give back: transcription spawns whisper-cli per request and it exits with the text, " +
      "so the ready flag is bookkeeping rather than memory",
  },
  tts: {
    holdsProcess: false,
    restorable: false,
    makeRoom: false,
    reason:
      "nothing stays resident to give back: synthesis spawns the Kokoro worker per request and it exits with the audio, " +
      "and system-speak uses the macOS voices instead",
  },
};

module.exports = {
  DEFAULT_POLICY,
  ENGINE_RULES,
  GIB,
  TIER_POLICIES,
  assessMemoryPressure,
  parseCompressorBytes,
  parseMeminfo,
  parseSwapUsage,
  planMakeRoom,
  planRelease,
  policyFor,
  round,
  toGb,
};
