window.__ModuleLoader__.load({ id: "dsh-mcp-manager", factory: (require) => {
var module = { exports: {} };
var exports = module.exports;

Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let react = require("react");
let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
let react_jsx_runtime = require("react/jsx-runtime");
//#region src/client/locales.ts
/** Locale dictionaries for the MCP manager panel. */
const zh = {
	nav: "MCP 服务器",
	subtitle: "管理挂载到本 Harness 的 MCP 服务器:增删改查、启停与状态监控。",
	refresh: "刷新",
	addServer: "添加服务器",
	edit: "编辑",
	remove: "删除",
	removeConfirm: "删除该服务器?",
	enable: "启用",
	disable: "停用",
	save: "保存",
	cancel: "取消",
	id: "ID",
	idHint: "工具命名空间,工具将以 mcp__<id>__<工具名> 出现",
	transport: "传输方式",
	description: "备注",
	command: "命令",
	args: "参数",
	argsHint: "JSON 数组,如 [\"-y\",\"@modelcontextprotocol/server-filesystem\",\"/tmp\"]",
	env: "环境变量",
	envHint: "JSON 对象,值为字符串",
	cwd: "工作目录",
	url: "URL",
	headers: "请求头",
	headersHint: "JSON 对象,值为字符串",
	toolCallTimeoutMs: "调用超时 (ms)",
	status: "状态",
	tools: "工具",
	empty: "还没有 MCP 服务器。点击「添加服务器」开始。",
	statusReady: "已就绪",
	statusStarting: "连接中 / 暂无工具",
	statusDisabled: "已停用",
	statusError: "错误",
	loading: "加载中…",
	loadFailed: "加载失败",
	stdioHint: "本地命令 (stdio)",
	httpHint: "HTTP 端点 (Streamable HTTP)"
};
const en = {
	nav: "MCP Servers",
	subtitle: "Manage MCP servers mounted into this harness: add/remove/edit, enable/disable, and monitor status.",
	refresh: "Refresh",
	addServer: "Add server",
	edit: "Edit",
	remove: "Remove",
	removeConfirm: "Remove this server?",
	enable: "Enable",
	disable: "Disable",
	save: "Save",
	cancel: "Cancel",
	id: "ID",
	idHint: "Tool namespace; tools appear as mcp__<id>__<tool>",
	transport: "Transport",
	description: "Description",
	command: "Command",
	args: "Args",
	argsHint: "JSON array, e.g. [\"-y\",\"@modelcontextprotocol/server-filesystem\",\"/tmp\"]",
	env: "Env",
	envHint: "JSON object with string values",
	cwd: "Working directory",
	url: "URL",
	headers: "Headers",
	headersHint: "JSON object with string values",
	toolCallTimeoutMs: "Call timeout (ms)",
	status: "Status",
	tools: "Tools",
	empty: "No MCP servers yet. Click \"Add server\" to start.",
	statusReady: "Ready",
	statusStarting: "Connecting / no tools",
	statusDisabled: "Disabled",
	statusError: "Error",
	loading: "Loading…",
	loadFailed: "Failed to load",
	stdioHint: "Local command (stdio)",
	httpHint: "HTTP endpoint (Streamable HTTP)"
};
//#endregion
//#region src/client/api.ts
/** Resolve an API path against the page the UI is served from. */
function api(path) {
	const relative = path.replace(/^\/+/, "");
	if (typeof document === "undefined") return `/${relative}`;
	return new URL(relative, document.baseURI).pathname;
}
async function call(path, init) {
	const response = await fetch(api(path), {
		...init,
		headers: {
			"content-type": "application/json",
			...init?.headers ?? {}
		}
	});
	let body;
	try {
		body = await response.json();
	} catch {
		throw new Error(`${response.status} ${response.statusText}`);
	}
	if (!response.ok) {
		const message = body.error;
		throw new Error(message ?? `${response.status} ${response.statusText}`);
	}
	return body;
}
async function fetchServers() {
	return (await call("mcp-manager/api/servers")).servers;
}
async function addServer(entry) {
	return (await call("mcp-manager/api/servers/add", {
		method: "POST",
		body: JSON.stringify(entry)
	})).server;
}
async function updateServer(patch) {
	return (await call("mcp-manager/api/servers/update", {
		method: "POST",
		body: JSON.stringify(patch)
	})).server;
}
async function setServerEnabled(id, enabled) {
	return (await call("mcp-manager/api/servers/enabled", {
		method: "POST",
		body: JSON.stringify({
			id,
			enabled
		})
	})).server;
}
async function removeServer(id) {
	await call("mcp-manager/api/servers/remove", {
		method: "POST",
		body: JSON.stringify({ id })
	});
}
/** Parse a JSON object/array field from form text; '' → undefined. */
function parseJsonField(text) {
	const trimmed = text.trim();
	if (trimmed === "") return void 0;
	return JSON.parse(trimmed);
}
//#endregion
//#region src/client/McpSection.tsx
/**
* The MCP manager settings section: server table with live status,
* add/edit form, enable/disable and remove.
*/
const EMPTY_FORM = {
	id: "",
	transport: "stdio",
	description: "",
	command: "",
	args: "",
	env: "",
	cwd: "",
	url: "",
	headers: "",
	toolCallTimeoutMs: ""
};
function formFromServer(server) {
	return {
		id: server.id,
		transport: server.transport,
		description: server.description ?? "",
		command: server.command ?? "",
		args: server.args === void 0 ? "" : JSON.stringify(server.args),
		env: server.env === void 0 ? "" : JSON.stringify(server.env),
		cwd: server.cwd ?? "",
		url: server.url ?? "",
		headers: server.headers === void 0 ? "" : JSON.stringify(server.headers),
		toolCallTimeoutMs: server.toolCallTimeoutMs === void 0 ? "" : String(server.toolCallTimeoutMs)
	};
}
function entryFromForm(form, editing) {
	const entry = {
		transport: form.transport,
		description: form.description.trim() === "" ? void 0 : form.description.trim()
	};
	if (editing) entry.id = form.id;
	else entry.id = form.id.trim();
	if (form.transport === "stdio") {
		entry.command = form.command.trim() === "" ? void 0 : form.command.trim();
		const args = parseJsonField(form.args);
		if (args !== void 0) entry.args = args;
		const env = parseJsonField(form.env);
		if (env !== void 0) entry.env = env;
		if (form.cwd.trim() !== "") entry.cwd = form.cwd.trim();
	} else {
		entry.url = form.url.trim() === "" ? void 0 : form.url.trim();
		const headers = parseJsonField(form.headers);
		if (headers !== void 0) entry.headers = headers;
	}
	if (form.toolCallTimeoutMs.trim() !== "") entry.toolCallTimeoutMs = Number(form.toolCallTimeoutMs.trim());
	return entry;
}
function statusMeta(server, t) {
	switch (server.status) {
		case "ready": return {
			dot: "done",
			label: t("statusReady")
		};
		case "starting": return {
			dot: "ongoing",
			label: t("statusStarting")
		};
		case "error": return {
			dot: "error",
			label: t("statusError")
		};
		default: return {
			dot: null,
			label: t("statusDisabled")
		};
	}
}
function endpointOf(server) {
	if (server.transport === "stdio") {
		const base = server.command ?? "";
		const tail = (server.args ?? []).slice(0, 2).join(" ");
		return tail === "" ? base : `${base} ${tail}`;
	}
	return server.url ?? "";
}
function McpSection({ t }) {
	const [servers, setServers] = (0, react.useState)(null);
	const [error, setError] = (0, react.useState)(null);
	const [busy, setBusy] = (0, react.useState)(false);
	const [editing, setEditing] = (0, react.useState)(null);
	const [form, setForm] = (0, react.useState)(EMPTY_FORM);
	const [formError, setFormError] = (0, react.useState)(null);
	const [confirmRemove, setConfirmRemove] = (0, react.useState)(null);
	const [expanded, setExpanded] = (0, react.useState)(/* @__PURE__ */ new Set());
	const serversRef = (0, react.useRef)(null);
	serversRef.current = servers;
	const refresh = (0, react.useCallback)(async () => {
		try {
			const next = await fetchServers();
			setError(null);
			setServers(next);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}, []);
	(0, react.useEffect)(() => {
		refresh();
		const timer = setInterval(() => {
			refresh();
		}, 5e3);
		return () => clearInterval(timer);
	}, [refresh]);
	const beginAdd = () => {
		setForm(EMPTY_FORM);
		setFormError(null);
		setEditing({ mode: "add" });
	};
	const beginEdit = (server) => {
		setForm(formFromServer(server));
		setFormError(null);
		setEditing({ mode: "edit" });
	};
	const submit = async () => {
		if (busy) return;
		setBusy(true);
		setFormError(null);
		try {
			if (editing?.mode === "add") await addServer(entryFromForm(form, false));
			else if (editing?.mode === "edit") await updateServer(entryFromForm(form, true));
			setEditing(null);
			await refresh();
		} catch (e) {
			setFormError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};
	const toggleEnabled = async (server) => {
		if (busy) return;
		setBusy(true);
		try {
			await setServerEnabled(server.id, !server.enabled);
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};
	const doRemove = async (id) => {
		if (busy) return;
		setBusy(true);
		try {
			await removeServer(id);
			setConfirmRemove(null);
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};
	const toggleExpanded = (id) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};
	const field = (key) => ({
		value: form[key],
		onChange: (e) => setForm((f) => ({
			...f,
			[key]: e.target.value
		}))
	});
	const rows = (0, react.useMemo)(() => servers ?? [], [servers]);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		style: {
			display: "flex",
			flexDirection: "column",
			gap: 12,
			padding: "4px 0"
		},
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					display: "flex",
					alignItems: "center",
					gap: 8
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						style: {
							flex: 1,
							opacity: .8,
							fontSize: 13
						},
						children: t("subtitle")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						size: "sm",
						onClick: () => {
							refresh();
						},
						children: t("refresh")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "primary",
						size: "sm",
						disabled: editing !== null,
						onClick: beginAdd,
						children: t("addServer")
					})
				]
			}),
			error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				role: "alert",
				style: {
					color: "var(--dsw-danger, #d13438)",
					fontSize: 13
				},
				children: [
					t("loadFailed"),
					": ",
					error
				]
			}),
			editing === null && rows.length === 0 && servers !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					opacity: .7,
					fontSize: 13,
					padding: "12px 0"
				},
				children: t("empty")
			}),
			servers === null && error === null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					opacity: .7,
					fontSize: 13
				},
				children: t("loading")
			}),
			rows.map((server) => {
				const meta = statusMeta(server, t);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						border: "1px solid var(--dsw-border, rgba(128,128,128,.35))",
						borderRadius: 8,
						padding: "8px 12px",
						display: "flex",
						flexDirection: "column",
						gap: 8
					},
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: {
								display: "flex",
								alignItems: "center",
								gap: 8,
								flexWrap: "wrap"
							},
							children: [
								meta.dot !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: meta.dot }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
									style: { fontSize: 14 },
									children: server.id
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
									active: false,
									children: server.transport === "stdio" ? "stdio" : "http"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										opacity: .75,
										fontSize: 12,
										flex: 1,
										minWidth: 120,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap"
									},
									children: endpointOf(server)
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										fontSize: 12,
										opacity: .85
									},
									children: [meta.label, server.toolNames.length > 0 ? ` · ${server.toolNames.length} ${t("tools")}` : ""]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									disabled: busy,
									onClick: () => {
										toggleEnabled(server);
									},
									children: server.enabled ? t("disable") : t("enable")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									onClick: () => beginEdit(server),
									children: t("edit")
								}),
								confirmRemove === server.id ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: {
										display: "inline-flex",
										gap: 4,
										alignItems: "center",
										fontSize: 12
									},
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("removeConfirm") }),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "primary",
											size: "sm",
											disabled: busy,
											onClick: () => {
												doRemove(server.id);
											},
											children: t("remove")
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
											variant: "ghost",
											size: "sm",
											onClick: () => setConfirmRemove(null),
											children: t("cancel")
										})
									]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "ghost",
									size: "sm",
									onClick: () => setConfirmRemove(server.id),
									children: t("remove")
								})
							]
						}),
						server.error !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							role: "alert",
							style: {
								fontSize: 12,
								color: "var(--dsw-danger, #d13438)"
							},
							children: server.error
						}),
						server.toolNames.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DisclosureRow, {
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconDatabaseOutlineMedium, {}),
							title: `${t("tools")} (${server.toolNames.length})`,
							expandable: true,
							open: expanded.has(server.id),
							onToggle: () => toggleExpanded(server.id),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ul", {
								style: {
									margin: "4px 0 0",
									paddingInlineStart: 20,
									fontSize: 12,
									opacity: .85
								},
								children: server.toolNames.map((name) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("li", { children: name }, name))
							})
						})
					]
				}, server.id);
			}),
			editing !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					border: "1px solid var(--dsw-border, rgba(128,128,128,.35))",
					borderRadius: 8,
					padding: 12,
					display: "flex",
					flexDirection: "column",
					gap: 8
				},
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 8,
							alignItems: "center"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							style: {
								fontSize: 14,
								fontWeight: 600
							},
							children: editing.mode === "add" ? t("addServer") : `${t("edit")}: ${form.id}`
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							style: {
								display: "inline-flex",
								gap: 4
							},
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
								active: form.transport === "stdio",
								onClick: () => setForm((f) => ({
									...f,
									transport: "stdio"
								})),
								children: "stdio"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Pill, {
								active: form.transport === "streamable-http",
								onClick: () => setForm((f) => ({
									...f,
									transport: "streamable-http"
								})),
								children: "streamable-http"
							})]
						})]
					}),
					editing.mode === "add" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 4,
							fontSize: 12
						},
						children: [
							t("id"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								placeholder: "github",
								...field("id")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { opacity: .65 },
								children: t("idHint")
							})
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 4,
							fontSize: 12
						},
						children: [t("description"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, { ...field("description") })]
					}),
					form.transport === "stdio" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 4,
								fontSize: 12
							},
							children: [t("command"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								placeholder: "npx",
								...field("command")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 4,
								fontSize: 12
							},
							children: [
								t("args"),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									placeholder: "[\"-y\",\"@modelcontextprotocol/server-filesystem\",\"/tmp\"]",
									...field("args")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { opacity: .65 },
									children: t("argsHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 4,
								fontSize: 12
							},
							children: [
								t("env"),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
									placeholder: "{\"GITHUB_TOKEN\":\"ghp_...\"}",
									...field("env")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: { opacity: .65 },
									children: t("envHint")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: 4,
								fontSize: 12
							},
							children: [t("cwd"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, { ...field("cwd") })]
						})
					] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 4,
							fontSize: 12
						},
						children: [t("url"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							placeholder: "http://localhost:3000/mcp",
							...field("url")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 4,
							fontSize: 12
						},
						children: [
							t("headers"),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
								placeholder: "{\"Authorization\":\"Bearer ...\"}",
								...field("headers")
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: { opacity: .65 },
								children: t("headersHint")
							})
						]
					})] }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 4,
							fontSize: 12
						},
						children: [t("toolCallTimeoutMs"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Input, {
							placeholder: "60000",
							inputMode: "numeric",
							...field("toolCallTimeoutMs")
						})]
					}),
					formError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						role: "alert",
						style: {
							color: "var(--dsw-danger, #d13438)",
							fontSize: 12
						},
						children: formError
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							display: "flex",
							gap: 8,
							justifyContent: "flex-end"
						},
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							onClick: () => setEditing(null),
							children: t("cancel")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							size: "sm",
							disabled: busy,
							onClick: () => {
								submit();
							},
							children: t("save")
						})]
					})
				]
			})
		]
	});
}
//#endregion
//#region src/client/index.ts
/**
* dsh-mcp-manager client: registers the "MCP Servers" settings section.
* Built by tsdown into the __ModuleLoader__ factory bundle at
* client/client.js; react and dsh-client-ui-primitives resolve from the
* frozen platform module table as externals.
*/
const NS = "dsh-mcp-manager";
const name = "dsh-mcp-manager";
const inject = [
	"slots",
	"locale",
	"theme"
];
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "dsh-mcp-manager: dictionaries");
	const t = ctx.locale.bind(NS);
	ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "mcp-manager",
		order: 45,
		label: () => t("nav"),
		locale: NS,
		inject: () => ({ t })
	}, () => (0, react.createElement)(McpSection, { t })));
}
//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;


return module.exports;
}});
