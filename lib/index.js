import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as mcpClient from "@deepseek-ai/dsh-mcp-client";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/registry.ts
/**
* MCP server registry: the persisted list of managed MCP servers plus the
* mapping from a registry entry to a dsh-mcp-client plugin config.
*
* Storage: <dshHome>/mcp-manager/servers.json (shared across profiles; each
* running profile mounts its own fibers from the same list). Writes are
* atomic (tmp + rename) and best-effort chmod 0600 for secret-bearing env
* blocks.
*/
/** Validation constraint mirrored from dsh-mcp-client's serverName rule. */
const SERVER_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
/** Registry file location under the harness home. */
function registryPath() {
	return join(resolveDshHome(), "mcp-manager", "servers.json");
}
/** Registry error with a stable machine-readable code. */
var RegistryError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "RegistryError";
	}
};
function asStringArray(value, where) {
	if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new RegistryError("INVALID_ENTRY", `${where} must be an array of strings`);
	return [...value];
}
function asStringRecord(value, where) {
	if (typeof value !== "object" || value === null || Array.isArray(value) || Object.entries(value).some(([, v]) => typeof v !== "string")) throw new RegistryError("INVALID_ENTRY", `${where} must be an object with string values`);
	return { ...value };
}
/**
* Validate and normalize a (partial) server entry from an untrusted caller
* (model tool arguments or HTTP body). Returns the sanitized fields.
*/
function validateEntryInput(input) {
	if (typeof input !== "object" || input === null) throw new RegistryError("INVALID_ENTRY", "entry must be an object");
	const raw = input;
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (!SERVER_ID_RE.test(id)) throw new RegistryError("INVALID_ID", `id must match ${SERVER_ID_RE} (got ${JSON.stringify(id)})`);
	const transport = raw.transport;
	if (transport !== "stdio" && transport !== "streamable-http") throw new RegistryError("INVALID_ENTRY", "transport must be 'stdio' or 'streamable-http'");
	const out = {
		id,
		transport
	};
	if (raw.description !== void 0) {
		if (typeof raw.description !== "string") throw new RegistryError("INVALID_ENTRY", "description must be a string");
		out.description = raw.description;
	}
	if (raw.command !== void 0) {
		if (typeof raw.command !== "string" || raw.command === "") throw new RegistryError("INVALID_ENTRY", "command must be a non-empty string");
		out.command = raw.command;
	}
	if (raw.args !== void 0) out.args = asStringArray(raw.args, "args");
	if (raw.env !== void 0) out.env = asStringRecord(raw.env, "env");
	if (raw.cwd !== void 0) {
		if (typeof raw.cwd !== "string") throw new RegistryError("INVALID_ENTRY", "cwd must be a string");
		out.cwd = raw.cwd;
	}
	if (raw.url !== void 0) {
		if (typeof raw.url !== "string" || !/^https?:\/\//i.test(raw.url)) throw new RegistryError("INVALID_ENTRY", "url must be an http(s) URL");
		out.url = raw.url;
	}
	if (raw.headers !== void 0) out.headers = asStringRecord(raw.headers, "headers");
	if (raw.toolCallTimeoutMs !== void 0) {
		if (typeof raw.toolCallTimeoutMs !== "number" || !Number.isInteger(raw.toolCallTimeoutMs) || raw.toolCallTimeoutMs <= 0) throw new RegistryError("INVALID_ENTRY", "toolCallTimeoutMs must be a positive integer");
		out.toolCallTimeoutMs = raw.toolCallTimeoutMs;
	}
	if (raw.enabled !== void 0) {
		if (typeof raw.enabled !== "boolean") throw new RegistryError("INVALID_ENTRY", "enabled must be a boolean");
		out.enabled = raw.enabled;
	}
	if (transport === "stdio" && out.command === void 0) throw new RegistryError("INVALID_ENTRY", "stdio servers require command");
	if (transport === "streamable-http" && out.url === void 0) throw new RegistryError("INVALID_ENTRY", "streamable-http servers require url");
	return out;
}
/** Map a registry entry to the dsh-mcp-client plugin config. */
function toMcpConfig(entry) {
	const config = {
		serverName: entry.id,
		transport: entry.transport,
		failOnStartupError: false
	};
	if (entry.command !== void 0) config.command = entry.command;
	if (entry.args !== void 0) config.args = entry.args;
	if (entry.env !== void 0) config.env = entry.env;
	if (entry.cwd !== void 0) config.cwd = entry.cwd;
	if (entry.url !== void 0) config.url = entry.url;
	if (entry.headers !== void 0) config.headers = entry.headers;
	if (entry.toolCallTimeoutMs !== void 0) config.toolCallTimeoutMs = entry.toolCallTimeoutMs;
	return config;
}
/** Load the registry; a missing or corrupt file yields an empty list. */
async function loadRegistry(path) {
	let text;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return [];
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new RegistryError("CORRUPT_REGISTRY", `registry file ${path} is not valid JSON`);
	}
	const servers = parsed.servers;
	if (!Array.isArray(servers)) throw new RegistryError("CORRUPT_REGISTRY", `registry file ${path} must hold { servers: [...] }`);
	const entries = [];
	for (const item of servers) try {
		const clean = validateEntryInput(item);
		entries.push({
			...clean,
			enabled: clean.enabled ?? true,
			addedAt: typeof item.addedAt === "string" ? item.addedAt : (/* @__PURE__ */ new Date()).toISOString(),
			updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : (/* @__PURE__ */ new Date()).toISOString()
		});
	} catch {}
	return entries;
}
/** Atomically persist the registry. */
async function saveRegistry(path, servers) {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	const body = JSON.stringify({
		version: 1,
		servers
	}, null, 2) + "\n";
	await writeFile(tmp, body, {
		encoding: "utf8",
		mode: 384
	});
	try {
		await chmod(tmp, 384);
	} catch {}
	await rename(tmp, path);
}
//#endregion
//#region src/manager.ts
var McpManager = class {
	ctx;
	path;
	entries = [];
	fibers = /* @__PURE__ */ new Map();
	mountErrors = /* @__PURE__ */ new Map();
	toolNames = /* @__PURE__ */ new Map();
	rescanTimer;
	constructor(ctx) {
		this.ctx = ctx;
		this.path = registryPath();
		ctx.on("tools/change", () => this.scheduleRescan());
	}
	/** Load the registry and mount every enabled entry. */
	async init() {
		this.entries = await loadRegistry(this.path);
		for (const entry of [...this.entries]) if (entry.enabled) await this.mount(entry);
		this.rescan();
	}
	/** All servers with live status. */
	list() {
		return this.entries.map((entry) => this.viewOf(entry));
	}
	/** One server's detailed view, or undefined. */
	get(id) {
		const entry = this.entries.find((e) => e.id === id);
		return entry === void 0 ? void 0 : this.viewOf(entry);
	}
	/** Add a server; mounts it immediately unless disabled. */
	async add(input) {
		const clean = validateEntryInput(input);
		if (this.entries.some((e) => e.id === clean.id)) throw new RegistryError("DUPLICATE_ID", `server ${clean.id} already exists`);
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const entry = {
			...clean,
			enabled: clean.enabled ?? true,
			addedAt: now,
			updatedAt: now
		};
		this.entries.push(entry);
		await this.persist();
		if (entry.enabled) await this.mount(entry);
		return this.viewOf(entry);
	}
	/** Patch a server's config; remounts it when enabled or config changed. */
	async update(input) {
		if (typeof input !== "object" || input === null) throw new RegistryError("INVALID_ENTRY", "update must be an object with id");
		const raw = input;
		const id = typeof raw.id === "string" ? raw.id : "";
		const entry = this.entries.find((e) => e.id === id);
		if (entry === void 0) throw new RegistryError("NOT_FOUND", `server ${id || JSON.stringify(raw.id)} does not exist`);
		const clean = validateEntryInput({
			...raw,
			id: entry.id,
			transport: raw.transport === void 0 ? entry.transport : raw.transport
		});
		const next = {
			...entry,
			...clean,
			enabled: clean.enabled ?? entry.enabled,
			updatedAt: (/* @__PURE__ */ new Date()).toISOString()
		};
		const changedMountRelevant = JSON.stringify(toMcpConfig(entry)) !== JSON.stringify(toMcpConfig(next));
		const index = this.entries.indexOf(entry);
		this.entries[index] = next;
		await this.persist();
		if (changedMountRelevant || clean.enabled !== void 0) {
			await this.unmount(next.id);
			if (next.enabled) await this.mount(next);
		}
		return this.viewOf(next);
	}
	/** Enable/disable without touching config. */
	async setEnabled(id, enabled) {
		const entry = this.entries.find((e) => e.id === id);
		if (entry === void 0) throw new RegistryError("NOT_FOUND", `server ${id} does not exist`);
		if (typeof enabled !== "boolean") throw new RegistryError("INVALID_ENTRY", "enabled must be a boolean");
		if (entry.enabled === enabled) return this.viewOf(entry);
		entry.enabled = enabled;
		entry.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
		await this.persist();
		if (enabled) await this.mount(entry);
		else await this.unmount(id);
		return this.viewOf(entry);
	}
	/** Remove a server and unmount it. */
	async remove(id) {
		const entry = this.entries.find((e) => e.id === id);
		if (entry === void 0) throw new RegistryError("NOT_FOUND", `server ${id} does not exist`);
		await this.unmount(id);
		this.entries.splice(this.entries.indexOf(entry), 1);
		await this.persist();
	}
	viewOf(entry) {
		const tools = entry.enabled ? this.toolNames.get(entry.id) ?? [] : [];
		const error = this.mountErrors.get(entry.id);
		const status = !entry.enabled ? "disabled" : error !== void 0 ? "error" : tools.length > 0 ? "ready" : "starting";
		const view = {
			...entry,
			status,
			toolNames: tools
		};
		if (error !== void 0) view.error = error;
		if (view.env !== void 0) view.env = redact(view.env);
		if (view.headers !== void 0) view.headers = redact(view.headers);
		return view;
	}
	async mount(entry) {
		await this.unmount(entry.id);
		this.mountErrors.delete(entry.id);
		this.toolNames.delete(entry.id);
		const config = toMcpConfig(entry);
		this.ctx.logger.info(`mcp-manager: mounting server %C as %s`, entry.id, config.transport);
		try {
			const fiber = this.ctx.plugin(mcpClient, config);
			this.fibers.set(entry.id, fiber);
			Promise.resolve(fiber).then(() => {
				this.scheduleRescan();
			}, (error) => {
				this.mountErrors.set(entry.id, String(error));
				this.ctx.logger.error(`mcp-manager: server %C failed to start: %s`, entry.id, String(error));
				this.scheduleRescan();
			});
		} catch (error) {
			this.mountErrors.set(entry.id, String(error));
			this.ctx.logger.error(`mcp-manager: server %C failed to mount: %s`, entry.id, String(error));
		}
	}
	async unmount(id) {
		const fiber = this.fibers.get(id);
		if (fiber === void 0) return;
		this.fibers.delete(id);
		try {
			await fiber.dispose();
		} catch (error) {
			this.ctx.logger.warn(`mcp-manager: unmounting server %C failed: %s`, id, String(error));
		}
		this.toolNames.delete(id);
	}
	/** Recompute per-server tool lists from the global tools registry. */
	rescan() {
		const names = [];
		try {
			const schemas = this.ctx.tools.schemas();
			for (const schema of schemas) if (typeof schema.name === "string" && schema.name.startsWith("mcp__")) names.push(schema.name);
		} catch {
			return;
		}
		const byServer = /* @__PURE__ */ new Map();
		for (const name of names) {
			const server = name.split("__")[1];
			if (server === void 0) continue;
			const list = byServer.get(server);
			if (list === void 0) byServer.set(server, [name]);
			else list.push(name);
		}
		for (const id of this.fibers.keys()) this.toolNames.set(id, byServer.get(id) ?? []);
		for (const [id, tools] of byServer) if (tools.length > 0) this.mountErrors.delete(id);
	}
	scheduleRescan() {
		if (this.rescanTimer !== void 0) return;
		this.rescanTimer = setTimeout(() => {
			this.rescanTimer = void 0;
			try {
				this.rescan();
			} catch {}
		}, 500);
	}
	async persist() {
		await saveRegistry(this.path, this.entries);
	}
};
/** Mask secret-shaped values for projections (GUI, model output). */
function redact(record) {
	const out = {};
	for (const [key, value] of Object.entries(record)) out[key] = /KEY|PASSWORD|SECRET|TOKEN/i.test(key) ? `${"*".repeat(8)} (set)` : value;
	return out;
}
//#endregion
//#region src/tools.ts
/** Project a server view for model output (compact, stable field order). */
function project(server) {
	const out = {
		id: server.id,
		transport: server.transport,
		enabled: server.enabled,
		status: server.status,
		toolCount: server.toolNames.length,
		tools: server.toolNames
	};
	if (server.description !== void 0) out.description = server.description;
	if (server.command !== void 0) {
		out.command = server.command;
		if (server.args !== void 0) out.args = server.args;
	}
	if (server.url !== void 0) out.url = server.url;
	if (server.error !== void 0) out.error = server.error;
	return out;
}
const idParam = {
	type: "string",
	required: true,
	description: "Server id (namespace); tools appear as mcp__<id>__<tool>. [A-Za-z0-9_-]{1,32}"
};
const entryParams = {
	id: idParam,
	transport: {
		type: "string",
		required: true,
		description: "'stdio' (local command) or 'streamable-http' (HTTP endpoint)"
	},
	command: {
		type: "string",
		description: "stdio: executable to spawn, e.g. npx. Required for stdio."
	},
	args: {
		type: "array",
		items: { type: "string" },
		description: "stdio: arguments passed to the command."
	},
	env: {
		type: "object",
		additionalProperties: true,
		description: "stdio: extra environment variables (string values), e.g. API tokens."
	},
	cwd: {
		type: "string",
		description: "stdio: working directory."
	},
	url: {
		type: "string",
		description: "streamable-http: endpoint URL. Required for streamable-http."
	},
	headers: {
		type: "object",
		additionalProperties: true,
		description: "streamable-http: extra request headers (string values)."
	},
	toolCallTimeoutMs: {
		type: "integer",
		description: "Per tool-call timeout in ms (default 60000)."
	},
	description: {
		type: "string",
		description: "Optional human-facing note about this server."
	}
};
const jsonOutput = {
	schema: { type: "json" },
	render: (_args, value) => [{
		type: "text",
		text: JSON.stringify(value, null, 2)
	}]
};
/** Register the management tools; call inside `ctx.inject(['tools'], ...)`. */
function registerManagerTools(ctx, manager) {
	const wrap = (fn) => async (args) => {
		try {
			return await fn(args);
		} catch (error) {
			const code = error instanceof RegistryError ? ` (${error.code})` : "";
			throw new Error(`${error instanceof Error ? error.message : String(error)}${code}`);
		}
	};
	ctx.tools.register(defineTool({
		name: "mcp_list",
		description: "List all managed MCP servers with live status (enabled/disabled, ready/starting/error) and the tools each server currently provides. Use this before other mcp_* tools.",
		parameters: {},
		output: jsonOutput,
		execute: wrap(async () => ({ servers: manager.list().map(project) }))
	}));
	ctx.tools.register(defineTool({
		name: "mcp_status",
		description: "Show one managed MCP server in detail: config (secrets redacted), status, and discovered tool names. Pass no id to get every server.",
		parameters: { id: {
			type: "string",
			description: "Optional server id; omit for all servers."
		} },
		output: jsonOutput,
		execute: wrap(async (args) => {
			if (args.id === void 0 || args.id === "") return { servers: manager.list().map(project) };
			const server = manager.get(args.id);
			if (server === void 0) throw new Error(`server ${args.id} does not exist (NOT_FOUND)`);
			return { server: project(server) };
		})
	}));
	ctx.tools.register(defineTool({
		name: "mcp_add",
		description: "Add and mount a new MCP server. stdio servers need command (e.g. npx with args like [\"-y\",\"@modelcontextprotocol/server-filesystem\",\"/tmp\"]); streamable-http servers need url. The server connects immediately and its tools appear as mcp__<id>__<tool>.",
		parameters: entryParams,
		output: jsonOutput,
		execute: wrap(async (args) => ({ added: project(await manager.add(args)) }))
	}));
	ctx.tools.register(defineTool({
		name: "mcp_update",
		description: "Update an existing MCP server's config (command/args/env/url/headers/description/enabled...). The server is remounted with the new config; secrets previously set via env/headers are redacted in output, resend full env/headers to replace them.",
		parameters: {
			id: {
				...idParam,
				description: "Id of the server to update."
			},
			command: entryParams.command,
			args: entryParams.args,
			env: entryParams.env,
			cwd: entryParams.cwd,
			url: entryParams.url,
			headers: entryParams.headers,
			toolCallTimeoutMs: entryParams.toolCallTimeoutMs,
			description: entryParams.description
		},
		output: jsonOutput,
		execute: wrap(async (args) => ({ updated: project(await manager.update(args)) }))
	}));
	ctx.tools.register(defineTool({
		name: "mcp_remove",
		description: "Remove an MCP server: unmounts it (its tools disappear) and deletes it from the persisted registry.",
		parameters: { id: idParam },
		output: jsonOutput,
		execute: wrap(async (args) => {
			await manager.remove(args.id);
			return { removed: args.id };
		})
	}));
	ctx.tools.register(defineTool({
		name: "mcp_set_enabled",
		description: "Enable or disable an MCP server without deleting it. Disabled servers stay configured but are unmounted (tools disappear); enabling remounts them.",
		parameters: {
			id: idParam,
			enabled: {
				type: "boolean",
				required: true,
				description: "true to mount, false to unmount."
			}
		},
		output: jsonOutput,
		execute: wrap(async (args) => ({ server: project(await manager.setEnabled(args.id, args.enabled)) }))
	}));
}
//#endregion
//#region src/http.ts
const MAX_BODY_BYTES = 1048576;
function sendJson(response, status, body) {
	response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	response.end(JSON.stringify(body));
}
async function readJson(request) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) throw new Error("request body too large");
		chunks.push(chunk);
	}
	if (chunks.length === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function statusOf(error) {
	if (error instanceof RegistryError) {
		if (error.code === "NOT_FOUND") return 404;
		if (error.code === "DUPLICATE_ID") return 409;
	}
	return 400;
}
/**
* Mount the manager API routes. Call inside `ctx.inject(['webServer'], ...)`.
*/
function mountManagerRoutes(ctx, manager) {
	const webServer = ctx.webServer;
	const wrap = (handler) => async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", "http://localhost");
			if (request.method !== "GET" && request.method !== "POST") {
				sendJson(response, 405, { error: "method not allowed" });
				return;
			}
			sendJson(response, 200, await handler(request.method === "GET" ? void 0 : await readJson(request), url));
		} catch (error) {
			sendJson(response, statusOf(error), { error: error instanceof Error ? error.message : String(error) });
		}
	};
	webServer.register({
		kind: "exact",
		path: "/mcp-manager/api/servers",
		handler: wrap(async () => ({ servers: manager.list() }))
	});
	webServer.register({
		kind: "exact",
		path: "/mcp-manager/api/servers/add",
		handler: wrap(async (body) => ({ server: await manager.add(body) }))
	});
	webServer.register({
		kind: "exact",
		path: "/mcp-manager/api/servers/update",
		handler: wrap(async (body) => ({ server: await manager.update(body) }))
	});
	webServer.register({
		kind: "exact",
		path: "/mcp-manager/api/servers/enabled",
		handler: wrap(async (body) => {
			const { id, enabled } = body ?? {};
			if (typeof id !== "string" || typeof enabled !== "boolean") throw new Error("id (string) and enabled (boolean) are required");
			return { server: await manager.setEnabled(id, enabled) };
		})
	});
	webServer.register({
		kind: "exact",
		path: "/mcp-manager/api/servers/remove",
		handler: wrap(async (body) => {
			const { id } = body ?? {};
			if (typeof id !== "string") throw new Error("id (string) is required");
			await manager.remove(id);
			return { removed: id };
		})
	});
	ctx.logger.info("mcp-manager: api routes mounted at /mcp-manager/api/servers");
}
//#endregion
//#region src/index.ts
const name = "dsh-mcp-manager";
const inject = ["tools"];
function trace(tag, detail) {
	const dir = process.env.DSH_MCP_MANAGER_TRACE;
	if (dir === void 0 || dir === "") return;
	try {
		appendFileSync(join(dir, ".mcp-manager-trace.log"), `${(/* @__PURE__ */ new Date()).toISOString()} [${tag}] ${detail === void 0 ? "" : String(detail)}\n`);
	} catch {}
}
function apply(ctx, _config = {}) {
	trace("apply:start");
	try {
		const manager = new McpManager(ctx);
		registerManagerTools(ctx, manager);
		trace("tools:registered");
		ctx.inject(["webServer"], (webCtx) => {
			trace("webServer:inject-fired");
			try {
				mountManagerRoutes(webCtx, manager);
				trace("routes:mounted");
			} catch (error) {
				trace("routes:error", error);
				throw error;
			}
		});
		manager.init().then(() => trace("init:done"), (error) => {
			trace("init:error", error);
			ctx.logger.error(`mcp-manager: failed to load registry: %s`, String(error));
		});
	} catch (error) {
		trace("apply:error", error);
		throw error;
	}
}
//#endregion
export { apply, inject, name };

//# sourceMappingURL=index.js.map