import { readFileSync } from 'fs';

const ACCOUNT_ID = 'a3aa2b215031e097488bb52593789c18';
const SCRIPT_NAME = 'poetry';
const D1_ID = 'c139e4fb-afee-4752-978e-f323bbec4aa7';
const KV_ID = '67c625a1b9014853b895f8dfc726b1fa';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;

if (!TOKEN) {
  console.error('Set CLOUDFLARE_API_TOKEN env var to the OAuth token from ~/.config/.wrangler/config/default.toml');
  process.exit(1);
}

const MODULES = ['worker.js', 'utils.js', 'db.js', 'services.js'];
const SCRIPTS = {};
for (const m of MODULES) {
  SCRIPTS[m] = readFileSync('src/' + m, 'utf8');
}
const TOTAL_KB = Object.values(SCRIPTS).reduce((s, c) => s + c.length, 0) / 1024;

const metadata = JSON.stringify({
  main_module: 'worker.js',
  bindings: [
    { name: 'DB', type: 'd1', id: D1_ID },
    { name: 'STATIC', type: 'kv_namespace', namespace_id: KV_ID },
  ],
  triggers: { crons: ['0 8 * * *'] },
});

const boundary = '----FormBoundary' + Date.now();

function encode(s) { return new TextEncoder().encode(s); }

const totalScriptBytes = [];
function addPart(name, filename, ct, data) {
  totalScriptBytes.push(encode('--' + boundary + '\r\n'));
  totalScriptBytes.push(encode('Content-Disposition: form-data; name="' + name + '"' + (filename ? '; filename="' + filename + '"' : '') + '\r\n'));
  totalScriptBytes.push(encode('Content-Type: ' + ct + '\r\n\r\n'));
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
for (const p of totalScriptBytes) { body.set(p, offset); offset += p.byteLength; }

console.log('Uploading ' + TOTAL_KB.toFixed(1) + 'KB to old account...');

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
console.log('Deployed! Tag:', result.result.tag);
