/**
 * Drawing template list / get / save via TradingView's session-authenticated
 * drawing-template endpoints (same origin as the chart page).
 *
 * Endpoints (from TradingView client bundles):
 *   GET  /drawing-templates/{tool}/                         → string[] names
 *   GET  /drawing-template/{tool}/?templateName=...         → { content: "<json>" }
 *   POST /save-drawing-template/  FormData(name, tool, content)
 */
import { evaluateAsync as _evaluateAsync, safeString } from '../connection.js';

/** Friendly aliases → TradingView LineTool* ids. */
export const DRAWING_TYPE_ALIASES = {
  // Fibonacci
  'fibonacci channel': 'LineToolFibChannel',
  'fib channel': 'LineToolFibChannel',
  fibchannel: 'LineToolFibChannel',
  'fibonacci retracement': 'LineToolFibRetracement',
  'fib retracement': 'LineToolFibRetracement',
  fibretracement: 'LineToolFibRetracement',
  'fibonacci extension': 'LineToolTrendBasedFibExtension',
  'fib extension': 'LineToolTrendBasedFibExtension',
  'trend based fib extension': 'LineToolTrendBasedFibExtension',
  'fibonacci time zone': 'LineToolFibTimeZone',
  'fib time zone': 'LineToolFibTimeZone',
  'fibonacci circles': 'LineToolFibCircles',
  'fib circles': 'LineToolFibCircles',
  'fibonacci speed resistance fan': 'LineToolFibSpeedResistanceFan',
  'fib speed resistance fan': 'LineToolFibSpeedResistanceFan',
  'fibonacci wedge': 'LineToolFibWedge',
  'fib wedge': 'LineToolFibWedge',
  // Channels / lines
  'parallel channel': 'LineToolParallelChannel',
  channel: 'LineToolParallelChannel',
  'disjoint channel': 'LineToolDisjointChannel',
  'regression trend': 'LineToolRegressionTrend',
  'flat top/bottom': 'LineToolFlatBottom',
  'flat bottom': 'LineToolFlatBottom',
  'trend line': 'LineToolTrendLine',
  trendline: 'LineToolTrendLine',
  'horizontal line': 'LineToolHorzLine',
  'horiz line': 'LineToolHorzLine',
  hline: 'LineToolHorzLine',
  'horizontal ray': 'LineToolHorzRay',
  'vertical line': 'LineToolVertLine',
  vline: 'LineToolVertLine',
  'cross line': 'LineToolCrossLine',
  // Shapes / annotations
  rectangle: 'LineToolRectangle',
  ellipse: 'LineToolEllipse',
  triangle: 'LineToolTriangle',
  polyline: 'LineToolPolyline',
  path: 'LineToolPath',
  text: 'LineToolText',
  callout: 'LineToolCallout',
  note: 'LineToolNote',
  arrow: 'LineToolArrow',
  ray: 'LineToolRay',
  'extended line': 'LineToolExtended',
  // Pitchforks / gann
  pitchfork: 'LineToolPitchfork',
  'schiff pitchfork': 'LineToolSchiffPitchfork',
  'modified schiff pitchfork': 'LineToolSchiffPitchfork2',
  'gann box': 'LineToolGannSquare',
  'gann square': 'LineToolGannSquareFixed',
  'gann fan': 'LineToolGannFan',
  // Risk
  'long position': 'LineToolRiskRewardLong',
  'short position': 'LineToolRiskRewardShort',
  'risk reward long': 'LineToolRiskRewardLong',
  'risk reward short': 'LineToolRiskRewardShort',
};

function _resolve(deps) {
  return { evaluateAsync: deps?.evaluateAsync || _evaluateAsync };
}

