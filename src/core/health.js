/**
 * Core health/discovery probes — healthCheck, discover, uiState.
 *
 * Launch logic lives in core/launch.js and update-check in
 * core/update_check.js (R5 health cohesion split). Both are re-exported
 * here so existing import paths (import * as core from './health.js')
 * continue to work.
 */
import { getClient, getTargetInfo, evaluate, KNOWN_PATHS } from '../connection.js';

export { launch } from './launch.js';
export { checkForUpdate } from './update_check.js';

export async function healthCheck() {
  await getClient();
  const target = await getTargetInfo();

  const state = await evaluate(`
    (function() {
      var result = { url: window.location.href, title: document.title };
      try {
        var chart = ${KNOWN_PATHS.chartApi};
        result.symbol = chart.symbol();
        result.resolution = chart.resolution();
        result.chartType = chart.chartType();
        result.apiAvailable = true;
      } catch(e) {
        result.symbol = 'unknown';
        result.resolution = 'unknown';
        result.chartType = null;
        result.apiAvailable = false;
        result.apiError = e.message;
      }
      return result;
    })()
  `);

  const update = await checkForUpdate();

  return {
    success: true,
    cdp_connected: true,
    target_id: target.id,
    target_url: target.url,
    target_title: target.title,
    chart_symbol: state?.symbol || 'unknown',
    chart_resolution: state?.resolution || 'unknown',
    chart_type: state?.chartType ?? null,
    api_available: state?.apiAvailable ?? false,
    ...(update && { update }),
  };
}

export async function discover() {
  const paths = await evaluate(`
    (function() {
      var results = {};
      try {
        var chart = ${KNOWN_PATHS.chartApi};
        var methods = [];
        for (var k in chart) { if (typeof chart[k] === 'function') methods.push(k); }
        results.chartApi = { available: true, path: ${JSON.stringify(KNOWN_PATHS.chartApi)}, methodCount: methods.length, methods: methods.slice(0, 50) };
      } catch(e) { results.chartApi = { available: false, error: e.message }; }
      try {
        var col = ${KNOWN_PATHS.chartWidgetCollection};
        var colMethods = [];
        for (var k in col) { if (typeof col[k] === 'function') colMethods.push(k); }
        results.chartWidgetCollection = { available: !!col, path: ${JSON.stringify(KNOWN_PATHS.chartWidgetCollection)}, methodCount: colMethods.length, methods: colMethods.slice(0, 30) };
      } catch(e) { results.chartWidgetCollection = { available: false, error: e.message }; }
      try {
        var ws = window.ChartApiInstance;
        var wsMethods = [];
        for (var k in ws) { if (typeof ws[k] === 'function') wsMethods.push(k); }
        results.chartApiInstance = { available: !!ws, path: 'window.ChartApiInstance', methodCount: wsMethods.length, methods: wsMethods.slice(0, 30) };
      } catch(e) { results.chartApiInstance = { available: false, error: e.message }; }
      try {
        var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
        var bwbMethods = [];
        if (bwb) { for (var k in bwb) { if (typeof bwb[k] === 'function') bwbMethods.push(k); } }
        results.bottomWidgetBar = { available: !!bwb, path: 'window.TradingView.bottomWidgetBar', methodCount: bwbMethods.length, methods: bwbMethods.slice(0, 20) };
      } catch(e) { results.bottomWidgetBar = { available: false, error: e.message }; }
      try {
        var replay = ${KNOWN_PATHS.replayApi};
        results.replayApi = { available: !!replay, path: ${JSON.stringify(KNOWN_PATHS.replayApi)} };
      } catch(e) { results.replayApi = { available: false, error: e.message }; }
      try {
        var alerts = ${KNOWN_PATHS.alertService};
        results.alertService = { available: !!alerts, path: ${JSON.stringify(KNOWN_PATHS.alertService)} };
      } catch(e) { results.alertService = { available: false, error: e.message }; }
      return results;
    })()
  `);

  const available = Object.values(paths).filter(v => v.available).length;
  const total = Object.keys(paths).length;

  return { success: true, apis_available: available, apis_total: total, apis: paths };
}

