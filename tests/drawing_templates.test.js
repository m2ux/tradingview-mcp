/**
 * Unit tests for drawing template helpers (no TradingView connection).
 * Run: node --test tests/drawing_templates.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAWING_TYPE_ALIASES,
  normalizeDrawingTypeKey,
  resolveDrawingType,
  deepMerge,
  parseContent,
  listTypes,
  listTemplates,
  getTemplate,
  saveTemplate,
} from '../src/core/drawing_templates.js';

describe('normalizeDrawingTypeKey', () => {
  it('lowercases and collapses separators', () => {
    assert.equal(normalizeDrawingTypeKey('  Fib_Channel  '), 'fib channel');
    assert.equal(normalizeDrawingTypeKey('Fibonacci-Channel'), 'fibonacci channel');
  });
});

describe('resolveDrawingType', () => {
  it('maps friendly aliases', () => {
    assert.equal(resolveDrawingType('fibonacci channel').tool, 'LineToolFibChannel');
    assert.equal(resolveDrawingType('Fib Channel').tool, 'LineToolFibChannel');
    assert.equal(resolveDrawingType('parallel channel').tool, 'LineToolParallelChannel');
    assert.equal(resolveDrawingType('channel').tool, 'LineToolParallelChannel');
  });

  it('passes through LineTool* ids', () => {
    assert.deepEqual(resolveDrawingType('LineToolFibChannel'), {
      tool: 'LineToolFibChannel',
      input: 'LineToolFibChannel',
    });
  });

  it('rejects unknown types with alias hints', () => {
    assert.throws(() => resolveDrawingType('not-a-tool'), /Unknown drawing_type/);
    assert.throws(() => resolveDrawingType(''), /drawing_type is required/);
  });

  it('has seeded aliases for common tools', () => {
    for (const key of ['fibonacci channel', 'trend line', 'horizontal line', 'rectangle']) {
      assert.ok(DRAWING_TYPE_ALIASES[key], `missing alias: ${key}`);
    }
  });
});

describe('deepMerge', () => {
  it('merges nested objects and replaces arrays/scalars', () => {
    const base = { a: 1, nested: { x: 1, y: 2 }, arr: [1], keep: true };
    const patch = { nested: { y: 9, z: 3 }, arr: [2, 3], a: 5 };
    assert.deepEqual(deepMerge(base, patch), {
      a: 5,
      nested: { x: 1, y: 9, z: 3 },
      arr: [2, 3],
      keep: true,
    });
  });
});

describe('parseContent', () => {
  it('accepts objects and JSON strings', () => {
    assert.deepEqual(parseContent({ linewidth: 2 }), { linewidth: 2 });
    assert.deepEqual(parseContent('{"linewidth":2}'), { linewidth: 2 });
    assert.equal(parseContent(undefined), undefined);
  });

  it('rejects invalid JSON', () => {
    assert.throws(() => parseContent('{'), /valid JSON/);
    assert.throws(() => parseContent(3), /object or JSON string/);
  });
});

describe('listTypes / listTemplates without drawing_type', () => {
  it('returns supported aliases without network', async () => {
    const types = listTypes();
    assert.equal(types.success, true);
    assert.ok(types.type_count > 0);
    assert.ok(types.types.some((t) => t.tool === 'LineToolFibChannel'));

    const listed = await listTemplates({});
    assert.equal(listed.success, true);
    assert.ok(listed.types.length > 0);
  });
});

describe('listTemplates / getTemplate / saveTemplate with mocks', () => {
  it('lists names via evaluateAsync', async () => {
    const result = await listTemplates({
      drawing_type: 'fib channel',
      _deps: {
        evaluateAsync: async () => ({ ok: true, status: 200, names: ['A', 'B'] }),
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.tool, 'LineToolFibChannel');
    assert.deepEqual(result.templates, ['A', 'B']);
    assert.equal(result.template_count, 2);
  });

  it('gets content via evaluateAsync', async () => {
    const result = await getTemplate({
      drawing_type: 'LineToolFibChannel',
      name: 'Base',
      _deps: {
        evaluateAsync: async () => ({ ok: true, status: 200, content: { linewidth: 1 } }),
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.name, 'Base');
    assert.deepEqual(result.content, { linewidth: 1 });
  });

  it('requires content or from_template on save', async () => {
    await assert.rejects(
      () => saveTemplate({ drawing_type: 'fib channel', name: 'x' }),
      /content and\/or from_template/,
    );
  });

  it('clones from_template then merges content', async () => {
    const calls = [];
    const result = await saveTemplate({
      drawing_type: 'fibonacci channel',
      name: 'NewTpl',
      from_template: 'Base',
      content: { transparency: 50, nested: { y: 2 } },
      _deps: {
        evaluateAsync: async (expr) => {
          calls.push(expr);
          if (expr.includes('/drawing-template/')) {
            return {
              ok: true,
              status: 200,
              content: { transparency: 80, nested: { x: 1, y: 1 }, keep: true },
            };
          }
          if (expr.includes('/save-drawing-template/')) {
            assert.ok(expr.includes('NewTpl'));
            assert.ok(expr.includes('LineToolFibChannel'));
            return { ok: true, status: 200, data: { id: 1 } };
          }
          return { ok: false, error: 'unexpected call' };
        },
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.action, 'saved');
    assert.equal(result.from_template, 'Base');
    assert.deepEqual(result.content, {
      transparency: 50,
      nested: { x: 1, y: 2 },
      keep: true,
    });
    assert.equal(calls.length, 2);
  });

  it('saves with content only', async () => {
    const result = await saveTemplate({
      drawing_type: 'trend line',
      name: 'ThinRed',
      content: { linecolor: '#ff0000', linewidth: 1 },
      _deps: {
        evaluateAsync: async () => ({ ok: true, status: 200 }),
      },
    });
    assert.equal(result.success, true);
    assert.equal(result.tool, 'LineToolTrendLine');
    assert.deepEqual(result.content, { linecolor: '#ff0000', linewidth: 1 });
  });
});
