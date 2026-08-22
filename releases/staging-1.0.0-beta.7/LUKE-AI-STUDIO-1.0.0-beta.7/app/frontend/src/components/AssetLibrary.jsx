import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  Box,
  Copy,
  Film,
  Image,
  Link2,
  RefreshCw,
  Search,
  Star,
  X,
} from "lucide-react";
import { listAssets } from "../services/api";

const ASSET_TYPES = [
  "all",
  "image",
  "video",
  "reference",
  "prompt",
  "brand",
  "logo",
  "voice",
  "music",
];

const ASSET_SORT_MODES = [
  {
    value: "updated-desc",
    label: "Newest",
  },
  {
    value: "updated-asc",
    label: "Oldest",
  },
  {
    value: "title-asc",
    label: "Title",
  },
  {
    value: "type-asc",
    label: "Type",
  },
];

function formatAssetDate(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatAssetPath(value) {
  if (!value) return "Managed record only";
  const parts = String(value).split(/[\\/]/).filter(Boolean);
  if (parts.length <= 3) return value;
  return `.../${parts.slice(-3).join("/")}`;
}

function getAssetIcon(type) {
  if (type === "image" || type === "reference" || type === "logo") return Image;
  if (type === "video") return Film;
  if (type === "brand") return Archive;
  return Box;
}

function getAssetTitle(asset) {
  return (
    asset.metadata?.originalName ||
    asset.metadata?.filename ||
    asset.metadata?.title ||
    asset.sourcePrompt ||
    asset.existingPath?.split(/[\\/]/).pop() ||
    asset.assetId
  );
}

function getAssetSearchText(asset) {
  const visibleRelations =
    (asset.relations || []).filter((item) => item?.assetId);

  return [
    asset.assetId,
    asset.type,
    asset.existingPath,
    asset.project,
    asset.campaign,
    asset.sourcePrompt,
    asset.sourceModel,
    asset.storageProviderId,
    asset.metadata?.originalName,
    asset.metadata?.filename,
    asset.metadata?.title,
    asset.metadata?.mimeType,
    asset.metadata?.source,
    ...(asset.tags || []),
    ...(asset.derivedFrom || []).filter(Boolean),
    ...(asset.references || []).filter(Boolean),
    ...visibleRelations.flatMap((item) => [
      item.assetId,
      item.relation || "Related asset",
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getAssetTime(asset) {
  const time =
    Date.parse(asset.updatedAt || asset.createdAt || "");

  return Number.isFinite(time) ? time : 0;
}

function sortAssets(assets, sortMode) {
  const sortedAssets = [...assets];

  sortedAssets.sort((left, right) => {
    if (sortMode === "updated-asc") {
      return getAssetTime(left) - getAssetTime(right);
    }

    if (sortMode === "title-asc") {
      return getAssetTitle(left).localeCompare(getAssetTitle(right));
    }

    if (sortMode === "type-asc") {
      return (
        String(left.type || "").localeCompare(String(right.type || "")) ||
        getAssetTitle(left).localeCompare(getAssetTitle(right))
      );
    }

    return getAssetTime(right) - getAssetTime(left);
  });

  return sortedAssets;
}

function getAssetDerivedCount(asset) {
  return (asset.derivedFrom || []).filter(Boolean).length;
}

function getAssetReferenceCount(asset) {
  return (asset.references || []).filter(Boolean).length;
}

function getAssetRelationCount(asset) {
  return (asset.relations || []).filter((item) => item?.assetId).length;
}

function getAssetRelationshipCount(asset) {
  return (
    getAssetDerivedCount(asset) +
    getAssetReferenceCount(asset) +
    getAssetRelationCount(asset)
  );
}

function formatAssetValue(value) {
  if (value === undefined || value === null || value === "") {
    return "Not recorded";
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "Complex metadata";
    }
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  return String(value);
}

function buildAssetDetailSnapshot(asset) {
  return {
    assetId: asset.assetId || "",
    type: asset.type || "",
    title: getAssetTitle(asset),
    existingPath: asset.existingPath || "",
    storageProviderId: asset.storageProviderId || "local",
    createdAt: asset.createdAt || "",
    updatedAt: asset.updatedAt || "",
    project: asset.project || "",
    campaign: asset.campaign || "",
    tags: asset.tags || [],
    favorite: asset.favorite === true,
    pinned: asset.pinned === true,
    sourcePrompt: asset.sourcePrompt || "",
    sourceModel: asset.sourceModel || "",
    derivedFrom: (asset.derivedFrom || []).filter(Boolean),
    references: (asset.references || []).filter(Boolean),
    relations: (asset.relations || [])
      .filter((item) => item?.assetId)
      .map((item) => ({
        relation: item.relation || "Related asset",
        assetId: item.assetId,
      })),
    metadata: asset.metadata || {},
  };
}

function buildAssetLibraryViewSnapshot({
  activeViewChips,
  assets,
  filters,
  stats,
}) {
  return {
    generatedAt: new Date().toISOString(),
    filters,
    activeView: activeViewChips,
    stats,
    assets: assets.map((asset) => ({
      assetId: asset.assetId || "",
      type: asset.type || "",
      title: getAssetTitle(asset),
      existingPath: asset.existingPath || "",
      storageProviderId: asset.storageProviderId || "local",
      updatedAt: asset.updatedAt || "",
      project: asset.project || "",
      campaign: asset.campaign || "",
      tags: asset.tags || [],
      sourceModel: asset.sourceModel || "",
      relationshipCount: getAssetRelationshipCount(asset),
    })),
  };
}

function AssetDetailRow({
  label,
  children,
  copyValue,
  copiedAssetField,
  onCopy,
}) {
  const canCopy =
    copyValue !== undefined &&
    copyValue !== null &&
    copyValue !== "";

  return (
    <div className="asset-library-detail-row">
      <dt>{label}</dt>
      <dd>
        <span>{children}</span>
        {canCopy && (
          <button
            type="button"
            className="asset-library-copy-button"
            onClick={() => onCopy(label, copyValue)}
            title={`Copy ${label}`}
            aria-label={`Copy ${label}`}
          >
            <Copy size={13} />
            <span>{copiedAssetField === label ? "Copied" : "Copy"}</span>
          </button>
        )}
      </dd>
    </div>
  );
}

function AssetDetailList({ title, items = [] }) {
  return (
    <section className="asset-library-detail-section">
      <h4>{title}</h4>
      {items.length > 0 ? (
        <div className="asset-library-detail-tags">
          {items.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      ) : (
        <p>None recorded</p>
      )}
    </section>
  );
}

function AssetRelationships({
  asset,
  copiedAssetField,
  onCopy,
}) {
  const derivedCount = getAssetDerivedCount(asset);
  const referenceCount = getAssetReferenceCount(asset);
  const relationCount = getAssetRelationCount(asset);

  const relationEntries = [
    ...((asset.derivedFrom || []).map((assetId) => ({
      label: "Derived from",
      value: assetId,
    }))),
    ...((asset.references || []).map((assetId) => ({
      label: "References",
      value: assetId,
    }))),
    ...((asset.relations || []).map((item) => ({
      label: item.relation || "Related asset",
      value: item.assetId,
    }))),
  ].filter((item) => item.value);

  return (
    <section className="asset-library-detail-section">
      <h4>Relationships</h4>
      <div className="asset-library-detail-relationship-summary">
        <span>
          <strong>{derivedCount}</strong>
          Derived
        </span>
        <span>
          <strong>{referenceCount}</strong>
          References
        </span>
        <span>
          <strong>{relationCount}</strong>
          Other links
        </span>
      </div>
      {relationEntries.length > 0 ? (
        <dl className="asset-library-relationships">
          {relationEntries.map((item, index) => (
            <div key={`${item.label}-${item.value}-${index}`}>
              <dt>{item.label}</dt>
              <dd>
                <span>{item.value}</span>
                <button
                  type="button"
                  className="asset-library-copy-button"
                  onClick={() =>
                    onCopy(`Relationship ${index + 1}`, item.value)
                  }
                  title={`Copy ${item.label}`}
                  aria-label={`Copy ${item.label}`}
                >
                  <Copy size={13} />
                  <span>
                    {copiedAssetField === `Relationship ${index + 1}`
                      ? "Copied"
                      : "Copy"}
                  </span>
                </button>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>None recorded</p>
      )}
    </section>
  );
}

function AssetDetailPanel({ asset, onClose }) {
  const [copiedAssetField, setCopiedAssetField] = useState("");
  const [copyAssetStatus, setCopyAssetStatus] = useState("");

  useEffect(() => {
    setCopiedAssetField("");
    setCopyAssetStatus("");
  }, [asset?.assetId]);

  if (!asset) return null;

  const metadataEntries =
    asset.metadata &&
    typeof asset.metadata === "object"
      ? Object.entries(asset.metadata).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      : [];

  const metadata =
    metadataEntries.length > 0
      ? JSON.stringify(asset.metadata, null, 2)
      : "None recorded";

  const detailPanelId = `asset-detail-panel-${asset.assetId}`;
  const detailTitleId = `asset-detail-title-${asset.assetId}`;

  const copyAssetDetailValue = async (label, value) => {
    const text =
      typeof value === "string"
        ? value
        : JSON.stringify(value, null, 2);

    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedAssetField(label);
      setCopyAssetStatus(`${label} copied.`);
      window.setTimeout(() => {
        setCopiedAssetField((current) =>
          current === label ? "" : current
        );
        setCopyAssetStatus((current) =>
          current === `${label} copied.` ? "" : current
        );
      }, 1600);
    } catch {
      setCopiedAssetField("");
      setCopyAssetStatus(`${label} could not be copied.`);
    }
  };

  return (
    <aside
      id={detailPanelId}
      className="asset-library-detail"
      aria-label="Asset detail"
      aria-labelledby={detailTitleId}
    >
      <header>
        <div>
          <span className={`asset-library-type asset-library-type-${asset.type}`}>
            {asset.type}
          </span>
          <h3 id={detailTitleId}>{getAssetTitle(asset)}</h3>
        </div>
        <div className="asset-library-detail-actions">
          <button
            type="button"
            className="asset-library-copy-button"
            onClick={() =>
              copyAssetDetailValue(
                "Asset snapshot",
                buildAssetDetailSnapshot(asset)
              )
            }
            title="Copy Asset Snapshot"
            aria-label="Copy Asset Snapshot"
          >
            <Copy size={13} />
            <span>
              {copiedAssetField === "Asset snapshot"
                ? "Copied"
                : "Copy snapshot"}
            </span>
          </button>
          <button
            type="button"
            className="asset-library-icon-button"
            onClick={onClose}
            title="Close asset detail"
            aria-label="Close asset detail"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      <dl className="asset-library-detail-grid">
        <AssetDetailRow
          label="Asset ID"
          copyValue={asset.assetId}
          copiedAssetField={copiedAssetField}
          onCopy={copyAssetDetailValue}
        >
          {asset.assetId}
        </AssetDetailRow>
        <AssetDetailRow label="Type">
          {formatAssetValue(asset.type)}
        </AssetDetailRow>
        <AssetDetailRow
          label="Existing path"
          copyValue={asset.existingPath}
          copiedAssetField={copiedAssetField}
          onCopy={copyAssetDetailValue}
        >
          {formatAssetValue(asset.existingPath)}
        </AssetDetailRow>
        <AssetDetailRow
          label="Storage provider"
          copyValue={asset.storageProviderId || "local"}
          copiedAssetField={copiedAssetField}
          onCopy={copyAssetDetailValue}
        >
          {formatAssetValue(asset.storageProviderId || "local")}
        </AssetDetailRow>
        <AssetDetailRow label="Created">
          {formatAssetDate(asset.createdAt)}
        </AssetDetailRow>
        <AssetDetailRow label="Updated">
          {formatAssetDate(asset.updatedAt)}
        </AssetDetailRow>
        <AssetDetailRow label="Project">
          {formatAssetValue(asset.project)}
        </AssetDetailRow>
        <AssetDetailRow label="Campaign">
          {formatAssetValue(asset.campaign)}
        </AssetDetailRow>
        <AssetDetailRow label="Favorite">
          {formatAssetValue(asset.favorite)}
        </AssetDetailRow>
        <AssetDetailRow label="Pinned">
          {formatAssetValue(asset.pinned)}
        </AssetDetailRow>
        <AssetDetailRow
          label="Source model"
          copyValue={asset.sourceModel}
          copiedAssetField={copiedAssetField}
          onCopy={copyAssetDetailValue}
        >
          {formatAssetValue(asset.sourceModel)}
        </AssetDetailRow>
        <AssetDetailRow
          label="Source prompt"
          copyValue={asset.sourcePrompt}
          copiedAssetField={copiedAssetField}
          onCopy={copyAssetDetailValue}
        >
          {formatAssetValue(asset.sourcePrompt)}
        </AssetDetailRow>
      </dl>

      <AssetDetailList
        title="Tags"
        items={asset.tags || []}
      />
      <AssetRelationships
        asset={asset}
        copiedAssetField={copiedAssetField}
        onCopy={copyAssetDetailValue}
      />

      <section className="asset-library-detail-section">
        <h4>Metadata</h4>
        {metadataEntries.length > 0 && (
          <dl className="asset-library-metadata-summary">
            {metadataEntries.slice(0, 8).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{formatAssetValue(value)}</dd>
              </div>
            ))}
          </dl>
        )}
        {metadataEntries.length > 8 && (
          <div className="asset-library-metadata-overflow">
            +{metadataEntries.length - 8} more metadata fields in raw JSON
          </div>
        )}
        <pre>{metadata}</pre>
        {metadataEntries.length > 0 && (
          <button
            type="button"
            className="asset-library-copy-button asset-library-copy-button-inline"
            onClick={() => copyAssetDetailValue("Metadata", asset.metadata)}
            title="Copy Metadata"
            aria-label="Copy Metadata"
          >
            <Copy size={13} />
            <span>{copiedAssetField === "Metadata" ? "Copied" : "Copy metadata"}</span>
          </button>
        )}
      </section>

      <p
        className="asset-library-copy-status"
        role="status"
        aria-live="polite"
      >
        {copyAssetStatus}
      </p>
    </aside>
  );
}

export default function AssetLibrary() {
  const [assets, setAssets] = useState([]);
  const [activeType, setActiveType] = useState("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sortMode, setSortMode] = useState("updated-desc");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [viewCopyStatus, setViewCopyStatus] = useState("");

  const loadAssets = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const result = await listAssets({
        type: activeType === "all" ? "" : activeType,
        favorite: favoriteOnly ? true : "",
        project: projectFilter.trim(),
        campaign: campaignFilter.trim(),
        tag: tagFilter.trim(),
      });

      setAssets(Array.isArray(result.assets) ? result.assets : []);
    } catch (err) {
      setError(err?.message || "Asset Library could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [activeType, campaignFilter, favoriteOnly, projectFilter, tagFilter]);

  useEffect(() => {
    loadAssets();
  }, [loadAssets]);

  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return assets;

    return assets.filter((asset) => {
      return getAssetSearchText(asset).includes(needle);
    });
  }, [assets, query]);

  useEffect(() => {
    if (
      selectedAssetId &&
      !filteredAssets.some((asset) => asset.assetId === selectedAssetId)
    ) {
      setSelectedAssetId("");
    }
  }, [filteredAssets, selectedAssetId]);

  const sortedAssets = useMemo(
    () => sortAssets(filteredAssets, sortMode),
    [filteredAssets, sortMode]
  );

  const summary = useMemo(() => {
    const counts = new Map();
    for (const asset of assets) {
      counts.set(asset.type, (counts.get(asset.type) || 0) + 1);
    }
    return counts;
  }, [assets]);

  const libraryStats = useMemo(() => {
    let favoriteCount = 0;
    let relationshipCount = 0;

    for (const asset of assets) {
      if (asset.favorite) favoriteCount += 1;

      relationshipCount += getAssetRelationshipCount(asset);
    }

    return {
      total: assets.length,
      visible: filteredAssets.length,
      favoriteCount,
      relationshipCount,
    };
  }, [assets, filteredAssets.length]);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.assetId === selectedAssetId) || null,
    [assets, selectedAssetId]
  );

  const activeViewChips = useMemo(() => {
    const chips = [];
    const sortLabel =
      ASSET_SORT_MODES.find((mode) => mode.value === sortMode)?.label ||
      "Newest";

    if (query.trim()) chips.push(`Search: ${query.trim()}`);
    if (activeType !== "all") chips.push(`Type: ${activeType}`);
    if (favoriteOnly) chips.push("Favorites only");
    if (projectFilter.trim()) chips.push(`Project: ${projectFilter.trim()}`);
    if (campaignFilter.trim()) chips.push(`Campaign: ${campaignFilter.trim()}`);
    if (tagFilter.trim()) chips.push(`Tag: ${tagFilter.trim()}`);
    if (sortMode !== "updated-desc") chips.push(`Sort: ${sortLabel}`);

    return chips;
  }, [activeType, campaignFilter, favoriteOnly, projectFilter, query, sortMode, tagFilter]);

  useEffect(() => {
    setViewCopyStatus("");
  }, [activeType, campaignFilter, favoriteOnly, projectFilter, query, sortMode, tagFilter]);

  const hasMetadataFilters =
    projectFilter.trim() ||
    campaignFilter.trim() ||
    tagFilter.trim();

  const clearMetadataFilters = () => {
    setProjectFilter("");
    setCampaignFilter("");
    setTagFilter("");
  };

  const resetAssetLibraryView = () => {
    setActiveType("all");
    setFavoriteOnly(false);
    setProjectFilter("");
    setCampaignFilter("");
    setTagFilter("");
    setSortMode("updated-desc");
    setQuery("");
    setSelectedAssetId("");
  };

  const copyAssetLibraryViewSnapshot = async () => {
    const snapshot = buildAssetLibraryViewSnapshot({
      activeViewChips,
      assets: sortedAssets,
      filters: {
        query: query.trim(),
        type: activeType,
        favoriteOnly,
        project: projectFilter.trim(),
        campaign: campaignFilter.trim(),
        tag: tagFilter.trim(),
        sortMode,
      },
      stats: libraryStats,
    });

    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setViewCopyStatus("Asset view snapshot copied.");
      window.setTimeout(() => {
        setViewCopyStatus((current) =>
          current === "Asset view snapshot copied." ? "" : current
        );
      }, 1600);
    } catch {
      setViewCopyStatus("Asset view snapshot could not be copied.");
    }
  };

  return (
    <section
      className="asset-library"
      aria-busy={isLoading}
    >
      <div className="asset-library-header">
        <div>
          <div className="asset-library-eyebrow">
            <Archive size={14} />
            <span>Asset Library</span>
          </div>
          <h2>Registered Assets</h2>
          <p>
            Browse generated images, videos and reference files already tracked by LUKE AI.
          </p>
        </div>

        <button
          type="button"
          className="m3-btn m3-btn-tonal"
          onClick={loadAssets}
          disabled={isLoading}
          title="Refresh Asset Library"
        >
          <RefreshCw size={16} />
          Refresh
        </button>
      </div>

      <div className="asset-library-toolbar">
        <div className="asset-library-search">
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search assets"
            aria-label="Search assets"
          />
        </div>

        <button
          type="button"
          className={`m3-btn ${favoriteOnly ? "m3-btn-filled" : "m3-btn-outlined"}`}
          onClick={() => setFavoriteOnly((value) => !value)}
          aria-pressed={favoriteOnly}
        >
          <Star size={16} />
          Favorites
        </button>

        <button
          type="button"
          className="m3-btn m3-btn-outlined"
          onClick={resetAssetLibraryView}
        >
          Reset view
        </button>
      </div>

      {activeViewChips.length > 0 && (
        <div className="asset-library-active-view" aria-label="Active Asset Library view">
          {activeViewChips.map((chip) => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
      )}

      <label className="asset-library-sort">
        <span>Sort</span>
        <select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value)}
          aria-label="Sort assets"
        >
          {ASSET_SORT_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>

      <div className="asset-library-filter-grid" aria-label="Asset metadata filters">
        <label>
          <span>Project</span>
          <input
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            placeholder="Any project"
          />
        </label>

        <label>
          <span>Campaign</span>
          <input
            value={campaignFilter}
            onChange={(event) => setCampaignFilter(event.target.value)}
            placeholder="Any campaign"
          />
        </label>

        <label>
          <span>Tag</span>
          <input
            value={tagFilter}
            onChange={(event) => setTagFilter(event.target.value)}
            placeholder="Any tag"
          />
        </label>

        <button
          type="button"
          className="m3-btn m3-btn-outlined"
          onClick={clearMetadataFilters}
          disabled={!hasMetadataFilters}
        >
          Clear
        </button>
      </div>

      <div className="asset-library-summary-strip" aria-label="Asset Library summary">
        <span>
          <strong>{libraryStats.total}</strong>
          Total
        </span>
        <span>
          <strong>{libraryStats.visible}</strong>
          Visible
        </span>
        <span>
          <strong>{libraryStats.favoriteCount}</strong>
          Favorites
        </span>
        <span>
          <strong>{libraryStats.relationshipCount}</strong>
          Links
        </span>
        <button
          type="button"
          className="asset-library-copy-button asset-library-view-snapshot-button"
          onClick={copyAssetLibraryViewSnapshot}
          disabled={sortedAssets.length === 0}
          title="Copy Asset View Snapshot"
          aria-label="Copy Asset View Snapshot"
        >
          <Copy size={13} />
          Copy view
        </button>
      </div>
      <p
        className="asset-library-copy-status"
        role="status"
        aria-live="polite"
      >
        {viewCopyStatus}
      </p>

      <div className="asset-library-tabs" aria-label="Asset type filters">
        {ASSET_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            className={activeType === type ? "active" : ""}
            onClick={() => setActiveType(type)}
            aria-pressed={activeType === type}
          >
            {type === "all" ? "All" : type}
            {type !== "all" && summary.has(type) && (
              <span>{summary.get(type)}</span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="asset-library-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {isLoading && (
        <div
          className="asset-library-empty"
          role="status"
          aria-live="polite"
        >
          Loading Asset Library...
        </div>
      )}

      {!isLoading && !error && filteredAssets.length === 0 && (
        <div
          className="asset-library-empty"
          role="status"
          aria-live="polite"
        >
          No registered assets match this view.
        </div>
      )}

      {!isLoading && !error && sortedAssets.length > 0 && (
        <div
          className="asset-library-grid"
          role="list"
          aria-label="Asset Library results"
        >
          {sortedAssets.map((asset) => {
            const Icon = getAssetIcon(asset.type);
            const derivedCount = getAssetDerivedCount(asset);
            const referenceCount = getAssetReferenceCount(asset);
            const relationCount = getAssetRelationCount(asset);
            const isSelected = selectedAssetId === asset.assetId;

            return (
              <article
                className={`asset-library-card ${isSelected ? "asset-library-card-selected" : ""}`}
                key={asset.assetId}
                role="listitem"
                aria-current={isSelected ? "true" : undefined}
                aria-selected={isSelected ? "true" : undefined}
              >
                <header>
                  <span className={`asset-library-type asset-library-type-${asset.type}`}>
                    <Icon size={15} />
                    {asset.type}
                  </span>
                  {asset.favorite && (
                    <span className="asset-library-favorite">
                      <Star size={14} />
                    </span>
                  )}
                </header>

                <h3 title={getAssetTitle(asset)}>
                  {getAssetTitle(asset)}
                </h3>

                <div className="asset-library-path" title={asset.existingPath || ""}>
                  {formatAssetPath(asset.existingPath)}
                </div>

                <div className="asset-library-meta">
                  <span>{formatAssetDate(asset.updatedAt || asset.createdAt)}</span>
                  <span>{asset.storageProviderId || "local"}</span>
                </div>

                {(asset.sourceModel || asset.sourcePrompt) && (
                  <div className="asset-library-source-context">
                    {asset.sourceModel && (
                      <span title={asset.sourceModel}>
                        {asset.sourceModel}
                      </span>
                    )}
                    {asset.sourcePrompt && (
                      <p title={asset.sourcePrompt}>
                        {asset.sourcePrompt}
                      </p>
                    )}
                  </div>
                )}

                {(asset.project || asset.campaign || asset.tags?.length > 0) && (
                  <div className="asset-library-tags">
                    {asset.project && <span>{asset.project}</span>}
                    {asset.campaign && <span>{asset.campaign}</span>}
                    {(asset.tags || []).slice(0, 3).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                    {(asset.tags || []).length > 3 && (
                      <span
                        className="asset-library-tag-overflow"
                        title={(asset.tags || []).join(", ")}
                      >
                        +{(asset.tags || []).length - 3}
                      </span>
                    )}
                  </div>
                )}

                <footer>
                  <span title={asset.assetId}>{asset.assetId}</span>
                  <div className="asset-library-relationship-summary">
                    <span title="Derived-from links">
                      D {derivedCount}
                    </span>
                    <span title="Reference links">
                      R {referenceCount}
                    </span>
                    <span title="Other relationships">
                      L {relationCount}
                    </span>
                    <button
                      type="button"
                      className="asset-library-detail-trigger"
                      onClick={() => setSelectedAssetId(asset.assetId)}
                      aria-label={`View details for ${getAssetTitle(asset)}`}
                      aria-expanded={isSelected}
                      aria-controls={
                        isSelected
                          ? `asset-detail-panel-${asset.assetId}`
                          : undefined
                      }
                    >
                      <Link2 size={13} />
                      Details
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      <AssetDetailPanel
        asset={selectedAsset}
        onClose={() => setSelectedAssetId("")}
      />
    </section>
  );
}
