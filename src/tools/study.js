import { z } from 'zod';
import { jsonResult, errorResult } from './_format.js';
import * as core from '../core/study.js';

export function registerStudyTools(server) {
  server.tool(
    'study_add',
    'Add a built-in study to the chart WITHOUT the Indicators dialog (headless chart.createStudy). Returns the new entity_id for later targeting (data_get_study_series, study_remove, indicator_set_inputs). USE FULL NAMES: "Relative Strength Index" not "RSI". For a user Pine script use pine_add_to_chart instead. Apply input overrides afterwards via indicator_set_inputs (createStudy applies defaults).',
    {
      indicator: z.string().describe('Full built-in indicator name, e.g. "Relative Strength Index", "Moving Average Exponential", "Volume", "Bollinger Bands". Short names like RSI/EMA do NOT work.'),
      overlay: z.coerce.boolean().optional().describe('Pane placement: true = overlay on price, false = separate pane. Omit to use the study\'s default placement.'),
    },
    async ({ indicator, overlay }) => {
      try { return jsonResult(await core.studyAdd({ indicator, overlay })); }
      catch (err) { return errorResult(err); }
    },
  );

  server.tool(
    'study_remove',
    'Remove a study from the chart headlessly (chart.removeEntity) by entity_id — no DOM interaction. Verifies the study is actually gone afterwards. Enables de-duplication and cleanup that chart_manage_indicator cannot do by name.',
    {
      entity_id: z.string().describe('Study entity ID (from chart_get_state / study_add). Required.'),
      undo: z.coerce.boolean().optional().describe('If true, route through removeEntityWithUndo so the removal lands on the chart undo stack (default false).'),
    },
    async ({ entity_id, undo }) => {
      try { return jsonResult(await core.studyRemove({ entity_id, undo })); }
      catch (err) { return errorResult(err); }
    },
  );
}
