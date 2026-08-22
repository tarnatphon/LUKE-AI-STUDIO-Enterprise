"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ASSET_TYPES =
  new Set([
    "image",
    "video",
    "reference",
    "prompt",
    "brand",
    "logo",
    "voice",
    "music",
  ]);

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

function normalizeString(
  value
) {
  return String(
    value ?? ""
  ).trim();
}

// LUKE_AI_ASSET_PATH_NORMALIZATION_V1
function normalizeExistingPath(
  value
) {
  const raw =
    normalizeString(
      value
    );

  if (!raw) {
    return "";
  }

  let normalized =
    path.normalize(
      raw
    );

  try {
    if (
      fs.existsSync(
        normalized
      )
    ) {
      normalized =
        fs.realpathSync(
          normalized
        );
    }
  } catch {
    // Keep normalized path when realpath is unavailable.
  }

  return normalized;
}

function normalizeArray(
  value
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(
          normalizeString
        )
        .filter(Boolean)
    ),
  ];
}

function normalizeRelations(
  value
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(
      (item) => ({
        assetId:
          normalizeString(
            item?.assetId
          ),

        relation:
          normalizeString(
            item?.relation
          ),
      })
    )
    .filter(
      (item) =>
        item.assetId &&
        item.relation
    );
}

function createAssetId() {
  if (
    typeof crypto.randomUUID ===
    "function"
  ) {
    return (
      "ast_" +
      crypto
        .randomUUID()
        .replace(
          /-/g,
          ""
        )
    );
  }

  return (
    "ast_" +
    Date.now()
      .toString(36) +
    "_" +
    crypto
      .randomBytes(8)
      .toString("hex")
  );
}

class AssetRegistry {
  constructor({
    statePath,
  } = {}) {
    if (!statePath) {
      throw new Error(
        "AssetRegistry statePath is required."
      );
    }

    this.statePath =
      statePath;

    this.state = {
      version: 1,
      assets: [],
    };

    this.load();
  }

  load() {
    if (
      !fs.existsSync(
        this.statePath
      )
    ) {
      return;
    }

    const parsed =
      JSON.parse(
        fs.readFileSync(
          this.statePath,
          "utf8"
        )
      );

    this.state = {
      version:
        Number(
          parsed?.version
        ) || 1,

      assets:
        Array.isArray(
          parsed?.assets
        )
          ? parsed.assets
          : [],
    };
  }

  save() {
    fs.mkdirSync(
      path.dirname(
        this.statePath
      ),
      {
        recursive: true,
      }
    );

    const temporary =
      this.statePath +
      ".tmp";

    fs.writeFileSync(
      temporary,
      JSON.stringify(
        this.state,
        null,
        2
      ),
      "utf8"
    );

    fs.renameSync(
      temporary,
      this.statePath
    );
  }

  list({
    type,
    project,
    campaign,
    tag,
    favorite,
  } = {}) {
    let assets =
      this.state.assets;

    if (type) {
      assets =
        assets.filter(
          (asset) =>
            asset.type ===
            type
        );
    }

    if (project) {
      assets =
        assets.filter(
          (asset) =>
            asset.project ===
            project
        );
    }

    if (campaign) {
      assets =
        assets.filter(
          (asset) =>
            asset.campaign ===
            campaign
        );
    }

    if (tag) {
      assets =
        assets.filter(
          (asset) =>
            asset.tags
              .includes(tag)
        );
    }

    if (
      favorite === true
    ) {
      assets =
        assets.filter(
          (asset) =>
            asset.favorite ===
            true
        );
    }

    return assets.map(
      clone
    );
  }

  // LUKE_AI_ASSET_PATH_UPSERT_V1
  findByPath(
    existingPath
  ) {
    const normalized =
      normalizeExistingPath(
        existingPath
      );

    if (!normalized) {
      return null;
    }

    const asset =
      this.state.assets
        .find(
          (item) =>
            normalizeExistingPath(
              item.existingPath
            ) ===
            normalized
        );

    return asset
      ? clone(asset)
      : null;
  }

  upsertByPath(
    input = {}
  ) {
    const normalizedPath =
      normalizeExistingPath(
        input.existingPath
      );

    if (!normalizedPath) {
      throw new Error(
        "existingPath is required for path upsert."
      );
    }

    const existing =
      this.findByPath(
        normalizedPath
      );

    if (existing) {
      return this.update(
        existing.assetId,
        {
          ...input,
          existingPath:
            normalizedPath,
        }
      );
    }

    return this.create({
      ...input,
      existingPath:
        normalizedPath,
    });
  }

