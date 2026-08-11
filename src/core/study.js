/**
 * Core headless study-lifecycle logic (issue #15).
 *
 * These functions mutate chart study state through the chart widget's own
 * model API (createStudy / removeEntity / getAllStudies) — the same headless
 * path the read tools use — instead of scraping the Indicators dialog DOM.
 * Every mutation returns a typed, checkable result (entity ids before/after)
 * so callers can verify the effect instead of inferring it from a count.
 */
import {
  evaluate as _evaluate,
  evaluateAsync as _evaluateAsync,
  safeString,
} from '../connection.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

function _resolve(deps) {
  return {
    evaluate: deps?.evaluate || _evaluate,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
  };
}

// Page JS: current study entity ids, in chart order. Shared by add/remove so
// both diff the same snapshot shape.
const STUDY_IDS_JS = `
  (function() {
    try {
      var chart = ${CHART_API};
      if (chart && typeof chart.getAllStudies === 'function') {
        return chart.getAllStudies().map(function(s) { return s.id; });
      }
    } catch (e) {}
    return null;
  })()
`;

async function studyIds(evaluate) {
  const ids = await evaluate(STUDY_IDS_JS);
  return Array.isArray(ids) ? ids : null;
}

// Poll for a new entity id after createStudy. createStudy resolves
// asynchronously once the study's metaInfo/data are ready, so a fixed sleep
// can race the id appearing; poll briefly and give up with null (caller
// surfaces success:false) rather than returning a wrong/absent id.
async function waitForNewStudyId(evaluate, beforeIds, { attempts = 12, intervalMs = 250 } = {}) {
  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const after = await studyIds(evaluate);
    if (!after) continue;
    const fresh = after.filter((id) => !(beforeIds || []).includes(id));
    if (fresh.length > 0) return { entityId: fresh[0], afterIds: after, newIds: fresh };
  }
  const after = await studyIds(evaluate);
  return { entityId: null, afterIds: after, newIds: [] };
}

/**
 * Add a built-in study WITHOUT the Indicators dialog, via chart.createStudy.
 *
 * `overlay`: pass true for price-overlay studies (Moving Average, Bollinger
 * Bands); false forces a separate pane (Volume, RSI). Omit to let TradingView
 * use the study's own default placement.
 *
 * createStudy's inputs argument is unreliable across builds (#249): the study
 * is created with defaults regardless. Apply overrides afterwards via
 * indicator_set_inputs / chart_manage_indicator.
 *
 * Returns { success, entity_id, new_study_count } — entity_id is the created
 * study's id for later targeting (data_get_study_series, study_remove, …).
 */
export async function studyAdd({ indicator, overlay, _deps } = {}) {
  if (!indicator) throw new Error('indicator name is required (full name, e.g. "Relative Strength Index").');
  const { evaluate } = _resolve(_deps);

  const before = await studyIds(evaluate);

  await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var overlay = ${overlay === true ? 'true' : overlay === false ? 'false' : 'null'};
      if (overlay === null) chart.createStudy(${safeString(indicator)});
      else chart.createStudy(${safeString(indicator)}, overlay, false, []);
    })()
  `);

  const { entityId, newIds } = await waitForNewStudyId(evaluate, before);

  return {
    success: entityId !== null,
    action: 'add',
    indicator,
    entity_id: entityId,
    new_study_count: newIds.length,
    ...(entityId === null && {
      note: 'createStudy dispatched but no new study id appeared — the name may be unknown to createStudy. Built-ins need the full name; for a user Pine script use pine_add_to_chart instead.',
    }),
  };
}

/**
 * Remove a study headlessly via chart.removeEntity (optionally undoable).
 *
 * `undo: true` routes through removeEntityWithUndo so the removal lands on the
 * chart's undo stack; the default (false) removes with undo disabled.
 *
 * Verifies the id is actually gone from getAllStudies() afterwards so a silent
 * no-op (stale/unknown id) is reported instead of returning a blind success.
 */
export async function studyRemove({ entity_id, undo, _deps } = {}) {
  if (!entity_id) throw new Error('entity_id is required. Use chart_get_state to find study IDs.');
  const { evaluate } = _resolve(_deps);

  const before = await studyIds(evaluate);
  if (before && !before.includes(entity_id)) {
    return {
      success: false,
      action: 'remove',
      entity_id,
      removed: false,
      error: `Study "${entity_id}" is not on the chart (stale id? entity ids are per-session — re-read chart_get_state).`,
      study_ids: before,
    };
  }

  await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var id = ${safeString(entity_id)};
      if (${undo === true ? 'true' : 'false'} && typeof chart.removeEntityWithUndo === 'function') {
        chart.removeEntityWithUndo(id);
      } else {
        chart.removeEntity(id, { disableUndo: true });
      }
    })()
  `);

  await new Promise((r) => setTimeout(r, 300));
  const after = await studyIds(evaluate);
  const removed = after ? !after.includes(entity_id) : null;

  return {
    success: removed !== false,
    action: 'remove',
    entity_id,
    removed,
    ...(removed === false && { note: 'removeEntity dispatched but the study is still present.' }),
  };
}
