import { readFileSync } from 'fs';

const SCRIPT = readFileSync('./dist/worker-bundle.js', 'utf8');
const ACCOUNT_ID = '02a5ee785952a4e4b7b6da209e10c53d';
const SCRIPT_NAME = 'poetry';
const D1_ID = '9f979733-d291-4e4a-af29-7cb463ca534a';
const KV_ID = 'fd50e45d91a6485b944e69056960dccd';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;

if (!TOKEN) { console.error('FATAL: CLOUDFLARE_API_TOKEN required'); process.exit(1); }

const metadata = JSON.stringify({
  main_module: 'worker.js',
  bindings: [
    { name: 'DB', type: 'd1', id: D1_ID },
    { name: 'STATIC', type: 'kv_namespace', namespace_id: KV_ID },
  ],
});

const boundary = '----FormBoundary' + Date.now();
function encode(s) { return new TextEncoder().encode(s); }

const parts = [];
function addPart(name, filename, contentType, data) {
  parts.push(encode('--' + boundary + '\r\n'));
  parts.push(encode('Content-Disposition: form-data; name="' + name + '"'));
  if (filename) parts.push(encode('; filename="' + filename + '"'));
  parts.push(encode('\r\n'));
  parts.push(encode('Content-Type: ' + contentType + '\r\n\r\n'));
  parts.push(encode(data));
  parts.push(encode('\r\n'));
}

addPart('metadata', null, 'application/json', metadata);
addPart('worker.js', 'worker.js', 'application/javascript+module', SCRIPT);
parts.push(encode('--' + boundary + '--\r\n'));

const body = new Uint8Array(parts.reduce((s, p) => s + p.byteLength, 0));
let offset = 0;
for (const p of parts) { body.set(p, offset); offset += p.byteLength; }

console.log('Uploading', SCRIPT.length, 'bytes...');

const resp = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}`,
  {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer ' + TOKEN,
      'Content-Type': 'multipart/form-data; boundary=' + boundary,
    },
    body: body,
  }
);

const result = await resp.json();
if (!result.success) {
  console.error('Failed:', JSON.stringify(result.errors));
  process.exit(1);
}
console.log('Deployed! Tag:', result.result.tag, 'Deployment:', result.result.deployment_id);
