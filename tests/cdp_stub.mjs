/**
 * In-process CDP stub for unit tests: a real HTTP server (serving /json/list)
 * with a WebSocket upgrade that speaks just enough of the Chrome DevTools
 * Protocol for chrome-remote-interface clients. Lets connection.js
 * (withTargetEvaluate) and core/capture.js run their REAL CDP code paths
 * against a fake target, with no TradingView Desktop.
 *
 *   const stub = await startCdpStub({ evaluate: (expr) => ({...}) });
 *   ... run code pointed at 127.0.0.1:stub.port ...
 *   await stub.stop();
 */
import http from 'node:http';
import pkg from 'ws';
const WebSocketServer = pkg.WebSocketServer || pkg.Server;

const DEFAULT_TARGETS = [
  { id: 'T1', type: 'page', title: 'Chart A', url: 'https://www.tradingview.com/chart/od9I4OCz/?symbol=ES1' },
  { id: 'T2', type: 'page', title: 'Chart B', url: 'https://www.tradingview.com/chart/abc12345/?symbol=NQ1' },
];

/**
 * @param {object} opts
 * @param {(expression:string, params:object)=>any} opts.evaluate  return the
 *   page value for a Runtime.evaluate call (throw to signal a JS exception).
 * @param {(params:object)=>string} [opts.captureScreenshot]  return base64 data.
 * @param {Array} [opts.targets]  targets served by /json/list.
 * @param {boolean} [opts.closeOnConnect]  terminate each WS connection as soon
 *   as the client sends its first message — simulates TradingView's CDP
 *   endpoint busy-closing a scoped socket (drives withTargetEvaluate's retry
 *   path and its final retryable "busy" error).
 */
export async function startCdpStub({ evaluate, captureScreenshot, targets = DEFAULT_TARGETS, closeOnConnect = false } = {}) {
  const evalCalls = [];
  const shotCalls = [];

  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/json/list') || req.url === '/json' || req.url === '/json/') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(targetsWithWs));
    } else if (req.url.startsWith('/json/protocol')) {
      // Minimal protocol descriptor: chrome-remote-interface builds its client
      // API from these domains, so only declare what tests use.
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        domains: [
          { domain: 'Runtime', commands: [{ name: 'enable' }, { name: 'evaluate' }] },
          { domain: 'Page', commands: [{ name: 'enable' }, { name: 'captureScreenshot' }] },
          { domain: 'DOM', commands: [{ name: 'enable' }] },
        ],
      }));
    } else if (req.url.startsWith('/json/version')) {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ Browser: 'CDP-stub' }));
    } else {
      res.statusCode = 404;
      res.end('not found');
    }
  });

  // Share the HTTP server for the WebSocket upgrade (chrome-remote-interface
  // issues a WS upgrade against the webSocketDebuggerUrl on the same port).
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    ws.on('message', (buf) => {
      if (closeOnConnect) { try { ws.terminate(); } catch { /* already gone */ } return; }
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      const { id, method, params = {} } = msg;
      const reply = (result) => ws.send(JSON.stringify({ id, result }));

      if (method === 'Runtime.evaluate') {
        evalCalls.push(params.expression);
        try {
          const value = evaluate ? evaluate(params.expression, params) : undefined;
          reply({ result: { type: 'object', value } });
        } catch (e) {
          reply({ result: { type: 'object' }, exceptionDetails: { text: e.message || 'error' } });
        }
      } else if (method === 'Page.captureScreenshot') {
        shotCalls.push(params);
        const data = captureScreenshot ? captureScreenshot(params) : Buffer.from('png-bytes').toString('base64');
        reply({ data });
      } else {
        reply({}); // Runtime/Page/DOM .enable and anything else
      }
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const targetsWithWs = targets.map((t) => ({
    ...t,
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${t.id}`,
  }));

  return {
    port,
    evalCalls,
    shotCalls,
    targets: targetsWithWs,
    async stop() {
      await new Promise((r) => wss.close(r));
      await new Promise((r) => server.close(r));
    },
  };
}

/** Stub globalThis.fetch to serve the stub's /json/list. Returns a restore fn. */
export function stubFetchToList(stub) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/json/list')) return { json: async () => stub.targets };
    return original(url);
  };
  return () => { globalThis.fetch = original; };
}
