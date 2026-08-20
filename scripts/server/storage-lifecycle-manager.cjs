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

function ageInDays(
  timestamp,
  now = Date.now()
) {
  const value =
    Number(timestamp);

  if (
    !Number.isFinite(value)
  ) {
    return 0;
  }

  return Math.max(
    0,
    (
      now - value
    ) /
      (
        24 *
        60 *
        60 *
        1000
      )
  );
}

function normalizeWorkload(
  workloadType
) {
  const value =
    String(
      workloadType || ""
    )
      .trim()
      .toLowerCase();

  return [
    "models",
    "images",
    "video",
    "backups",
    "temporary",
  ].includes(value)
    ? value
    : "temporary";
}

function safeRelativePath(
  rootPath,
  absolutePath
) {
  const root =
    path.resolve(rootPath);

  const candidate =
    path.resolve(
      absolutePath
    );

  const relative =
    path.relative(
      root,
      candidate
    );

  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    const error =
      new Error(
        "Path is outside lifecycle scan root."
      );

    error.statusCode = 403;
    throw error;
  }

  return relative;
}

class StorageLifecycleManager {
  constructor({
    configPath,
    statePath,
    workloadDetector,
  }) {
    this.configPath =
      configPath;

    this.statePath =
      statePath;

    this.workloadDetector =
      workloadDetector;
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
        lastPlan: null,
        plans: [],
        protectedPaths: [],
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

    state.plans =
      (
        state.plans || []
      ).slice(-100);

    state.events =
      (
        state.events || []
      ).slice(-500);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  getRule(
    workloadType
  ) {
    const config =
      this.readConfig();

    const normalized =
      normalizeWorkload(
        workloadType
      );

    return {
      workloadType:
        normalized,
      ...config.rules[
        normalized
      ],
    };
  }

  classify({
    workloadType,
    sizeBytes,
    modifiedAtMs,
    protectedFile = false,
  }) {
    const rule =
      this.getRule(
        workloadType
      );

    const ageDays =
      ageInDays(
        modifiedAtMs
      );

    const bytes =
      Math.max(
        0,
        Number(
          sizeBytes
        ) || 0
      );

    if (protectedFile) {
      return {
        action: "keep",
        reason:
          "protected-path",
        ageDays,
        rule,
      };
    }

    if (
      ageDays >=
        rule
          .deleteCandidateAfterDays &&
      bytes >=
        rule.minimumCandidateBytes
    ) {
      return {
        action:
          "delete-candidate",
        reason:
          "retention-threshold",
        ageDays,
        rule,
      };
    }

    if (
      ageDays >=
      rule.archiveAfterDays
    ) {
      return {
        action: "archive",
        reason:
          "archive-threshold",
        ageDays,
        rule,
      };
    }

    if (
      ageDays >=
      rule.reviewAfterDays
    ) {
      return {
        action: "review",
        reason:
          "review-threshold",
        ageDays,
        rule,
      };
    }

    return {
      action: "keep",
      reason:
        "within-retention",
      ageDays,
      rule,
    };
  }

  isProtected(
    absolutePath
  ) {
    const state =
      this.readState();

    const resolved =
      path.resolve(
        absolutePath
      );

    return (
      state.protectedPaths ||
      []
    ).some(
      (candidate) =>
        resolved ===
          path.resolve(
            candidate
          ) ||
        resolved.startsWith(
          path.resolve(
            candidate
          ) + path.sep
        )
    );
  }

  protectPath(
    targetPath
  ) {
    const resolved =
      path.resolve(
        String(
          targetPath || ""
        )
      );

    const state =
      this.readState();

    if (
      !state.protectedPaths
        .includes(
          resolved
        )
    ) {
      state.protectedPaths
        .push(
          resolved
        );
    }

    this.writeState(
      state
    );

    return {
      protected: true,
      path:
        resolved,
    };
  }

  unprotectPath(
    targetPath
  ) {
    const resolved =
      path.resolve(
        String(
          targetPath || ""
        )
      );

    const state =
      this.readState();

    state.protectedPaths =
      state.protectedPaths
        .filter(
          (candidate) =>
            path.resolve(
              candidate
            ) !==
            resolved
        );

    this.writeState(
      state
    );

    return {
      protected: false,
      path:
        resolved,
    };
  }

  scanDirectory({
    rootPath,
    maxFiles = 5000,
  }) {
    const root =
      path.resolve(
        String(
          rootPath || ""
        )
      );

    if (
      !fs.existsSync(root) ||
      !fs.statSync(root)
        .isDirectory()
    ) {
      const error =
        new Error(
          "Lifecycle scan root was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    const results = [];
    const stack = [root];

    while (
      stack.length > 0 &&
      results.length <
        maxFiles
    ) {
      const current =
        stack.pop();

      let entries;

      try {
        entries =
          fs.readdirSync(
            current,
            {
              withFileTypes:
                true,
            }
          );
      } catch {
        continue;
      }

      for (
        const entry of entries
      ) {
        if (
          results.length >=
          maxFiles
        ) {
          break;
        }

        const absolute =
          path.join(
            current,
            entry.name
          );

        if (
          entry.isSymbolicLink()
        ) {
          continue;
        }

        if (
          entry.isDirectory()
        ) {
          stack.push(
            absolute
          );
          continue;
        }

        if (
          !entry.isFile()
        ) {
          continue;
        }

        let stat;

        try {
          stat =
            fs.statSync(
              absolute
            );
        } catch {
          continue;
        }

        let detection;

        try {
          detection =
            this.workloadDetector
              .detect({
                sourcePath:
                  absolute,
                manualOverride:
                  false,
              });
        } catch {
          detection = {
            workloadType:
              "temporary",
            confidence:
              0,
            reason:
              "detection-failed",
          };
        }

        const classification =
          this.classify({
            workloadType:
              detection
                .workloadType,
            sizeBytes:
              stat.size,
            modifiedAtMs:
              stat.mtimeMs,
            protectedFile:
              this.isProtected(
                absolute
              ),
          });

        results.push({
          absolutePath:
            absolute,
          relativePath:
            safeRelativePath(
              root,
              absolute
            ),
          sizeBytes:
            stat.size,
          modifiedAt:
            stat.mtime
              .toISOString(),
          workloadType:
            detection
              .workloadType,
          confidence:
            detection
              .confidence,
          action:
            classification
              .action,
          reason:
            classification
              .reason,
          ageDays:
            Math.round(
              classification
                .ageDays *
                10
            ) / 10,
          protected:
            classification
              .action ===
              "keep" &&
            classification
              .reason ===
              "protected-path",
        });
      }
    }

    return results;
  }

  createPlan({
    rootPath,
    maxFiles = 5000,
  }) {
    const files =
      this.scanDirectory({
        rootPath,
        maxFiles,
      });

    const summary = {
      totalFiles:
        files.length,
      totalBytes: 0,
      keepFiles: 0,
      reviewFiles: 0,
      archiveFiles: 0,
      deleteCandidateFiles:
        0,
      potentialRecoveryBytes:
        0,
    };

    for (
      const file of files
    ) {
      summary.totalBytes +=
        file.sizeBytes;

      switch (
        file.action
      ) {
        case "review":
          summary.reviewFiles +=
            1;
          break;

        case "archive":
          summary.archiveFiles +=
            1;
          break;

        case "delete-candidate":
          summary.deleteCandidateFiles +=
            1;

          summary
            .potentialRecoveryBytes +=
            file.sizeBytes;
          break;

        default:
          summary.keepFiles +=
            1;
          break;
      }
    }

    const plan = {
      id:
        `lifecycle-${Date.now()}`,
      rootPath:
        path.resolve(
          rootPath
        ),
      automaticDeletion:
        false,
      summary,
      files,
      createdAt:
        new Date()
          .toISOString(),
    };

    const state =
      this.readState();

    state.lastPlan =
      plan;

    state.plans.push({
      id:
        plan.id,
      rootPath:
        plan.rootPath,
      automaticDeletion:
        false,
      summary,
      createdAt:
        plan.createdAt,
    });

    state.events.push({
      type:
        "cleanup-plan-created",
      planId:
        plan.id,
      rootPath:
        plan.rootPath,
      deleteCandidateFiles:
        summary
          .deleteCandidateFiles,
      createdAt:
        plan.createdAt,
    });

    this.writeState(
      state
    );

    return plan;
  }

  getStatus() {
    const config =
      this.readConfig();

    return {
      config,
      state:
        this.readState(),
      deletionCapabilities: {
        automaticDeletion:
          false,
        deleteEndpoint:
          false,
        executionAvailable:
          false,
        planningOnly:
          true,
      },
    };
  }
}

module.exports = {
  StorageLifecycleManager,
  ageInDays,
  normalizeWorkload,
  safeRelativePath,
};
