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

class StoragePolicyManager {
  constructor({
    configPath,
    statePath,
    healthScorer,
  }) {
    this.configPath =
      configPath;

    this.statePath =
      statePath;

    this.healthScorer =
      healthScorer;
  }

  readConfig() {
    return readJson(
      this.configPath
    );
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
        lastSelection: null,
        history: [],
      };
    }

    return readJson(
      this.statePath
    );
  }

  writeState(state) {
    state.updatedAt =
      new Date().toISOString();

    state.history =
      (
        state.history || []
      ).slice(-500);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  getProfiles() {
    return this.readConfig();
  }

  getProfile(
    workloadType
  ) {
    const config =
      this.readConfig();

    const requested =
      String(
        workloadType || ""
      ).trim()
      .toLowerCase();

    const profileId =
      requested &&
      config.profiles?.[
        requested
      ]
        ? requested
        : config.defaultProfile;

    const profile =
      config.profiles?.[
        profileId
      ];

    if (!profile) {
      const error =
        new Error(
          "Storage policy profile was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    return {
      id:
        profileId,
      ...profile,
    };
  }

  calculatePolicyScore(
    candidate,
    profile
  ) {
    const healthScore =
      Number(
        candidate.score
      ) || 0;

    const breakdown =
      candidate.breakdown || {};

    const categoryAdjustment =
      Number(
        profile
          .categoryWeights?.[
          candidate.provider
            .category
        ]
      ) || 0;

    const healthWeight =
      Number(
        profile
          .scoreWeights
          ?.health
      ) || 1;

    const freeSpaceWeight =
      Number(
        profile
          .scoreWeights
          ?.freeSpace
      ) || 1;

    const latencyWeight =
      Number(
        profile
          .scoreWeights
          ?.latency
      ) || 1;

    const stabilityWeight =
      Number(
        profile
          .scoreWeights
          ?.stability
      ) || 1;

    const raw =
      healthScore *
        healthWeight +
      (
        Number(
          breakdown.freeSpace
        ) || 0
      ) *
        (
          freeSpaceWeight - 1
        ) +
      (
        Number(
          breakdown.latency
        ) || 0
      ) *
        (
          latencyWeight - 1
        ) +
      (
        Number(
          breakdown.stability
        ) || 0
      ) *
        (
          stabilityWeight - 1
        ) +
      categoryAdjustment;

    const availableBytes =
      Number(
        candidate.health
          ?.availableBytes
      );

    let minimumSpacePenalty =
      0;

    if (
      Number.isFinite(
        availableBytes
      ) &&
      availableBytes <
        Number(
          profile
            .minimumFreeBytes ||
          0
        )
    ) {
      minimumSpacePenalty =
        -100;
    }

    return {
      finalScore:
        Math.round(
          (
            raw +
            minimumSpacePenalty
          ) *
          100
        ) / 100,
      categoryAdjustment,
      minimumSpacePenalty,
    };
  }

  selectForWorkload({
    workloadType,
    capability = "write",
  }) {
    const profile =
      this.getProfile(
        workloadType
      );

    const evaluated =
      this.healthScorer
        .evaluateAll()
        .filter(
          (candidate) =>
            candidate.provider
              .enabled !==
              false &&
            candidate.provider
              .capabilities
              ?.[capability] ===
              true &&
            candidate.health
              ?.status ===
              "online" &&
            (
              capability !==
                "write" ||
              candidate.health
                ?.writable ===
                true
            )
        )
        .map(
          (candidate) => {
            const policy =
              this.calculatePolicyScore(
                candidate,
                profile
              );

            return {
              ...candidate,
              workloadType:
                profile.id,
              policy,
              finalScore:
                policy.finalScore,
            };
          }
        )
        .sort(
          (left, right) =>
            right.finalScore -
            left.finalScore
        );

    if (
      evaluated.length ===
      0
    ) {
      const error =
        new Error(
          "No storage provider is available for this workload."
        );

      error.statusCode =
        409;

      throw error;
    }

    const selected =
      evaluated[0];

    const state =
      this.readState();

    state.lastSelection = {
      workloadType:
        profile.id,
      providerId:
        selected.provider.id,
      finalScore:
        selected.finalScore,
      selectedAt:
        new Date().toISOString(),
    };

    state.history.push({
      ...state.lastSelection,
    });

    this.writeState(
      state
    );

    return {
      profile,
      selected,
      candidates:
        evaluated,
    };
  }

  getStatus() {
    return {
      config:
        this.readConfig(),
      state:
        this.readState(),
    };
  }
}

module.exports = {
  StoragePolicyManager,
};
