"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readJson(filePath) {
  return JSON.parse(
    fs.readFileSync(
      filePath,
      "utf8"
    )
  );
}

function writeJsonAtomic(
  filePath,
  value
) {
  fs.mkdirSync(
    path.dirname(filePath),
    {
      recursive: true,
    }
  );

  const temporaryPath =
    `${filePath}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.renameSync(
    temporaryPath,
    filePath
  );
}

function clamp(
  value,
  minimum,
  maximum
) {
  return Math.min(
    maximum,
    Math.max(
      minimum,
      Number(value) || 0
    )
  );
}

function categoryBaseScore(
  category
) {
  switch (category) {
    case "external":
      return 18;

    case "nas":
      return 15;

    case "cloud":
      return 12;

    case "local":
      return 8;

    default:
      return 0;
  }
}

class StorageHealthScorer {
  constructor({
    statePath,
    providerCore,
  }) {
    this.statePath =
      statePath;

    this.providerCore =
      providerCore;
  }

  readState() {
    if (
      !fs.existsSync(
        this.statePath
      )
    ) {
      return {
        schemaVersion: 1,
        updatedAt: null,
        providers: {},
        selectionHistory: [],
      };
    }

    return readJson(
      this.statePath
    );
  }

  writeState(state) {
    state.updatedAt =
      new Date().toISOString();

    state.selectionHistory =
      (
        state.selectionHistory ||
        []
      ).slice(-500);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  scoreProvider(
    provider,
    health,
    previous = null
  ) {
    let score = 0;

    const breakdown = {
      availability: 0,
      writable: 0,
      freeSpace: 0,
      latency: 0,
      stability: 0,
      priority: 0,
      category: 0,
    };

    if (
      health?.status ===
      "online"
    ) {
      breakdown.availability =
        30;
    } else if (
      health?.status ===
      "degraded"
    ) {
      breakdown.availability =
        10;
    } else {
      breakdown.availability =
        -50;
    }

    breakdown.writable =
      health?.writable ===
      true
        ? 20
        : -40;

    if (
      Number.isFinite(
        health?.availableBytes
      ) &&
      Number.isFinite(
        health?.totalBytes
      ) &&
      health.totalBytes > 0
    ) {
      const ratio =
        health.availableBytes /
        health.totalBytes;

      breakdown.freeSpace =
        clamp(
          ratio * 20,
          0,
          20
        );

      if (ratio < 0.05) {
        breakdown.freeSpace -=
          25;
      } else if (
        ratio < 0.10
      ) {
        breakdown.freeSpace -=
          10;
      }
    } else {
      breakdown.freeSpace =
        5;
    }

    const latencyMs =
      Number(
        health?.latencyMs
      );

    if (
      Number.isFinite(
        latencyMs
      ) &&
      latencyMs >= 0
    ) {
      if (latencyMs <= 10) {
        breakdown.latency =
          15;
      } else if (
        latencyMs <= 50
      ) {
        breakdown.latency =
          12;
      } else if (
        latencyMs <= 150
      ) {
        breakdown.latency =
          8;
      } else if (
        latencyMs <= 500
      ) {
        breakdown.latency =
          3;
      } else {
        breakdown.latency =
          -5;
      }
    } else {
      breakdown.latency =
        2;
    }

    const failures =
      Number(
        previous?.recentFailures
      ) || 0;

    breakdown.stability =
      clamp(
        10 -
          failures * 3,
        -20,
        10
      );

    const priority =
      Number(
        provider.priority
      ) || 100;

    breakdown.priority =
      clamp(
        15 -
          priority / 10,
        -10,
        15
      );

    breakdown.category =
      categoryBaseScore(
        provider.category
      );

    score =
      Object.values(
        breakdown
      ).reduce(
        (sum, value) =>
          sum + value,
        0
      );

    if (
      health?.status !==
      "online" ||
      health?.writable !==
      true
    ) {
      score =
        Math.min(
          score,
          0
        );
    }

    return {
      score:
        Math.round(
          score * 100
        ) / 100,
      breakdown,
    };
  }

  evaluateAll() {
    const checked =
      this.providerCore
        .checkAllProviders();

    const state =
      this.readState();

    const evaluated =
      checked.map(
        (result) => {
          const provider =
            result.provider;

          const previous =
            state.providers?.[
              provider.id
            ] || null;

          const scoring =
            this.scoreProvider(
              provider,
              result.health,
              previous
            );

          const record = {
            providerId:
              provider.id,
            name:
              provider.name,
            category:
              provider.category,
            adapter:
              provider.adapter,
            priority:
              provider.priority,
            health:
              result.health,
            score:
              scoring.score,
            breakdown:
              scoring.breakdown,
            recentFailures:
              previous
                ?.recentFailures ||
              0,
            evaluatedAt:
              new Date()
                .toISOString(),
          };

          state.providers = {
            ...(state.providers ||
              {}),
            [provider.id]:
              record,
          };

          return {
            provider,
            health:
              result.health,
            score:
              scoring.score,
            breakdown:
              scoring.breakdown,
          };
        }
      );

    this.writeState(
      state
    );

    return evaluated.sort(
      (left, right) =>
        right.score -
        left.score
    );
  }

  selectBestProvider({
    capability = "write",
  } = {}) {
    const evaluated =
      this.evaluateAll()
        .filter(
          (result) =>
            result.provider
              .enabled !==
              false &&
            result.provider
              .capabilities
              ?.[capability] ===
              true &&
            result.health
              .status ===
              "online" &&
            (
              capability !==
                "write" ||
              result.health
                .writable === true
            )
        );

    if (
      evaluated.length ===
      0
    ) {
      const error =
        new Error(
          "No healthy storage provider is available."
        );

      error.statusCode =
        409;

      throw error;
    }

    const selected =
      evaluated[0];

    const state =
      this.readState();

    state.selectionHistory.push({
      providerId:
        selected.provider.id,
      score:
        selected.score,
      capability,
      selectedAt:
        new Date().toISOString(),
    });

    this.writeState(
      state
    );

    return selected;
  }

  recordFailure(
    providerId
  ) {
    const state =
      this.readState();

    const current =
      state.providers?.[
        providerId
      ] || {};

    state.providers = {
      ...(state.providers ||
        {}),
      [providerId]: {
        ...current,
        recentFailures:
          Math.min(
            20,
            (
              Number(
                current
                  .recentFailures
              ) || 0
            ) + 1
          ),
      },
    };

    return this.writeState(
      state
    );
  }

  recordSuccess(
    providerId
  ) {
    const state =
      this.readState();

    const current =
      state.providers?.[
        providerId
      ] || {};

    state.providers = {
      ...(state.providers ||
        {}),
      [providerId]: {
        ...current,
        recentFailures:
          Math.max(
            0,
            (
              Number(
                current
                  .recentFailures
              ) || 0
            ) - 1
          ),
      },
    };

    return this.writeState(
      state
    );
  }

  getStatus() {
    return this.readState();
  }
}

module.exports = {
  StorageHealthScorer,
  categoryBaseScore,
  clamp,
};
