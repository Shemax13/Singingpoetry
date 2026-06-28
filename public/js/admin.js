const API = 'https://poetry.shemax.workers.dev/api';
let token = localStorage.getItem('shemax-admin-token');
let songs = [];
let songs2 = [];
let mp4Only = true;
let noCoverFilter = false;

function $(id) { return document.getElementById(id); }

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!data.ok && res.status === 401) {
      showAuth();
      return data;
    }
    return data;
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

function showAuth() {
  token = null;
  localStorage.removeItem('shemax-admin-token');
  $('authSection').classList.remove('hidden');
  $('adminContent').classList.add('hidden');
}

function showAdmin() {
  $('authSection').classList.add('hidden');
  $('adminContent').classList.remove('hidden');
}

async function handleLogin() {
  const password = $('loginPassword').value;
  if (!password) {
    $('loginError').textContent = 'Enter password';
    $('loginError').classList.remove('hidden');
    return;
  }
  var turnstileToken = '';
  if (typeof turnstile !== 'undefined') {
    try { turnstileToken = turnstile.getResponse(); } catch(e) {}
    turnstile.reset();
  }
  const btn = $('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  const result = await api('POST', '/admin/login', { password, turnstile_token: turnstileToken });
  btn.disabled = false;
  btn.textContent = 'Sign In';
  if (result.ok && result.data?.token) {
    token = result.data.token;
    localStorage.setItem('shemax-admin-token', token);
    showAdmin();
    loadAdminData();
  } else {
    $('loginError').textContent = 'Invalid password';
    $('loginError').classList.remove('hidden');
  }
}

async function loadAdminData() {
  await loadSongsList();
}

function clearSongsCache() {
  try { localStorage.removeItem('songs_cache_admin'); } catch(e) {}
}

async function loadSongsList() {
  // Try cache first
  try {
    var cached = localStorage.getItem('songs_cache_admin');
    if (cached) {
      var parsed = JSON.parse(cached);
      if (parsed.data && Date.now() - parsed.ts < 36000000) {
        songs = parsed.data;
        songs2 = songs.filter(s => !hasCover(s));
        renderSongsTable();
        updateStats();
        // Refresh in background
        var r2 = await api('GET', '/admin/songs');
        if (r2.ok && r2.data) {
          songs = r2.data;
          try { localStorage.setItem('songs_cache_admin', JSON.stringify({ ts: Date.now(), data: songs })); } catch(e) {}
          songs2 = songs.filter(s => !hasCover(s));
          renderSongsTable();
          updateStats();
        }
        return;
      }
    }
  } catch(e) {}

  const result = await api('GET', '/admin/songs');
  if (!result.ok) return;
  songs = result.data || [];
  try { localStorage.setItem('songs_cache_admin', JSON.stringify({ ts: Date.now(), data: songs })); } catch(e) {}
  songs2 = songs.filter(s => !hasCover(s));
  renderSongsTable();
  updateStats();
}

function hasCover(song) {
  return (song.cover_url && song.cover_url !== '') || (song.suno_cover_url && song.suno_cover_url !== '');
}

function getFilteredSongs() {
  var list = noCoverFilter ? songs2 : songs;
  if (mp4Only) list = list.filter(s => s.tg_video_url && s.tg_video_url !== '');
  return list;
}

function renderSongsTable() {
  renderSongsTableWith(getFilteredSongs());
}

function updateStats() {
  const total = songs.length;
  const visible = songs.filter(s => s.visible).length;
  const noCover = songs.filter(s => !hasCover(s)).length;
  const withMp4 = songs.filter(s => s.tg_video_url && s.tg_video_url !== '').length;
  $('statTotal').textContent = total;
  $('statVisible').textContent = visible;
  $('statHidden').textContent = total - visible;
  const el = $('statNoCover');
  if (el) el.textContent = noCover;
  var mp4El = $('statMp4');
  if (!mp4El) {
    mp4El = document.createElement('div');
    mp4El.id = 'statMp4';
    mp4El.className = 'stat-item';
    mp4El.innerHTML = '<div class="stat-value">' + withMp4 + '</div><div class="stat-label">With MP4</div>';
    $('statNoCover').parentNode.parentNode.appendChild(mp4El);
  } else {
    mp4El.querySelector('.stat-value').textContent = withMp4;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
function idSafe(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

async function toggleVisibility(id, visible) {
  const song = songs.find(s => s.id === id);
  if (!song) return;
  song.visible = visible ? 1 : 0;
  await api('PUT', `/admin/songs/${id}`, song);
  clearSongsCache();
  updateStats();
}

async function deleteSong(id) {
  if (!confirm('Delete this song?')) return;
  await api('DELETE', `/admin/songs/${id}`);
  clearSongsCache();
  loadSongsList();
}

// Drag & drop reorder
let dragSrcId = null;
function handleDragStart(e) {
  dragSrcId = this.dataset.id;
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function handleDragOver(e) {
  e.preventDefault();
  this.classList.add('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over');
  if (dragSrcId && dragSrcId !== this.dataset.id) {
    const rows = [...document.querySelectorAll('#songsTableBody tr')];
    const fromIdx = rows.findIndex(r => r.dataset.id === dragSrcId);
    const toIdx = rows.findIndex(r => r.dataset.id === this.dataset.id);
    if (fromIdx >= 0 && toIdx >= 0) {
      const [moved] = songs.splice(fromIdx, 1);
      songs.splice(toIdx, 0, moved);
      saveOrder();
    }
  }
  dragSrcId = null;
}
function handleDragEnd(e) {
  this.classList.remove('dragging');
  document.querySelectorAll('#songsTableBody tr').forEach(r => r.classList.remove('drag-over'));
}

async function saveOrder() {
  const ids = songs.map(s => s.id);
  await api('PUT', '/admin/songs', { ids });
  songs2 = songs.filter(s => !hasCover(s));
  renderSongsTable();
}

// Edit song modal
function editSong(id) {
  $('editId').value = id || '';
  $('editTitle').value = '';
  $('editLyrics').value = '';
  $('editTgUrl').value = '';
  $('editCoverUrl').value = '';
  $('editSunoCoverUrl').value = '';
  $('editSunoUrl').value = '';
  $('editLanguage').value = 'ru';
  if (id) {
    const song = songs.find(s => s.id === id);
    if (song) {
      $('editId').value = song.id || '';
      $('editTitle').value = song.title || '';
      $('editLyrics').value = song.lyrics || '';
      $('editTgUrl').value = song.tg_video_url || '';
      $('editCoverUrl').value = song.cover_url || '';
      $('editSunoCoverUrl').value = song.suno_cover_url || '';
      $('editSunoUrl').value = song.suno_track_url || '';
      $('editLanguage').value = song.language || 'ru';
      loadPodcasts(song.id);
    }
  }
  showCoverPreview();
  $('editModal').classList.remove('hidden');
}

function showCoverPreview() {
  const preview = $('editCoverPreview');
  const url = $('editCoverUrl').value || $('editSunoCoverUrl').value;
  if (url) {
    preview.src = url;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
  }
}

function syncSunoCover(val) {
  const sunoInput = $('editSunoCoverUrl');
  if (!sunoInput.value) sunoInput.value = val;
  showCoverPreview();
}

function closeEdit() {
  $('editModal').classList.add('hidden');
}

async function saveEdit() {
  const coverUrl = $('editCoverUrl').value || null;
  const sunoCoverUrl = $('editSunoCoverUrl').value || null;
  const id = $('editId').value;
  const existing = id ? songs.find(s => s.id == id) : null;
  const body = {
    title: $('editTitle').value,
    lyrics: $('editLyrics').value,
    tg_video_url: $('editTgUrl').value || null,
    cover_url: coverUrl,
    suno_cover_url: sunoCoverUrl || coverUrl,
    suno_track_url: $('editSunoUrl').value || null,
    language: $('editLanguage').value,
    visible: existing ? existing.visible : 1,
    order_index: existing ? existing.order_index : 0,
    tg_file_id: existing ? existing.tg_file_id : null,
    suno_audio_url: existing ? existing.suno_audio_url : null,
    telegram_message_id: existing ? existing.telegram_message_id : null,
    published_at: existing ? existing.published_at : null,
  };
  var res = id ? await api('PUT', `/admin/songs/${id}`, body) : await api('POST', '/admin/songs', body);
  if (!res.ok) { alert(res.error || 'Save failed'); return; }
  closeEdit();
  clearSongsCache();
  loadSongsList();
}

// Suno fetch
async function fetchSuno() {
  const url = $('sunoUrl').value.trim();
  if (!url) return;
  const result = await api('POST', '/admin/suno', { url });
  if (result.ok && result.data) {
    $('editTitle').value = result.data.title || '';
    $('editSunoUrl').value = url;
    $('sunoResult').innerHTML = `
      <div class="suno-preview">
        <img src="${result.data.coverUrl || ''}" alt="cover" style="width:80px;height:80px;border-radius:8px;object-fit:cover">
        <div>
          <strong>${escapeHtml(result.data.title)}</strong><br>
          <span class="text-muted">${result.data.audioUrl ? '✓ Audio' : ''} ${result.data.duration ? '· ' + result.data.duration + 's' : ''}</span>
        </div>
      </div>`;
    $('sunoResult').dataset.audioUrl = result.data.audioUrl || '';
    $('sunoResult').dataset.coverUrl = result.data.coverUrl || '';
  } else {
    $('sunoResult').innerHTML = `<span class="error">Could not fetch track</span>`;
  }
}

// Sync
async function syncTelegram() {
  const btn = $('syncBtn');
  const status = $('syncStatus');
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  if (status) status.textContent = 'Temporarily removing webhook, polling history...';
  const result = await api('POST', '/admin/sync', {});
  btn.disabled = false;
  btn.textContent = 'Sync Pending';
  if (result.ok && result.data) {
    if (status) {
      if (result.data.synced > 0) {
        status.textContent = `✓ Synced ${result.data.synced} new post(s)`;
      } else {
        status.textContent = 'No pending updates found';
      }
    }
    clearSongsCache();
    loadSongsList();
  } else if (status) {
    status.textContent = 'Sync failed';
  }
}

async function scanChannel() {
  const from = parseInt($('scanFrom').value, 10) || 121;
  const to = parseInt($('scanTo').value, 10) || 2000;
  const delay = parseInt($('scanDelay').value, 10) || 1500;
  const btn = $('scanBtn');
  const status = $('scanStatus');
  btn.disabled = true;
  if (status) status.textContent = `Scanning IDs ${from}-${to} with ${delay}ms delay...`;
  const result = await api('POST', '/admin/scan-channel', { from, to, delayMs: delay, maxEmpties: 10 });
  btn.disabled = false;
  if (result.ok && result.data) {
    const errs = result.data.errors || [];
    if (status) {
      status.textContent = `✓ Found ${result.data.count} messages, scanned up to ${result.data.scannedUpTo}, nextFrom: ${result.data.nextFrom}${errs.length ? ', errors: ' + errs.length : ''}`;
    }
  } else if (status) {
    status.textContent = 'Scan failed';
  }
}

async function createSongs() {
  const btn = $('createSongsBtn');
  const status = $('createSongsStatus');
  btn.disabled = true;
  if (status) status.textContent = 'Creating songs...';
  const result = await api('POST', '/admin/create-songs', { limit: 100, offset: 0 });
  btn.disabled = false;
  if (result.ok && result.data) {
    if (status) status.textContent = `✓ Created ${result.data.created} songs, ${result.data.remaining} remaining`;
  } else if (status) {
    status.textContent = 'Create failed';
  }
}

async function resolveCovers() {
  const btn = $('resolveCoversBtn');
  const status = $('resolveCoversStatus');
  btn.disabled = true;
  if (status) status.textContent = 'Resolving...';
  const result = await api('POST', '/admin/resolve-covers', { limit: 100 });
  btn.disabled = false;
  if (result.ok && result.data) {
    if (status) status.textContent = `✓ Resolved ${result.data.resolved}, ${result.data.remaining} remaining`;
  } else if (status) {
    status.textContent = 'Resolve failed';
  }
}

async function searchSuno() {
  const btn = $('searchSunoBtn');
  const status = $('searchSunoStatus');
  btn.disabled = true;
  if (status) status.textContent = 'Searching...';
  const result = await api('POST', '/admin/search-suno', { limit: 50, offset: 0 });
  btn.disabled = false;
  if (result.ok && result.data) {
    if (status) status.textContent = `✓ Searched ${result.data.searched} songs, found ${result.data.found} Suno links`;
  } else if (status) {
    status.textContent = 'Search failed';
  }
}

async function dailySync() {
  const btn = $('dailySyncBtn');
  const status = $('dailySyncStatus');
  btn.disabled = true;
  if (status) status.textContent = 'Running...';
  const result = await api('POST', '/admin/daily-sync', {});
  btn.disabled = false;
  if (result.ok && result.data) {
    if (status) status.textContent = `✓ Checked ${result.data.checked} songs, updated ${result.data.updated}, errors ${result.data.errors}`;
  } else if (status) {
    status.textContent = 'Daily sync failed';
  }
}

async function importChannel() {
  const channel = $('importChannel').value.trim();
  const ids = $('importIds').value.trim();
  const status = $('importStatus');
  const btn = $('importBtn');
  if (!channel || !ids) { status.textContent = 'Enter channel and message IDs'; return; }
  btn.disabled = true;
  btn.textContent = 'Importing...';
  status.textContent = 'Forwarding messages to bot...';
  const result = await api('POST', '/admin/import-channel', { channel, message_ids: ids, target: '@ShemaxPoetryFreeChat' });
  btn.disabled = false;
  btn.textContent = 'Import';
  if (result.ok && result.data) {
    const errs = result.data.errors || [];
    if (result.data.imported > 0) {
      status.textContent = `✓ ${result.data.imported} post(s) forwarded — they will appear shortly`;
    } else {
      status.textContent = `No posts imported. Errors: ${errs.length}`;
    }
    if (errs.length) {
      console.log('Import errors:', errs);
    }
    setTimeout(function() { clearSongsCache(); loadSongsList(); }, 2000);
  } else {
    status.textContent = 'Import failed';
  }
}

// Publications
let allPublications = [];

async function loadPublications() {
  const container = $('publicationsList');
  const loading = $('publicationsLoading');
  const stats = $('pubStats');
  if (!container) return;

  // Try cache first
  try {
    var cached = localStorage.getItem('publications_cache');
    if (cached) {
      var parsed = JSON.parse(cached);
      if (parsed.data && Date.now() - parsed.ts < 36000000) {
        allPublications = parsed.data;
        filterPublications();
      }
    }
  } catch(e) {}

  loading.classList.remove('hidden');
  const result = await api('GET', '/admin/publications');
  loading.classList.add('hidden');
  if (!result.ok || !result.data) {
    if (!allPublications.length) container.innerHTML = '<span class="error">Failed to load</span>';
    return;
  }
  allPublications = result.data;
  try { localStorage.setItem('publications_cache', JSON.stringify({ ts: Date.now(), data: allPublications })); } catch(e) {}
  filterPublications();
}

function renderPublication(pub, idx) {
  const p = pub.post;
  const song = pub.song;
  const comments = pub.comments;
  const card = document.createElement('div');
  card.className = 'pub-card';
  card.dataset.index = idx;

  const meta = document.createElement('div');
  meta.className = 'pub-meta';
  meta.textContent = `#${idx} · ID ${p.channel_msg_id} · ${p.msg_type || 'text'} · ${p.published_at ? new Date(p.published_at).toLocaleDateString() : ''}`;
  card.appendChild(meta);

  if (song) {
    const badge = document.createElement('span');
    badge.style.cssText = 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.7rem;background:rgba(212,168,83,0.2);color:var(--accent);margin-bottom:6px';
    var badgeText = `♪ ${escapeHtml(song.title)}`;
    badge.textContent = badgeText;
    card.appendChild(badge);
    if (song.suno_audio_url) {
      const sunoBadge = document.createElement('span');
      sunoBadge.style.cssText = 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.7rem;background:rgba(59,130,246,0.2);color:#60a5fa;margin-bottom:6px;margin-left:4px';
      sunoBadge.textContent = 'Suno Audio';
      card.appendChild(sunoBadge);
    } else if (song.suno_track_url) {
      const sunoBadge = document.createElement('span');
      sunoBadge.style.cssText = 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.7rem;background:rgba(251,191,36,0.2);color:#fbbf24;margin-bottom:6px;margin-left:4px';
      sunoBadge.textContent = 'Suno Link';
      card.appendChild(sunoBadge);
    }
  }

  if (p.file_url) {
    const mediaDiv = document.createElement('div');
    mediaDiv.className = 'pub-media';
    const link = document.createElement('a');
    link.href = p.file_url;
    link.target = '_blank';
    const typeLabel = {video:'🎬 Video',audio:'🎵 Audio',voice:'🎤 Voice',photo:'📷 Photo',document:'📄 File'}[p.msg_type] || p.msg_type;
    link.textContent = typeLabel;
    mediaDiv.appendChild(link);
    if (p.file_size) {
      const size = document.createElement('span');
      size.className = 'text-muted';
      size.style.fontSize = '0.75rem';
      size.textContent = ` (${(p.file_size/1024/1024).toFixed(1)} MB)`;
      mediaDiv.appendChild(size);
    }
    card.appendChild(mediaDiv);
  }

  if (p.text_content) {
    const textDiv = document.createElement('div');
    textDiv.className = 'pub-text';
    textDiv.textContent = p.text_content;
    card.appendChild(textDiv);
  }

  if (comments && comments.length) {
    comments.forEach(c => {
      const cmt = document.createElement('div');
      cmt.className = 'pub-comment';
      cmt.textContent = (c.text_content || '(media)').substring(0, 200);
      card.appendChild(cmt);
    });
  } else {
    const empty = document.createElement('div');
    empty.className = 'pub-comment';
    empty.style.color = 'var(--text-muted)';
    empty.style.fontStyle = 'italic';
    empty.textContent = 'No comments yet';
    card.appendChild(empty);
  }
  return card;
}

function filterPublications() {
  const container = $('publicationsList');
  const stats = $('pubStats');
  if (!container || !allPublications.length) return;
  const q = ($('pubSearch')?.value || '').toLowerCase().trim();
  let filtered = allPublications;
  if (q) {
    filtered = allPublications.filter(pub => {
      const p = pub.post;
      const song = pub.song;
      const text = (p.text_content || '').toLowerCase();
      const date = (p.published_at || '');
      const id = String(p.channel_msg_id);
      const title = song ? (song.title || '').toLowerCase() : '';
      return text.includes(q) || date.includes(q) || id.includes(q) || title.includes(q);
    });
  }
  if (stats) {
    var sunoCount = allPublications.filter(p => p.song && p.song.suno_audio_url).length;
    stats.textContent = `${filtered.length} / ${allPublications.length} publications · ${sunoCount} Suno`;
  }
  container.innerHTML = '';
  filtered.forEach((pub, i) => {
    container.appendChild(renderPublication(pub, i + 1));
  });
}

function filterNoCover() {
  noCoverFilter = !noCoverFilter;
  const btn = $('filterNoCoverBtn');
  if (noCoverFilter) {
    btn.textContent = 'Show all';
    btn.classList.add('active');
    songs2 = songs.filter(s => !hasCover(s));
  } else {
    btn.textContent = 'Show missing covers';
    btn.classList.remove('active');
    songs2 = songs;
  }
  renderSongsTableWith(getFilteredSongs());
}

function toggleMp4Filter() {
  mp4Only = !mp4Only;
  const btn = $('filterMp4Btn');
  if (mp4Only) {
    btn.textContent = 'All songs';
    btn.classList.add('active');
  } else {
    btn.textContent = 'MP4 only';
    btn.classList.remove('active');
  }
  renderSongsTable();
}

function renderSongsTableWith(list) {
  const tbody = $('songsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  (list || songs).forEach((song, idx) => {
    const cover = hasCover(song);
    const tr = document.createElement('tr');
    var pc = parseInt(song.podcast_count, 10) || 0;
    tr.innerHTML = `
      <td class="drag-handle">⠿</td>
      <td>${idx + 1}</td>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <span${cover ? '' : ' style="color:var(--accent);font-weight:bold" title="No cover"'}>${escapeHtml(song.title)}</span>
          ${!cover ? '<span style="color:var(--accent);font-size:0.7rem">⚠️</span>' : ''}
        </div>
      </td>
      <td style="text-align:center">
        ${song.tg_video_url || song.suno_audio_url || song.podcast_audio_url
          ? `<button class="btn-sm" onclick="openPlayer(${idSafe(song.id)})" title="Play" style="color:var(--accent)">▶</button>`
          : '<span class="text-muted" style="font-size:0.75rem">—</span>'}
      </td>
      <td>
        ${song.tg_video_url ? '<span class="badge badge-video">Video</span>' : ''}
        ${song.suno_audio_url ? '<span class="badge badge-audio">Audio</span>' : ''}
      </td>
      <td style="text-align:center">
        ${cover
          ? '<span style="color:#4ade80;font-size:0.85rem">✓</span>'
          : `<button class="btn-sm" onclick="editSong(${idSafe(song.id)})" style="color:var(--accent)" title="Add cover">+</button>`}
      </td>
      <td style="text-align:center">${pc > 0 ? '<span style="color:#60a5fa;font-size:0.85rem" title="' + pc + ' podcast(s)">🎙' + pc + '</span>' : '<span class="text-muted" style="font-size:0.75rem">—</span>'}</td>
      <td class="status-cell">
        <label class="toggle">
          <input type="checkbox" ${song.visible ? 'checked' : ''}
            onchange="toggleVisibility(${idSafe(song.id)}, this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        <button class="btn-sm" onclick="editSong(${idSafe(song.id)})">✎</button>
        <button class="btn-sm btn-danger" onclick="deleteSong(${idSafe(song.id)})">✕</button>
      </td>`;
    tr.draggable = true;
    tr.dataset.id = song.id;
    tr.addEventListener('dragstart', handleDragStart);
    tr.addEventListener('dragover', handleDragOver);
    tr.addEventListener('drop', handleDrop);
    tr.addEventListener('dragend', handleDragEnd);
    tbody.appendChild(tr);
  });
}

// Podcasts
let currentPodcasts = [];

async function loadPodcasts(songId) {
  const container = $('podcastList');
  if (!container) return;
  container.innerHTML = '<span class="text-muted" style="font-size:0.85rem">Loading...</span>';
  const result = await api('GET', '/admin/songs/' + songId + '/podcasts');
  if (!result.ok || !result.data) { container.innerHTML = ''; return; }
  currentPodcasts = result.data;
  renderPodcasts();
}

function renderPodcasts() {
  const container = $('podcastList');
  if (!container) return;
  if (!currentPodcasts.length) {
    container.innerHTML = '<span class="text-muted" style="font-size:0.85rem">No podcasts attached</span>';
    return;
  }
  container.innerHTML = '';
  currentPodcasts.forEach(function(p) {
    var div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-primary);border-radius:var(--radius);margin-bottom:6px';
    var title = escapeHtml(p.title || 'Podcast');
    var dur = p.duration ? ' (' + p.duration + 's)' : '';
    div.innerHTML = '<span style="flex:1;font-size:0.85rem">🎙 ' + title + dur + '</span>' +
      '<button class="btn-sm btn-danger" onclick="detachPodcast(' + p.id + ')" style="padding:2px 8px">✕</button>';
    container.appendChild(div);
  });
}

async function detachPodcast(id) {
  if (!confirm('Remove this podcast?')) return;
  var result = await api('DELETE', '/admin/podcast/' + id);
  if (result.ok) {
    currentPodcasts = currentPodcasts.filter(function(p) { return p.id !== id; });
    renderPodcasts();
    clearSongsCache();
    loadSongsList();
  }
}

async function attachPodcast(songId, file) {
  var result = await api('POST', '/admin/attach-podcast', {
    song_id: songId,
    title: file.text_content || 'Podcast',
    file_url: file.file_url,
    duration: file.duration || null,
    telegram_message_id: file.tg_msg_id || null,
  });
  if (result.ok) {
    loadPodcasts(songId);
    clearSongsCache();
    loadSongsList();
  }
}

async function showPodcastSelector(songId) {
  var list = $('audioFilesList');
  var btn = $('attachPodcastBtn');
  if (list.classList.contains('hidden')) {
    list.classList.remove('hidden');
    btn.textContent = 'Cancel';
    list.innerHTML = '<span class="text-muted" style="font-size:0.85rem">Loading audio files...</span>';
    var result = await api('GET', '/admin/audio-files');
    if (!result.ok || !result.data) { list.innerHTML = '<span class="error">Failed to load</span>'; return; }
    list.innerHTML = '';
    var files = result.data;
    if (!files.length) {
      list.innerHTML = '<span class="text-muted" style="font-size:0.85rem">No audio files found in groups</span>';
      return;
    }
    files.forEach(function(f) {
      var div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-primary);border-radius:var(--radius);margin-bottom:4px;cursor:pointer;transition:var(--transition)';
      div.onmouseover = function() { this.style.background = 'rgba(255,255,255,0.05)'; };
      div.onmouseout = function() { this.style.background = ''; };
      var title = escapeHtml(f.file_name || f.text_content || 'Podcast #' + f.tg_msg_id);
      var dur = f.duration ? '(' + f.duration + 's)' : '';
      var date = f.published_at ? new Date(f.published_at).toLocaleDateString() : '';
      div.innerHTML = '<span style="flex:1;font-size:0.85rem">🎙 ' + title + ' <span class="text-muted">' + dur + ' ' + date + '</span></span>';
      div.onclick = function() {
        attachPodcast(songId, f);
        list.classList.add('hidden');
        btn.textContent = '+ Attach Podcast';
      };
      list.appendChild(div);
    });
  } else {
    list.classList.add('hidden');
    btn.textContent = '+ Attach Podcast';
  }
}

// Player
var API_BASE = 'https://poetry.shemax.workers.dev/api';

function openPlayer(id) {
  const song = songs.find(s => s.id === id);
  if (!song) return;
  const modal = $('playerModal') || $('pm');
  const title = $('playerTitle') || $('pt');
  const container = $('playerContainer') || $('pc');
  title.textContent = song.title || 'Untitled';
  var isVideo = !!song.tg_video_url;
  var mediaUrl;
  // Songs with only tg_file_id: proxy through /api/media/:id
  if (!song.tg_video_url && !song.suno_audio_url && !song.podcast_audio_url && song.tg_file_id) {
    mediaUrl = API_BASE + '/media/' + song.id;
  } else if (isVideo) {
    mediaUrl = song.tg_video_url;
  } else if (song.suno_audio_url && song.suno_audio_url.indexOf('api.telegram.org') !== -1) {
    mediaUrl = API_BASE + '/media/' + song.id;
  } else if (song.suno_audio_url) {
    mediaUrl = song.suno_audio_url;
  } else if (song.podcast_audio_url) {
    mediaUrl = song.podcast_audio_url;
  }
  if (!mediaUrl) {
    container.innerHTML = '<span class="text-muted">No media available</span>';
    modal.classList.remove('hidden');
    return;
  }
  var triedResolve = false;
  var showError = function() { container.innerHTML = '<span class="error">Failed to load media</span>'; };
  var tryResolve = function(el) {
    if (triedResolve) { showError(); return; }
    triedResolve = true;
    fetch(API_BASE + '/tg-file-url/' + song.id).then(function(r){return r.json();}).then(function(j){
      if (j.ok && j.url) {
        el.src = j.url;
        el.load();
      } else {
        showError();
      }
    }).catch(function(e){console.error("openPlayer failed",e);showError();});
  };
  if (isVideo) {
    var v = document.createElement('video');
    v.controls = true; v.autoplay = true; v.src = mediaUrl;
    container.innerHTML = ''; container.appendChild(v);
  } else {
    var a = document.createElement('audio');
    a.controls = true; a.autoplay = true; a.style.cssText = 'width:100%'; a.src = mediaUrl;
    container.innerHTML = ''; container.appendChild(a);
  }
  modal.classList.remove('hidden');
  var el = container.querySelector(isVideo ? 'video' : 'audio');
  if (el) {
    el.onerror = function() { tryResolve(el); };
  }
}

function closePlayer() {
  var container = $('playerContainer') || $('pc');
  if (container) container.innerHTML = '<span class="text-muted">No media available</span>';
  var modal = $('playerModal') || $('pm');
  if (modal) modal.classList.add('hidden');
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  if (token) {
    showAdmin();
    loadAdminData();
  } else {
    showAuth();
  }

  $('loginBtn')?.addEventListener('click', handleLogin);
  $('loginPassword')?.addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
});
