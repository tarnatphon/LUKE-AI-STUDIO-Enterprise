"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  spawn,
} = require("node:child_process");

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

function expandHome(value) {
  const text =
    String(value || "");

  if (text === "~") {
    return os.homedir();
  }

  if (text.startsWith("~/")) {
    return path.join(
      os.homedir(),
      text.slice(2)
    );
  }

  return text;
}

function createJobId() {
  return (
    `runtime-install-${Date.now()}-` +
    Math.random()
      .toString(16)
      .slice(2)
  );
}

function executableExists(
  executablePath
) {
  try {
    fs.accessSync(
      executablePath,
      fs.constants.X_OK
    );

    return true;
  } catch {
    return false;
  }
}

// LUKE_AI_RUNTIME_INSTALL_PROGRESS_PREFLIGHT_V2
function clampInstallProgress(value) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(number)
    )
  );
}

function formatInstallBytes(bytes) {
  const number =
    Number(bytes);

  if (
    !Number.isFinite(number) ||
    number < 0
  ) {
    return null;
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
    "TB",
  ];

  let value = number;
  let index = 0;

  while (
    value >= 1024 &&
    index < units.length - 1
  ) {
    value /= 1024;
    index += 1;
  }

  return (
    `${value.toFixed(
      index === 0 ? 0 : 1
    )} ${units[index]}`
  );
}

