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

function calculateReserveBytes({
  requiredBytes,
  workloadType,
}) {
  const required =
    Math.max(
      0,
      Number(
        requiredBytes
      ) || 0
    );

  const percentage =
    workloadType === "video"
      ? 0.20
      : workloadType === "models"
        ? 0.15
        : workloadType === "backups"
          ? 0.15
          : 0.10;

  const minimumReserve =
    workloadType === "video"
      ? 20 * 1024 ** 3
      : workloadType === "models"
        ? 10 * 1024 ** 3
        : 2 * 1024 ** 3;

  return Math.max(
    Math.ceil(
      required * percentage
    ),
    minimumReserve
  );
}

function capacityLevel({
  availableBytes,
  requiredBytes,
  reserveBytes,
}) {
  const available =
    Number(
      availableBytes
    );

  if (
    !Number.isFinite(
      available
    )
  ) {
    return "unknown";
  }

  const required =
    Math.max(
      0,
      Number(
        requiredBytes
      ) || 0
    );

  const reserve =
    Math.max(
      0,
      Number(
        reserveBytes
      ) || 0
    );

  const remaining =
    available -
    required -
    reserve;

  if (remaining < 0) {
    return "critical";
  }

  if (
    remaining <
    Math.max(
      5 * 1024 ** 3,
      available * 0.10
    )
  ) {
    return "warning";
  }

  return "healthy";
}

