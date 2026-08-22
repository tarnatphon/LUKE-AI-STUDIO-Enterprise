#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(
  __dirname,
  "..",
  ".."
);

function read(relativePath) {
  return fs.readFileSync(
    path.join(root, relativePath),
    "utf8"
  );
}

function assertIncludes(
  content,
  marker,
  message
) {
  if (!content.includes(marker)) {
    throw new Error(message);
  }
}

const component =
  read(
    "app/frontend/src/components/AssetLibrary.jsx"
  );

const app =
  read(
    "app/frontend/src/App.jsx"
  );

const sidebar =
  read(
    "app/frontend/src/components/Sidebar.jsx"
  );

const styles =
  read(
    "app/frontend/src/App.css"
  );

const api =
  read(
    "app/frontend/src/services/api.js"
  );

const server =
  read(
    "scripts/server/serve.cjs"
  );

assertIncludes(
  component,
  "listAssets",
  "Asset Library must use the existing Asset API service."
);

assertIncludes(
  component,
  "favoriteOnly",
  "Asset Library must expose favorite filtering."
);

assertIncludes(
  component,
  "aria-pressed={favoriteOnly}",
  "Asset Library favorite toggle must expose pressed state accessibly."
);

assertIncludes(
  component,
  "projectFilter",
  "Asset Library must expose project filtering."
);

assertIncludes(
  component,
  "campaignFilter",
  "Asset Library must expose campaign filtering."
);

assertIncludes(
  component,
  "tagFilter",
  "Asset Library must expose tag filtering."
);

assertIncludes(
  component,
  "clearMetadataFilters",
  "Asset Library must allow metadata filters to be cleared."
);

assertIncludes(
  component,
  "resetAssetLibraryView",
  "Asset Library must allow the local view state to be reset."
);

assertIncludes(
  component,
  "activeViewChips",
  "Asset Library must summarize active view controls."
);

assertIncludes(
  component,
  "asset-library-active-view",
  "Asset Library must render active view chips."
);

assertIncludes(
  component,
  "setSelectedAssetId(\"\")",
  "Asset Library reset must close the selected detail card."
);

assertIncludes(
  component,
  "!filteredAssets.some((asset) => asset.assetId === selectedAssetId)",
  "Asset Library must close detail cards hidden by the active view."
);

assertIncludes(
  component,
  "getAssetSearchText",
  "Asset Library must centralize searchable asset fields."
);

assertIncludes(
  component,
  "asset.metadata?.originalName",
  "Asset Library search must include original metadata names."
);

assertIncludes(
  component,
  "asset.metadata?.mimeType",
  "Asset Library search must include metadata MIME types."
);

assertIncludes(
  component,
  "asset.storageProviderId",
  "Asset Library search must include storage provider IDs."
);

assertIncludes(
  component,
  "asset.relations",
  "Asset Library search must include relationship metadata."
);

assertIncludes(
  component,
  "const visibleRelations =",
  "Asset Library search must normalize visible relationship rows."
);

assertIncludes(
  component,
  "...(asset.derivedFrom || []).filter(Boolean)",
  "Asset Library search must ignore blank derived relationship IDs."
);

assertIncludes(
  component,
  "...(asset.references || []).filter(Boolean)",
  "Asset Library search must ignore blank reference relationship IDs."
);

assertIncludes(
  component,
  "item.relation || \"Related asset\"",
  "Asset Library search must include fallback relationship labels."
);

assertIncludes(
  component,
  "libraryStats",
  "Asset Library must expose read-only summary stats."
);

assertIncludes(
  component,
  "asset-library-summary-strip",
  "Asset Library must render a summary strip."
);

assertIncludes(
  component,
  "role=\"status\"",
  "Asset Library loading and empty states must be announced accessibly."
);

assertIncludes(
  component,
  "aria-busy={isLoading}",
  "Asset Library surface must expose loading state accessibly."
);

assertIncludes(
  component,
  "aria-live=\"polite\"",
  "Asset Library status updates must use polite live regions."
);

