#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { listWorkDirectory, readWorkFile, writeWorkFile } = require("../server/work-file-manager.cjs");
const { getWorkTerminalSession, runTypedWorkCommand, runWorkFileDiff } = require("../server/work-action-runner.cjs");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { inspectWorkEnvironment } = require("../server/work-environment-inspector.cjs");
const { assertWorkFolderGrant, grantWorkFolder, revokeWorkFolderGrant } = require("../server/work-folder-grants.cjs");
const { extractProjectDocument, searchProjectFiles } = require("../server/work-project-search.cjs");

async function rejectsWithStatus(action, statusCode) {
  await assert.rejects(action, (error) => error?.statusCode === statusCode);
}

async function main() {
  const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "luke-work-files-"));
  const root = path.join(sandbox, "project");
  try {
    await fs.mkdir(root);
    const secondRoot = path.join(sandbox, "second-project");
    await fs.mkdir(secondRoot);
    await fs.mkdir(path.join(root, "nested"));
    await fs.writeFile(path.join(root, "nested", "inside.txt"), "inside", "utf8");
    await fs.writeFile(path.join(root, "notes.txt"), "one\ntwo\nthree\n", "utf8");
    await fs.writeFile(path.join(root, "architecture.md"), "Authentication uses a project-scoped folder grant.\nThe retrieval index returns bounded chunks.", "utf8");
    await fs.writeFile(path.join(root, "binary.dat"), Buffer.from([65, 0, 66]));
    await fs.writeFile(path.join(sandbox, "secret.txt"), "outside", "utf8");
    await fs.symlink(path.join(sandbox, "secret.txt"), path.join(root, "escape.txt"));

    const projectGrant = grantWorkFolder({ projectId: "project-a", root });
    assert.equal(assertWorkFolderGrant({ projectId: "project-a", root, grantId: projectGrant.grantId }), await fs.realpath(root));
    await rejectsWithStatus(async () => assertWorkFolderGrant({ projectId: "project-b", root, grantId: projectGrant.grantId }), 403);
    await rejectsWithStatus(async () => assertWorkFolderGrant({ projectId: "project-a", root: secondRoot, grantId: projectGrant.grantId }), 403);
    revokeWorkFolderGrant({ projectId: "project-a", grantId: projectGrant.grantId });
    await rejectsWithStatus(async () => assertWorkFolderGrant({ projectId: "project-a", root, grantId: projectGrant.grantId }), 403);

    const opened = await readWorkFile({ root, filePath: "notes.txt" });
    const terminalSession = await getWorkTerminalSession({ root });
    assert.equal(terminalSession.cwd, await fs.realpath(root));
    assert.match(terminalSession.prompt, /project [>%$]$/);
    assert.match(terminalSession.changeDirectoryCommand, /^cd /);
    assert.equal(opened.content, "one\ntwo\nthree\n");
    const selectedEnvironment = await inspectWorkEnvironment({ sourceFolders: [root, secondRoot], activeRoot: secondRoot });
    assert.equal(selectedEnvironment.activeRoot, secondRoot);
    const rejectedSelection = await inspectWorkEnvironment({ sourceFolders: [root, secondRoot], activeRoot: sandbox });
    assert.equal(rejectedSelection.activeRoot, root);
    const nested = await listWorkDirectory({ root, directoryPath: "nested" });
    assert.equal(nested.path, "nested");
    assert.deepEqual(nested.entries.map((entry) => entry.path), ["nested/inside.txt"]);
    await rejectsWithStatus(() => listWorkDirectory({ root, directoryPath: ".." }), 400);
    await rejectsWithStatus(() => readWorkFile({ root, filePath: "../secret.txt" }), 400);
    await rejectsWithStatus(() => readWorkFile({ root, filePath: "escape.txt" }), 403);
    await rejectsWithStatus(() => readWorkFile({ root, filePath: "binary.dat" }), 415);
    const search = await searchProjectFiles({ root, query: "project scoped retrieval", limit: 4 });
    assert.equal(search.results[0].path, "architecture.md");
    assert.match(search.results[0].text, /folder grant/);
    const phraseSearch = await searchProjectFiles({ root, query: "retrieval index returns bounded chunks", limit: 4 });
    assert.equal(phraseSearch.results[0].path, "architecture.md");
    assert.ok(phraseSearch.results[0].score >= 20);
    const legacyDocText = await extractProjectDocument(Buffer.from("\u0000Project document retrieval\u0000", "utf16le"), ".doc");
    assert.match(legacyDocText, /Project document retrieval/);
    await fs.writeFile(path.join(root, "legacy.doc"), Buffer.from("\u0000Project document retrieval\u0000", "utf16le"));
    const documentPreview = await readWorkFile({ root, filePath: "legacy.doc" });
    assert.equal(documentPreview.readOnly, true);
    assert.equal(documentPreview.sourceFormat, "DOC");
    const JSZip = require(require.resolve("jszip", { paths: [path.join(__dirname, "../server")] }));
    const workbook = new JSZip();
    workbook.file("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    workbook.file("_rels/.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
    workbook.file("xl/workbook.xml", '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Roadmap" sheetId="1" r:id="rId1"/></sheets></workbook>');
    workbook.file("xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
    workbook.file("xl/worksheets/sheet1.xml", '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Milestone</t></is></c><c r="B1" t="inlineStr"><is><t>Project retrieval complete</t></is></c></row></sheetData></worksheet>');
    const workbookBuffer = await workbook.generateAsync({ type: "nodebuffer" });
    const workbookText = await extractProjectDocument(workbookBuffer, ".xlsx");
    assert.match(workbookText, /\[Sheet: Roadmap\]/);
    assert.match(workbookText, /Project retrieval complete/);
    const presentation = new JSZip();
    presentation.file("ppt/slides/slide2.xml", '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:t>Second slide</a:t></p:cSld></p:sld>');
    presentation.file("ppt/slides/slide1.xml", '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><a:t>Project &amp; presentation retrieval</a:t></p:cSld></p:sld>');
    const presentationBuffer = await presentation.generateAsync({ type: "nodebuffer" });
    const presentationText = await extractProjectDocument(presentationBuffer, ".pptx");
    assert.match(presentationText, /\[Slide 1\]\nProject & presentation retrieval/);
    assert.match(presentationText, /\[Slide 2\]\nSecond slide/);
    await rejectsWithStatus(() => writeWorkFile({ root, filePath: "notes.txt", content: "changed", approvalGranted: false }), 403);

    const future = new Date(Date.now() + 5000);
    await fs.utimes(path.join(root, "notes.txt"), future, future);
    await rejectsWithStatus(() => writeWorkFile({ root, filePath: "notes.txt", content: "stale", approvalGranted: true, expectedModifiedAt: opened.modifiedAt }), 409);
    assert.equal(await fs.readFile(path.join(root, "notes.txt"), "utf8"), "one\ntwo\nthree\n");

    const refreshed = await readWorkFile({ root, filePath: "notes.txt" });
    const saved = await writeWorkFile({ root, filePath: "notes.txt", content: "alpha\nbeta\ngamma", approvalGranted: true, expectedModifiedAt: refreshed.modifiedAt });
    assert.equal(saved.saved, true);
    assert.ok(saved.modifiedAt);
    assert.equal(await fs.readFile(path.join(root, "notes.txt"), "utf8"), "alpha\nbeta\ngamma");
    assert.equal((await runTypedWorkCommand({ root, command: "cat notes.txt" })).output, "alpha\nbeta\ngamma");
    assert.equal((await runTypedWorkCommand({ root, command: "head -n 2 notes.txt" })).output, "alpha\nbeta");
    assert.equal((await runTypedWorkCommand({ root, command: "tail -n 1 notes.txt" })).output, "gamma");
    await rejectsWithStatus(() => runTypedWorkCommand({ root, command: "cat ../secret.txt" }), 400);
    await rejectsWithStatus(() => runTypedWorkCommand({ root, command: "cat notes.txt | sh" }), 400);
    const run = promisify(execFile);
    await run("git", ["init"], { cwd: root });
    await run("git", ["add", "notes.txt"], { cwd: root });
    await run("git", ["-c", "user.name=LUKE Test", "-c", "user.email=test@example.invalid", "commit", "-m", "initial"], { cwd: root });
    await fs.writeFile(path.join(root, "notes.txt"), "alpha\nbeta\nchanged", "utf8");
    const diff = await runWorkFileDiff({ root, filePath: "notes.txt" });
    assert.match(diff.output, /# Unstaged/);
    assert.match(diff.output, /-gamma/);
    assert.match(diff.output, /\+changed/);
    await rejectsWithStatus(() => runWorkFileDiff({ root, filePath: "../secret.txt" }), 400);
    console.log("PASS: Work Files confines text reads and guarded atomic writes to the project root.");
    console.log("PASS: Work Terminal cat/head/tail remain parsed, read-only and shell-free.");
    console.log("PASS: Work folder grants are bound to one project and one canonical selected folder.");
    console.log("PASS: Project documents include bounded Excel workbook and PowerPoint slide extraction.");
  } finally {
    await fs.rm(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