class StorageCapacityManager {
  constructor({
    statePath,
    healthScorer,
    policyManager,
  }) {
    this.statePath =
      statePath;

    this.healthScorer =
      healthScorer;

    this.policyManager =
      policyManager;
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
        reservations: [],
        forecasts: [],
        events: [],
      };
    }

    return readJson(
      this.statePath
    );
  }

  writeState(state) {
    state.updatedAt =
      new Date().toISOString();

    state.reservations =
      (
        state.reservations ||
        []
      ).slice(-1000);

    state.forecasts =
      (
        state.forecasts ||
        []
      ).slice(-500);

    state.events =
      (
        state.events ||
        []
      ).slice(-500);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  estimateSourceBytes(
    sourcePath
  ) {
    try {
      const stat =
        fs.statSync(
          sourcePath
        );

      if (stat.isFile()) {
        return stat.size;
      }
    } catch {
      return null;
    }

    return null;
  }

  getReservedBytes(
    providerId
  ) {
    const state =
      this.readState();

    return (
      state.reservations || []
    )
      .filter(
        (reservation) =>
          reservation.providerId ===
            providerId &&
          reservation.status ===
            "active"
      )
      .reduce(
        (sum, reservation) =>
          sum +
          (
            Number(
              reservation
                .requiredBytes
            ) || 0
          ) +
          (
            Number(
              reservation
                .reserveBytes
            ) || 0
          ),
        0
      );
  }

  evaluateProvider({
    provider,
    health,
    requiredBytes,
    workloadType,
  }) {
    const reserveBytes =
      calculateReserveBytes({
        requiredBytes,
        workloadType,
      });

    const reservedBytes =
      this.getReservedBytes(
        provider.id
      );

    const rawAvailableBytes =
      Number(
        health
          ?.availableBytes
      );

    const effectiveAvailableBytes =
      Number.isFinite(
        rawAvailableBytes
      )
        ? Math.max(
            0,
            rawAvailableBytes -
              reservedBytes
          )
        : null;

    const level =
      capacityLevel({
        availableBytes:
          effectiveAvailableBytes,
        requiredBytes,
        reserveBytes,
      });

    const sufficient =
      level !== "critical" &&
      (
        effectiveAvailableBytes ===
          null ||
        effectiveAvailableBytes >=
          (
            Number(
              requiredBytes
            ) || 0
          ) +
          reserveBytes
      );

    return {
      providerId:
        provider.id,
      providerName:
        provider.name,
      category:
        provider.category,
      workloadType,
      requiredBytes:
        Number(
          requiredBytes
        ) || 0,
      reserveBytes,
      reservedBytes,
      rawAvailableBytes:
        Number.isFinite(
          rawAvailableBytes
        )
          ? rawAvailableBytes
          : null,
      effectiveAvailableBytes,
      sufficient,
      level,
      checkedAt:
        new Date().toISOString(),
    };
  }

  forecast({
    workloadType,
    sourcePath = null,
    requiredBytes = null,
  }) {
    const bytes =
      Number.isFinite(
        Number(
          requiredBytes
        )
      )
        ? Number(
            requiredBytes
          )
        : this
            .estimateSourceBytes(
              sourcePath
            );

    if (
      !Number.isFinite(
        bytes
      ) ||
      bytes < 0
    ) {
      const error =
        new Error(
          "Unable to determine required storage capacity."
        );

      error.statusCode =
        400;

      throw error;
    }

    const health =
      this.healthScorer
        .evaluateAll();

    const evaluations =
      health.map(
        (candidate) =>
          this.evaluateProvider({
            provider:
              candidate.provider,
            health:
              candidate.health,
            requiredBytes:
              bytes,
            workloadType,
          })
      );

    const healthy =
      evaluations.filter(
        (item) =>
          item.sufficient
      );

    let recommendation =
      null;

    if (
      healthy.length > 0
    ) {
      try {
        const policy =
          this.policyManager
            .selectForWorkload({
              workloadType,
              capability:
                "write",
            });

        const policyProviderId =
          policy.selected
            .provider.id;

        recommendation =
          healthy.find(
            (item) =>
              item.providerId ===
              policyProviderId
          ) ||
          healthy[0];
      } catch {
        recommendation =
          healthy[0];
      }
    }

    const forecast = {
      workloadType,
      sourcePath,
      requiredBytes:
        bytes,
      recommendation,
      providers:
        evaluations,
      sufficientProviders:
        healthy.length,
      createdAt:
        new Date().toISOString(),
    };

    const state =
      this.readState();

    state.forecasts.push(
      forecast
    );

    for (
      const evaluation of
      evaluations
    ) {
      state.providers = {
        ...(state.providers ||
          {}),
        [evaluation.providerId]:
          evaluation,
      };
    }

    this.writeState(
      state
    );

    return forecast;
  }

  reserve({
    jobId,
    providerId,
    requiredBytes,
    workloadType,
  }) {
    const state =
      this.readState();

    state.reservations =
      (
        state.reservations || []
      ).filter(
        (item) =>
          !(
            item.jobId ===
              jobId &&
            item.status ===
              "active"
          )
      );

    const reservation = {
      jobId,
      providerId,
      workloadType,
      requiredBytes:
        Number(
          requiredBytes
        ) || 0,
      reserveBytes:
        calculateReserveBytes({
          requiredBytes,
          workloadType,
        }),
      status:
        "active",
      createdAt:
        new Date().toISOString(),
      releasedAt:
        null,
    };

    state.reservations.push(
      reservation
    );

    this.writeState(
      state
    );

    return reservation;
  }

  release(
    jobId
  ) {
    const state =
      this.readState();

    let released = 0;

    for (
      const reservation of
      state.reservations || []
    ) {
      if (
        reservation.jobId ===
          jobId &&
        reservation.status ===
          "active"
      ) {
        reservation.status =
          "released";

        reservation.releasedAt =
          new Date().toISOString();

        released += 1;
      }
    }

    this.writeState(
      state
    );

    return {
      jobId,
      released,
    };
  }

  getCleanupRecommendations() {
    const state =
      this.readState();

    const recommendations = [];

    for (
      const [
        providerId,
        provider,
      ] of Object.entries(
        state.providers || {}
      )
    ) {
      if (
        provider.level ===
        "critical"
      ) {
        recommendations.push({
          providerId,
          severity:
            "critical",
          action:
            "Review temporary files, completed downloads, old caches or move data to another healthy provider.",
          automaticDeletion:
            false,
        });
      } else if (
        provider.level ===
        "warning"
      ) {
        recommendations.push({
          providerId,
          severity:
            "warning",
          action:
            "Consider moving large models, video or backups before starting additional transfers.",
          automaticDeletion:
            false,
        });
      }
    }

    return recommendations;
  }

  getStatus() {
    return {
      ...this.readState(),
      cleanupRecommendations:
        this
          .getCleanupRecommendations(),
    };
  }
}

module.exports = {
  StorageCapacityManager,
  calculateReserveBytes,
  capacityLevel,
};
