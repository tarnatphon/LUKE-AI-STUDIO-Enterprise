"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} = require("@aws-sdk/client-s3");

const {
  Upload,
} = require("@aws-sdk/lib-storage");

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

function createId(prefix) {
  return (
    `${prefix}-${Date.now()}-` +
    crypto
      .randomBytes(6)
      .toString("hex")
  );
}

function sanitizeObjectKey(value) {
  const key =
    String(value || "")
      .replaceAll("\\", "/")
      .replace(/^\/+/, "")
      .trim();

  if (
    !key ||
    key.includes("\0") ||
    key.split("/").includes("..")
  ) {
    const error =
      new Error(
        "Invalid S3 object key."
      );

    error.statusCode = 400;
    throw error;
  }

  return key;
}

function normalizeEndpoint(value) {
  const endpoint =
    String(value || "")
      .trim()
      .replace(/\/+$/, "");

  if (!endpoint) {
    return null;
  }

  let parsed;

  try {
    parsed = new URL(endpoint);
  } catch {
    const error =
      new Error(
        "Invalid S3 endpoint."
      );

    error.statusCode = 400;
    throw error;
  }

  if (
    parsed.protocol !== "https:" &&
    parsed.protocol !== "http:"
  ) {
    const error =
      new Error(
        "S3 endpoint must use HTTP or HTTPS."
      );

    error.statusCode = 400;
    throw error;
  }

  return endpoint;
}

function isPathInside(
  candidate,
  root
) {
  const resolvedCandidate =
    path.resolve(candidate);

  const resolvedRoot =
    path.resolve(root);

  return (
    resolvedCandidate === resolvedRoot ||
    resolvedCandidate.startsWith(
      resolvedRoot + path.sep
    )
  );
}

async function hashFile(filePath) {
  return new Promise(
    (resolve, reject) => {
      const hash =
        crypto.createHash(
          "sha256"
        );

      const stream =
        fs.createReadStream(
          filePath
        );

      stream.on(
        "error",
        reject
      );

      stream.on(
        "data",
        (chunk) => {
          hash.update(chunk);
        }
      );

      stream.on(
        "end",
        () => {
          resolve(
            hash.digest("hex")
          );
        }
      );
    }
  );
}

async function writeBodyToFile(
  body,
  destinationPath
) {
  fs.mkdirSync(
    path.dirname(
      destinationPath
    ),
    {
      recursive: true,
    }
  );

  const temporaryPath =
    `${destinationPath}.partial-${process.pid}-${Date.now()}`;

  try {
    if (
      typeof body?.transformToByteArray ===
      "function"
    ) {
      const bytes =
        await body
          .transformToByteArray();

      await fs.promises.writeFile(
        temporaryPath,
        Buffer.from(bytes)
      );
    } else if (
      body &&
      typeof body.pipe ===
        "function"
    ) {
      await new Promise(
        (resolve, reject) => {
          const output =
            fs.createWriteStream(
              temporaryPath
            );

          body.pipe(output);

          body.on(
            "error",
            reject
          );

          output.on(
            "error",
            reject
          );

          output.on(
            "finish",
            resolve
          );
        }
      );
    } else {
      throw new Error(
        "Unsupported S3 response body."
      );
    }

    await fs.promises.rename(
      temporaryPath,
      destinationPath
    );
  } catch (error) {
    await fs.promises.rm(
      temporaryPath,
      {
        force: true,
      }
    );

    throw error;
  }
}

