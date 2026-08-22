#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");

const catalog = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "app/config/text-models/signed-catalog.json",
    ),
    "utf8",
  ),
);

const policy = JSON.parse(
  fs.readFileSync(
    path.join(
      root,
      "app/config/text-models/catalog-policy.json",
    ),
    "utf8",
  ),
);

const communityModel = catalog.models.find(
  (model) =>
    model.id === "dolphin3-llama3.2-3b",
);

if (!communityModel) {
  throw new Error(
    "Community Dolphin model is missing.",
  );
}

if (
  communityModel.category !== "community" ||
  communityModel.safetyProfile !== "community"
) {
  throw new Error(
    "Community model classification is invalid.",
  );
}

if (
  communityModel.installation?.oneClickDownload !== true ||
  communityModel.installation?.openExternalWebsite !== false
) {
  throw new Error(
    "Community model must support one-click in-app download.",
  );
}

const variant = communityModel.variants?.find(
  (item) => item.id === "q4-k-m",
);

if (
  !variant ||
  variant.quantization !== "Q4_K_M" ||
  !variant.download?.url?.startsWith(
    "https://huggingface.co/",
  ) ||
  variant.download
    ?.resolveSha256FromMetadata !== true
) {
  throw new Error(
    "Community model download variant is invalid.",
  );
}

if (
  communityModel.updateChannel?.automaticCheck !== true ||
  communityModel.updateChannel
    ?.showUpdateInsideModelCard !== true
) {
  throw new Error(
    "Community model automatic update policy is incomplete.",
  );
}

if (
  policy.communityModelPolicy?.enabled !== true ||
  policy.communityModelPolicy
    ?.sameDownloadQueueAsOfficialModels !== true ||
  policy.communityModelPolicy
    ?.oneClickDownloadRequired !== true ||
  policy.communityModelPolicy
    ?.openExternalWebsiteForDownload !== false
) {
  throw new Error(
    "Community Model Manager policy is invalid.",
  );
}

if (
  !catalog.trust?.allowedPublishers?.includes(
    "bartowski",
  )
) {
  throw new Error(
    "Community model publisher is not trusted.",
  );
}

console.log(
  "PASS: Community Models category is enabled.",
);
console.log(
  "PASS: Dolphin community model is present.",
);
console.log(
  "PASS: One-click in-app download is required.",
);
console.log(
  "PASS: Community models use the unified queue.",
);
console.log(
  "PASS: SHA256 metadata verification is required.",
);
console.log(
  "PASS: Automatic community model update checking is enabled.",
);
console.log(
  "PASS: Community text model catalog validation completed.",
);
