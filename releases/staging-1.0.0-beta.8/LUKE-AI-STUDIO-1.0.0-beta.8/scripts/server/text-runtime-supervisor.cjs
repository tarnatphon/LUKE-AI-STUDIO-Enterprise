"use strict";

const fs = require("node:fs");
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

  const temporary =
    `${filePath}.tmp-${process.pid}-${Date.now()}`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(
      value,
      null,
      2
    ) + "\n",
    "utf8"
  );

  fs.renameSync(
    temporary,
    filePath
  );
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(
      resolve,
      milliseconds
    );
  });
}

class TextRuntimeSupervisor {
  constructor({
    root,
    policyPath,
    statePath,
    fetchImpl = global.fetch,
    spawnImpl = spawn,
  }) {
    this.root = root;
    this.policyPath =
      policyPath;
    this.statePath =
      statePath;
    this.fetchImpl =
      fetchImpl;
    this.spawnImpl =
      spawnImpl;

    this.child = null;
    this.monitorTimer = null;
    this.restartTimer = null;
    this.stopping = false;
    this.started = false;
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
        status: "stopped",
        desiredState:
          "stopped",
        pid: null,
        ownedProcess: false,
        restartCount: 0,
        consecutiveFailures: 0,
        restartDelayMs: 0,
        suspendedUntil: null,
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

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  updateState(updater) {
    const current =
      this.readState();

    const next =
      updater({
        ...current,
        events: [
          ...(current.events || []),
        ],
      }) || current;

    return this.writeState(
      next
    );
  }

  addEvent(
    type,
    details = {}
  ) {
    const policy =
      this.readPolicy();

    return this.updateState(
      (state) => {
        state.events.push({
          id:
            `runtime-event-${Date.now()}-${Math.random()
              .toString(16)
              .slice(2)}`,
          type,
          createdAt:
            new Date().toISOString(),
          ...details,
        });

        const maximum =
          Number(
            policy.history
              ?.maximumEvents
          ) || 2000;

        state.events =
          state.events.slice(
            -maximum
          );

        return state;
      }
    );
  }

  // LUKE_AI_RUNTIME_SUPERVISOR_POLICY_RELOAD_V1
  reloadPolicy() {
    if (this.monitorTimer) {
      clearInterval(
        this.monitorTimer
      );

      this.monitorTimer = null;
    }

    if (this.started) {
      const policy =
        this.readPolicy();

      const interval =
        Number(
          policy.supervision
            ?.healthCheckIntervalMs
        ) || 5000;

      this.monitorTimer =
        setInterval(
          () => {
            this.monitorOnce()
              .catch(
                (error) => {
                  this.addEvent(
                    "monitor-error",
                    {
                      error:
                        error instanceof Error
                          ? error.message
                          : String(error),
                    }
                  );
                }
              );
          },
          interval
        );

      this.monitorTimer.unref?.();
    }

    this.addEvent(
      "supervisor-policy-reloaded"
    );

    return this.getStatus();
  }

  getStatus() {
    const state =
      this.readState();

    return {
      ...state,
      processRunning:
        Boolean(
          this.child &&
          this.child.exitCode ===
            null
        ),
      supervisorRunning:
        this.started,
    };
  }

  resolveRuntimeCommand() {
    const policy =
      this.readPolicy();

    const command =
      String(
        process.env
          .LUKE_AI_TEXT_RUNTIME_COMMAND ||
        policy.runtime
          ?.command ||
        ""
      ).trim();

    const environmentArgs =
      process.env
        .LUKE_AI_TEXT_RUNTIME_ARGS;

    let args =
      policy.runtime
        ?.arguments || [];

    if (environmentArgs) {
      try {
        args =
          JSON.parse(
            environmentArgs
          );
      } catch {
        throw new Error(
          "LUKE_AI_TEXT_RUNTIME_ARGS must be valid JSON."
        );
      }
    }

    if (
      !command ||
      !Array.isArray(args)
    ) {
      throw new Error(
        "Text runtime command is not configured."
      );
    }

    const configuredWorkingDirectory =
      String(
        policy.runtime
          ?.workingDirectory ||
        "."
      );

    const workingDirectory =
      path.isAbsolute(
        configuredWorkingDirectory
      )
        ? configuredWorkingDirectory
        : path.resolve(
            this.root,
            configuredWorkingDirectory
          );

    return {
      command,
      args,
      workingDirectory,
      environment: {
        ...(
          policy.runtime
            ?.inheritEnvironment ===
            false
            ? {}
            : process.env
        ),
        ...(
          policy.runtime
            ?.environment || {}
        ),
      },
    };
  }

  async healthCheck() {
    const policy =
      this.readPolicy();

    const healthUrl =
      String(
        process.env
          .LUKE_AI_TEXT_RUNTIME_HEALTH_URL ||
        policy.runtime
          ?.healthUrl ||
        ""
      ).trim();

    if (!healthUrl) {
      return {
        healthy: false,
        error:
          "Text runtime health URL is not configured.",
      };
    }

    const controller =
      new AbortController();

    const timeout =
      setTimeout(
        () => {
          controller.abort();
        },
        Number(
          policy.supervision
            ?.healthCheckTimeoutMs
        ) || 3000
      );

    try {
      const response =
        await this.fetchImpl(
          healthUrl,
          {
            signal:
              controller.signal,
          }
        );

      if (!response.ok) {
        return {
          healthy: false,
          statusCode:
            response.status,
          error:
            `Health HTTP ${response.status}`,
        };
      }

      let data = null;

      try {
        data =
          await response.json();
      } catch {}

      return {
        healthy: true,
        statusCode:
          response.status,
        data,
      };
    } catch (error) {
      return {
        healthy: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  calculateRestartDelay() {
    const policy =
      this.readPolicy();

    const state =
      this.readState();

    const initialDelay =
      Number(
        policy.restart
          ?.initialDelayMs
      ) || 1000;

    const maximumDelay =
      Number(
        policy.restart
          ?.maximumDelayMs
      ) || 30000;

    const multiplier =
      Number(
        policy.restart
          ?.backoffMultiplier
      ) || 2;

    const failureIndex =
      Math.max(
        0,
        Number(
          state.consecutiveFailures
        ) - 1
      );

    return Math.min(
      maximumDelay,
      Math.round(
        initialDelay *
        multiplier **
          failureIndex
      )
    );
  }

  isSuspended() {
    const state =
      this.readState();

    if (!state.suspendedUntil) {
      return false;
    }

    return (
      Date.now() <
      new Date(
        state.suspendedUntil
      ).getTime()
    );
  }

  async startRuntime({
    reason = "manual",
  } = {}) {
    if (
      this.child &&
      this.child.exitCode === null
    ) {
      return this.getStatus();
    }

    if (this.isSuspended()) {
      throw new Error(
        "Runtime restart is temporarily suspended."
      );
    }

    const runtime =
      this.resolveRuntimeCommand();

    this.stopping = false;

    this.updateState(
      (state) => {
        state.status =
          "starting";
        state.desiredState =
          "running";
        state.lastError = null;
        state.suspendedUntil =
          null;
        return state;
      }
    );

    this.addEvent(
      "runtime-start-requested",
      {
        reason,
        command:
          runtime.command,
        arguments:
          runtime.args,
      }
    );

    const child =
      this.spawnImpl(
        runtime.command,
        runtime.args,
        {
          cwd:
            runtime.workingDirectory,
          env:
            runtime.environment,
          stdio: [
            "ignore",
            "pipe",
            "pipe",
          ],
          detached: false,
          shell: false,
        }
      );

    this.child = child;

    child.stdout?.on(
      "data",
      (chunk) => {
        this.addEvent(
          "runtime-stdout",
          {
            message:
              String(chunk)
                .slice(0, 2000),
          }
        );
      }
    );

    child.stderr?.on(
      "data",
      (chunk) => {
        this.addEvent(
          "runtime-stderr",
          {
            message:
              String(chunk)
                .slice(0, 2000),
          }
        );
      }
    );

    child.once(
      "spawn",
      () => {
        this.updateState(
          (state) => {
            state.status =
              "starting";
            state.pid =
              child.pid || null;
            state.ownedProcess =
              true;
            state.startedAt =
              new Date().toISOString();
            return state;
          }
        );
      }
    );

    child.once(
      "error",
      (error) => {
        this.handleRuntimeFailure(
          error
        );
      }
    );

    child.once(
      "exit",
      (
        exitCode,
        signal
      ) => {
        const wasStopping =
          this.stopping;

        this.child = null;

        this.updateState(
          (state) => {
            state.status =
              wasStopping
                ? "stopped"
                : "crashed";
            state.pid = null;
            state.ownedProcess =
              false;
            state.lastExitCode =
              exitCode;
            state.lastSignal =
              signal;
            state.lastStoppedAt =
              new Date().toISOString();

            if (!wasStopping) {
              state.consecutiveFailures =
                Number(
                  state.consecutiveFailures
                ) + 1;
            }

            return state;
          }
        );

        this.addEvent(
          wasStopping
            ? "runtime-stopped"
            : "runtime-crashed",
          {
            exitCode,
            signal,
          }
        );

        if (!wasStopping) {
          this.scheduleRestart(
            "process-exit"
          );
        }
      }
    );

    return this.getStatus();
  }

  async stopRuntime({
    reason = "manual",
  } = {}) {
    const policy =
      this.readPolicy();

    this.stopping = true;

    if (this.restartTimer) {
      clearTimeout(
        this.restartTimer
      );

      this.restartTimer = null;
    }

    this.updateState(
      (state) => {
        state.desiredState =
          "stopped";
        state.status =
          this.child
            ? "stopping"
            : "stopped";
        return state;
      }
    );

    this.addEvent(
      "runtime-stop-requested",
      {
        reason,
      }
    );

    if (
      !this.child ||
      this.child.exitCode !== null
    ) {
      this.child = null;

      this.updateState(
        (state) => {
          state.status =
            "stopped";
          state.pid = null;
          state.ownedProcess =
            false;
          state.lastStoppedAt =
            new Date().toISOString();
          return state;
        }
      );

      return this.getStatus();
    }

    const child =
      this.child;

    child.kill("SIGTERM");

    const timeoutMs =
      Number(
        policy.supervision
          ?.shutdownTimeoutMs
      ) || 8000;

    await Promise.race([
      new Promise(
        (resolve) => {
          child.once(
            "exit",
            resolve
          );
        }
      ),
      delay(timeoutMs),
    ]);

    if (
      child.exitCode === null
    ) {
      child.kill("SIGKILL");
    }

    return this.getStatus();
  }

  async restartRuntime({
    reason = "manual",
  } = {}) {
    await this.stopRuntime({
      reason:
        `${reason}-stop`,
    });

    this.stopping = false;

    return this.startRuntime({
      reason:
        `${reason}-start`,
    });
  }

  handleRuntimeFailure(error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    this.updateState(
      (state) => {
        state.status =
          "failed";
        state.lastError =
          message;
        state.consecutiveFailures =
          Number(
            state.consecutiveFailures
          ) + 1;
        return state;
      }
    );

    this.addEvent(
      "runtime-error",
      {
        error: message,
      }
    );

    this.scheduleRestart(
      "runtime-error"
    );
  }

  scheduleRestart(reason) {
    const policy =
      this.readPolicy();

    const state =
      this.readState();

    if (
      policy.supervision
        ?.autoRestart === false ||
      state.desiredState !==
        "running" ||
      this.stopping
    ) {
      return;
    }

    const maximumFailures =
      Number(
        policy.supervision
          ?.maximumConsecutiveFailures
      ) || 5;

    if (
      Number(
        state.consecutiveFailures
      ) >= maximumFailures
    ) {
      const suspendDuration =
        Number(
          policy.supervision
            ?.suspendDurationMs
        ) || 600000;

      this.updateState(
        (next) => {
          next.status =
            "suspended";
          next.suspendedUntil =
            new Date(
              Date.now() +
              suspendDuration
            ).toISOString();
          return next;
        }
      );

      this.addEvent(
        "restart-suspended",
        {
          reason,
          consecutiveFailures:
            state.consecutiveFailures,
        }
      );

      return;
    }

    const restartDelay =
      this.calculateRestartDelay();

    this.updateState(
      (next) => {
        next.status =
          "waiting-to-restart";
        next.restartDelayMs =
          restartDelay;
        return next;
      }
    );

    this.addEvent(
      "restart-scheduled",
      {
        reason,
        delayMs:
          restartDelay,
      }
    );

    if (this.restartTimer) {
      clearTimeout(
        this.restartTimer
      );
    }

    this.restartTimer =
      setTimeout(
        async () => {
          this.restartTimer =
            null;

          try {
            this.updateState(
              (next) => {
                next.restartCount =
                  Number(
                    next.restartCount
                  ) + 1;
                return next;
              }
            );

            await this.startRuntime({
              reason:
                "automatic-restart",
            });
          } catch (error) {
            this.handleRuntimeFailure(
              error
            );
          }
        },
        restartDelay
      );
  }

  async monitorOnce() {
    const policy =
      this.readPolicy();

    const state =
      this.readState();

    if (
      state.desiredState !==
        "running"
    ) {
      return {
        skipped: true,
        reason:
          "desired-state-stopped",
      };
    }

    if (
      state.status ===
        "suspended"
    ) {
      if (!this.isSuspended()) {
        this.updateState(
          (next) => {
            next.status =
              "stopped";
            next.suspendedUntil =
              null;
            next.consecutiveFailures =
              0;
            return next;
          }
        );

        await this.startRuntime({
          reason:
            "suspension-expired",
        });
      }

      return {
        skipped: true,
        reason: "suspended",
      };
    }

    const health =
      await this.healthCheck();

    const now =
      new Date().toISOString();

    if (health.healthy) {
      this.updateState(
        (next) => {
          next.status =
            "healthy";
          next.lastHealthCheckAt =
            now;
          next.lastHealthyAt =
            now;
          next.lastError =
            null;

          if (!next.healthySince) {
            next.healthySince =
              now;
          }

          const healthyDuration =
            Date.now() -
            new Date(
              next.healthySince
            ).getTime();

          const resetAfter =
            Number(
              policy.restart
                ?.resetBackoffAfterHealthyMs
            ) || 60000;

          if (
            healthyDuration >=
            resetAfter
          ) {
            next.consecutiveFailures =
              0;
            next.restartDelayMs =
              0;
          }

          return next;
        }
      );

      return health;
    }

    this.updateState(
      (next) => {
        next.status =
          "unhealthy";
        next.lastHealthCheckAt =
          now;
        next.lastError =
          health.error ||
          "Runtime health check failed.";
        next.healthySince =
          null;
        next.consecutiveFailures =
          Number(
            next.consecutiveFailures
          ) + 1;
        return next;
      }
    );

    this.addEvent(
      "health-check-failed",
      {
        error:
          health.error ||
          null,
        statusCode:
          health.statusCode ||
          null,
      }
    );

    if (
      this.child &&
      this.child.exitCode === null
    ) {
      await this.restartRuntime({
        reason:
          "health-check-failed",
      });
    } else {
      this.scheduleRestart(
        "health-check-failed"
      );
    }

    return health;
  }

  startMonitoring() {
    if (this.started) {
      return;
    }

    this.started = true;

    const policy =
      this.readPolicy();

    const interval =
      Number(
        policy.supervision
          ?.healthCheckIntervalMs
      ) || 5000;

    this.monitorTimer =
      setInterval(
        () => {
          this.monitorOnce()
            .catch(
              (error) => {
                this.addEvent(
                  "monitor-error",
                  {
                    error:
                      error instanceof Error
                        ? error.message
                        : String(error),
                  }
                );
              }
            );
        },
        interval
      );

    this.monitorTimer.unref?.();

    if (
      policy.supervision
        ?.autoStart === true
    ) {
      this.updateState(
        (state) => {
          state.desiredState =
            "running";
          return state;
        }
      );

      this.startRuntime({
        reason:
          "supervisor-auto-start",
      }).catch(
        (error) => {
          this.handleRuntimeFailure(
            error
          );
        }
      );
    }
  }

  async shutdown() {
    this.started = false;

    if (this.monitorTimer) {
      clearInterval(
        this.monitorTimer
      );

      this.monitorTimer = null;
    }

    if (this.restartTimer) {
      clearTimeout(
        this.restartTimer
      );

      this.restartTimer = null;
    }

    await this.stopRuntime({
      reason:
        "supervisor-shutdown",
    });
  }

  resetSupervisor() {
    if (this.restartTimer) {
      clearTimeout(
        this.restartTimer
      );

      this.restartTimer = null;
    }

    this.updateState(
      (state) => {
        state.status =
          "stopped";
        state.desiredState =
          "stopped";
        state.consecutiveFailures =
          0;
        state.restartDelayMs =
          0;
        state.suspendedUntil =
          null;
        state.lastError =
          null;
        return state;
      }
    );

    this.addEvent(
      "supervisor-reset"
    );

    return this.getStatus();
  }
}

module.exports = {
  TextRuntimeSupervisor,
};
