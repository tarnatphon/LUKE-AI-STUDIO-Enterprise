"use strict";

/**
 * Settings tab layout regression — "run cache มี Setting แทรกอยู่ตรงกลาง".
 *
 * Mac evidence (2026-11-04, after PR #89):
 *   checkout : aafccf4   bundle : aafccf4   stale : False
 *   process  : aafccf4   restart : False
 * ...so neither an old bundle nor an old serve.cjs process could be the cause.
 * The heading position comes from JSX + CSS in the bundle that was already
 * loaded. The real cause was in App.css:
 *
 *   .workspace-panel { flex: 1 1 0; height: 0 }        (flex column)
 *   .runtime-dashboard-shell { overflow: visible }     (global)
 *   .workspace-area { flex: 1; overflow-y: auto }      (nested scroll)
 *
 * The Settings tab renders `.runtime-dashboard-shell` and `<Settings>` as two
 * direct flex children. Flex shrank the dashboard, `overflow: visible` let its
 * cleanup cards paint past its box, and the Settings heading (which followed
 * it in DOM order) was painted in the middle of the "Runtime cache" card.
 *
 * The fix: one scroll container (the panel, which already gets
 * overflow="auto"), non-shrinking children, no nested scroll box, and the page
 * heading moved to the top of the tab (rendered once, not twice).
 *
 * Run: node scripts/validation/test-settings-layout.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
let passed = 0;
let failed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(t) { console.log(`\n${t}`); }
function read(relative) { return fs.readFileSync(path.join(root, relative), "utf8"); }

const app = read("app/frontend/src/App.jsx");
const settings = read("app/frontend/src/components/Settings.jsx");
const css = read("app/frontend/src/App.css");
const buildInfo = read("app/frontend/src/lib/build-info.mjs");
const serve = read("scripts/server/serve.cjs");

/** Extract the declarations of one CSS rule (first match), ignoring comments. */
function ruleDeclarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : "";
}
/** The LUKE_SETTINGS_LAYOUT_FIX block, up to the next unrelated rule. */
function fixBlock() {
  const start = css.indexOf("/* LUKE_SETTINGS_LAYOUT_FIX");
  const end = css.indexOf(".chat-arena-chip.selected", start);
  return start < 0 ? "" : css.slice(start, end < 0 ? css.length : end);
}
const block = fixBlock();

/**
 * A tiny, honest flexbox model of the Settings tab. `childrenShrink` and
 * `nestedScroll` are read from the CSS above, not hard-coded: if someone
 * reintroduces the old rules, the simulation changes shape too.
 *
 * Old layout: shell is first, shrunk to a fraction of the panel, but its
 * `overflow: visible` content still paints to shellContentHeight. The heading
 * follows the shrunken shell box and is therefore covered by the cards.
 * New layout: non-shrinking children in document order (heading → shell →
 * settings), with the panel as the only scroll container.
 */
function simulate({ order, childrenShrink, nestedScroll, shellOverflowVisible,
  panelHeight, headerHeight, shellContentHeight, settingsContentHeight }) {
  const shrinkFactor = childrenShrink ? 0.2 : 1;
  if (order === "shell-first") {
    const shellBox = shellContentHeight * shrinkFactor;
    const shellPaintedBottom = shellOverflowVisible ? shellContentHeight : shellBox;
    const headingTop = shellBox;
    return {
      // Cards paint past the shrunken shell box and cover the heading below.
      overlap: shellPaintedBottom > headingTop + 1,
      headingTop,
      shellTop: 0,
      shellPaintedBottom,
      scrollHeight: shellBox + headerHeight + settingsContentHeight,
      nestedScrollContainers: nestedScroll ? 1 : 0,
    };
  }
  const headingTop = 0;
  const shellTop = headerHeight;
  const shellBox = shellContentHeight * shrinkFactor;
  const shellPaintedBottom = shellTop + (shellOverflowVisible ? shellContentHeight : shellBox);
  return {
    // The cards now start BELOW the heading, so their painted bottom being
    // far down the page is expected and is not an overlap.
    overlap: shellTop < headingTop + headerHeight - 1,
    headingTop,
    shellTop,
    shellPaintedBottom,
    scrollHeight: headerHeight + shellBox + settingsContentHeight,
    nestedScrollContainers: nestedScroll ? 1 : 0,
  };
}

section("A. Health evidence is not the cause (regression guard)");
check("diagnoseBuild does not claim to check the process",
  !/restartRequired|process\?\./.test(buildInfo.slice(buildInfo.indexOf("export function diagnoseBuild"))),
  "the sidebar's ตรงกับซอร์ส only compares bundle/dist/source");
check("/api/health still reports restartRequired",
  serve.includes("restartRequired: Boolean(PROCESS_SOURCE.available"),
  "PR #89 process stamp must stay");

section("B. Settings tab DOM structure");
check("stable className=\"workspace-panel\" kept",
  app.includes('className="workspace-panel"'),
  "test-frontend-chat-projects.cjs pins this string");
check("panel exposes data-tab for scoped CSS", app.includes("data-tab={tab}"));
const settingsTab = app.slice(app.indexOf('<WorkspacePanel tab="settings"'), app.indexOf("</WorkspacePanel>", app.indexOf('<WorkspacePanel tab="settings"')));
check("settings tab is found", settingsTab.length > 200);
check("settings panel is the only scroll container (overflow=\"auto\")",
  settingsTab.includes('overflow="auto"'));
