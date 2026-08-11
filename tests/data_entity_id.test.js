/**
 * Unit tests for the entity_id selector on the study read tools (issue #15B).
 * Verifies the selector is interpolated into the generated page JS and that
 * result shaping is unchanged. Pure unit — mocked evaluate records the
 * expression and returns a canned payload.
 *
 * Run: node --test tests/data_entity_id.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getStudySeries,
  getStudyValues,
  getPineLines,
  getPineLabels,
  getPineTables,
  getPineBoxes,
} from '../src/core/data.js';

function mockEvaluate(raw) {
  const calls = [];
  const evaluate = async (expr) => { calls.push(expr); return raw; };
  evaluate.calls = calls;
  return evaluate;
}

const seriesPage = {
  found: true,
  study: 'RSI Zone Divergence',
  entity_id: 'FzvERz',
  plot_ids: ['plot_0'],
  bar_count: 1,
  total_available: 100,
  bars: [{ time: 1000, plots: { plot_0: 1 } }],
  price: null,
};

describe('getStudySeries() — entity_id selector', () => {
  it('interpolates entity_id into the page JS for exact matching', async () => {
    const evaluate = mockEvaluate(seriesPage);
    await getStudySeries({ entity_id: 'FzvERz', _deps: { evaluate } });
    assert.ok(evaluate.calls[0].includes('"FzvERz"'), 'entity_id serialized into JS');
  });

  it('entity_id match path bypasses the name-substring filter', async () => {
    const evaluate = mockEvaluate(seriesPage);
    await getStudySeries({ entity_id: 'FzvERz', _deps: { evaluate } });
    // When entityId is set the in-page code compares s.id() to it directly.
    assert.ok(/String\(sid\) !== entityId/.test(evaluate.calls[0]), 'exact id comparison present');
  });

  it('returns the matched study with its entity_id', async () => {
    const evaluate = mockEvaluate(seriesPage);
    const res = await getStudySeries({ entity_id: 'FzvERz', _deps: { evaluate } });
    assert.equal(res.success, true);
    assert.equal(res.entity_id, 'FzvERz');
  });

  it('surfaces an entity_id-specific not-found error', async () => {
    const evaluate = mockEvaluate({ found: false, error: 'No study with entity_id "zzz" on chart.' });
    await assert.rejects(() => getStudySeries({ entity_id: 'zzz', _deps: { evaluate } }), /entity_id "zzz"/);
  });

  it('still sends an empty entity_id when only a name filter is given', async () => {
    const evaluate = mockEvaluate(seriesPage);
    await getStudySeries({ study: 'RSI', _deps: { evaluate } });
    assert.ok(evaluate.calls[0].includes('var entityId = "";'), 'entityId defaults to empty (name path)');
  });
});

describe('getStudyValues() — entity_id selector', () => {
  const valuesPage = [{ id: 'FzvERz', name: 'RSI Zone Divergence', inputs: null, values: { RSI: '55.2' } }];

  it('interpolates entity_id into the page JS', async () => {
    const evaluate = mockEvaluate(valuesPage);
    await getStudyValues({ entity_id: 'FzvERz', _deps: { evaluate } });
    assert.ok(evaluate.calls[0].includes('"FzvERz"'));
  });

  it('returns the filtered study list unchanged in shape', async () => {
    const evaluate = mockEvaluate(valuesPage);
    const res = await getStudyValues({ entity_id: 'FzvERz', _deps: { evaluate } });
    assert.equal(res.success, true);
    assert.equal(res.study_count, 1);
    assert.equal(res.studies[0].id, 'FzvERz');
  });
});

describe('pine graphics extractors — entity_id selector', () => {
  const graphicsPage = [{ name: 'RSI Zone Divergence', count: 1, items: [{ id: 'x', raw: { y1: 100, y2: 100 } }] }];

  const cases = [
    ['getPineLines', getPineLines, { y1: 100, y2: 100 }],
    ['getPineLabels', getPineLabels, { t: 'PDH', y: 100 }],
    ['getPineTables', getPineTables, { tid: 0, row: 0, col: 0, t: 'cell' }],
    ['getPineBoxes', getPineBoxes, { y1: 110, y2: 100 }],
  ];

  for (const [name, fn, rawItem] of cases) {
    it(`${name} interpolates entity_id into buildGraphicsJS`, async () => {
      const page = [{ name: 'S', count: 1, items: [{ id: 'x', raw: rawItem }] }];
      const evaluate = mockEvaluate(page);
      await fn({ entity_id: 'FzvERz', _deps: { evaluate } });
      assert.ok(evaluate.calls[0].includes('"FzvERz"'), `${name} serializes entity_id`);
      assert.ok(/String\(sid\) !== entityId/.test(evaluate.calls[0]), `${name} exact id comparison present`);
    });
  }

  it('getPineLines still shapes deduplicated levels with entity_id set', async () => {
    const evaluate = mockEvaluate(graphicsPage);
    const res = await getPineLines({ entity_id: 'FzvERz', _deps: { evaluate } });
    assert.equal(res.success, true);
    assert.deepEqual(res.studies[0].horizontal_levels, [100]);
  });
});