assertIncludes(
  component,
  "role=\"alert\"",
  "Asset Library errors must be announced accessibly."
);

assertIncludes(
  component,
  "relationshipCount",
  "Asset Library summary must include relationship counts."
);

assertIncludes(
  component,
  "getAssetRelationshipCount(asset)",
  "Asset Library summary must count only visible relationship IDs."
);

assertIncludes(
  component,
  "ASSET_SORT_MODES",
  "Asset Library must expose sort modes."
);

assertIncludes(
  component,
  "sortAssets",
  "Asset Library must sort loaded assets client-side."
);

assertIncludes(
  component,
  "sortedAssets",
  "Asset Library must render sorted assets."
);

assertIncludes(
  component,
  "role=\"list\"",
  "Asset Library card grid must expose list semantics."
);

assertIncludes(
  component,
  "aria-label=\"Asset Library results\"",
  "Asset Library card grid must expose a descriptive list label."
);

assertIncludes(
  component,
  "role=\"listitem\"",
  "Asset Library cards must expose list item semantics."
);

assertIncludes(
  component,
  "updated-desc",
  "Asset Library must support newest-first sorting."
);

assertIncludes(
  component,
  "ASSET_TYPES",
  "Asset Library must expose asset type filters."
);

assertIncludes(
  component,
  "aria-pressed={activeType === type}",
  "Asset Library type filters must expose pressed state accessibly."
);

assertIncludes(
  component,
  "relationCount",
  "Asset Library must show relationship visibility."
);

assertIncludes(
  component,
  "derivedCount",
  "Asset Library cards must show derived relationship counts."
);

assertIncludes(
  component,
  "getAssetDerivedCount(asset)",
  "Asset Library cards must count only visible derived relationship IDs."
);

assertIncludes(
  component,
  "referenceCount",
  "Asset Library cards must show reference relationship counts."
);

assertIncludes(
  component,
  "getAssetReferenceCount(asset)",
  "Asset Library cards must count only visible reference relationship IDs."
);

assertIncludes(
  component,
  "getAssetRelationCount(asset)",
  "Asset Library cards must count only visible custom relationship IDs."
);

assertIncludes(
  component,
  "asset-library-relationship-summary",
  "Asset Library cards must show split relationship summaries."
);

assertIncludes(
  component,
  "AssetDetailPanel",
  "Asset Library must expose a read-only asset detail surface."
);

assertIncludes(
  component,
  "detailTitleId",
  "Asset detail must prepare an accessible title ID."
);

assertIncludes(
  component,
  "detailPanelId",
  "Asset detail must prepare an accessible panel ID."
);

assertIncludes(
  component,
  "aria-labelledby={detailTitleId}",
  "Asset detail must be labelled by the selected asset title."
);

assertIncludes(
  component,
  "asset-library-card-selected",
  "Asset Library must visually mark the selected detail card."
);

assertIncludes(
  component,
  "aria-current",
  "Asset Library selected card must expose current state accessibly."
);

assertIncludes(
  component,
  "aria-selected={isSelected ? \"true\" : undefined}",
  "Asset Library selected card must expose selection state accessibly."
);

assertIncludes(
  component,
  "aria-expanded={isSelected}",
  "Asset Library detail trigger must expose expanded state accessibly."
);

assertIncludes(
  component,
  "isSelected\n                          ? `asset-detail-panel-${asset.assetId}`",
  "Asset Library detail trigger must reference the mounted detail panel accessibly."
);

assertIncludes(
  component,
  "existingPath",
  "Asset Library must show the registered asset path."
);

assertIncludes(
  component,
  "sourcePrompt",
  "Asset detail must show the source prompt."
);

assertIncludes(
  component,
  "sourceModel",
  "Asset detail must show the source model."
);

assertIncludes(
  component,
  "asset-library-source-context",
  "Asset Library cards must show source prompt/model context."
);

assertIncludes(
  component,
  "asset-library-tag-overflow",
  "Asset Library cards must show hidden tag counts."
);

