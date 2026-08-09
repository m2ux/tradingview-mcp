/**
 * Per-call human approval for ui_evaluate via MCP form elicitation.
 * Fail-closed: decline, cancel, missing approve flag, or elicitation errors
 * all refuse execution. The agent cannot bypass this — only the client user can.
 */

const PREVIEW_LIMIT = 500;

/** Truncate a JS expression for the approval dialog. */
export function previewExpression(expression, limit = PREVIEW_LIMIT) {
  if (typeof expression !== 'string') return '';
  if (expression.length <= limit) return expression;
  return `${expression.slice(0, limit)}…`;
}

/**
 * Ask the human to approve running `expression` in the page context.
 * @param {object} opts
 * @param {{ elicitInput: Function }} opts.elicitor - usually `server.server`
 * @param {string} opts.expression
 * @returns {Promise<{ approved: boolean, reason?: string }>}
 */
export async function requestUiEvaluateApproval({ elicitor, expression }) {
  if (!elicitor || typeof elicitor.elicitInput !== 'function') {
    return { approved: false, reason: 'approval elicitation is unavailable on this client' };
  }

  const preview = previewExpression(expression);
  let result;
  try {
    result = await elicitor.elicitInput({
      mode: 'form',
      message:
        'Approve ui_evaluate? This runs arbitrary JavaScript in your authenticated TradingView session.\n\n'
        + `Expression:\n${preview}`,
      requestedSchema: {
        type: 'object',
        properties: {
          approve: {
            type: 'boolean',
            title: 'Approve execution',
            description: 'I have reviewed the expression and approve running it in the page context',
            default: false,
          },
        },
        required: ['approve'],
      },
    });
  } catch (err) {
    return {
      approved: false,
      reason: `approval elicitation failed: ${err?.message || String(err)}`,
    };
  }

  if (result?.action === 'accept' && result.content?.approve === true) {
    return { approved: true };
  }
  if (result?.action === 'decline') {
    return { approved: false, reason: 'user declined ui_evaluate' };
  }
  return { approved: false, reason: 'user cancelled ui_evaluate approval' };
}
