/**
 * Integration tests for registrar-level gating: the composed server surface
 * denies power tools by default, registers them on TV_ALLOW_DANGEROUS=1,
 * and keeps ui_evaluate on the always-on surface.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapRegistrar } from '../src/capabilities.js';
import { registerHealthTools } from '../src/tools/health.js';
import { registerUiTools } from '../src/tools/ui.js';
import { registerDrawingTools } from '../src/tools/drawing.js';
import { registerAlertTools } from '../src/tools/alerts.js';
import { registerBatchTools } from '../src/tools/batch.js';

const GATED = ['tv_update', 'tv_launch', 'alert_delete', 'draw_clear', 'batch_run'];

function buildServer() {
  const server = new McpServer({ name: 'test', version: '0.0.1' });
  wrapRegistrar(server);
  registerHealthTools(server);
  registerUiTools(server);
  registerDrawingTools(server);
  registerAlertTools(server);
  registerBatchTools(server);
  return server;
}

function toolNames(server) {
  return Object.keys(server._registeredTools ?? {});
}

describe('registrar gating (composed server)', () => {
  let savedDangerous;
  beforeEach(() => {
    savedDangerous = process.env.TV_ALLOW_DANGEROUS;
    delete process.env.TV_ALLOW_DANGEROUS;
  });
  afterEach(() => {
    if (savedDangerous === undefined) delete process.env.TV_ALLOW_DANGEROUS;
    else process.env.TV_ALLOW_DANGEROUS = savedDangerous;
  });

  it('denies all five power tools by default', () => {
    const names = toolNames(buildServer());
    for (const name of GATED) {
      assert.ok(!names.includes(name), `${name} absent by default`);
    }
  });

  it('keeps the read surface registered by default', () => {
    const names = toolNames(buildServer());
    for (const name of ['tv_health_check', 'ui_click', 'ui_evaluate', 'alert_create', 'draw_shape']) {
      assert.ok(names.includes(name), `${name} present by default`);
    }
  });

  it('registers the power tools when TV_ALLOW_DANGEROUS=1', () => {
    process.env.TV_ALLOW_DANGEROUS = '1';
    const names = toolNames(buildServer());
    for (const name of GATED) {
      assert.ok(names.includes(name), `${name} present on opt-in`);
    }
  });
});