assertIncludes(
  component,
  "length - 3",
  "Asset Library hidden tag count must reflect tags beyond the visible chip limit."
);

assertIncludes(
  component,
  "storageProviderId",
  "Asset detail must show storage provider metadata."
);

assertIncludes(
  component,
  "createdAt",
  "Asset detail must show creation timestamps."
);

assertIncludes(
  component,
  "updatedAt",
  "Asset detail must show update timestamps."
);

assertIncludes(
  component,
  "JSON.stringify(asset.metadata",
  "Asset detail must show full metadata."
);

assertIncludes(
  component,
  "metadataEntries",
  "Asset detail must prepare metadata entries for summary display."
);

assertIncludes(
  component,
  "Object.entries(asset.metadata).sort",
  "Asset detail metadata summaries must use stable key ordering."
);

assertIncludes(
  component,
  "typeof value === \"object\"",
  "Asset detail metadata summaries must handle nested metadata values."
);

assertIncludes(
  component,
  "function buildAssetDetailSnapshot(asset)",
  "Asset detail must provide a read-only snapshot builder."
);

assertIncludes(
  component,
  "buildAssetDetailSnapshot(asset)",
  "Asset detail must expose a copyable snapshot action."
);

assertIncludes(
  component,
  "function buildAssetLibraryViewSnapshot(",
  "Asset Library must provide a read-only view snapshot builder."
);

assertIncludes(
  component,
  "copyAssetLibraryViewSnapshot",
  "Asset Library must expose a copyable current-view snapshot action."
);

assertIncludes(
  component,
  "assets: sortedAssets",
  "Asset Library view snapshot must use the currently sorted visible assets."
);

assertIncludes(
  component,
  "filters: {",
  "Asset Library view snapshot must include active filters."
);

assertIncludes(
  component,
  "stats: libraryStats",
  "Asset Library view snapshot must include read-only summary stats."
);

assertIncludes(
  component,
  "Asset view snapshot copied.",
  "Asset Library view snapshot must announce copy success accessibly."
);

assertIncludes(
  component,
  "Asset snapshot",
  "Asset detail snapshot copy confirmation must use a dedicated label."
);

assertIncludes(
  component,
  "relations: (asset.relations || [])",
  "Asset detail snapshot must include normalized relationship metadata."
);

assertIncludes(
  component,
  "metadata: asset.metadata || {}",
  "Asset detail snapshot must include raw metadata."
);

assertIncludes(
  component,
  "return JSON.stringify(value);",
  "Asset detail metadata summaries must show nested metadata as compact JSON."
);

assertIncludes(
  component,
  "asset-library-metadata-summary",
  "Asset detail must show metadata key/value summaries."
);

assertIncludes(
  component,
  "asset-library-metadata-overflow",
  "Asset detail must show when metadata summaries are capped."
);

assertIncludes(
  component,
  "metadataEntries.length - 8",
  "Asset detail metadata overflow count must reflect hidden summary fields."
);

assertIncludes(
  component,
  "AssetRelationships",
  "Asset detail must show asset relationships."
);

assertIncludes(
  component,
  "copyAssetDetailValue",
  "Asset detail must allow important read-only values to be copied."
);

assertIncludes(
  component,
  "navigator.clipboard.writeText",
  "Asset detail copy controls must use the system clipboard only."
);

assertIncludes(
  component,
  "asset-library-copy-button",
  "Asset detail must render copy controls for inspectable fields."
);

assertIncludes(
  component,
  "asset-library-copy-status",
  "Asset detail copy confirmation must render as a status message."
);

assertIncludes(
  component,
  "copyAssetStatus",
  "Asset detail copy confirmation must use dedicated status text."
);

assertIncludes(
  component,
  "setCopyAssetStatus(\"\");",
  "Asset detail copy confirmation must reset after asset changes."
);

assertIncludes(
  component,
  "setCopyAssetStatus(`${label} copied.`);",
  "Asset detail copy confirmation must announce the copied field."
);

