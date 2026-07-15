// Upload a media file to GitHub raw via Worker API
// Usage: ADMIN_TOKEN=xxx node scripts/cache-song.js <song-id> <file-path>
// Example: ADMIN_TOKEN=xxx node scripts/cache-song.js 123 ./video.mp4
// The file is uploaded through the Worker, which stores it on GitHub,
// then updates the song's tg_video_url in the database.

var WORKER = 'https://poetry.shemax.workers.dev';

async function main() {
  var args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: ADMIN_TOKEN=xxx node scripts/cache-song.js <song-id> <file-path>');
    process.exit(1);
  }
  var songId = parseInt(args[0], 10);
  var filePath = args[1];
  if (!songId || !filePath) { console.error('Invalid arguments'); process.exit(1); }

  var fs = await import('fs');
  if (!fs.existsSync(filePath)) { console.error('File not found:', filePath); process.exit(1); }

  var token = process.env.ADMIN_TOKEN;
  if (!token) { console.error('Set ADMIN_TOKEN env var (get from admin panel login)'); process.exit(1); }

  var stat = fs.statSync(filePath);
  var ext = filePath.substring(filePath.lastIndexOf('.'));
  var contentType = ext === '.mp4' ? 'video/mp4' : ext === '.m4a' ? 'audio/mp4' : ext === '.mp3' ? 'audio/mpeg' : ext === '.ogg' ? 'audio/ogg' : ext === '.webm' ? 'video/webm' : 'video/mp4';

  console.log('Uploading', filePath, '(' + (stat.size / 1024 / 1024).toFixed(1) + 'MB) to song #' + songId + '...');

  var fileBuffer = fs.readFileSync(filePath);
  var resp = await fetch(WORKER + '/api/upload-video/' + songId, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': contentType },
    body: fileBuffer,
  });
  var result = await resp.json();
  if (result.ok) {
    console.log('Done. Song #' + songId + ' cached at', result.data ? result.data.url : '(unknown)');
  } else {
    console.error('Failed:', JSON.stringify(result));
    process.exit(1);
  }
}

main().catch(function(e) { console.error('Error:', e.message); process.exit(1); });