class S3CompatibleStorageAdapter {
  constructor({
    providerCore,
    credentialVault,
    statePath,
    clientFactory = null,
    uploadFactory = null,
  }) {
    this.providerCore =
      providerCore;

    this.credentialVault =
      credentialVault;

    this.statePath =
      statePath;

    this.clientFactory =
      clientFactory ||
      ((configuration) =>
        new S3Client(
          configuration
        ));

    this.uploadFactory =
      uploadFactory ||
      ((configuration) =>
        new Upload(
          configuration
        ));
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
        transfers: [],
        pendingDeleteConfirmations:
          [],
      };
    }

    return readJson(
      this.statePath
    );
  }

  writeState(state) {
    state.updatedAt =
      new Date().toISOString();

    state.transfers =
      (
        state.transfers || []
      ).slice(-500);

    state.pendingDeleteConfirmations =
      (
        state
          .pendingDeleteConfirmations ||
        []
      ).slice(-200);

    writeJsonAtomic(
      this.statePath,
      state
    );

    return state;
  }

  getProvider(providerId) {
    const provider =
      this.providerCore
        .getProvider(
          providerId
        );

    if (
      provider.category !== "cloud" ||
      provider.adapter !==
        "s3-compatible"
    ) {
      const error =
        new Error(
          "Provider is not S3-compatible."
        );

      error.statusCode = 400;
      throw error;
    }

    if (
      !provider
        .credentialReference
    ) {
      const error =
        new Error(
          "Credential reference is required."
        );

      error.statusCode = 409;
      throw error;
    }

    if (
      !String(
        provider.settings
          ?.bucket || ""
      ).trim()
    ) {
      const error =
        new Error(
          "S3 bucket is required."
        );

      error.statusCode = 400;
      throw error;
    }

    return provider;
  }

  async createClient(
    providerId
  ) {
    const provider =
      this.getProvider(
        providerId
      );

    const credential =
      await this
        .credentialVault
        .get(
          provider
            .credentialReference
        );

    const accessKeyId =
      String(
        credential.accessKeyId ||
        credential.username ||
        ""
      ).trim();

    const secretAccessKey =
      String(
        credential
          .secretAccessKey ||
        credential.password ||
        credential.secret ||
        ""
      );

    if (
      !accessKeyId ||
      !secretAccessKey
    ) {
      const error =
        new Error(
          "Access Key ID and Secret Access Key are required."
        );

      error.statusCode = 409;
      throw error;
    }

    const endpoint =
      normalizeEndpoint(
        provider.settings
          ?.endpoint
      );

    const configuration = {
      region:
        String(
          provider.settings
            ?.region ||
          "auto"
        ).trim(),
      credentials: {
        accessKeyId,
        secretAccessKey,
        ...(credential.sessionToken
          ? {
              sessionToken:
                credential
                  .sessionToken,
            }
          : {}),
      },
      forcePathStyle:
        provider.settings
          ?.forcePathStyle ===
        true,
      maxAttempts:
        Math.max(
          1,
          Number(
            provider.settings
              ?.maxAttempts
          ) || 3
        ),
    };

    if (endpoint) {
      configuration.endpoint =
        endpoint;
    }

    return {
      provider,
      client:
        this.clientFactory(
          configuration
        ),
    };
  }

  async testConnection(
    providerId
  ) {
    const {
      provider,
      client,
    } = await this.createClient(
      providerId
    );

    const bucket =
      provider.settings.bucket;

    await client.send(
      new HeadBucketCommand({
        Bucket: bucket,
      })
    );

    const listing =
      await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          MaxKeys: 1,
        })
      );

    return {
      providerId:
        provider.id,
      connected: true,
      bucket,
      endpoint:
        provider.settings
          ?.endpoint ||
        null,
      region:
        provider.settings
          ?.region ||
        "auto",
      canList: true,
      objectCount:
        Number(
          listing.KeyCount
        ) || 0,
      checkedAt:
        new Date().toISOString(),
    };
  }

  async uploadFile({
    providerId,
    sourcePath,
    objectKey = null,
    contentType = null,
  }) {
    const source =
      path.resolve(
        String(
          sourcePath || ""
        )
      );

    if (
      !fs.existsSync(source) ||
      !fs.statSync(
        source
      ).isFile()
    ) {
      const error =
        new Error(
          "Upload source file was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    const key =
      sanitizeObjectKey(
        objectKey ||
        path.basename(source)
      );

    const {
      provider,
      client,
    } = await this.createClient(
      providerId
    );

    const bucket =
      provider.settings.bucket;

    const sourceStat =
      fs.statSync(source);

    const sourceSha256 =
      await hashFile(source);

    const state =
      this.readState();

    const transfer = {
      id:
        createId(
          "s3-upload"
        ),
      providerId:
        provider.id,
      direction:
        "upload",
      bucket,
      objectKey:
        key,
      sourcePath:
        source,
      sourceBytes:
        sourceStat.size,
      sourceSha256,
      progress: 0,
      status:
        "uploading",
      verified:
        false,
      startedAt:
        new Date().toISOString(),
      completedAt:
        null,
      error:
        null,
    };

    state.transfers.push(
      transfer
    );

    this.writeState(
      state
    );

    try {
      const upload =
        this.uploadFactory({
          client,
          params: {
            Bucket:
              bucket,
            Key:
              key,
            Body:
              fs.createReadStream(
                source
              ),
            Metadata: {
              "luke-sha256":
                sourceSha256,
            },
            ...(contentType
              ? {
                  ContentType:
                    contentType,
                }
              : {}),
          },
          queueSize: 1,
          partSize:
            8 * 1024 * 1024,
          leavePartsOnError:
            false,
        });

      if (
        typeof upload.on ===
        "function"
      ) {
        upload.on(
          "httpUploadProgress",
          (progress) => {
            const loaded =
              Number(
                progress.loaded
              ) || 0;

            const total =
              Number(
                progress.total
              ) ||
              sourceStat.size;

            transfer.progress =
              total > 0
                ? Math.min(
                    99,
                    Math.round(
                      loaded /
                      total *
                      100
                    )
                  )
                : transfer.progress;

            this.writeState(
              state
            );
          }
        );
      }

      await upload.done();

      const remote =
        await client.send(
          new HeadObjectCommand({
            Bucket:
              bucket,
            Key:
              key,
          })
        );

      const remoteBytes =
        Number(
          remote.ContentLength
        );

      const remoteSha256 =
        remote.Metadata
          ?.[
            "luke-sha256"
          ] || null;

      transfer.remoteBytes =
        remoteBytes;

      transfer.remoteSha256 =
        remoteSha256;

      transfer.sizeVerified =
        remoteBytes ===
        sourceStat.size;

      transfer.sha256Verified =
        remoteSha256 ===
        sourceSha256;

      transfer.verified =
        transfer.sizeVerified &&
        transfer.sha256Verified;

      transfer.progress =
        transfer.verified
          ? 100
          : 99;

      transfer.status =
        transfer.verified
          ? "completed"
          : "verification-failed";

      transfer.completedAt =
        new Date().toISOString();

      this.writeState(
        state
      );

      if (
        !transfer.verified
      ) {
        const error =
          new Error(
            "S3 upload verification failed."
          );

        error.statusCode = 500;
        throw error;
      }

      return {
        transfer,
        sourcePreserved:
          true,
      };
    } catch (error) {
      transfer.status =
        transfer.status ===
          "verification-failed"
          ? transfer.status
          : "failed";

      transfer.error =
        error instanceof Error
          ? error.message
          : String(error);

      transfer.completedAt =
        new Date().toISOString();

      this.writeState(
        state
      );

      throw error;
    }
  }

  async downloadFile({
    providerId,
    objectKey,
    destinationPath,
    approvedRoot = null,
  }) {
    const key =
      sanitizeObjectKey(
        objectKey
      );

    const destination =
      path.resolve(
        String(
          destinationPath || ""
        )
      );

    if (
      approvedRoot &&
      !isPathInside(
        destination,
        approvedRoot
      )
    ) {
      const error =
        new Error(
          "Download destination is outside approved storage."
        );

      error.statusCode = 403;
      throw error;
    }

    const {
      provider,
      client,
    } = await this.createClient(
      providerId
    );

    const bucket =
      provider.settings.bucket;

    const result =
      await client.send(
        new GetObjectCommand({
          Bucket:
            bucket,
          Key:
            key,
        })
      );

    await writeBodyToFile(
      result.Body,
      destination
    );

    const destinationSha256 =
      await hashFile(
        destination
      );

    const expectedSha256 =
      result.Metadata
        ?.[
          "luke-sha256"
        ] || null;

    const sha256Verified =
      expectedSha256
        ? destinationSha256 ===
          expectedSha256
        : null;

    const state =
      this.readState();

    const transfer = {
      id:
        createId(
          "s3-download"
        ),
      providerId:
        provider.id,
      direction:
        "download",
      bucket,
      objectKey:
        key,
      destinationPath:
        destination,
      destinationBytes:
        fs.statSync(
          destination
        ).size,
      destinationSha256,
      expectedSha256,
      sha256Verified,
      status:
        sha256Verified ===
          false
          ? "verification-failed"
          : "completed",
      completedAt:
        new Date().toISOString(),
    };

    state.transfers.push(
      transfer
    );

    this.writeState(
      state
    );

    if (
      sha256Verified ===
      false
    ) {
      const error =
        new Error(
          "S3 download SHA-256 verification failed."
        );

      error.statusCode = 500;
      throw error;
    }

    return {
      transfer,
    };
  }

  requestDelete({
    providerId,
    objectKey,
  }) {
    const provider =
      this.getProvider(
        providerId
      );

    const key =
      sanitizeObjectKey(
        objectKey
      );

    const state =
      this.readState();

    const confirmation = {
      confirmationId:
        createId(
          "s3-delete"
        ),
      providerId:
        provider.id,
      bucket:
        provider
          .settings
          .bucket,
      objectKey:
        key,
      createdAt:
        new Date().toISOString(),
      expiresAt:
        new Date(
          Date.now() +
          10 * 60 * 1000
        ).toISOString(),
    };

    state
      .pendingDeleteConfirmations
      .push(
        confirmation
      );

    this.writeState(
      state
    );

    return confirmation;
  }

  async confirmDelete({
    confirmationId,
  }) {
    const state =
      this.readState();

    const confirmation =
      state
        .pendingDeleteConfirmations
        .find(
          (item) =>
            item.confirmationId ===
            confirmationId
        );

    if (!confirmation) {
      const error =
        new Error(
          "Delete confirmation was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    if (
      Date.parse(
        confirmation.expiresAt
      ) < Date.now()
    ) {
      state.pendingDeleteConfirmations =
        state
          .pendingDeleteConfirmations
          .filter(
            (item) =>
              item.confirmationId !==
              confirmationId
          );

      this.writeState(
        state
      );

      const error =
        new Error(
          "Delete confirmation expired."
        );

      error.statusCode = 409;
      throw error;
    }

    const {
      client,
    } = await this.createClient(
      confirmation
        .providerId
    );

    await client.send(
      new DeleteObjectCommand({
        Bucket:
          confirmation.bucket,
        Key:
          confirmation.objectKey,
      })
    );

    state.pendingDeleteConfirmations =
      state
        .pendingDeleteConfirmations
        .filter(
          (item) =>
            item.confirmationId !==
            confirmationId
        );

    state.transfers.push({
      id:
        createId(
          "s3-delete-record"
        ),
      providerId:
        confirmation.providerId,
      direction:
        "delete",
      bucket:
        confirmation.bucket,
      objectKey:
        confirmation.objectKey,
      status:
        "completed",
      confirmed:
        true,
      completedAt:
        new Date().toISOString(),
    });

    this.writeState(
      state
    );

    return {
      deleted: true,
      providerId:
        confirmation.providerId,
      bucket:
        confirmation.bucket,
      objectKey:
        confirmation.objectKey,
    };
  }

  cancelDelete({
    confirmationId,
  }) {
    const state =
      this.readState();

    const exists =
      state
        .pendingDeleteConfirmations
        .some(
          (item) =>
            item.confirmationId ===
            confirmationId
        );

    if (!exists) {
      const error =
        new Error(
          "Delete confirmation was not found."
        );

      error.statusCode = 404;
      throw error;
    }

    state.pendingDeleteConfirmations =
      state
        .pendingDeleteConfirmations
        .filter(
          (item) =>
            item.confirmationId !==
            confirmationId
        );

    this.writeState(
      state
    );

    return {
      cancelled: true,
      confirmationId,
    };
  }

  getStatus() {
    return this.readState();
  }
}

module.exports = {
  S3CompatibleStorageAdapter,
  hashFile,
  isPathInside,
  normalizeEndpoint,
  sanitizeObjectKey,
};
