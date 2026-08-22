"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PROVIDER_CATEGORIES =
  new Set([
    "local",
    "external",
    "nas",
    "cloud",
  ]);

const ADAPTERS = {
  local: new Set([
    "local-folder",
  ]),
  external: new Set([
    "mounted-folder",
  ]),
  nas: new Set([
    "mounted-folder",
    "smb",
    "nfs",
    "webdav",
  ]),
  cloud: new Set([
    "s3-compatible",
    "google-cloud-storage",
    "azure-blob",
  ]),
};

const SECRET_FIELD_NAMES =
  new Set([
    "password",
    "secret",
    "secretKey",
    "accessKey",
    "accessKeyId",
    "token",
    "apiKey",
    "connectionString",
    "accountKey",
    "clientSecret",
    "privateKey",
  ]);

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

  return path.resolve(text);
}

function sanitizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9._-]+/g,
      "-"
    )
    .replace(
      /^-+|-+$/g,
      ""
    );
}

function containsSecretFields(
  value
) {
  if (
    !value ||
    typeof value !== "object"
  ) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(
      containsSecretFields
    );
  }

  return Object.entries(value)
    .some(
      ([key, nestedValue]) =>
        SECRET_FIELD_NAMES.has(
          key
        ) ||
        containsSecretFields(
          nestedValue
        )
    );
}

function statFilesystem(
  targetPath
) {
  if (
    typeof fs.statfsSync !==
    "function"
  ) {
    return {
      availableBytes: null,
      totalBytes: null,
    };
  }

  const statistics =
    fs.statfsSync(
      targetPath
    );

  const blockSize =
    Number(
      statistics.bsize ||
      statistics.frsize ||
      0
    );

  return {
    availableBytes:
      blockSize *
      Number(
        statistics.bavail ??
        statistics.bfree ??
        0
      ),
    totalBytes:
      blockSize *
      Number(
        statistics.blocks ||
        0
      ),
  };
}

class UnifiedStorageProviderCore {
  constructor({
    configPath,
    statePath,
  }) {
    this.configPath =
      configPath;

    this.statePath =
      statePath;
  }

  readConfig() {
    return readJson(
      this.configPath
    );
  }

