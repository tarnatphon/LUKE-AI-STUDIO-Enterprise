"use strict";

const fs = require("node:fs");
const path = require("node:path");

const TERMINAL_STATES =
  new Set([
    "completed",
    "failed",
    "cancelled",
  ]);

function resolveOutputPath(
  root,
  value
) {
  const raw =
    String(value || "")
      .trim();

  if (!raw) {
    return null;
  }

  if (
    path.isAbsolute(raw)
  ) {
    if (
      raw.startsWith(
        path.join(
          root,
          "outputs"
        )
      )
    ) {
      return path.normalize(raw);
    }

    if (
      raw.startsWith(
        "/outputs/"
      )
    ) {
      return path.join(
        root,
        "app",
        raw.slice(1)
      );
    }

    return path.normalize(raw);
  }

  if (
    raw.startsWith(
      "app/"
    )
  ) {
    return path.join(
      root,
      raw
    );
  }

  if (
    raw.startsWith(
      "outputs/"
    )
  ) {
    return path.join(
      root,
      "app",
      raw
    );
  }

  return path.resolve(
    root,
    raw
  );
}

function collectReferencedOutputs(
  root,
  jobs
) {
  const referenced =
    new Set();

  for (
    const job of
    jobs || []
  ) {
    const output =
      job?.output || {};

    const candidates = [
      output.output,
      output.videoUrl,
      output.worker?.output,
    ];

    for (
      const candidate of
      candidates
    ) {
      const resolved =
        resolveOutputPath(
          root,
          candidate
        );

      if (resolved) {
        referenced.add(
          path.normalize(
            resolved
          )
        );
      }
    }
  }

  return referenced;
}

function ageMs(
  stats,
  now
) {
  return Math.max(
    0,
    now -
    Number(
      stats.mtimeMs ||
      stats.ctimeMs ||
      0
    )
  );
}

function safeStat(
  target
) {
  try {
    return fs.statSync(
      target
    );
  } catch {
    return null;
  }
}

function buildJobMap(
  jobs
) {
  return new Map(
    (jobs || [])
      .map(
        (job) => [
          String(job.id),
          job,
        ]
      )
  );
}

function classifyCacheName(
  name
) {
  if (
    name.endsWith(
      "-references"
    )
  ) {
    return name.slice(
      0,
      -"-references".length
    );
  }

  const extension =
    path.extname(name);

  if (extension) {
    return path.basename(
      name,
      extension
    );
  }

  return name;
}

function planImageToVideoCleanup({
  root,
  jobs = [],
  now = Date.now(),
  orphanAgeMs =
    7 * 24 * 60 * 60 * 1000,
  terminalCacheAgeMs =
    24 * 60 * 60 * 1000,
}) {
  const projectRoot =
    path.resolve(root);

  const cacheDir =
    path.join(
      projectRoot,
      "app",
      "cache",
      "image-to-video"
    );

  const outputDir =
    path.join(
      projectRoot,
      "app",
      "outputs",
      "video"
    );

  const jobMap =
    buildJobMap(jobs);

  const referencedOutputs =
    collectReferencedOutputs(
      projectRoot,
      jobs
    );

  const remove = [];
  const preserve = [];

  if (
    fs.existsSync(
      cacheDir
    )
  ) {
    for (
      const entry of
      fs.readdirSync(
        cacheDir,
        {
          withFileTypes: true,
        }
      )
    ) {
      const target =
        path.join(
          cacheDir,
          entry.name
        );

      const stats =
        safeStat(target);

      if (!stats) {
        continue;
      }

      const jobId =
        classifyCacheName(
          entry.name
        );

      const job =
        jobMap.get(jobId);

      if (
        job &&
        !TERMINAL_STATES.has(
          job.state
        )
      ) {
        preserve.push({
          path: target,
          reason:
            "ACTIVE_JOB",
        });

        continue;
      }

      if (
        job &&
        TERMINAL_STATES.has(
          job.state
        )
      ) {
        if (
          ageMs(
            stats,
            now
          ) >
          terminalCacheAgeMs
        ) {
          remove.push({
            path: target,
            type:
              entry.isDirectory()
                ? "directory"
                : "file",

            reason:
              "TERMINAL_JOB_CACHE_EXPIRED",
          });
        } else {
          preserve.push({
            path: target,
            reason:
              "RECENT_TERMINAL_JOB_CACHE",
          });
        }

        continue;
      }

      if (
        ageMs(
          stats,
          now
        ) >
        orphanAgeMs
      ) {
        remove.push({
          path: target,
          type:
            entry.isDirectory()
              ? "directory"
              : "file",

          reason:
            "ORPHAN_CACHE_EXPIRED",
        });
      } else {
        preserve.push({
          path: target,
          reason:
            "RECENT_ORPHAN_CACHE",
        });
      }
    }
  }

  if (
    fs.existsSync(
      outputDir
    )
  ) {
    for (
      const entry of
      fs.readdirSync(
        outputDir,
        {
          withFileTypes: true,
        }
      )
    ) {
      if (
        !entry.isFile()
      ) {
        continue;
      }

      const target =
        path.normalize(
          path.join(
            outputDir,
            entry.name
          )
        );

      const stats =
        safeStat(target);

      if (!stats) {
        continue;
      }

      if (
        referencedOutputs.has(
          target
        )
      ) {
        preserve.push({
          path: target,
          reason:
            "REFERENCED_BY_RETAINED_HISTORY",
        });

        continue;
      }

      if (
        ageMs(
          stats,
          now
        ) >
        orphanAgeMs
      ) {
        remove.push({
          path: target,
          type: "file",
          reason:
            "ORPHAN_OUTPUT_EXPIRED",
        });
      } else {
        preserve.push({
          path: target,
          reason:
            "RECENT_UNREFERENCED_OUTPUT",
        });
      }
    }
  }

  return {
    root:
      projectRoot,

    generatedAt:
      new Date(now)
        .toISOString(),

    policy: {
      orphanAgeMs,
      terminalCacheAgeMs,
      deleteReferencedOutputs:
        false,
    },

    remove,
    preserve,
  };
}

function applyImageToVideoCleanup(
  plan
) {
  const removed = [];

  for (
    const item of
    plan.remove || []
  ) {
    const target =
      path.resolve(
        item.path
      );

    if (
      !target.startsWith(
        path.resolve(
          plan.root,
          "app",
          "cache",
          "image-to-video"
        ) +
        path.sep
      ) &&
      !target.startsWith(
        path.resolve(
          plan.root,
          "app",
          "outputs",
          "video"
        ) +
        path.sep
      )
    ) {
      throw new Error(
        `REFUSING_OUTSIDE_I2V_PATH:${target}`
      );
    }

    fs.rmSync(
      target,
      {
        recursive:
          item.type ===
          "directory",

        force: true,
      }
    );

    removed.push({
      ...item,
      path: target,
    });
  }

  return {
    removed,
    removedCount:
      removed.length,
  };
}

module.exports = {
  TERMINAL_STATES,
  resolveOutputPath,
  collectReferencedOutputs,
  planImageToVideoCleanup,
  applyImageToVideoCleanup,
};