/** Normalize user input for alias lookup. */
export function normalizeDrawingTypeKey(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Resolve a friendly drawing type or raw LineTool* id.
 * @returns {{ tool: string, input: string }}
 */
export function resolveDrawingType(drawingType) {
  const raw = String(drawingType || '').trim();
  if (!raw) throw new Error('drawing_type is required');
  if (/^LineTool[A-Za-z0-9]+$/.test(raw)) return { tool: raw, input: raw };
  const key = normalizeDrawingTypeKey(raw);
  const tool = DRAWING_TYPE_ALIASES[key];
  if (!tool) {
    const aliases = Object.keys(DRAWING_TYPE_ALIASES).sort();
    throw new Error(
      `Unknown drawing_type "${raw}". Pass a LineTool* id or one of: ${aliases.join(', ')}`,
    );
  }
  return { tool, input: raw };
}

/** Deep-merge plain objects; arrays and scalars in `patch` replace. */
export function deepMerge(base, patch) {
  if (patch === undefined) return base;
  if (
    base === null || typeof base !== 'object' || Array.isArray(base) ||
    patch === null || typeof patch !== 'object' || Array.isArray(patch)
  ) {
    return patch;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = k in base ? deepMerge(base[k], v) : v;
  }
  return out;
}

export function parseContent(content) {
  if (content === undefined || content === null) return undefined;
  if (typeof content === 'string') {
    try { return JSON.parse(content); }
    catch (e) { throw new Error(`content must be valid JSON: ${e.message}`); }
  }
  if (typeof content === 'object') return content;
  throw new Error('content must be an object or JSON string');
}

/** Supported type aliases for agents (no network). */
export function listTypes() {
  const byTool = {};
  for (const [alias, tool] of Object.entries(DRAWING_TYPE_ALIASES)) {
    if (!byTool[tool]) byTool[tool] = [];
    byTool[tool].push(alias);
  }
  const types = Object.entries(byTool)
    .map(([tool, aliases]) => ({ tool, aliases: aliases.sort() }))
    .sort((a, b) => a.tool.localeCompare(b.tool));
  return { success: true, type_count: types.length, types };
}

export async function listTemplates({ drawing_type, _deps } = {}) {
  if (drawing_type === undefined || drawing_type === null || drawing_type === '') {
    return listTypes();
  }
  const { tool, input } = resolveDrawingType(drawing_type);
  const { evaluateAsync } = _resolve(_deps);
  const result = await evaluateAsync(`
    (async function() {
      try {
        var tool = ${safeString(tool)};
        var r = await fetch('/drawing-templates/' + tool + '/', { credentials: 'same-origin' });
        var text = await r.text();
        if (!r.ok) return { ok: false, status: r.status, error: text.slice(0, 200) };
        var names = JSON.parse(text);
        if (!Array.isArray(names)) return { ok: false, status: r.status, error: 'Unexpected list response' };
        return { ok: true, status: r.status, names: names };
      } catch (e) { return { ok: false, error: e.message }; }
    })()
  `);
  if (!result?.ok) {
    return {
      success: false,
      source: 'internal_api',
      drawing_type: input,
      tool,
      error: result?.error || 'Failed to list drawing templates',
      status: result?.status,
    };
  }
  return {
    success: true,
    source: 'internal_api',
    drawing_type: input,
    tool,
    template_count: result.names.length,
    templates: result.names,
  };
}

export async function getTemplate({ drawing_type, name, _deps }) {
  const { tool, input } = resolveDrawingType(drawing_type);
  const templateName = String(name || '').trim();
  if (!templateName) throw new Error('name is required');
  const { evaluateAsync } = _resolve(_deps);
  const result = await evaluateAsync(`
    (async function() {
      try {
        var tool = ${safeString(tool)};
        var name = ${safeString(templateName)};
        var url = '/drawing-template/' + tool + '/?templateName=' + encodeURIComponent(name);
        var r = await fetch(url, { credentials: 'same-origin' });
        var text = await r.text();
        if (!r.ok) return { ok: false, status: r.status, error: text.slice(0, 200) };
        var data = JSON.parse(text);
        if (data == null || typeof data.content !== 'string') {
          return { ok: false, status: r.status, error: 'Unexpected template response (missing content)' };
        }
        return { ok: true, status: r.status, content: JSON.parse(data.content) };
      } catch (e) { return { ok: false, error: e.message }; }
    })()
  `);
  if (!result?.ok) {
    return {
      success: false,
      source: 'internal_api',
      drawing_type: input,
      tool,
      name: templateName,
      error: result?.error || 'Failed to load drawing template',
      status: result?.status,
    };
  }
  return {
    success: true,
    source: 'internal_api',
    drawing_type: input,
    tool,
    name: templateName,
    content: result.content,
  };
}

export async function saveTemplate({ drawing_type, name, content, from_template, _deps }) {
  const { tool, input } = resolveDrawingType(drawing_type);
  const templateName = String(name || '').trim();
  if (!templateName) throw new Error('name is required');

  const patch = parseContent(content);
  const fromName = from_template != null && String(from_template).trim() !== ''
    ? String(from_template).trim()
    : null;

  if (patch === undefined && !fromName) {
    throw new Error('Provide content and/or from_template to save a drawing template');
  }

  let base = {};
  if (fromName) {
    const loaded = await getTemplate({ drawing_type: tool, name: fromName, _deps });
    if (!loaded.success) {
      return {
        success: false,
        source: 'internal_api',
        drawing_type: input,
        tool,
        name: templateName,
        from_template: fromName,
        error: loaded.error || `Failed to load from_template "${fromName}"`,
      };
    }
    base = loaded.content;
  }

  const merged = patch === undefined ? base : deepMerge(base, patch);
  const contentStr = JSON.stringify(merged);
  const { evaluateAsync } = _resolve(_deps);

  const result = await evaluateAsync(`
    (async function() {
      try {
        var tool = ${safeString(tool)};
        var name = ${safeString(templateName)};
        var content = ${safeString(contentStr)};
        var fd = new FormData();
        fd.append('name', name);
        fd.append('tool', tool);
        fd.append('content', content);
        var r = await fetch('/save-drawing-template/', {
          method: 'POST',
          credentials: 'same-origin',
          body: fd,
        });
        var text = await r.text();
        var data = null;
        try { data = JSON.parse(text); } catch (e) {}
        if (!r.ok) return { ok: false, status: r.status, error: text.slice(0, 200), data: data };
        return { ok: true, status: r.status, data: data };
      } catch (e) { return { ok: false, error: e.message }; }
    })()
  `);

  if (!result?.ok) {
    return {
      success: false,
      source: 'internal_api',
      drawing_type: input,
      tool,
      name: templateName,
      from_template: fromName,
      error: result?.error || 'Failed to save drawing template',
      status: result?.status,
    };
  }

  return {
    success: true,
    source: 'internal_api',
    drawing_type: input,
    tool,
    name: templateName,
    from_template: fromName,
    action: 'saved',
    content: merged,
  };
}