  writeConfig(config) {
    writeJsonAtomic(
      this.configPath,
      config
    );

    return config;
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
        lastSelectedProviderId:
          null,
        routingHistory: [],
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

  validateProvider(provider) {
    if (
      !provider ||
      typeof provider !==
        "object"
    ) {
      const error =
        new Error(
          "Storage provider is required."
        );

      error.statusCode = 400;
      throw error;
    }

    const id =
      sanitizeId(
        provider.id
      );

    if (!id) {
      const error =
        new Error(
          "Provider ID is required."
        );

      error.statusCode = 400;
      throw error;
    }

    const category =
      String(
        provider.category || ""
      ).trim();

    if (
      !PROVIDER_CATEGORIES.has(
        category
      )
    ) {
      const error =
        new Error(
          "Unsupported provider category."
        );

      error.statusCode = 400;
      throw error;
    }

    const adapter =
      String(
        provider.adapter || ""
      ).trim();

    if (
      !ADAPTERS[category]
        ?.has(adapter)
    ) {
      const error =
        new Error(
          `Unsupported ${category} adapter.`
        );

      error.statusCode = 400;
      throw error;
    }

    if (
      containsSecretFields(
        provider.settings
      )
    ) {
      const error =
        new Error(
          "Credentials must not be stored in provider settings."
        );

      error.statusCode = 400;
      throw error;
    }

    if (
      provider.credentials ||
      provider.password ||
      provider.token ||
      provider.secret
    ) {
      const error =
        new Error(
          "Plaintext credentials are not allowed."
        );

      error.statusCode = 400;
      throw error;
    }

    const credentialReference =
      provider.credentialReference
        ? String(
            provider
              .credentialReference
          ).trim()
        : null;

    if (
      [
        "smb",
        "webdav",
        "s3-compatible",
        "google-cloud-storage",
        "azure-blob",
      ].includes(adapter) &&
      !credentialReference
    ) {
      return {
        ...provider,
        id,
        category,
        adapter,
        credentialReference:
          null,
        configurationStatus:
          "authentication-required",
      };
    }

    return {
      ...provider,
      id,
      name:
        String(
          provider.name ||
          id
        ).trim(),
      category,
      adapter,
      enabled:
        provider.enabled !==
        false,
      priority:
        Number.isFinite(
          Number(
            provider.priority
          )
        )
          ? Number(
              provider.priority
            )
          : 100,
      credentialReference,
      settings: {
        ...(provider.settings ||
          {}),
      },
      capabilities: {
        read:
          provider.capabilities
            ?.read !== false,
        write:
          provider.capabilities
            ?.write !== false,
        delete:
          provider.capabilities
            ?.delete === true,
        resume:
          provider.capabilities
            ?.resume === true,
      },
      configurationStatus:
        "configured",
    };
  }

  listProviders() {
    const config =
      this.readConfig();

    return (
      config.providers || []
    )
      .map(
        (provider) =>
          this.validateProvider(
            provider
          )
      )
      .sort(
        (left, right) =>
          left.priority -
          right.priority
      );
  }

  getProvider(providerId) {
    const id =
      sanitizeId(
        providerId
      );

    const provider =
      this.listProviders()
        .find(
          (item) =>
            item.id === id
        );

    if (!provider) {
      const error =
        new Error(
          "Storage provider was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    return provider;
  }

  upsertProvider(input) {
    const provider =
      this.validateProvider(
        input
      );

    const config =
      this.readConfig();

    const providers =
      Array.isArray(
        config.providers
      )
        ? config.providers
        : [];

    const index =
      providers.findIndex(
        (item) =>
          sanitizeId(
            item.id
          ) === provider.id
      );

    if (index >= 0) {
      providers[index] =
        provider;
    } else {
      providers.push(
        provider
      );
    }

    config.providers =
      providers;

    this.writeConfig(
      config
    );

    return provider;
  }

  // LUKE_AI_PROVIDER_CREDENTIAL_REFERENCE_V1
  setCredentialReference({
    providerId,
    credentialReference,
  }) {
    const provider =
      this.getProvider(
        providerId
      );

    const reference =
      String(
        credentialReference || ""
      ).trim();

    if (!reference) {
      const error =
        new Error(
          "Credential reference is required."
        );

      error.statusCode = 400;
      throw error;
    }

    return this.upsertProvider({
      ...provider,
      credentialReference:
        reference,
      configurationStatus:
        "configured",
    });
  }

  clearCredentialReference(
    providerId
  ) {
    const provider =
      this.getProvider(
        providerId
      );

    return this.upsertProvider({
      ...provider,
      credentialReference:
        null,
    });
  }

  removeProvider(providerId) {
    const id =
      sanitizeId(
        providerId
      );

    if (
      [
        "local-fallback",
        "external-default",
      ].includes(id)
    ) {
      const error =
        new Error(
          "Default storage providers cannot be removed."
        );

      error.statusCode = 409;
      throw error;
    }

    const config =
      this.readConfig();

    const before =
      (
        config.providers || []
      ).length;

    config.providers =
      (
        config.providers || []
      ).filter(
        (provider) =>
          sanitizeId(
            provider.id
          ) !== id
      );

    if (
      config.providers.length ===
      before
    ) {
      const error =
        new Error(
          "Storage provider was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    this.writeConfig(
      config
    );

    return {
      removed: true,
      providerId: id,
    };
  }

  checkMountedFolder(
    provider
  ) {
    const rootPath =
      expandHome(
        provider.settings
          ?.rootPath
      );

    if (
      !rootPath ||
      !fs.existsSync(rootPath)
    ) {
      return {
        providerId:
          provider.id,
        status:
          "offline",
        reachable: false,
        writable: false,
        rootPath,
        availableBytes: null,
        totalBytes: null,
        checkedAt:
          new Date().toISOString(),
        reason:
          "path-not-found",
      };
    }

    try {
      const stats =
        fs.statSync(
          rootPath
        );

      if (
        !stats.isDirectory()
      ) {
        return {
          providerId:
            provider.id,
          status:
            "degraded",
          reachable: true,
          writable: false,
          rootPath,
          availableBytes:
            null,
          totalBytes:
            null,
          checkedAt:
            new Date().toISOString(),
          reason:
            "not-a-directory",
        };
      }

      fs.accessSync(
        rootPath,
        fs.constants.R_OK
      );

      let writable = true;

      try {
        fs.accessSync(
          rootPath,
          fs.constants.W_OK
        );
      } catch {
        writable = false;
      }

      const filesystem =
        statFilesystem(
          rootPath
        );

      return {
        providerId:
          provider.id,
        status:
          writable
            ? "online"
            : "degraded",
        reachable: true,
        writable,
        rootPath,
        ...filesystem,
        checkedAt:
          new Date().toISOString(),
        reason:
          writable
            ? null
            : "read-only",
      };
    } catch (error) {
      return {
        providerId:
          provider.id,
        status:
          "offline",
        reachable: false,
        writable: false,
        rootPath,
        availableBytes: null,
        totalBytes: null,
        checkedAt:
          new Date().toISOString(),
        reason:
          error instanceof Error
            ? error.message
            : String(error),
      };
    }
  }

  checkProvider(providerId) {
    const provider =
      this.getProvider(
        providerId
      );

    let health;

    if (
      provider.configurationStatus ===
      "authentication-required"
    ) {
      health = {
        providerId:
          provider.id,
        status:
          "authentication-required",
        reachable: false,
        writable: false,
        checkedAt:
          new Date().toISOString(),
        reason:
          "credential-reference-required",
      };
    } else if (
      [
        "local-folder",
        "mounted-folder",
      ].includes(
        provider.adapter
      )
    ) {
      health =
        this.checkMountedFolder(
          provider
        );
    } else {
      health = {
        providerId:
          provider.id,
        status:
          "adapter-not-connected",
        reachable: false,
        writable: false,
        checkedAt:
          new Date().toISOString(),
        reason:
          `${provider.adapter}-adapter-pending`,
      };
    }

    const state =
      this.readState();

    state.providers = {
      ...(state.providers ||
        {}),
      [provider.id]:
        health,
    };

    this.writeState(
      state
    );

    return {
      provider,
      health,
    };
  }

  checkAllProviders() {
    return this.listProviders()
      .map(
        (provider) =>
          this.checkProvider(
            provider.id
          )
      );
  }

  selectProvider({
    capability = "write",
  } = {}) {
    const providers =
      this.listProviders()
        .filter(
          (provider) =>
            provider.enabled &&
            provider.capabilities
              ?.[capability] ===
              true
        );

    const checked =
      providers.map(
        (provider) =>
          this.checkProvider(
            provider.id
          )
      );

    const selected =
      checked.find(
        (result) =>
          result.health.status ===
            "online" &&
          (
            capability !==
              "write" ||
            result.health
              .writable === true
          )
      );

    if (!selected) {
      const error =
        new Error(
          "No healthy storage provider is available."
        );

      error.statusCode = 409;
      error.providers =
        checked;

      throw error;
    }

    const state =
      this.readState();

    state.lastSelectedProviderId =
      selected.provider.id;

    state.routingHistory =
      [
        ...(state.routingHistory ||
          []),
        {
          selectedProviderId:
            selected.provider.id,
          capability,
          selectedAt:
            new Date().toISOString(),
        },
      ].slice(-200);

    this.writeState(
      state
    );

    return selected;
  }

  getStatus() {
    return {
      providers:
        this.listProviders(),
      state:
        this.readState(),
      supportedAdapters:
        Object.fromEntries(
          Object.entries(
            ADAPTERS
          ).map(
            ([category, adapters]) => [
              category,
              [...adapters],
            ]
          )
        ),
    };
  }
}

module.exports = {
  UnifiedStorageProviderCore,
  ADAPTERS,
  containsSecretFields,
  expandHome,
  sanitizeId,
};
