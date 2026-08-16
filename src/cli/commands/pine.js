import { register } from '../router.js';
import * as core from '../../core/pine.js';
import { readFileSync } from 'fs';

async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

register('pine', {
  description: 'Pine Script tools',
  subcommands: new Map([
    ['get', {
      description: 'Get Pine Script source (current editor, or a saved script by name/id without opening it)',
      options: {
        name: { type: 'string', description: 'Saved script name to read without opening' },
        id: { type: 'string', description: 'scriptIdPart to read without opening' },
      },
      handler: (opts) => (opts.name || opts.id
        ? core.readScript({ name: opts.name, script_id: opts.id })
        : core.getSource()),
    }],
    ['read', {
      description: 'Read a saved or published script source by name/id WITHOUT opening it',
      options: {
        id: { type: 'string', description: 'scriptIdPart (takes precedence over name)' },
        scope: { type: 'string', description: 'saved (default) or published' },
        version: { type: 'string', description: 'Version to fetch (e.g. 2.0)' },
      },
      handler: (opts, positionals) => {
        const name = positionals.join(' ') || undefined;
        if (!name && !opts.id) throw new Error('Usage: tv pine read "Script Name"  |  tv pine read --id USER;xxxx [--scope published --version 2]');
        return core.readScript({ name, script_id: opts.id, scope: opts.scope, version: opts.version });
      },
    }],
    ['set', {
      description: 'Set Pine Script source (reads stdin or --file)',
      options: {
        file: { type: 'string', short: 'f', description: 'Read source from file' },
        'script-name': { type: 'string', description: 'Refuse if editor header identity differs' },
      },
      handler: async (opts) => {
        let source;
        if (opts.file) {
          source = readFileSync(opts.file, 'utf-8');
        } else {
          source = await readStdin();
        }
        if (!source) throw new Error('No source provided. Pipe source via stdin or use --file.');
        return core.setSource({ source, script_name: opts['script-name'] });
      },
    }],
    ['compile', {
      description: 'Smart compile: detect button, compile, check errors',
      options: {
        'require-published-imports': { type: 'boolean', description: 'Fail when import-resolve errors present' },
      },
      handler: (opts) => core.smartCompile({
        require_published_imports: !!opts['require-published-imports'],
      }),
    }],
    ['raw-compile', {
      description: 'Click compile/add button without smart detection',
      handler: () => core.compile(),
    }],
    ['analyze', {
      description: 'Offline static analysis (no TradingView needed)',
      options: {
        file: { type: 'string', short: 'f', description: 'Read source from file' },
      },
      handler: async (opts) => {
        let source;
        if (opts.file) {
          source = readFileSync(opts.file, 'utf-8');
        } else {
          source = await readStdin();
        }
        if (!source) throw new Error('No source provided. Pipe source via stdin or use --file.');
        return core.analyze({ source });
      },
    }],
    ['check', {
      description: 'Server-side compile check (no chart needed)',
      options: {
        file: { type: 'string', short: 'f', description: 'Read source from file' },
      },
      handler: async (opts) => {
        let source;
        if (opts.file) {
          source = readFileSync(opts.file, 'utf-8');
        } else {
          source = await readStdin();
        }
        if (!source) throw new Error('No source provided. Pipe source via stdin or use --file.');
        return core.check({ source });
      },
    }],
    ['save', {
      description: 'Save the current Pine Script (Ctrl+S)',
      handler: () => core.save(),
    }],
    ['new', {
      description: 'Create a new blank Pine Script (indicator, strategy, library)',
      handler: (opts, positionals) => {
        const type = positionals[0] || 'indicator';
        return core.newScript({ type });
      },
    }],
    ['open', {
      description: 'Open a saved Pine Script by registered identity (Open dialog)',
      options: {
        id: { type: 'string', description: 'scriptIdPart (disambiguates near-duplicate names)' },
      },
      handler: (opts, positionals) => {
        const name = positionals.join(' ') || undefined;
        if (!name && !opts.id) throw new Error('Usage: tv pine open "My Script"  |  tv pine open --id USER;xxxx');
        return core.openScript({ name, script_id: opts.id });
      },
    }],
    ['copy', {
      description: 'Make a registered UI copy of a script',
      options: {
        from: { type: 'string', description: 'Source script name' },
        'from-id': { type: 'string', description: 'Source scriptIdPart' },
        replace: { type: 'boolean', description: 'Replace if new name exists' },
      },
      handler: (opts, positionals) => {
        const newName = positionals.join(' ');
        if (!newName) throw new Error('Usage: tv pine copy --from "Old" "New Name"');
        if (!opts.from && !opts['from-id']) throw new Error('--from or --from-id required');
        return core.copyScript({
          from_name: opts.from,
          from_id: opts['from-id'],
          new_name: newName,
          replace: !!opts.replace,
        });
      },
    }],
    ['save-as', {
      description: 'Alias for pine copy (registered Save as / Make a copy)',
      options: {
        from: { type: 'string', description: 'Source script name' },
        'from-id': { type: 'string', description: 'Source scriptIdPart' },
        replace: { type: 'boolean', description: 'Replace if new name exists' },
      },
      handler: (opts, positionals) => {
        const newName = positionals.join(' ');
        if (!newName) throw new Error('Usage: tv pine save-as --from "Old" "New Name"');
        if (!opts.from && !opts['from-id']) throw new Error('--from or --from-id required');
        return core.saveAsScript({
          from_name: opts.from,
          from_id: opts['from-id'],
          new_name: newName,
          replace: !!opts.replace,
        });
      },
    }],
    ['add-to-chart', {
      description: 'Add/update the open Pine script on the active chart',
      handler: () => core.addToChart(),
    }],
    ['publish', {
      description: 'Publish the open or named script (private|public)',
      options: {
        name: { type: 'string', description: 'Script name to open and publish' },
        id: { type: 'string', description: 'scriptIdPart' },
        privacy: { type: 'string', description: 'private (default) or public' },
        description: { type: 'string', description: 'Publish description' },
      },
      handler: (opts) => core.publishScript({
        name: opts.name,
        id: opts.id,
        privacy: opts.privacy || 'private',
        description: opts.description,
      }),
    }],
    ['exports', {
      description: 'List export names for a published or saved Pine library (no consumer compile)',
      options: {
        id: { type: 'string', description: 'scriptIdPart or PUB;id' },
        scope: { type: 'string', description: 'published (default) or saved' },
        version: { type: 'string', description: 'Published version N' },
      },
      handler: (opts, positionals) => {
        const name = positionals.join(' ') || undefined;
        if (!name && !opts.id) throw new Error('Usage: tv pine exports "LibName" [--scope published --version 2]');
        return core.listLibraryExports({ name, script_id: opts.id, scope: opts.scope, version: opts.version });
      },
    }],
    ['list', {
      description: 'List saved Pine Scripts (with orphan / publish flags)',
      options: {
        'no-ui-check': { type: 'boolean', description: 'Skip Open-dialog ui_visible scrape' },
      },
      handler: (opts) => core.listScripts({ check_ui_visible: !opts['no-ui-check'] }),
    }],
    ['errors', {
      description: 'Get Pine Script compilation errors',
      handler: () => core.getErrors(),
    }],
    ['console', {
      description: 'Get Pine Script console/log output',
      handler: () => core.getConsole(),
    }],
  ]),
});