function parseInstallProgress(
  output,
  currentProgress = 0
) {
  const text =
    String(output || "");

  const matches = [
    ...text.matchAll(
      /(?:^|[\s[(])(\d{1,3}(?:\.\d+)?)\s*%/g
    ),
  ];

  if (matches.length > 0) {
    const latest =
      Number(
        matches[
          matches.length - 1
        ][1]
      );

    if (Number.isFinite(latest)) {
      return Math.max(
        currentProgress,
        clampInstallProgress(latest)
      );
    }
  }

  const lower =
    text.toLowerCase();

  if (
    lower.includes("downloading") ||
    lower.includes("fetching")
  ) {
    return Math.max(
      currentProgress,
      25
    );
  }

  if (lower.includes("installing")) {
    return Math.max(
      currentProgress,
      55
    );
  }

  if (
    lower.includes("building") ||
    lower.includes("linking")
  ) {
    return Math.max(
      currentProgress,
      75
    );
  }

  if (
    lower.includes(
      "successfully installed"
    ) ||
    lower.includes(
      "installation complete"
    )
  ) {
    return Math.max(
      currentProgress,
      95
    );
  }

  return currentProgress;
}

class RuntimeInstallQueue {
  constructor({
    root,
    policyPath,
    statePath,
    spawnImpl = spawn,
  }) {
    this.root = root;
    this.policyPath =
      policyPath;
    this.statePath =
      statePath;
    this.spawnImpl =
      spawnImpl;

    this.activeChild = null;
    this.processing = false;
  }

  readPolicy() {
    return readJson(
      this.policyPath
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
        activeJobId: null,
        jobs: [],
      };
    }

    return readJson(
      this.statePath
    );
  }

  writeState(state) {
    state.updatedAt =
      new Date().toISOString();

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  getSnapshot() {
    const state =
      this.readState();

    return {
      ...state,
      processing:
        this.processing,
    };
  }

  resolveHomebrew() {
    const candidates = [
      "/opt/homebrew/bin/brew",
      "/usr/local/bin/brew",
    ];

    return (
      candidates.find(
        executableExists
      ) ||
      null
    );
  }

  resolvePython() {
    const candidates = [
      process.env.PYTHON3,
      "/opt/homebrew/bin/python3",
      "/usr/local/bin/python3",
      "/usr/bin/python3",
    ].filter(Boolean);

    return (
      candidates.find(
        executableExists
      ) ||
      null
    );
  }

  resolveDiskCheckPath(
    runtimeType
  ) {
    const policy =
      this.readPolicy();

    const definition =
      policy.supportedRuntimes
        ?.[runtimeType];

    if (
      definition?.installer ===
      "python-venv"
    ) {
      return expandHome(
        policy.paths
          ?.pythonVenvRoot ||
        "~/Library/Application Support/LUKE AI STUDIO/runtime-venvs"
      );
    }

    const brew =
      this.resolveHomebrew();

    if (
      brew?.startsWith(
        "/opt/homebrew/"
      )
    ) {
      return "/opt/homebrew";
    }

    if (
      brew?.startsWith(
        "/usr/local/"
      )
    ) {
      return "/usr/local";
    }

    return this.root;
  }

  getDiskPreflight(
    runtimeType
  ) {
    const policy =
      this.readPolicy();

    const definition =
      policy.supportedRuntimes
        ?.[runtimeType];

    if (!definition) {
      const error =
        new Error(
          "Unsupported runtime type."
        );

      error.statusCode = 400;
      throw error;
    }

    const estimatedInstallBytes =
      Math.max(
        0,
        Number(
          definition
            .estimatedInstallBytes
        ) || 0
      );

    const bufferBytes =
      Math.max(
        0,
        Number(
          policy.installation
            ?.minimumFreeSpaceBufferBytes
        ) || 0
      );

    const requiredBytes =
      estimatedInstallBytes +
      bufferBytes;

    const requestedPath =
      this.resolveDiskCheckPath(
        runtimeType
      );

    let existingPath =
      requestedPath;

    while (
      existingPath &&
      !fs.existsSync(existingPath)
    ) {
      const parent =
        path.dirname(
          existingPath
        );

      if (
        parent === existingPath
      ) {
        break;
      }

      existingPath =
        parent;
    }

    if (
      !existingPath ||
      !fs.existsSync(existingPath) ||
      typeof fs.statfsSync !==
        "function"
    ) {
      const allowed =
        policy.installation
          ?.rejectWhenDiskSpaceUnknown !==
        true;

      return {
        runtimeType,
        checked: false,
        allowed,
        path:
          requestedPath,
        existingPath:
          existingPath || null,
        estimatedInstallBytes,
        bufferBytes,
        requiredBytes,
        availableBytes: null,
        estimatedInstallText:
          formatInstallBytes(
            estimatedInstallBytes
          ),
        bufferText:
          formatInstallBytes(
            bufferBytes
          ),
        requiredText:
          formatInstallBytes(
            requiredBytes
          ),
        availableText: null,
        reason:
          "disk-space-unavailable",
      };
    }

    const statistics =
      fs.statfsSync(
        existingPath
      );

    const blockSize =
      Number(
        statistics.bsize ||
        statistics.frsize ||
        0
      );

    const availableBlocks =
      Number(
        statistics.bavail ??
        statistics.bfree ??
        0
      );

    const availableBytes =
      Math.max(
        0,
        blockSize *
        availableBlocks
      );

    return {
      runtimeType,
      checked: true,
      allowed:
        availableBytes >=
        requiredBytes,
      path:
        requestedPath,
      existingPath,
      estimatedInstallBytes,
      bufferBytes,
      requiredBytes,
      availableBytes,
      estimatedInstallText:
        formatInstallBytes(
          estimatedInstallBytes
        ),
      bufferText:
        formatInstallBytes(
          bufferBytes
        ),
      requiredText:
        formatInstallBytes(
          requiredBytes
        ),
      availableText:
        formatInstallBytes(
          availableBytes
        ),
      reason:
        availableBytes >=
          requiredBytes
          ? null
          : "insufficient-disk-space",
    };
  }

  updateJobProgress(
    jobId,
    progress,
    stage = null
  ) {
    return this.updateJob(
      jobId,
      (current) => ({
        ...current,
        progress:
          Math.max(
            Number(
              current.progress
            ) || 0,
            clampInstallProgress(
              progress
            )
          ),
        progressStage:
          stage ||
          current.progressStage ||
          null,
        progressUpdatedAt:
          new Date().toISOString(),
      })
    );
  }

  getInstallPlan(
    runtimeType
  ) {
    const policy =
      this.readPolicy();

    const definition =
      policy.supportedRuntimes
        ?.[runtimeType];

    if (!definition) {
      const error = new Error(
        "Unsupported runtime type."
      );

      error.statusCode = 400;
      throw error;
    }

    if (
      definition.appleSiliconOnly ===
        true &&
      !(
        process.platform ===
          "darwin" &&
        process.arch === "arm64"
      )
    ) {
      const error = new Error(
        `${runtimeType} requires Apple Silicon.`
      );

      error.statusCode = 409;
      throw error;
    }

    if (
      definition.installer ===
      "homebrew"
    ) {
      if (
        policy.installation
          ?.allowHomebrew !== true
      ) {
        const error = new Error(
          "Homebrew installation is disabled."
        );

        error.statusCode = 403;
        throw error;
      }

      const brew =
        this.resolveHomebrew();

      if (!brew) {
        const error = new Error(
          "Homebrew was not detected. Install Homebrew before installing this runtime."
        );

        error.statusCode = 409;
        throw error;
      }

      return {
        runtimeType,
        displayName:
          definition.displayName,
        command: brew,
        arguments: [
          "install",
          definition.package,
        ],
        workingDirectory:
          this.root,
        environment: {
          ...process.env,
          HOMEBREW_NO_AUTO_UPDATE:
            "1",
        },
        installationType:
          "homebrew",
      };
    }

    if (
      definition.installer ===
      "python-venv"
    ) {
      if (
        policy.installation
          ?.allowPythonVenv !== true
      ) {
        const error = new Error(
          "Python virtual environment installation is disabled."
        );

        error.statusCode = 403;
        throw error;
      }

      const python =
        this.resolvePython();

      if (!python) {
        const error = new Error(
          "Python 3 was not detected."
        );

        error.statusCode = 409;
        throw error;
      }

      const venvRoot =
        expandHome(
          policy.paths
            ?.pythonVenvRoot ||
          "~/Library/Application Support/LUKE AI STUDIO/runtime-venvs"
        );

      const venvPath =
        path.join(
          venvRoot,
          runtimeType
            .replace(/[^a-z0-9.-]/gi, "-")
        );

      const installerScript =
        [
          "import os, subprocess, sys, venv",
          `target=${JSON.stringify(venvPath)}`,
          "os.makedirs(os.path.dirname(target), exist_ok=True)",
          "venv.EnvBuilder(with_pip=True, clear=False).create(target)",
          "pip=os.path.join(target, 'bin', 'pip')",
          `subprocess.check_call([pip, 'install', '--upgrade', ${JSON.stringify(definition.package)}])`,
        ].join(";");

      return {
        runtimeType,
        displayName:
          definition.displayName,
        command: python,
        arguments: [
          "-c",
          installerScript,
        ],
        workingDirectory:
          this.root,
        environment: {
          ...process.env,
        },
        installationType:
          "python-venv",
        venvPath,
      };
    }

    const error = new Error(
      "Unsupported installer type."
    );

    error.statusCode = 400;
    throw error;
  }

  enqueue(runtimeType) {
    const policy =
      this.readPolicy();

    const state =
      this.readState();

    const maximumQueuedJobs =
      Number(
        policy.queue
          ?.maximumQueuedJobs
      ) || 20;

    const pendingCount =
      state.jobs.filter(
        (job) =>
          [
            "queued",
            "installing",
          ].includes(
            job.status
          )
      ).length;

    if (
      pendingCount >=
      maximumQueuedJobs
    ) {
      const error = new Error(
        "Runtime install queue is full."
      );

      error.statusCode = 409;
      throw error;
    }

    const duplicate =
      state.jobs.find(
        (job) =>
          job.runtimeType ===
            runtimeType &&
          [
            "queued",
            "installing",
          ].includes(
            job.status
          )
      );

    if (duplicate) {
      return duplicate;
    }

    const preflight =
      this.getDiskPreflight(
        runtimeType
      );

    if (
      preflight.allowed !== true
    ) {
      const error =
        new Error(
          `พื้นที่ว่างไม่เพียงพอสำหรับ ${runtimeType}: ต้องใช้ ${preflight.requiredText || preflight.requiredBytes + " bytes"} แต่มี ${preflight.availableText || "ไม่ทราบ"}`
        );

      error.statusCode = 409;
      error.preflight =
        preflight;

      throw error;
    }

    const plan =
      this.getInstallPlan(
        runtimeType
      );

    const job = {
      id:
        createJobId(),
      runtimeType,
      displayName:
        plan.displayName,
      installationType:
        plan.installationType,
      status:
        "queued",
      progress: 0,
      progressStage:
        "queued",
      progressUpdatedAt:
        new Date().toISOString(),
      diskPreflight:
        preflight,
      createdAt:
        new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      log: "",
      cancelledAt: null,
    };

    state.jobs.push(job);

    this.writeState(state);

    queueMicrotask(
      () => {
        this.processNext()
          .catch(() => {});
      }
    );

    return job;
  }

  appendLog(
    jobId,
    content
  ) {
    const policy =
      this.readPolicy();

    const maximumCharacters =
      Number(
        policy.installation
          ?.maximumLogCharacters
      ) || 50000;

    const state =
      this.readState();

    const job =
      state.jobs.find(
        (item) =>
          item.id === jobId
      );

    if (!job) {
      return;
    }

    job.log =
      (
        String(job.log || "") +
        String(content || "")
      ).slice(
        -maximumCharacters
      );

    this.writeState(state);
  }

  updateJob(
    jobId,
    updater
  ) {
    const state =
      this.readState();

    const index =
      state.jobs.findIndex(
        (job) =>
          job.id === jobId
      );

    if (index < 0) {
      return null;
    }

    const current =
      state.jobs[index];

    const updated =
      updater({
        ...current,
      }) || current;

    state.jobs[index] =
      updated;

    this.writeState(state);

    return updated;
  }

  async runJob(job) {
    const policy =
      this.readPolicy();

    const plan =
      this.getInstallPlan(
        job.runtimeType
      );

    this.updateJob(
      job.id,
      (current) => ({
        ...current,
        status:
          "installing",
        progress:
          Math.max(
            Number(
              current.progress
            ) || 0,
            5
          ),
        progressStage:
          "starting",
        progressUpdatedAt:
          new Date().toISOString(),
        startedAt:
          new Date().toISOString(),
        error: null,
      })
    );

    const state =
      this.readState();

    state.activeJobId =
      job.id;

    this.writeState(state);

    const child =
      this.spawnImpl(
        plan.command,
        plan.arguments,
        {
          cwd:
            plan.workingDirectory,
          env:
            plan.environment,
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
          detached: false,
          shell: false,
        }
      );

    this.activeChild =
      child;

    child.stdout?.on(
      "data",
      (chunk) => {
        const output =
          String(chunk);

        this.appendLog(
          job.id,
          output
        );

        const latestJob =
          this.readState()
            .jobs.find(
              (item) =>
                item.id === job.id
            );

        const nextProgress =
          parseInstallProgress(
            output,
            Number(
              latestJob?.progress
            ) || 0
          );

        if (
          nextProgress >
          Number(
            latestJob?.progress
          )
        ) {
          this.updateJobProgress(
            job.id,
            Math.min(
              95,
              nextProgress
            ),
            "installing"
          );
        }
      }
    );

    child.stderr?.on(
      "data",
      (chunk) => {
        const output =
          String(chunk);

        this.appendLog(
          job.id,
          output
        );

        const latestJob =
          this.readState()
            .jobs.find(
              (item) =>
                item.id === job.id
            );

        const nextProgress =
          parseInstallProgress(
            output,
            Number(
              latestJob?.progress
            ) || 0
          );

        if (
          nextProgress >
          Number(
            latestJob?.progress
          )
        ) {
          this.updateJobProgress(
            job.id,
            Math.min(
              95,
              nextProgress
            ),
            "installing"
          );
        }
      }
    );

    const timeoutMs =
      Number(
        policy.installation
          ?.timeoutMs
      ) || 1800000;

    let timedOut = false;

    const timeout =
      setTimeout(
        () => {
          timedOut = true;

          if (
            child.exitCode ===
            null
          ) {
            child.kill(
              "SIGTERM"
            );
          }
        },
        timeoutMs
      );

    const result =
      await new Promise(
        (resolve) => {
          child.once(
            "error",
            (error) => {
              resolve({
                exitCode: null,
                signal: null,
                error:
                  error instanceof Error
                    ? error.message
                    : String(error),
              });
            }
          );

          child.once(
            "exit",
            (
              exitCode,
              signal
            ) => {
              resolve({
                exitCode,
                signal,
                error: null,
              });
            }
          );
        }
      );

    clearTimeout(timeout);

    this.activeChild =
      null;

    const latest =
      this.readState();

    const latestJob =
      latest.jobs.find(
        (item) =>
          item.id === job.id
      );

    if (
      latestJob?.status ===
      "cancelled"
    ) {
      latest.activeJobId =
        null;

      this.writeState(latest);
      return;
    }

    if (
      result.exitCode === 0 &&
      !timedOut &&
      !result.error
    ) {
      this.updateJob(
        job.id,
        (current) => ({
          ...current,
          status:
            "completed",
          progress: 100,
          progressStage:
            "completed",
          progressUpdatedAt:
            new Date().toISOString(),
          completedAt:
            new Date().toISOString(),
          exitCode:
            result.exitCode,
          signal:
            result.signal,
          error: null,
        })
      );
    } else {
      this.updateJob(
        job.id,
        (current) => ({
          ...current,
          status:
            "failed",
          progressStage:
            "failed",
          progressUpdatedAt:
            new Date().toISOString(),
          completedAt:
            new Date().toISOString(),
          exitCode:
            result.exitCode,
          signal:
            result.signal,
          error:
            timedOut
              ? "Installation timed out."
              : (
                  result.error ||
                  `Installer exited with code ${result.exitCode}`
                ),
        })
      );
    }

    const finalState =
      this.readState();

    finalState.activeJobId =
      null;

    this.writeState(
      finalState
    );
  }

  async processNext() {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (true) {
        const state =
          this.readState();

        const next =
          state.jobs.find(
            (job) =>
              job.status ===
              "queued"
          );

        if (!next) {
          break;
        }

        await this.runJob(next);

        const policy =
          this.readPolicy();

        const latest =
          this.readState();

        const completed =
          latest.jobs.find(
            (job) =>
              job.id === next.id
          );

        if (
          completed?.status ===
            "failed" &&
          policy.queue
            ?.continueAfterFailure ===
            false
        ) {
          break;
        }
      }
    } finally {
      this.processing = false;
    }
  }

  cancel(jobId) {
    const state =
      this.readState();

    const job =
      state.jobs.find(
        (item) =>
          item.id === jobId
      );

    if (!job) {
      const error = new Error(
        "Install job was not found."
      );

      error.statusCode = 404;
      throw error;
    }

    if (
      ![
        "queued",
        "installing",
      ].includes(
        job.status
      )
    ) {
      return job;
    }

    job.status =
      "cancelled";

    job.progressStage =
      "cancelled";

    job.progressUpdatedAt =
      new Date().toISOString();

    job.cancelledAt =
      new Date().toISOString();

    job.completedAt =
      job.cancelledAt;

    if (
      state.activeJobId ===
      jobId
    ) {
      state.activeJobId =
        null;

      if (
        this.activeChild &&
        this.activeChild.exitCode ===
          null
      ) {
        this.activeChild.kill(
          "SIGTERM"
        );
      }
    }

    this.writeState(state);

    return job;
  }

  clearCompleted() {
    const state =
      this.readState();

    state.jobs =
      state.jobs.filter(
        (job) =>
          [
            "queued",
            "installing",
          ].includes(
            job.status
          )
      );

    this.writeState(state);

    return this.getSnapshot();
  }
}

module.exports = {
  RuntimeInstallQueue,
};
