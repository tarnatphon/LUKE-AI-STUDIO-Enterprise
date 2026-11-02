"use strict";

/**
 * A minimal Model Context Protocol surface over HTTP.
 *
 * LUKE already has an OpenAI-compatible /v1 and ~300 /api routes. MCP is the
 * third door: an editor or agent can ask "what can you do?" and then call a
 * tool without a bespoke integration. Only JSON-RPC methods that read state or
 * ask for a chat turn are exposed; no file, terminal or key management tool is
 * reachable here.
 *
 * Handlers are injected by serve.cjs so this module has no opinion about how a
 * turn is answered and can be unit-tested with stand-ins.
 */

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "luke-ai-studio", version: "1.0.0" };

function tools() {
  return [
    {
      name: "luke_status",
      description: "Read LUKE's online-surface policy and egress counters.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "luke_providers",
      description: "List the researched provider catalogue and which ones LUKE can call today.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "luke_chat",
      description: "Send one text turn through LUKE's free-only chain, falling back to the local model.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The user's message" },
          system: { type: "string", description: "Optional system prompt" },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
    {
      name: "luke_egress_report",
      description: "Return the air-gap attestation built from the Egress Ledger.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
  ];
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message, data = undefined) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function textResult(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

/**
 * `context` supplies: status(), catalog(), chat({message, system}),
 * egressReport(), and policy(). Any of them may be async.
 */
async function handleRpc(request, context = {}) {
  if (!request || typeof request !== "object" || request.jsonrpc !== "2.0") {
    return rpcError(null, -32600, "Invalid Request: jsonrpc must be \"2.0\".");
  }

  const id = request.id === undefined ? null : request.id;
  const method = String(request.method || "");
  const params = request.params && typeof request.params === "object" ? request.params : {};

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
  }
  if (method === "notifications/initialized" || method === "ping") {
    return rpcResult(id, {});
  }
  if (method === "tools/list") return rpcResult(id, { tools: tools() });

  if (method === "tools/call") {
    const name = String(params.name || "");
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};

    try {
      if (name === "luke_status") {
        return rpcResult(id, textResult(await context.status()));
      }
      if (name === "luke_providers") {
        return rpcResult(id, textResult(await context.catalog()));
      }
      if (name === "luke_egress_report") {
        return rpcResult(id, textResult(await context.egressReport()));
      }
      if (name === "luke_chat") {
        const message = String(args.message || "").trim();
        if (!message) return rpcError(id, -32602, "luke_chat needs a non-empty message.");
        const answer = await context.chat({
          message,
          system: String(args.system || "").trim(),
        });
        return rpcResult(id, textResult(answer));
      }
      return rpcError(id, -32601, `Unknown tool: ${name}`);
    } catch (error) {
      return rpcError(id, -32000, error instanceof Error ? error.message : String(error));
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`);
}

module.exports = {
  PROTOCOL_VERSION,
  SERVER_INFO,
  tools,
  handleRpc,
  rpcResult,
  rpcError,
};