export async function uiState() {
  const state = await evaluate(`
    (function() {
      var ui = {};
      var bottom = document.querySelector('[class*="layout__area--bottom"]');
      ui.bottom_panel = { open: !!(bottom && bottom.offsetHeight > 50), height: bottom ? bottom.offsetHeight : 0 };
      var right = document.querySelector('[class*="layout__area--right"]');
      ui.right_panel = { open: !!(right && right.offsetWidth > 50), width: right ? right.offsetWidth : 0 };
      var monacoEl = document.querySelector('.monaco-editor.pine-editor-monaco');
      ui.pine_editor = { open: !!monacoEl, width: monacoEl ? monacoEl.offsetWidth : 0, height: monacoEl ? monacoEl.offsetHeight : 0 };
      var stratPanel = document.querySelector('[data-name="backtesting"]') || document.querySelector('[class*="strategyReport"]');
      ui.strategy_tester = { open: !!(stratPanel && stratPanel.offsetParent) };
      var widgetbar = document.querySelector('[data-name="widgetbar-wrap"]');
      ui.widgetbar = { open: !!(widgetbar && widgetbar.offsetWidth > 50) };
      ui.buttons = {};
      var btns = document.querySelectorAll('button');
      var seen = {};
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.offsetParent === null || b.offsetWidth < 15) continue;
        var text = b.textContent.trim();
        var aria = b.getAttribute('aria-label') || '';
        var dn = b.getAttribute('data-name') || '';
        var label = text || aria || dn;
        if (!label || label.length > 60) continue;
        var key = label.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 40);
        if (seen[key]) continue;
        seen[key] = true;
        var rect = b.getBoundingClientRect();
        var region = 'other';
        if (rect.y < 50) region = 'top_bar';
        else if (rect.y < 90 && rect.x < 650) region = 'toolbar';
        else if (rect.x < 45) region = 'left_sidebar';
        else if (rect.x > 650 && rect.y < 100) region = 'pine_header';
        else if (rect.y > 750) region = 'bottom_bar';
        if (!ui.buttons[region]) ui.buttons[region] = [];
        ui.buttons[region].push({ label: label.substring(0, 40), disabled: b.disabled, x: Math.round(rect.x), y: Math.round(rect.y) });
      }
      ui.key_buttons = {};
      var keyLabels = {
        'add_to_chart': /add to chart/i, 'save_and_add': /save and add/i,
        'update_on_chart': /update on chart/i, 'save': /^Save(Save)?$/,
        'saved': /^Saved/, 'publish_script': /publish script/i,
        'compile_errors': /error/i, 'unsaved_version': /unsaved version/i,
      };
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.offsetParent === null) continue;
        var text = b.textContent.trim();
        for (var k in keyLabels) {
          if (keyLabels[k].test(text)) {
            ui.key_buttons[k] = { text: text.substring(0, 40), disabled: b.disabled, visible: b.offsetWidth > 0 };
          }
        }
      }
      ui.dialogs = [];
      var dialogNodes = document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [data-name="confirm-dialog"], [data-name="warning-dialog"], [class~="js-dialog"]'
      );
      function isDialogSurface(node) {
        if (node.matches('[role="dialog"], [aria-modal="true"], [data-name="confirm-dialog"], [data-name="warning-dialog"]')) {
          return true;
        }
        if (!node.matches('[class~="js-dialog"]')) return false;
        var text = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
        var controls = node.querySelectorAll('button, [role="button"], [role="radio"], label');
        for (var c = 0; c < controls.length; c++) {
          var controlLabel = ((controls[c].getAttribute('aria-label') || '') + ' ' + (controls[c].textContent || ''))
            .replace(/\\s+/g, ' ')
            .trim();
          if (/publish new script|publish existing script|publish private|publish public/i.test(controlLabel)) return true;
        }
        return /publish (?:new|existing) script/i.test(text)
          && /(?:continue|next|privacy|private|public|description)/i.test(text);
      }
      var seenDialogs = [];
      for (var d = 0; d < dialogNodes.length; d++) {
        var dlg = dialogNodes[d];
        if (dlg.offsetParent === null && dlg.getClientRects().length === 0) continue;
        if (!isDialogSurface(dlg)) continue;
        if (seenDialogs.indexOf(dlg) !== -1) continue;
        var nestedDialogs = dlg.querySelectorAll(
          '[role="dialog"], [aria-modal="true"], [data-name="confirm-dialog"], [data-name="warning-dialog"], [class~="js-dialog"]'
        );
        var hasVisibleNestedDialog = false;
        for (var nd = 0; nd < nestedDialogs.length; nd++) {
          if (
            (nestedDialogs[nd].offsetParent !== null || nestedDialogs[nd].getClientRects().length > 0)
            && isDialogSurface(nestedDialogs[nd])
          ) {
            hasVisibleNestedDialog = true;
            break;
          }
        }
        if (hasVisibleNestedDialog) continue;
        seenDialogs.push(dlg);
        var dlgText = (dlg.innerText || dlg.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!dlgText) continue;
        var dlgButtons = [];
        var dlgButtonNodes = dlg.querySelectorAll('button, [role="button"]');
        for (var db = 0; db < dlgButtonNodes.length; db++) {
          var dlgButton = dlgButtonNodes[db];
          if (dlgButton.offsetParent === null && dlgButton.getClientRects().length === 0) continue;
          var dlgButtonText = (dlgButton.textContent || dlgButton.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
          if (dlgButtonText && dlgButtons.indexOf(dlgButtonText) === -1) dlgButtons.push(dlgButtonText.substring(0, 80));
        }
        ui.dialogs.push({
          text: dlgText.substring(0, 500),
          buttons: dlgButtons,
          input_count: dlg.querySelectorAll('input, textarea').length,
        });
      }
      ui.blocking_dialog = ui.dialogs.length > 0 ? ui.dialogs[ui.dialogs.length - 1] : null;
      try {
        var chart = ${KNOWN_PATHS.chartApi};
        ui.chart = { symbol: chart.symbol(), resolution: chart.resolution(), chartType: chart.chartType(), study_count: chart.getAllStudies().length };
      } catch(e) { ui.chart = { error: e.message }; }
      try {
        var replay = ${KNOWN_PATHS.replayApi};
        function unwrap(v) { return (v && typeof v === 'object' && typeof v.value === 'function') ? v.value() : v; }
        ui.replay = { available: unwrap(replay.isReplayAvailable()), started: unwrap(replay.isReplayStarted()) };
      } catch(e) { ui.replay = { error: e.message }; }
      return ui;
    })()
  `);

  return { success: true, ...state };
}
