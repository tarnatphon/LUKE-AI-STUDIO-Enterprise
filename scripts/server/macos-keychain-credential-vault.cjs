"use strict";

const crypto = require("node:crypto");
const {
  execFile,
} = require("node:child_process");
const {
  promisify,
} = require("node:util");

const execFileAsync =
  promisify(execFile);

const SECURITY_BIN =
  "/usr/bin/security";

const SERVICE_PREFIX =
  "LUKE-AI-STUDIO-STORAGE";

function sanitizeReference(value) {
  const reference =
    String(value || "")
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

  if (!reference) {
    const error =
      new Error(
        "Credential reference is required."
      );

    error.statusCode = 400;
    throw error;
  }

  return reference;
}

function createReference(
  providerId
) {
  const provider =
    sanitizeReference(
      providerId
    );

  return (
    `${provider}-` +
    crypto
      .randomBytes(6)
      .toString("hex")
  );
}

function serviceName(
  reference
) {
  return (
    `${SERVICE_PREFIX}:` +
    sanitizeReference(
      reference
    )
  );
}

function redactCredential(
  credential
) {
  return {
    username:
      credential?.username
        ? String(
            credential.username
          )
        : "",
    hasPassword:
      Boolean(
        credential?.password
      ),
    hasToken:
      Boolean(
        credential?.token
      ),
    hasSecret:
      Boolean(
        credential?.secret
      ),
    hasAccessKeyId:
      Boolean(
        credential?.accessKeyId
      ),
    hasSecretAccessKey:
      Boolean(
        credential
          ?.secretAccessKey
      ),
    hasConnectionString:
      Boolean(
        credential
          ?.connectionString
      ),
    fields:
      Object.keys(
        credential || {}
      ).filter(
        (key) =>
          ![
            "password",
            "token",
            "secret",
            "secretAccessKey",
            "connectionString",
          ].includes(key)
      ),
  };
}

class MacOSKeychainCredentialVault {
  constructor({
    platform =
      process.platform,
    execFileImpl =
      execFileAsync,
  } = {}) {
    this.platform =
      platform;

    this.execFileImpl =
      execFileImpl;
  }

  assertSupported() {
    if (
      this.platform !==
      "darwin"
    ) {
      const error =
        new Error(
          "macOS Keychain is available only on macOS."
        );

      error.statusCode = 501;
      throw error;
    }
  }

  async runSecurity(
    args
  ) {
    this.assertSupported();

    return this.execFileImpl(
      SECURITY_BIN,
      args,
      {
        shell: false,
        timeout: 30000,
        maxBuffer:
          1024 * 1024,
      }
    );
  }

  async save({
    reference,
    providerId,
    credential,
  }) {
    const resolvedReference =
      reference
        ? sanitizeReference(
            reference
          )
        : createReference(
            providerId
          );

    if (
      !credential ||
      typeof credential !==
        "object"
    ) {
      const error =
        new Error(
          "Credential payload is required."
        );

      error.statusCode = 400;
      throw error;
    }

    const payload =
      JSON.stringify(
        credential
      );

    await this.runSecurity([
      "add-generic-password",
      "-U",
      "-a",
      resolvedReference,
      "-s",
      serviceName(
        resolvedReference
      ),
      "-w",
      payload,
    ]);

    return {
      reference:
        resolvedReference,
      summary:
        redactCredential(
          credential
        ),
    };
  }

  async get(reference) {
    const resolvedReference =
      sanitizeReference(
        reference
      );

    const result =
      await this.runSecurity([
        "find-generic-password",
        "-a",
        resolvedReference,
        "-s",
        serviceName(
          resolvedReference
        ),
        "-w",
      ]);

    const raw =
      String(
        result.stdout || ""
      ).trim();

    if (!raw) {
      const error =
        new Error(
          "Credential was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    return JSON.parse(raw);
  }

  async getSummary(
    reference
  ) {
    try {
      const credential =
        await this.get(
          reference
        );

      return {
        exists: true,
        reference:
          sanitizeReference(
            reference
          ),
        summary:
          redactCredential(
            credential
          ),
      };
    } catch (error) {
      if (
        error?.statusCode ===
          404 ||
        String(
          error?.stderr || ""
        ).includes(
          "could not be found"
        )
      ) {
        return {
          exists: false,
          reference:
            sanitizeReference(
              reference
            ),
          summary: null,
        };
      }

      throw error;
    }
  }

  async delete(reference) {
    const resolvedReference =
      sanitizeReference(
        reference
      );

    try {
      await this.runSecurity([
        "delete-generic-password",
        "-a",
        resolvedReference,
        "-s",
        serviceName(
          resolvedReference
        ),
      ]);
    } catch (error) {
      if (
        !String(
          error?.stderr || ""
        ).includes(
          "could not be found"
        )
      ) {
        throw error;
      }
    }

    return {
      deleted: true,
      reference:
        resolvedReference,
    };
  }
}

module.exports = {
  MacOSKeychainCredentialVault,
  createReference,
  redactCredential,
  sanitizeReference,
  serviceName,
};
