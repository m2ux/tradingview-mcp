/**
 * Shared MCP response formatting helper.
 * All tool files use this instead of manually constructing MCP responses.
 * Tool output is untrusted input for the consuming model; the registrar
 * allowlist is the trust boundary, fencing is the spotlighting layer.
 */

const FENCE_PREFIX = 'UNTRUSTED_';
const FENCE_RE = /UNTRUSTED_[A-Z0-9_]+_(START|END)/g;

/** Scalars whose values are server-authored, not chart-derived. */
const TRUSTED_KEYS = new Set(['success', 'error', 'hint', 'note', 'warning', 'status']);

function fenceString(value, origin) {
  const tag = `${FENCE_PREFIX}${origin}_`;
  // Neutralize any pre-existing fence markers so chart text can't forge or
  // break a fence — datamarking strength over delimiters.
  const body = String(value).replace(FENCE_RE, (m) => m.replace(/_/g, '‗'));
  return `${tag}START\n${body}\n${tag}END`;
}

function fenceValue(value, origin, insideTrustedKey) {
  if (typeof value === 'string') return insideTrustedKey ? value : fenceString(value, origin);
  if (Array.isArray(value)) return value.map((v) => fenceValue(v, origin, false));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, fenceValue(v, origin, TRUSTED_KEYS.has(k))]),
    );
  }
  return value;
}

/**
 * Wrap chart/Pine/UI-derived string values of `obj` in UNTRUSTED fences.
 * `origin` names the data provenance (default CHART) and is uppercased
 * into the marker: UNTRUSTED_<ORIGIN>_START … UNTRUSTED_<ORIGIN>_END.
 */
export function wrapUntrusted(obj, origin = 'CHART') {
  const tag = origin.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return fenceValue(obj, tag, false);
}

export function jsonResult(obj, isError = false) {
  const payload = isError ? obj : wrapUntrusted(obj);
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError && { isError: true }),
  };
}