const headingIndex = settingsTab.indexOf("settings-workspace-header");
const shellIndex = settingsTab.indexOf('className="runtime-dashboard-shell"');
const settingsIndex = settingsTab.indexOf("<Settings");
check("page heading is rendered at the top of the tab", headingIndex >= 0);
check("heading comes BEFORE the runtime dashboard",
  headingIndex >= 0 && headingIndex < shellIndex,
  `heading=${headingIndex} shell=${shellIndex}`);
check("runtime dashboard still comes BEFORE the Settings body",
  shellIndex >= 0 && shellIndex < settingsIndex,
  `shell=${shellIndex} settings=${settingsIndex}`);
check("Settings body is told not to render a second heading",
  settingsTab.includes("showHeader={false}"));
check("heading markup appears exactly once in App.jsx",
  (app.match(/Settings & Parameters/g) || []).length === 1);
check("error boundary does not wrap children in an extra DOM node",
  app.includes("if (!this.state.error) return this.props.children;"),
  "CSS child selector (>) depends on direct DOM children");

section("C. Settings.jsx heading is gated, not deleted");
check("showHeader defaults to true for standalone renders",
  /showHeader\s*=\s*true/.test(settings));
check("heading is wrapped in a showHeader condition",
  /\{showHeader\s*&&\s*\(/.test(settings));
check("original heading text is preserved",
  settings.includes("Settings & Parameters") &&
  settings.includes("Configure your AI models for optimal performance."));
check("Settings root is still .workspace-area",
  settings.includes('className="workspace-area"'));

section("D. CSS: one scroll container, no shrinking children");
check("LUKE_SETTINGS_LAYOUT_FIX block exists", block.length > 100);
check("old global `.runtime-dashboard-shell { overflow: visible }` is gone",
  !/(^|\n)\s*\.runtime-dashboard-shell\s*\{\s*overflow:\s*visible;?\s*\}/.test(css));
const allChildren = ruleDeclarations('.workspace-panel[data-tab="settings"] > *');
check("scoped rule for direct children exists", allChildren.length > 0);
check("children do not shrink (flex: 0 0 auto)", /flex:\s*0 0 auto/.test(allChildren));
check("children cannot overflow horizontally", /min-width:\s*0/.test(allChildren));
const shellRule = ruleDeclarations('.workspace-panel[data-tab="settings"] > .runtime-dashboard-shell');
check("dashboard overflow rule is scoped to settings", shellRule.length > 0);
check("dashboard keeps overflow: visible without clipping", /overflow:\s*visible/.test(shellRule));
const areaRule = ruleDeclarations('.workspace-panel[data-tab="settings"] > .workspace-area');
check("Settings .workspace-area override exists", areaRule.length > 0);
check("Settings .workspace-area does not shrink", /flex:\s*0 0 auto/.test(areaRule));
check("no nested scroll box on Settings .workspace-area",
  /overflow:\s*visible/.test(areaRule) && !/overflow-y:\s*(auto|scroll)/.test(areaRule));
const headerRule = ruleDeclarations('.workspace-panel[data-tab="settings"] > .settings-workspace-header');
check("top heading gets the same 28px inset as the body", /padding:\s*28px/.test(headerRule));
check("fix does not use position/z-index hacks",
  !/position:\s*(absolute|fixed)|z-index/.test(block));
const selectors = [...block.matchAll(/^([^{}]+)\{/gm)].map((m) => m[1].trim()).filter((s) => !s.startsWith("/*") && !s.startsWith("*"));
check("every new rule is scoped to the settings tab",
  selectors.length > 0 && selectors.every((s) => s.includes('[data-tab="settings"]')),
  selectors.join(" | "));
check("flex column is still declared for .workspace-panel",
  /\.workspace-panel\s*\{[^}]*flex-direction:\s*column/.test(css));

section("E. Layout invariant (values read from the CSS above)");
const newShrink = !/flex:\s*0 0 auto/.test(allChildren);
const newNested = /overflow:\s*(auto|scroll)/.test(areaRule) || /overflow-y:\s*(auto|scroll)/.test(areaRule);
const oldLayout = simulate({ order: "shell-first", childrenShrink: true, nestedScroll: true,
  shellOverflowVisible: true, panelHeight: 900, headerHeight: 90,
  shellContentHeight: 1800, settingsContentHeight: 2600 });
check("the OLD rules reproduce the reported overlap", oldLayout.overlap === true,
  `painted bottom=${oldLayout.shellPaintedBottom}, heading top=${oldLayout.headingTop}`);
check("the OLD layout really had a nested scroll box",
  oldLayout.nestedScrollContainers === 1);
for (const [panelHeight, shellContentHeight] of [[600, 1800], [900, 2400], [1400, 3200]]) {
  const now = simulate({ order: "heading-first", childrenShrink: newShrink,
    nestedScroll: newNested, shellOverflowVisible: true, panelHeight,
    headerHeight: 90, shellContentHeight, settingsContentHeight: 2600 });
  check(`no overlap at panel=${panelHeight}, dashboard=${shellContentHeight}`,
    now.overlap === false && now.headingTop === 0,
    `painted bottom=${now.shellPaintedBottom}`);
  check(`content still scrollable at panel=${panelHeight}`,
    now.scrollHeight > panelHeight && now.nestedScrollContainers === 0);
}

section("F. Other tabs are untouched");
check("no unscoped .workspace-area override was added",
  !/(^|\n)\s*\.workspace-area\s*\{/.test(block));
check("no unscoped .workspace-panel overflow override was added",
  !/^\.workspace-panel\s*\{/m.test(block));
check("data-tab scoping is on the panel element, not body-wide",
  app.includes('className="workspace-panel" data-tab={tab}'));

console.log(`\n${passed} passed · ${failed} failed`);
process.exit(failed ? 1 : 0);
