import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const MODULES = ['worker.js', 'utils.js', 'db.js', 'services.js'];
const SCRIPTS = {};
for (const m of MODULES) {
  SCRIPTS[m] = readFileSync('src/' + m, 'utf8');
}
const TOTAL_KB = Object.values(SCRIPTS).reduce((s, c) => s + c.length, 0) / 1024;
const ACCOUNT_ID = process.env.DEPLOY_ACCOUNT_ID || '02a5ee785952a4e4b7b6da209e10c53d';
const SCRIPT_NAME = 'poetry';
const D1_ID = process.env.DEPLOY_D1_ID || '9f979733-d291-4e4a-af29-7cb463ca534a';
const KV_ID = process.env.DEPLOY_KV_ID || 'fd50e45d91a6485b944e69056960dccd';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;

if (!TOKEN) {
  console.error('FATAL: CLOUDFLARE_API_TOKEN or CF_API_TOKEN env var required');
  process.exit(1);
}

const KV_API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_ID}/values`;

async function kvPut(key, value, contentType) {
  const resp = await fetch(`${KV_API}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': contentType,
    },
    body: value,
  });
  const result = await resp.json();
  if (!result.success) {
    console.error(`  FAILED ${key}:`, JSON.stringify(result.errors));
    return false;
  }
  console.log(`  OK ${key}`);
  return true;
}

async function uploadStatic(dir, prefix) {
  const entries = readdirSync(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      await uploadStatic(full, prefix + name + '/');
    } else {
      const key = prefix + name;
      const content = readFileSync(full);
      const mime = {
        '.html': 'text/html;charset=utf-8',
        '.js': 'application/javascript;charset=utf-8',
        '.css': 'text/css;charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.svg': 'image/svg+xml',
      }[extname(name)] || 'application/octet-stream';
      process.stdout.write(`  Uploading ${key}...\n`);
      await kvPut(key, content, mime);
    }
  }
}

// 1. Deploy worker script (all modules)
const metadata = JSON.stringify({
  main_module: 'worker.js',
  bindings: [
    { name: 'DB', type: 'd1', id: D1_ID },
    { name: 'STATIC', type: 'kv_namespace', namespace_id: KV_ID },
  ],
  triggers: {
    crons: ['0 8 * * *'],
  },
});

const boundary = '----FormBoundary' + Date.now();

function encode(s) {
  return new TextEncoder().encode(s);
}

const parts = [];
const totalScriptBytes = [];

function addPart(name, filename, contentType, data) {
  const header = encode('--' + boundary + '\r\n');
  totalScriptBytes.push(header);
  const disp = encode('Content-Disposition: form-data; name="' + name + '"' + (filename ? '; filename="' + filename + '"' : '') + '\r\n');
  totalScriptBytes.push(disp);
  totalScriptBytes.push(encode('Content-Type: ' + contentType + '\r\n\r\n'));
  totalScriptBytes.push(encode(data));
  totalScriptBytes.push(encode('\r\n'));
}

addPart('metadata', null, 'application/json', metadata);
for (const m of MODULES) {
  addPart(m, m, 'application/javascript+module', SCRIPTS[m]);
}

totalScriptBytes.push(encode('--' + boundary + '--\r\n'));

const totalLength = totalScriptBytes.reduce((s, p) => s + p.byteLength, 0);
const body = new Uint8Array(totalLength);
let offset = 0;
for (const p of totalScriptBytes) {
  body.set(p, offset);
  offset += p.byteLength;
}

console.log('Uploading worker modules (' + TOTAL_KB.toFixed(1) + 'KB total)...');

const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}`;
const resp = await fetch(url, {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer ' + TOKEN,
    'Content-Type': 'multipart/form-data; boundary=' + boundary,
  },
  body: body,
});

const result = await resp.json();
if (!result.success) {
  console.error('Upload failed:', JSON.stringify(result.errors));
  process.exit(1);
}
console.log('Deployed! Tag:', result.result.tag, 'Deployment:', result.result.deployment_id);

// 2. Upload static files to KV
console.log('Uploading static files...');
await uploadStatic('public', '');