  get(assetId) {
    const asset =
      this.state.assets
        .find(
          (item) =>
            item.assetId ===
            assetId
        );

    return asset
      ? clone(asset)
      : null;
  }

  require(assetId) {
    const asset =
      this.state.assets
        .find(
          (item) =>
            item.assetId ===
            assetId
        );

    if (!asset) {
      throw new Error(
        "Asset not found."
      );
    }

    return asset;
  }

  create(input = {}) {
    const type =
      normalizeString(
        input.type
      );

    if (
      !ASSET_TYPES.has(type)
    ) {
      throw new Error(
        "Unsupported asset type."
      );
    }

    const timestamp =
      nowIso();

    const asset = {
      assetId:
        createAssetId(),

      type,

      existingPath:
        normalizeExistingPath(
          input.existingPath
        ) || null,

      storageProviderId:
        normalizeString(
          input.storageProviderId
        ) || "local",

      createdAt:
        timestamp,

      updatedAt:
        timestamp,

      tags:
        normalizeArray(
          input.tags
        ),

      favorite:
        Boolean(
          input.favorite
        ),

      pinned:
        Boolean(
          input.pinned
        ),

      project:
        normalizeString(
          input.project
        ) || null,

      campaign:
        normalizeString(
          input.campaign
        ) || null,

      sourceModel:
        normalizeString(
          input.sourceModel
        ) || null,

      sourcePrompt:
        normalizeString(
          input.sourcePrompt
        ) || null,

      derivedFrom:
        normalizeArray(
          input.derivedFrom
        ),

      references:
        normalizeArray(
          input.references
        ),

      relations:
        normalizeRelations(
          input.relations
        ),

      metadata:
        input.metadata &&
        typeof input.metadata ===
          "object"
          ? clone(
              input.metadata
            )
          : {},
    };

    this.state.assets.push(
      asset
    );

    this.save();

    return clone(asset);
  }

  update(
    assetId,
    patch = {}
  ) {
    const asset =
      this.require(
        assetId
      );

    if (
      patch.type !==
      undefined
    ) {
      const type =
        normalizeString(
          patch.type
        );

      if (
        !ASSET_TYPES.has(type)
      ) {
        throw new Error(
          "Unsupported asset type."
        );
      }

      asset.type =
        type;
    }

    for (
      const key of [
        "existingPath",
        "storageProviderId",
        "project",
        "campaign",
        "sourceModel",
        "sourcePrompt",
      ]
    ) {
      if (
        patch[key] !==
        undefined
      ) {
        asset[key] =
          key === "existingPath"
            ? (
                normalizeExistingPath(
                  patch[key]
                ) || null
              )
            : (
                normalizeString(
                  patch[key]
                ) || null
              );
      }
    }

    if (
      patch.tags !==
      undefined
    ) {
      asset.tags =
        normalizeArray(
          patch.tags
        );
    }

    if (
      patch.favorite !==
      undefined
    ) {
      asset.favorite =
        Boolean(
          patch.favorite
        );
    }

    if (
      patch.pinned !==
      undefined
    ) {
      asset.pinned =
        Boolean(
          patch.pinned
        );
    }

    if (
      patch.derivedFrom !==
      undefined
    ) {
      asset.derivedFrom =
        normalizeArray(
          patch.derivedFrom
        );
    }

    if (
      patch.references !==
      undefined
    ) {
      asset.references =
        normalizeArray(
          patch.references
        );
    }

    if (
      patch.relations !==
      undefined
    ) {
      asset.relations =
        normalizeRelations(
          patch.relations
        );
    }

    if (
      patch.metadata !==
      undefined
    ) {
      asset.metadata =
        patch.metadata &&
        typeof patch.metadata ===
          "object"
          ? clone(
              patch.metadata
            )
          : {};
    }

    asset.updatedAt =
      nowIso();

    this.save();

    return clone(asset);
  }

  remove(assetId) {
    const index =
      this.state.assets
        .findIndex(
          (asset) =>
            asset.assetId ===
            assetId
        );

    if (index < 0) {
      return false;
    }

    this.state.assets.splice(
      index,
      1
    );

    this.save();

    return true;
  }
}

module.exports = {
  ASSET_TYPES,
  AssetRegistry,
};
