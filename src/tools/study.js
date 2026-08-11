import { z } from 'zod';
import { jsonResult, errorResult } from './_format.js';
import * as core from '../core/study.js';
import { lookupFacadeScript } from '../core/pine_ui.js';

export function registerStudyTools(server) {
  server.tool(
    'study_add',
    'Add a built-in study to the chart WITHOUT the Indicators dialog (headless chart.createStudy). Returns the new entity_id for later targeting (data_get_study_series, study_remove, indicator_set_inputs). USE FULL NAMES: "Relative Strength Index" not "RSI". For one of YOUR saved Pine scripts use study_add_pine instead. Apply input overrides afterwards via indicator_set_inputs (createStudy applies defaults).',
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
    'study_add_pine',
    'Add one of YOUR saved Pine scripts to the chart WITHOUT the Indicators dialog or Pine editor button (headless: compiles via the chart study-meta repository, then insertStudyWithoutCheck). Pass a script name (resolved via the facade saved list) or a script_id. Returns the new entity_id for later targeting. Preferred over indicator_add / pine_add_to_chart for My scripts.',
    {
      name: z.string().optional().describe('Saved script name/title (e.g. "RSI Zone Divergence"). Resolved to a script_id via the facade. Provide name OR script_id.'),
      script_id: z.string().optional().describe('Facade scriptIdPart (bare hex or "USER;<part>"). Provide name OR script_id.'),
      version: z.string().optional().describe('Script version to compile (default "last" = latest saved).'),
      overlay: z.coerce.boolean().optional().describe('Pane placement: true = overlay on price, false = separate pane. Omit for the script\'s own placement.'),
      inputs: z.string().optional().describe('JSON object of input overrides applied at insert time, e.g. \'{"length": 21}\'. Keys are input ids.'),
    },
    async ({ name, script_id, version, overlay, inputs }) => {
      try {
        let id = script_id;
        if (!id) {
          if (!name) return errorResult(new Error('Provide name or script_id.'));
          const entry = await lookupFacadeScript({ name });
          id = entry.scriptIdPart || entry.id;
        }
        let parsedInputs;
        if (inputs) {
          try { parsedInputs = JSON.parse(inputs); }
          catch { return errorResult(new Error('inputs must be valid JSON, e.g. \'{"length": 21}\'')); }
        }
        return jsonResult(await core.studyAddPine({ script_id: id, version, overlay, inputs: parsedInputs }));
      } catch (err) { return errorResult(err); }
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
