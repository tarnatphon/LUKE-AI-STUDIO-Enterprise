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

class StorageAvailabilityWatcher {
  constructor({
    statePath,
    providerCore,
    transferQueue,
  }) {
    this.statePath =
      statePath;

    this.providerCore =
      providerCore;

    this.transferQueue =
      transferQueue;

    this.timer =
      null;

    this.running =
      false;
  }

  readState() {
    if (
      !fs.existsSync(
        this.statePath
      )
    ) {
      return {
        schemaVersion: 1,
        enabled: true,
        intervalMs: 10000,
        updatedAt: null,
        lastScanAt: null,
        providers: {},
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

  getStatus() {
    return {
      running:
        this.running,
      ...this.readState(),
    };
  }

  setEnabled(enabled) {
    const state =
      this.readState();

    state.enabled =
      Boolean(enabled);

    this.writeState(state);

    if (state.enabled) {
      this.start();
    } else {
      this.stop();
    }

    return this.getStatus();
  }

  setIntervalMs(intervalMs) {
    const value =
      Math.max(
        3000,
        Number(
          intervalMs
        ) || 10000
      );

    const state =
      this.readState();

    state.intervalMs =
      value;

    this.writeState(state);

    if (this.running) {
      this.stop();
      this.start();
    }

    return this.getStatus();
  }

  async scan() {
    const state =
      this.readState();

    const checked =
      this.providerCore
        .checkAllProviders();

    const now =
      new Date().toISOString();

    for (const result of checked) {
      const providerId =
        result.provider.id;

      const previous =
        state.providers?.[
          providerId
        ] || null;

      const current = {
        status:
          result.health.status,
        reachable:
          Boolean(
            result.health
              .reachable
          ),
        writable:
          Boolean(
            result.health
              .writable
          ),
        checkedAt:
          result.health
            .checkedAt ||
          now,
      };

      state.providers = {
        ...(state.providers ||
          {}),
        [providerId]:
          current,
      };

      const becameOnline =
        previous &&
        previous.status !==
          "online" &&
        current.status ===
          "online";

      if (becameOnline) {
        const wake =
          this.transferQueue
            .wakeWaitingJobs({
              providerId,
            });

        state.events.push({
          type:
            "provider-online",
          providerId,
          changedJobs:
            wake.changed,
          createdAt:
            now,
        });
      }

      if (
        !previous ||
        previous.status !==
          current.status
      ) {
        state.events.push({
          type:
            "provider-status",
          providerId,
          from:
            previous
              ?.status ||
            null,
          to:
            current.status,
          createdAt:
            now,
        });
      }
    }

    state.lastScanAt =
      now;

    this.writeState(state);

    return {
      checked,
      state:
        this.getStatus(),
    };
  }

  start() {
    if (this.running) {
      return this.getStatus();
    }

    const state =
      this.readState();

    if (!state.enabled) {
      return this.getStatus();
    }

    this.running =
      true;

    const run =
      async () => {
        try {
          await this.scan();
        } catch (error) {
          const latest =
            this.readState();

          latest.events.push({
            type:
              "watcher-error",
            error:
              error instanceof Error
                ? error.message
                : String(error),
            createdAt:
              new Date().toISOString(),
          });

          this.writeState(
            latest
          );
        }
      };

    run();

    this.timer =
      setInterval(
        run,
        Math.max(
          3000,
          Number(
            state.intervalMs
          ) || 10000
        )
      );

    return this.getStatus();
  }

  stop() {
    if (this.timer) {
      clearInterval(
        this.timer
      );

      this.timer =
        null;
    }

    this.running =
      false;

    return this.getStatus();
  }
}

module.exports = {
  StorageAvailabilityWatcher,
};
