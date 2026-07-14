const { Driver, IamAuthService } = require('ydb-sdk');
const { TableDescription, Column, AUTO_TX, Types } = require('ydb-sdk');
const fs = require('fs');

const endpoint = 'grpcs://ydb.serverless.yandexcloud.net:2135';
const database = '/ru-central1/b1g25si1urnkfqhh7vlj/etnoghq53eii07srv7np';

function col(name, type) {
  return new Column(name, Types.optional(type));
}
function pkCol(name, type) {
  return new Column(name, type);
}

async function run() {
  const keyData = JSON.parse(fs.readFileSync('sa-key.json', 'utf8'));
  const authService = new IamAuthService({
    serviceAccountId: keyData.service_account_id,
    accessKeyId: keyData.id,
    privateKey: Buffer.from(keyData.private_key, 'utf8'),
    iamEndpoint: 'iam.api.cloud.yandex.net:443',
  });

  const driver = new Driver({ endpoint, database, authService });
  if (!await driver.ready(15000)) {
    console.error('Driver not ready');
    process.exit(1);
  }
  console.log('Connected to YDB');

  const tableDefs = {
    songs: {
      columns: [
        pkCol('id', Types.UINT64),
        col('telegram_message_id', Types.UINT64), col('title', Types.UTF8),
        col('lyrics', Types.UTF8), col('tg_video_url', Types.UTF8),
        col('tg_file_id', Types.UTF8), col('suno_audio_url', Types.UTF8),
        col('suno_cover_url', Types.UTF8), col('suno_track_url', Types.UTF8),
        col('cover_url', Types.UTF8), col('published_at', Types.UTF8),
        col('order_index', Types.INT64), col('visible', Types.BOOL),
        col('language', Types.UTF8), col('created_at', Types.UTF8),
        col('updated_at', Types.UTF8), col('suno_title', Types.UTF8),
        col('description', Types.UTF8), col('r2_video_url', Types.UTF8),
        col('r2_migratable', Types.BOOL), col('pending_review', Types.BOOL),
        col('pending_metadata', Types.UTF8), col('metadata_source', Types.UTF8),
      ],
      pk: ['id'],
    },
    messages: {
      columns: [
        pkCol('id', Types.UINT64), col('tg_msg_id', Types.UINT64),
        col('chat_id', Types.UTF8), col('chat_type', Types.UTF8),
        col('msg_type', Types.UTF8), col('text_content', Types.UTF8),
        col('file_id', Types.UTF8), col('file_unique_id', Types.UTF8),
        col('file_url', Types.UTF8), col('mime_type', Types.UTF8),
        col('file_size', Types.UINT64), col('duration', Types.UINT64),
        col('forward_from_chat_id', Types.UTF8), col('forward_from_msg_id', Types.UINT64),
        col('reply_to_msg_id', Types.UINT64), col('reply_to_chat_id', Types.UTF8),
        col('published_at', Types.UTF8), col('created_at', Types.UTF8),
        col('cover_file_id', Types.UTF8), col('cover_url', Types.UTF8),
        col('file_name', Types.UTF8),
      ],
      pk: ['id'],
    },
    settings: {
      columns: [pkCol('key', Types.UTF8), col('value', Types.UTF8)],
      pk: ['key'],
    },
    admin_sessions: {
      columns: [pkCol('id', Types.UTF8), col('created_at', Types.UTF8), col('expires_at', Types.UTF8)],
      pk: ['id'],
    },
    extra_audio: {
      columns: [
        pkCol('id', Types.UINT64), col('song_id', Types.UINT64), col('title', Types.UTF8),
        col('file_url', Types.UTF8), col('r2_key', Types.UTF8), col('file_type', Types.UTF8),
        col('source', Types.UTF8), col('telegram_message_id', Types.UINT64),
        col('duration', Types.UINT64), col('visible', Types.BOOL),
        col('published_at', Types.UTF8), col('created_at', Types.UTF8), col('updated_at', Types.UTF8),
      ],
      pk: ['id'],
    },
    external_link_types: {
      columns: [
        pkCol('id', Types.UINT64), col('name', Types.UTF8), col('icon', Types.UTF8),
        col('sort_order', Types.INT64), col('created_at', Types.UTF8),
      ],
      pk: ['id'],
    },
    song_external_links: {
      columns: [
        pkCol('id', Types.UINT64), col('song_id', Types.UINT64), col('link_type_id', Types.UINT64),
        col('url', Types.UTF8), col('description', Types.UTF8), col('created_at', Types.UTF8),
      ],
      pk: ['id'],
    },
    metadata_reviews: {
      columns: [
        pkCol('id', Types.UINT64), col('song_id', Types.UINT64), col('field', Types.UTF8),
        col('old_value', Types.UTF8), col('new_value', Types.UTF8), col('source', Types.UTF8),
        col('status', Types.UTF8), col('created_at', Types.UTF8),
      ],
      pk: ['id'],
    },
  };

  for (const [name, def] of Object.entries(tableDefs)) {
    try {
      await driver.tableClient.withSession(async (session) => {
        await session.createTable(name, new TableDescription(def.columns, def.pk));
      });
      console.log(`✓ Table ${name} created`);
    } catch (e) {
      if (e.message && (e.message.includes('already exists') || e.message.includes('TableCreationError'))) {
        console.log(`~ Table ${name} already exists`);
      } else {
        console.error(`✗ Table ${name}: ${e.message.substring(0, 100)}`);
      }
    }
  }

  // Import data
  console.log('\nImporting settings...');
  const settingsRows = [
    ['site_language', 'ru'],
    ['songs_per_page', '20'],
    ['last_sync_at', ''],
    ['about_text_ru', "Поэтический проект Shemaxpoetry"],
    ['about_text_en', 'Shemaxpoetry poetic project'],
  ];
  for (const [k, v] of settingsRows) {
    await driver.tableClient.withSession(async (session) => {
      await session.executeQuery(`UPSERT INTO settings (key, value) VALUES ('${k}', '${v.replace(/'/g, "''")}');`);
    });
  }
  console.log('Settings imported');

  console.log('Importing link types...');
  for (const lt of [
    { id: 1, name: 'Instagram', icon: '📷', sort: 1 },
    { id: 2, name: 'TikTok', icon: '🎵', sort: 2 },
    { id: 3, name: 'VK', icon: '💬', sort: 3 },
  ]) {
    await driver.tableClient.withSession(async (session) => {
      await session.executeQuery(`UPSERT INTO external_link_types (id, name, icon, sort_order) VALUES (${lt.id}, '${lt.name}', '${lt.icon}', ${lt.sort});`);
    });
  }
  console.log('Link types imported');

  const songsData = JSON.parse(fs.readFileSync('/tmp/d1_songs.json', 'utf8'));
  const songs = songsData[0].results;
  console.log(`\nImporting ${songs.length} songs...`);

  const batchSize = 20;
  for (let i = 0; i < songs.length; i += batchSize) {
    const batch = songs.slice(i, i + batchSize);
    const values = batch.map(song => {
      const esc = (v) => {
        if (v === null || v === undefined) return 'NULL';
        return "'" + String(v).replace(/'/g, "''") + "'";
      };
      return `(${song.id}, ${song.telegram_message_id ?? 'NULL'}, ${esc(song.title)}, ${esc(song.lyrics)}, ${esc(song.tg_video_url)}, ${esc(song.tg_file_id)}, ${esc(song.suno_audio_url)}, ${esc(song.suno_cover_url)}, ${esc(song.suno_track_url)}, ${esc(song.cover_url)}, ${esc(song.published_at)}, ${song.order_index || 0}, ${song.visible ? 'true' : 'false'}, ${esc(song.language || 'ru')}, ${esc(song.created_at || '')}, ${esc(song.updated_at || '')})`;
    }).join(',\n');
    
    try {
      await driver.tableClient.withSession(async (session) => {
        await session.executeQuery(`UPSERT INTO songs (id, telegram_message_id, title, lyrics, tg_video_url, tg_file_id, suno_audio_url, suno_cover_url, suno_track_url, cover_url, published_at, order_index, visible, language, created_at, updated_at) VALUES ${values};`);
      });
    } catch (e) {
      console.error(`Error batch ${i}: ${e.message.substring(0, 150)}`);
    }
    if ((i / batchSize) % 5 === 0) process.stdout.write(`  ${Math.min(i + batchSize, songs.length)}/${songs.length}\n`);
  }
  console.log('Songs imported');

  await driver.destroy();
  console.log('\nDone!');
}

run().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