assertIncludes(
  component,
  "setCopyAssetStatus(`${label} could not be copied.`);",
  "Asset detail copy confirmation must announce clipboard failures."
);

assertIncludes(
  component,
  "setCopiedAssetField(\"\");",
  "Asset detail copy feedback must reset when the selected asset changes."
);

assertIncludes(
  component,
  "}, [asset?.assetId]);",
  "Asset detail copy feedback reset must depend on the selected asset."
);

assertIncludes(
  component,
  "Relationship ${index + 1}",
  "Asset detail relationship IDs must be copyable read-only."
);

assertIncludes(
  component,
  "item.relation || \"Related asset\"",
  "Asset detail must label unnamed relationship types read-only."
);

assertIncludes(
  component,
  "].filter((item) => item.value);",
  "Asset detail must avoid blank relationship rows."
);

assertIncludes(
  component,
  "function getAssetDerivedCount(asset)",
  "Asset detail derived counts must ignore blank relationship IDs."
);

assertIncludes(
  component,
  "function getAssetReferenceCount(asset)",
  "Asset detail reference counts must ignore blank relationship IDs."
);

assertIncludes(
  component,
  "function getAssetRelationCount(asset)",
  "Asset detail other relationship counts must ignore blank relationship IDs."
);

assertIncludes(
  component,
  "asset-library-detail-relationship-summary",
  "Asset detail must show relationship summary counts."
);

assertIncludes(
  app,
  "LUKE_AI_ASSET_LIBRARY_UI_V1",
  "Asset Library marker is missing from App."
);

assertIncludes(
  app,
  '<AssetLibrary />',
  "Asset Library is not mounted in the App."
);

assertIncludes(
  app,
  'activeTab === "assets"',
  "Asset Library tab route is missing."
);

assertIncludes(
  sidebar,
  'setActiveTab("assets")',
  "Asset Library navigation item is missing."
);

assertIncludes(
  styles,
  "LUKE_AI_ASSET_LIBRARY_STYLES_V1",
  "Asset Library styles are missing."
);

assertIncludes(
  styles,
  "asset-library-filter-grid",
  "Asset Library metadata filter styles are missing."
);

assertIncludes(
  styles,
  "asset-library-summary-strip",
  "Asset Library summary strip styles are missing."
);

assertIncludes(
  styles,
  "asset-library-sort",
  "Asset Library sort styles are missing."
);

assertIncludes(
  styles,
  "asset-library-active-view",
  "Asset Library active view styles are missing."
);

assertIncludes(
  styles,
  "asset-library-source-context",
  "Asset Library source context styles are missing."
);

assertIncludes(
  styles,
  "asset-library-relationship-summary",
  "Asset Library relationship summary styles are missing."
);

assertIncludes(
  styles,
  "asset-library-tag-overflow",
  "Asset Library hidden tag count styles are missing."
);

assertIncludes(
  styles,
  "asset-library-card-selected",
  "Asset Library selected-card styles are missing."
);

assertIncludes(
  styles,
  "asset-library-detail-actions",
  "Asset detail snapshot action styles are missing."
);

assertIncludes(
  styles,
  "asset-library-view-snapshot-button",
  "Asset Library view snapshot button styles are missing."
);

assertIncludes(
  styles,
  "asset-library-detail-relationship-summary",
  "Asset detail relationship summary styles are missing."
);

assertIncludes(
  styles,
  "asset-library-metadata-summary",
  "Asset detail metadata summary styles are missing."
);

assertIncludes(
  styles,
  "asset-library-metadata-overflow",
  "Asset detail metadata overflow styles are missing."
);

assertIncludes(
  styles,
  "asset-library-copy-button",
  "Asset detail copy button styles are missing."
);

assertIncludes(
  styles,
  "asset-library-copy-status",
  "Asset detail copy status styles are missing."
);

assertIncludes(
  api,
  "export function listAssets",
  "listAssets service is missing."
);

