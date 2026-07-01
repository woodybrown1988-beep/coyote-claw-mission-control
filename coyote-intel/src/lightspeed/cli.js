'use strict';

const { loadConfig, assertConnectorEnabled } = require('./config.js');
const { OAuthTokenManager } = require('./oauth.js');
const { LightspeedClient } = require('./client.js');
const { JsonStateStore } = require('./state-store.js');
const { syncSales } = require('./sales-sync.js');
const { syncLabour } = require('./labour-sync.js');
const { runBackfill } = require('./backfill.js');
const { reconcileFiles } = require('./reconcile.js');

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        index += 1;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function buildRuntime(env = process.env) {
  const config = loadConfig(env);
  const tokenManager = new OAuthTokenManager(config);
  const client = new LightspeedClient(config, tokenManager);
  const stateStore = new JsonStateStore(config.stateStorePath);
  return { config, tokenManager, client, stateStore };
}

async function runCli(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const command = args._[0];
  const runtime = buildRuntime(env);

  if (command === 'auth-url') {
    printJson({ authUrl: runtime.tokenManager.buildAuthUrl(args.state) });
    return;
  }

  if (command === 'exchange-token') {
    assertConnectorEnabled(runtime.config);
    if (!args.code) {
      throw new Error('--code is required');
    }
    printJson(await runtime.tokenManager.exchangeCode(args.code));
    return;
  }

  if (command === 'sales-sync') {
    assertConnectorEnabled(runtime.config);
    printJson(await syncSales({ ...runtime, from: args.from, to: args.to }));
    return;
  }

  if (command === 'labour-sync') {
    assertConnectorEnabled(runtime.config);
    printJson(await syncLabour({ ...runtime, from: args.from, to: args.to }));
    return;
  }

  if (command === 'backfill') {
    assertConnectorEnabled(runtime.config);
    if (!args.from || !args.to) {
      throw new Error('--from and --to are required');
    }
    printJson(await runBackfill({ ...runtime, from: args.from, to: args.to }));
    return;
  }

  if (command === 'reconcile') {
    if (!args.api || !args.report) {
      throw new Error('--api and --report are required');
    }
    const drops = []
      .concat(args.drop || [])
      .concat(args.drop1 || [])
      .concat(args.drop2 || [])
      .filter(Boolean);
    printJson(reconcileFiles({ apiPath: args.api, fileDropPaths: drops, reportPath: args.report }));
    return;
  }

  throw new Error('Command must be one of auth-url, exchange-token, sales-sync, labour-sync, backfill, reconcile');
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  buildRuntime,
  parseArgs,
  runCli
};
