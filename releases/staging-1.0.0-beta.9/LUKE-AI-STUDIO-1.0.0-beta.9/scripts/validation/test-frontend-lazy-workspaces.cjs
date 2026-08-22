#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const app = fs.readFileSync("app/frontend/src/App.jsx", "utf8");
const sidebar = fs.readFileSync("app/frontend/src/components/Sidebar.jsx", "utf8");
const workspaceModules = [
  ["generator", "Generator"],
  ["models", "ModelManager"],
  ["settings", "Settings"],
  ["chat", "TextChat"],
  ["speech", "SpeechTranscriber"],
  ["tts", "TextToSpeech"],
  ["image-video", "ImageToVideo"],
  ["assets", "AssetLibrary"],
];
const settingsModules = [
  "RuntimeDownloadDashboard",
  "TextModelManager",
  "PersistentTextChat",
];

function requireText(text, label) {
  if (!app.includes(text)) throw new Error(`${label}: ${text}`);
}

requireText("lazy, Suspense", "REACT_LAZY_IMPORT_MISSING");
requireText("<Suspense fallback={<WorkspaceFallback />}>", "SUSPENSE_BOUNDARY_MISSING");
requireText("const [visitedTabs, setVisitedTabs]", "VISITED_TAB_STATE_MISSING");
requireText("role=\"status\"", "ACCESSIBLE_LOADING_STATUS_MISSING");

for (const [tab, component] of workspaceModules) {
  requireText(
    `${tab === "image-video" ? JSON.stringify(tab) : tab}: () => import(\"./components/${component}\")`,
    `WORKSPACE_LOADER_MISSING_${component}`
  );
  requireText(
    tab === "image-video"
      ? `const ${component} = lazy(workspaceLoaders[\"${tab}\"]);`
      : `const ${component} = lazy(workspaceLoaders.${tab});`,
    `LAZY_WORKSPACE_BINDING_MISSING_${component}`
  );
  if (app.includes(`import ${component} from \"./components/${component}\";`)) {
    throw new Error(`EAGER_WORKSPACE_IMPORT_PRESENT_${component}`);
  }
}

for (const component of settingsModules) {
  requireText(
    `const ${component} = lazy(() => import(\"./components/${component}\"));`,
    `LAZY_SETTINGS_MODULE_MISSING_${component}`
  );
}

for (const [tab] of workspaceModules) {
  requireText(`visitedTabs.has(\"${tab}\")`, `VISITED_TAB_GATE_MISSING_${tab}`);
  if (!sidebar.includes(`prefetchProps(\"${tab}\")`)) {
    throw new Error(`SIDEBAR_PREFETCH_MISSING_${tab}`);
  }
}

requireText("const prefetchWorkspace = useCallback", "PREFETCH_CALLBACK_MISSING");
requireText("prefetchWorkspace={prefetchWorkspace}", "PREFETCH_PROP_MISSING");

console.log("PASS: Heavy workspaces use dynamic imports.");
console.log("PASS: Workspaces load only after their first visit.");
console.log("PASS: Visited workspaces remain mounted to preserve state.");
console.log("PASS: Lazy loading exposes an accessible status fallback.");
console.log("PASS: Sidebar intent safely prefetches workspace chunks.");
console.log("PASS: Beta 8 Frontend Lazy Workspace validation completed.");