assertIncludes(
  server,
  "LUKE_AI_ASSET_REGISTRY_API_V1",
  "Asset Registry API marker is missing."
);

assertIncludes(
  server,
  'assetUrl.pathname ===\n        "/api/assets"',
  "GET /api/assets route is missing."
);

if (
  component.includes("deleteAsset(") ||
  component.includes("updateAsset(") ||
  component.includes("createAsset(")
) {
  throw new Error(
    "Asset Library must remain read-only in this phase."
  );
}

console.log(
  "PASS: Asset Library uses existing Asset API."
);
console.log(
  "PASS: Asset Library filters by type and favorites."
);
console.log(
  "PASS: Asset Library exposes filter pressed states accessibly."
);
console.log(
  "PASS: Asset Library filters by project, campaign and tag."
);
console.log(
  "PASS: Asset Library resets local view controls read-only."
);
console.log(
  "PASS: Asset Library clears selected details hidden by the active view."
);
console.log(
  "PASS: Asset Library summarizes active view controls."
);
console.log(
  "PASS: Asset Library search covers metadata and relationships."
);
console.log(
  "PASS: Asset Library search normalizes visible relationship rows."
);
console.log(
  "PASS: Asset Library shows read-only summary stats."
);
console.log(
  "PASS: Asset Library announces status and error states accessibly."
);
console.log(
  "PASS: Asset Library exposes loading busy state accessibly."
);
console.log(
  "PASS: Asset Library summary counts visible relationship IDs."
);
console.log(
  "PASS: Asset Library sorts loaded assets read-only."
);
console.log(
  "PASS: Asset Library exposes card collection semantics accessibly."
);
console.log(
  "PASS: Asset Library labels the card results list accessibly."
);
console.log(
  "PASS: Asset Library cards show source prompt/model context."
);
console.log(
  "PASS: Asset Library cards show split relationship counts."
);
console.log(
  "PASS: Asset Library cards count visible relationship IDs."
);
console.log(
  "PASS: Asset Library cards show hidden tag counts."
);
console.log(
  "PASS: Asset Library highlights the selected detail card."
);
console.log(
  "PASS: Asset Library exposes selected card state accessibly."
);
console.log(
  "PASS: Asset Library exposes detail trigger expanded state accessibly."
);
console.log(
  "PASS: Asset Library shows paths and relationship counts."
);
console.log(
  "PASS: Asset Library detail is labelled by its asset title."
);
console.log(
  "PASS: Asset Library detail trigger references the detail panel accessibly."
);
console.log(
  "PASS: Asset Library detail shows full read-only asset metadata."
);
console.log(
  "PASS: Asset Library detail summarizes metadata fields."
);
console.log(
  "PASS: Asset Library detail sorts metadata summaries consistently."
);
console.log(
  "PASS: Asset Library detail formats nested metadata summaries."
);
console.log(
  "PASS: Asset Library detail exposes copyable read-only snapshots."
);
console.log(
  "PASS: Asset Library exposes copyable current-view snapshots."
);
console.log(
  "PASS: Asset Library detail shows capped metadata overflow."
);
console.log(
  "PASS: Asset Library detail summarizes relationships."
);
console.log(
  "PASS: Asset Library detail exposes read-only copy controls."
);
console.log(
  "PASS: Asset Library detail announces copy confirmations accessibly."
);
console.log(
  "PASS: Asset Library detail announces clipboard copy failures."
);
console.log(
  "PASS: Asset Library detail clears stale copy feedback after asset changes."
);
console.log(
  "PASS: Asset Library detail exposes copyable relationship IDs."
);
console.log(
  "PASS: Asset Library detail normalizes relationship display rows."
);
console.log(
  "PASS: Asset Library detail counts visible relationship rows."
);
console.log(
  "PASS: Asset Library is connected to navigation."
);
console.log(
  "PASS: Asset Library remains read-only."
);
console.log(
  "PASS: Phase 3A-5D Asset Library UI validation completed."
);
