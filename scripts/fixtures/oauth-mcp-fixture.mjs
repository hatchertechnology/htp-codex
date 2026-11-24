#!/usr/bin/env node
// Cooperative loopback OAuth 2.0 + MCP fixture for Codex CLI host acceptance.
//
// Everything is synthetic and process-lifetime only: dynamic client
// registrations, authorization codes, access/refresh tokens and the served
// payloads are random or fixed test data. The server binds 127.0.0.1 only and
// never contacts any external service. It implements just enough of RFC 9728
// (protected-resource metadata), RFC 8414 (authorization-server metadata),
// RFC 7591 (dynamic client registration) and OAuth 2.0 authorization-code with
// PKCE S256 to let an ordinary Codex CLI client complete a login, discover a
// synthetic MCP tool catalog and log out.
//
// Environment:
//   FIXTURE_PORT      listen port; 0 (default) selects an ephemeral loopback port
//   FIXTURE_LOG       optional path for a JSONL request/event log (mode 0600)
//   FIXTURE_DECISION  approve (default) | deny | consent
//   FIXTURE_DENY_MCP  "1" makes the authenticated /mcp endpoint answer 403
//
// Endpoints (all under http://127.0.0.1:<port>):
//   GET  /.well-known/oauth-protected-resource[/...]  protected-resource metadata
//   GET  /.well-known/oauth-authorization-server      authorization-server metadata
//   POST /register                                    dynamic client registration
//   GET  /authorize                                   consent page (consent mode)
//   GET  /authorize/decision                          approve/deny completion
//   POST /token                                       authorization_code / refresh_token
//   POST /revoke                                      token revocation
//   ALL  /mcp                                         bearer-protected MCP endpoint
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";

let PORT = Number(process.env.FIXTURE_PORT || 0);
const LOG = process.env.FIXTURE_LOG || "";
const DECISION = process.env.FIXTURE_DECISION || "approve";
const DENY_MCP = process.env.FIXTURE_DENY_MCP === "1";

const randomSecret = (bytes = 24) => crypto.randomBytes(bytes).toString("base64url");
const baseUrl = () => `http://127.0.0.1:${PORT}`;

// Process-lifetime synthetic state only.
const clients = new Map();
const codes = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();

let logStream = null;
function logEvent(obj) {
  const line = JSON.stringify({ t: new Date().toISOString(), ...obj });
  if (LOG) {
    if (!logStream) logStream = fs.createWriteStream(LOG, { flags: "a", mode: 0o600 });
    logStream.write(line + "\n");
  }
  if (obj.event) process.stderr.write(`[fixture] ${obj.event}\n`);
}

