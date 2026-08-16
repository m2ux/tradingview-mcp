import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/drawing.js';
import * as templates from '../core/drawing_templates.js';

export function registerDrawingTools(server) {
  server.tool('draw_shape', 'Draw a shape/line on the chart', {
    shape: z.string().describe('Shape type: horizontal_line, vertical_line, trend_line, rectangle, text'),
    point: z.object({ time: z.coerce.number(), price: z.coerce.number() }).describe('{ time: unix_timestamp, price: number }'),
    point2: z.object({ time: z.coerce.number(), price: z.coerce.number() }).optional().describe('Second point for two-point shapes (trend_line, rectangle)'),
    overrides: z.string().optional().describe('JSON string of style overrides (e.g., \'{"linecolor": "#ff0000", "linewidth": 2}\')'),
    text: z.string().optional().describe('Text content for text shapes'),
  }, async ({ shape, point, point2, overrides, text }) => {
    try { return jsonResult(await core.drawShape({ shape, point, point2, overrides, text })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool(
    'draw_fib_channel',
    'Draw a Fibonacci channel from a saved LineToolFibChannel template, bullish/bearish direction, and three bar times (TV click order: baseline point→point2, offset point3). Optional timeframe selects which resolution supplies OHLC (omit = active chart).',
    {
      template: z.string().describe(
        'Required. Any exact saved LineToolFibChannel template name (caller-supplied; no default). Must exist on /drawing-templates/LineToolFibChannel/ — refuses otherwise, no factory-default fallback.',
      ),
      direction: z.enum(['bullish', 'bearish']).describe(
        'Required. Selects the OHLC extreme at each locus: bullish = low, high, low; bearish = high, low, high.',
      ),
      point: z.object({ time: z.coerce.number(), price: z.coerce.number().optional() }).describe(
        'First locus (TV click 1). Time required; price optional override (else bar low if bullish, high if bearish).',
      ),
      point2: z.object({ time: z.coerce.number(), price: z.coerce.number().optional() }).describe(
        'Second locus (TV click 2; with point forms the baseline). Time required; price optional (else high if bullish, low if bearish).',
      ),
      point3: z.object({ time: z.coerce.number(), price: z.coerce.number().optional() }).describe(
        'Third locus (TV click 3; parallel / width). Time required; price optional (else low if bullish, high if bearish).',
      ),
      timeframe: z.string().optional().describe(
        'Resolution whose bars supply OHLC when a locus omits price (e.g. "D", "60", "45"). Omit to use the active chart timeframe. The original resolution is restored after lookup.',
      ),
    },
    async ({ template, direction, point, point2, point3, timeframe }) => {
      try { return jsonResult(await core.drawFibChannel({ template, direction, point, point2, point3, timeframe })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool('draw_list', 'List all shapes/drawings on the chart', {}, async () => {
    try { return jsonResult(await core.listDrawings()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_clear', 'Remove all drawings from the chart', {}, async () => {
    try { return jsonResult(await core.clearAll()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_remove_one', 'Remove a specific drawing by entity ID', {
    entity_id: z.string().describe('Entity ID of the drawing to remove (from draw_list)'),
  }, async ({ entity_id }) => {
    try { return jsonResult(await core.removeOne({ entity_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('draw_get_properties', 'Get properties and points of a specific drawing', {
    entity_id: z.string().describe('Entity ID of the drawing (from draw_list)'),
  }, async ({ entity_id }) => {
    try { return jsonResult(await core.getProperties({ entity_id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool(
    'draw_template_list',
    'List saved drawing templates for a drawing type (e.g. "fibonacci channel"), or list supported drawing_type aliases when omitted',
    {
      drawing_type: z.string().optional().describe(
        'Friendly type (e.g. "fibonacci channel", "parallel channel", "trend line") or raw LineTool* id. Omit to list supported aliases.',
      ),
    },
    async ({ drawing_type }) => {
      try { return jsonResult(await templates.listTemplates({ drawing_type })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'draw_template_get',
    'Fetch one saved drawing template by drawing type and name (returns TradingView native content object)',
    {
      drawing_type: z.string().describe('Friendly type or LineTool* id (e.g. "fibonacci channel")'),
      name: z.string().describe('Exact saved template name'),
    },
    async ({ drawing_type, name }) => {
      try { return jsonResult(await templates.getTemplate({ drawing_type, name })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'draw_template_save',
    'Create or overwrite a drawing template. Pass content and/or from_template (clone then deep-merge). Mutates your TradingView cloud templates.',
    {
      drawing_type: z.string().describe('Friendly type or LineTool* id (e.g. "fibonacci channel")'),
      name: z.string().describe('Template name to create or overwrite'),
      content: z.union([z.record(z.string(), z.any()), z.string()]).optional().describe(
        'Template body as object or JSON string (TradingView native properties). Merged onto from_template when both are set.',
      ),
      from_template: z.string().optional().describe(
        'Existing template name of the same drawing type to clone before applying content',
      ),
    },
    async ({ drawing_type, name, content, from_template }) => {
      try {
        return jsonResult(await templates.saveTemplate({ drawing_type, name, content, from_template }));
      } catch (err) {
        return jsonResult({ success: false, error: err.message }, true);
      }
    },
  );
}
