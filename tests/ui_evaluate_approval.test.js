/**
 * Unit tests for per-call ui_evaluate human approval (MCP elicitation).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { previewExpression, requestUiEvaluateApproval } from '../src/tools/ui_evaluate_approval.js';

describe('previewExpression', () => {
  it('returns short expressions unchanged', () => {
    assert.equal(previewExpression('1 + 1'), '1 + 1');
  });

  it('truncates long expressions with an ellipsis', () => {
    const long = 'x'.repeat(600);
    const preview = previewExpression(long, 500);
    assert.equal(preview.length, 501);
    assert.ok(preview.endsWith('…'));
  });
});

describe('requestUiEvaluateApproval', () => {
  it('refuses when elicitation is unavailable', async () => {
    const r = await requestUiEvaluateApproval({ elicitor: {}, expression: '1' });
    assert.equal(r.approved, false);
    assert.match(r.reason, /unavailable/i);
  });

  it('approves only on accept + approve:true', async () => {
    const elicitor = {
      async elicitInput() {
        return { action: 'accept', content: { approve: true } };
      },
    };
    const r = await requestUiEvaluateApproval({ elicitor, expression: '1+1' });
    assert.deepEqual(r, { approved: true });
  });

  it('refuses accept with approve:false', async () => {
    const elicitor = {
      async elicitInput() {
        return { action: 'accept', content: { approve: false } };
      },
    };
    const r = await requestUiEvaluateApproval({ elicitor, expression: '1+1' });
    assert.equal(r.approved, false);
  });

  it('refuses decline and cancel', async () => {
    for (const action of ['decline', 'cancel']) {
      const elicitor = {
        async elicitInput() {
          return { action, content: { approve: true } };
        },
      };
      const r = await requestUiEvaluateApproval({ elicitor, expression: '1+1' });
      assert.equal(r.approved, false, action);
    }
  });

  it('fail-closes when elicitInput throws', async () => {
    const elicitor = {
      async elicitInput() {
        throw new Error('client has no elicitation');
      },
    };
    const r = await requestUiEvaluateApproval({ elicitor, expression: '1+1' });
    assert.equal(r.approved, false);
    assert.match(r.reason, /client has no elicitation/);
  });

  it('includes the expression preview in the elicitation message', async () => {
    let seen;
    const elicitor = {
      async elicitInput(params) {
        seen = params;
        return { action: 'decline' };
      },
    };
    await requestUiEvaluateApproval({ elicitor, expression: 'window.foo()' });
    assert.equal(seen.mode, 'form');
    assert.match(seen.message, /window\.foo\(\)/);
    assert.equal(seen.requestedSchema.properties.approve.type, 'boolean');
  });
});
