#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");

function read(relativePath) {
  return fs.readFileSync(
    path.join(root, relativePath),
    "utf8"
  );
}

function assertIncludes(content, marker, message) {
  if (!content.includes(marker)) {
    throw new Error(message);
  }
}

const api = read("app/frontend/src/services/api.js");
const server = read("scripts/server/serve.cjs");

assertIncludes(
  api,
  "function buildLlmResponseFormat(options = {})",
  "Frontend text chat API must expose a JSON output response format builder."
);

assertIncludes(
  api,
  "if (options.responseFormat)",
  "Frontend response format builder must preserve explicit responseFormat payloads."
);

assertIncludes(
  api,
  "!options.jsonSchema ||",
  "Frontend response format builder must keep JSON schema output opt-in."
);

assertIncludes(
  api,
  "typeof options.jsonSchema !== \"object\"",
  "Frontend response format builder must ignore non-object JSON schemas."
);

assertIncludes(
  api,
  "Array.isArray(options.jsonSchema)",
  "Frontend response format builder must ignore array JSON schemas."
);

assertIncludes(
  api,
  "function normalizeLlmJsonSchemaName(value)",
  "Frontend text chat API must normalize JSON schema names."
);

assertIncludes(
  api,
  ".replace(/[^A-Za-z0-9_-]+/g, \"_\")",
  "Frontend JSON schema names must be restricted to safe characters."
);

assertIncludes(
  api,
  ".slice(0, 64)",
  "Frontend JSON schema names must be capped at a safe length."
);

assertIncludes(
  api,
  "options.jsonSchema.name ||",
  "Frontend JSON schema response format must derive names from schema metadata."
);

assertIncludes(
  api,
  "options.jsonSchema.title",
  "Frontend JSON schema response format must support JSON Schema titles as names."
);

assertIncludes(
  api,
  "strict: options.jsonSchemaStrict !== false",
  "Frontend JSON schema response format must default to strict mode."
);

assertIncludes(
  api,
  "response_format: buildLlmResponseFormat(options)",
  "Frontend text chat API must forward built JSON output response formats."
);

assertIncludes(
  server,
  "LUKE_AI_JSON_OUTPUT_CORE_COMMANDS_V1",
  "Server JSON output core command marker is missing."
);

assertIncludes(
  server,
  "function normalizeLlmResponseFormat(value)",
  "Server must normalize JSON output response formats before runtime dispatch."
);

assertIncludes(
  server,
  "function normalizeLlmResponseFormatCandidate(primary, fallback)",
  "Server must normalize response format fallbacks independently."
);

assertIncludes(
  server,
  "const mode = normalizeLlmResponseFormatType(value);",
  "Server must support string response format modes."
);

assertIncludes(
  server,
  "const type = normalizeLlmResponseFormatType(value.type);",
  "Server must normalize object response format types."
);

assertIncludes(
  server,
  "typeof value !== \"object\" || Array.isArray(value)",
  "Server must ignore invalid response format payloads."
);

assertIncludes(
  server,
  "if (type === \"json_schema\")",
  "Server must handle JSON schema response formats explicitly."
);

assertIncludes(
  server,
  "isLlmResponseFormatObject(value.jsonSchema)",
  "Server must accept camelCase JSON schema response format metadata."
);

assertIncludes(
  server,
  "!Array.isArray(value)",
  "Server must validate response format objects reject arrays."
);

assertIncludes(
  server,
  "if (!schema)",
  "Server must ignore JSON schema response formats without an object schema."
);

assertIncludes(
  server,
  "function normalizeLlmJsonSchemaName(value)",
  "Server must normalize JSON schema names."
);

assertIncludes(
  server,
  "function isLlmResponseFormatObject(value)",
  "Server must share response format object validation."
);

assertIncludes(
  server,
  "function hasLlmResponseFormatSchemaField(value)",
  "Server must distinguish JSON schema wrappers from direct schemas."
);

assertIncludes(
  server,
  "function normalizeLlmResponseFormatType(value)",
  "Server must normalize response format type aliases."
);

assertIncludes(
  server,
  "type === \"json\" ? \"json_object\" : type",
  "Server must normalize json shorthand to json_object."
);

