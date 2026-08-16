import { register } from '../router.js';
import * as core from '../../core/drawing.js';
import * as templates from '../../core/drawing_templates.js';

register('draw', {
  description: 'Drawing tools (shape, fib-channel, list, get, remove, clear, templates)',
  subcommands: new Map([
    ['shape', {
      description: 'Draw a shape on the chart',
      options: {
        type: { type: 'string', short: 't', description: 'Shape type: horizontal_line, trend_line, rectangle, text' },
        price: { type: 'string', short: 'p', description: 'Price level' },
        time: { type: 'string', description: 'Unix timestamp' },
        price2: { type: 'string', description: 'Second point price (for trend_line, rectangle)' },
        time2: { type: 'string', description: 'Second point time (for trend_line, rectangle)' },
        text: { type: 'string', description: 'Text content (for text shapes)' },
        overrides: { type: 'string', description: 'JSON style overrides' },
      },
      handler: (opts) => {
        const point = { time: Number(opts.time), price: Number(opts.price) };
        const point2 = opts.price2 ? { time: Number(opts.time2), price: Number(opts.price2) } : undefined;
        return core.drawShape({ shape: opts.type || 'horizontal_line', point, point2, overrides: opts.overrides, text: opts.text });
      },
    }],
    ['fib-channel', {
      description: 'Draw a Fibonacci channel from a saved template, direction, and three bar times',
      options: {
        template: { type: 'string', short: 'n', description: 'Required. Any exact LineToolFibChannel template name (no default)' },
        direction: { type: 'string', short: 'd', description: 'Required. bullish (L→H→L) or bearish (H→L→H)' },
        time: { type: 'string', description: 'First locus unix timestamp' },
        price: { type: 'string', short: 'p', description: 'Optional first-locus price override' },
        time2: { type: 'string', description: 'Second locus unix timestamp' },
        price2: { type: 'string', description: 'Optional second-locus price override' },
        time3: { type: 'string', description: 'Third locus unix timestamp' },
        price3: { type: 'string', description: 'Optional third-locus price override' },
      },
      handler: (opts) => {
        const locus = (time, price) => {
          const point = { time: Number(time) };
          if (price != null && price !== '') point.price = Number(price);
          return point;
        };
        return core.drawFibChannel({
          template: opts.template,
          direction: opts.direction,
          point: locus(opts.time, opts.price),
          point2: locus(opts.time2, opts.price2),
          point3: locus(opts.time3, opts.price3),
        });
      },
    }],
    ['list', {
      description: 'List all drawings on the chart',
      handler: () => core.listDrawings(),
    }],
    ['get', {
      description: 'Get properties of a drawing',
      handler: (opts, positionals) => core.getProperties({ entity_id: positionals[0] }),
    }],
    ['remove', {
      description: 'Remove a drawing by entity ID',
      handler: (opts, positionals) => core.removeOne({ entity_id: positionals[0] }),
    }],
    ['clear', {
      description: 'Remove all drawings',
      handler: () => core.clearAll(),
    }],
    ['templates', {
      description: 'List/get/save drawing templates (use: list|get|save)',
      options: {
        type: { type: 'string', short: 't', description: 'Drawing type alias or LineTool* id' },
        name: { type: 'string', short: 'n', description: 'Template name' },
        content: { type: 'string', short: 'c', description: 'Template JSON content (for save)' },
        from: { type: 'string', description: 'Clone from existing template name (for save)' },
      },
      handler: (opts, positionals) => {
        const action = (positionals[0] || 'list').toLowerCase();
        if (action === 'list' || action === 'types') {
          return templates.listTemplates({ drawing_type: opts.type });
        }
        if (action === 'get') {
          return templates.getTemplate({
            drawing_type: opts.type || positionals[1],
            name: opts.name || positionals[2],
          });
        }
        if (action === 'save') {
          return templates.saveTemplate({
            drawing_type: opts.type || positionals[1],
            name: opts.name || positionals[2],
            content: opts.content,
            from_template: opts.from,
          });
        }
        throw new Error('Unknown templates action. Use: list, get, or save');
      },
    }],
  ]),
});
