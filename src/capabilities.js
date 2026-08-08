/**
 * Capability allowlist gate — the registrar-level trust boundary.
 *
 * Power tools are denied by default and registered only when the operator
 * opts in via environment. Enforcement lives here (at the `server.tool`
 * funnel) rather than in prompts or page-side sandboxes, so an agent cannot
 * bypass it. New capabilities are added deliberately: propose, human
 * approval, implement, PR onto the allowlist (see README).
 */

/** Tools removed from the agent-facing surface entirely — never registered. */
export const REMOVED_TOOLS = new Set(['ui_evaluate']);

/**
 * Power tools gated off by default. Each registers only when its gate opens.
 * Blast radius: tv_update = self-install; tv_launch = process spawn/kill;
 * alert_delete/draw_clear = irreversible chart-state mutation;
 * batch_run = fan-out amplification.
 */
export const GATED_TOOLS = new Set([
  'tv_update',
  'tv_launch',
  'alert_delete',
  'draw_clear',
  'batch_run',
]);

const GATE_ENV = 'TV_ALLOW_DANGEROUS';

/** True when the operator has opted in to the gated tool surface. */
export function isGateOpen(env = process.env) {
  return env[GATE_ENV] === '1';
}

/**
 * Registration decision for one tool name. Removed tools never register;
 * gated tools register only with the gate open; everything else registers.
 */
export function isAllowed(name, env = process.env) {
  if (REMOVED_TOOLS.has(name)) return false;
  if (GATED_TOOLS.has(name)) return isGateOpen(env);
  return true;
}

/**
 * Wrap an McpServer so every `server.tool(name, …)` call passes the
 * allowlist check. Skipped registrations are logged to stderr (never stdout,
 * which carries the MCP protocol) for audit.
 */
export function wrapRegistrar(server, { env = process.env, log = process.stderr } = {}) {
  const original = server.tool.bind(server);
  server.tool = (name, ...rest) => {
    if (!isAllowed(name, env)) {
      const reason = REMOVED_TOOLS.has(name) ? 'removed from the tool surface' : `gated (set ${GATE_ENV}=1 to enable)`;
      log.write(`⚠  tradingview-mcp  |  tool "${name}" not registered: ${reason}\n`);
      return undefined;
    }
    return original(name, ...rest);
  };
  return server;
}