assertIncludes(
  server,
  "!hasLlmResponseFormatSchemaField(value.jsonSchema)",
  "Server must not treat invalid camelCase schema wrappers as direct schemas."
);

assertIncludes(
  server,
  "const schemaName =",
  "Server must derive a stable JSON schema response format name."
);

assertIncludes(
  server,
  "value.schema_name",
  "Server must support snake_case direct schema name hints."
);

assertIncludes(
  server,
  "value.schemaName",
  "Server must support camelCase direct schema name hints."
);

assertIncludes(
  server,
  "value.json_schema_name",
  "Server must support snake_case JSON schema name hints."
);

assertIncludes(
  server,
  "value.jsonSchemaName",
  "Server must support camelCase JSON schema name hints."
);

assertIncludes(
  server,
  "jsonSchema.title",
  "Server must support JSON schema wrapper titles as name hints."
);

assertIncludes(
  server,
  "schema.title",
  "Server must support JSON Schema titles as response format names."
);

assertIncludes(
  server,
  "name: normalizeLlmJsonSchemaName(schemaName)",
  "Server must normalize derived JSON schema response format names."
);

assertIncludes(
  server,
  "value.schema_strict !== false",
  "Server must support snake_case direct schema strict overrides."
);

assertIncludes(
  server,
  "value.schemaStrict !== false",
  "Server must support camelCase direct schema strict overrides."
);

assertIncludes(
  server,
  "value.json_schema_strict !== false",
  "Server must support snake_case JSON schema strict overrides."
);

assertIncludes(
  server,
  "value.jsonSchemaStrict !== false",
  "Server must support camelCase JSON schema strict overrides."
);

assertIncludes(
  server,
  "response_format: normalizeLlmResponseFormatCandidate(body.response_format, body.responseFormat)",
  "Server must forward normalized response_format to the local text runtime."
);

assertIncludes(
  server,
  "const responseFormat =",
  "Server text-runtime payloads must build a normalized response format."
);

assertIncludes(
  server,
  "payload.response_format =",
  "Server text-runtime payloads must forward normalized response formats."
);

assertIncludes(
  server,
  "response_format:\n            body.response_format",
  "Server text-runtime stream endpoint must accept response_format from requests."
);

assertIncludes(
  server,
  "async function streamMultiModelGeneration(",
  "Server must expose multi-model generation for JSON output forwarding."
);

assertIncludes(
  server,
  "options = {}\n)",
  "Server multi-model generation must accept response format options."
);

assertIncludes(
  server,
  "async function requestSingleModelGeneration(",
  "Server must route JSON output options to each multi-model runtime request."
);

assertIncludes(
  server,
  "async function streamAiJudgeSynthesis(",
  "Server must expose AI Judge synthesis for JSON output forwarding."
);

assertIncludes(
  server,
  "const normalizedResponseFormat =",
  "Server AI Judge synthesis must normalize response format payloads."
);

assertIncludes(
  server,
  "response_format:\n                    normalizedResponseFormat",
  "Server AI Judge synthesis must forward normalized response formats."
);

assertIncludes(
  server,
  "async function generateWithRuntimeRecovery(",
  "Server must expose Runtime Recovery for JSON output forwarding."
);

assertIncludes(
  server,
  "response_format = null",
  "Server Runtime Recovery must accept response format payloads."
);

assertIncludes(
  server,
  "response_format,\n                      responseFormat",
  "Server Runtime Recovery attempts must forward response formats."
);

console.log(
  "PASS: Frontend forwards JSON output response format options."
);

console.log(
  "PASS: Server normalizes JSON output response format commands."
);

console.log(
  "PASS: Server forwards JSON output response_format to local text runtime."
);

console.log(
  "PASS: Server forwards JSON output response_format through text-runtime streams."
);

console.log(
  "PASS: Server forwards JSON output response_format through multi-model streams."
);

console.log(
  "PASS: Server forwards JSON output response_format through AI Judge synthesis."
);

console.log(
  "PASS: Server forwards JSON output response_format through Runtime Recovery."
);

console.log(
  "PASS: Phase JSON Output Core Commands validation completed."
);