function send(res, status, body, headers = {}) {
  const isText = typeof body === "string";
  res.writeHead(status, {
    "Content-Type": isText ? "text/html; charset=utf-8" : "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(isText ? body : JSON.stringify(body));
}

function protectedResourceMetadata() {
  return {
    resource: `${baseUrl()}/mcp`,
    authorization_servers: [baseUrl()],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
  };
}

function authServerMetadata() {
  return {
    issuer: baseUrl(),
    authorization_endpoint: `${baseUrl()}/authorize`,
    token_endpoint: `${baseUrl()}/token`,
    registration_endpoint: `${baseUrl()}/register`,
    revocation_endpoint: `${baseUrl()}/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseForm(body, contentType) {
  if ((contentType || "").includes("application/json")) {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(body));
}

function redirectAuthorization(params, decision, res) {
  if (!params.redirect_uri) return send(res, 400, { error: "invalid_request" });
  const target = new URL(params.redirect_uri);
  target.searchParams.set("state", params.state || "");
  if (decision === "deny") {
    target.searchParams.set("error", "access_denied");
    target.searchParams.set("error_description", "synthetic fixture denied");
    logEvent({ event: "authorize_denied" });
    res.writeHead(302, { Location: target.toString() });
    return res.end();
  }
  const code = "code-" + randomSecret(18);
  codes.set(code, {
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    scope: params.scope || "mcp",
    state: params.state,
  });
  target.searchParams.set("code", code);
  logEvent({ event: "authorize_approved" });
  res.writeHead(302, { Location: target.toString() });
  return res.end();
}

function consentPage(params) {
  const query = new URLSearchParams(params).toString();
  return `<!doctype html><html><head><meta charset="utf-8"><title>Consent</title></head>
<body><h1>Authorize access</h1>
<p><a id="approve" href="/authorize/decision?${query}&decision=approve">Approve</a></p>
<p><a id="deny" href="/authorize/decision?${query}&decision=deny">Deny</a></p>
</body></html>`;
}

const MCP_TOOLS = [
  {
    name: "hello_world_secured",
    description: "Authentication greeting for the synthetic fixture",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "synthetic_saved_read",
    description: "Synthetic saved-data read; site=denied returns a denied tool result",
    inputSchema: { type: "object", properties: { site: { type: "string" } } },
  },
];

function mcpResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, baseUrl());
  const path = url.pathname;
  logEvent({
    event: "request",
    method: req.method,
    path,
    hasAuth: Boolean(req.headers.authorization),
    query: [...url.searchParams.keys()],
  });

  if (path.startsWith("/.well-known/oauth-protected-resource")) {
    return send(res, 200, protectedResourceMetadata());
  }
  if (path === "/.well-known/oauth-authorization-server" || path === "/.well-known/openid-configuration") {
    return send(res, 200, authServerMetadata());
  }

  if (path === "/register" && req.method === "POST") {
    const body = parseForm(await readBody(req), req.headers["content-type"]);
    const clientId = "synthetic-" + randomSecret(12);
    clients.set(clientId, body);
    logEvent({ event: "client_registered", redirectUris: body.redirect_uris || [] });
    return send(res, 201, {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: body.redirect_uris || [],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  }

  if (path === "/authorize" && req.method === "GET") {
    const params = Object.fromEntries(url.searchParams);
    logEvent({ event: "authorize", clientId: params.client_id, hasChallenge: Boolean(params.code_challenge) });
    if (DECISION === "approve") return redirectAuthorization(params, "approve", res);
    if (DECISION === "deny") return redirectAuthorization(params, "deny", res);
    return send(res, 200, consentPage(params));
  }
  if (path === "/authorize/decision" && req.method === "GET") {
    const params = Object.fromEntries(url.searchParams);
    return redirectAuthorization(params, params.decision === "deny" ? "deny" : "approve", res);
  }

  if (path === "/token" && req.method === "POST") {
    const body = parseForm(await readBody(req), req.headers["content-type"]);
    if (body.grant_type === "refresh_token") {
      const record = refreshTokens.get(body.refresh_token);
      if (!record) return send(res, 400, { error: "invalid_grant" });
      const accessToken = "at-" + randomSecret(24);
      const refreshToken = "rt-" + randomSecret(24);
      accessTokens.set(accessToken, record);
      refreshTokens.set(refreshToken, record);
      logEvent({ event: "token_refreshed" });
      return send(res, 200, {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: refreshToken,
        scope: record.scope,
      });
    }
    if (body.grant_type !== "authorization_code") {
      return send(res, 400, { error: "unsupported_grant_type" });
    }
    const record = codes.get(body.code);
    if (!record) return send(res, 400, { error: "invalid_grant" });
    // The fixture does not persist the PKCE verifier; the host is the client
    // under test and the loopback flow is cooperative.
    codes.delete(body.code);
    const accessToken = "at-" + randomSecret(24);
    const refreshToken = "rt-" + randomSecret(24);
    accessTokens.set(accessToken, record);
    refreshTokens.set(refreshToken, record);
    logEvent({ event: "token_issued", hasVerifier: Boolean(body.code_verifier) });
    return send(res, 200, {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: record.scope,
    });
  }

  if (path === "/revoke" && req.method === "POST") {
    const body = parseForm(await readBody(req), req.headers["content-type"]);
    if (body.token) {
      accessTokens.delete(body.token);
      refreshTokens.delete(body.token);
    }
    logEvent({ event: "revoke_called", hasToken: Boolean(body.token) });
    return send(res, 200, {});
  }

  if (path === "/mcp") {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
    if (!match || !accessTokens.has(match[1])) {
      logEvent({ event: "mcp_unauthorized" });
      return send(res, 401, { error: "unauthorized" }, {
        "WWW-Authenticate": `Bearer resource_metadata="${baseUrl()}/.well-known/oauth-protected-resource/mcp"`,
      });
    }
    if (DENY_MCP) {
      logEvent({ event: "mcp_forbidden" });
      return send(res, 403, { error: "forbidden" });
    }
    if (req.method === "GET") {
      // A Streamable HTTP client may open an SSE stream; acknowledge and close.
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      return res.end();
    }
    if (req.method === "DELETE") return send(res, 204, "");
    let message = {};
    try {
      message = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, { error: "invalid_json" });
    }
    logEvent({ event: "mcp_authorized_call", rpcMethod: message.method });
    if (message.method === "initialize") {
      return send(res, 200, mcpResult(message.id, {
        protocolVersion: message.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "oauth-fixture", version: "0.0.1" },
      }));
    }
    if (message.method === "notifications/initialized") return send(res, 202, {});
    if (message.method === "tools/list") {
      return send(res, 200, mcpResult(message.id, { tools: MCP_TOOLS }));
    }
    if (message.method === "tools/call") {
      const name = message.params?.name;
      const args = message.params?.arguments || {};
      if (name === "synthetic_saved_read" && args.site === "denied") {
        logEvent({ event: "tool_denied", tool: name });
        return send(res, 200, mcpResult(message.id, {
          isError: true,
          content: [{ type: "text", text: "403 denied" }],
        }));
      }
      logEvent({ event: "tool_ok", tool: name });
      return send(res, 200, mcpResult(message.id, {
        content: [{ type: "text", text: "synthetic-ok" }],
        structuredContent: { ok: true, site: args.site || "owner" },
      }));
    }
    return send(res, 200, mcpResult(message.id, {}));
  }

  return send(res, 404, { error: "not_found", path });
});

server.listen(PORT, "127.0.0.1", () => {
  PORT = server.address().port;
  process.stdout.write(`FIXTURE_READY port=${PORT}\n`);
  logEvent({ event: "fixture_listening", port: PORT, decision: DECISION, denyMcp: DENY_MCP });
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    logEvent({ event: "fixture_stopping", signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  });
}
