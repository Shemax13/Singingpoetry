const API = 'https://shemax-esm2.shemax.workers.dev/api';
let token = localStorage.getItem('shemax-admin-token');
let songs = [];

function $(id) { return document.getElementById(id); }

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
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
  const result = await api('POST', '/admin/login', { password });
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
  await Promise.all([loadSongsList(), loadSettings()]);
}

async function loadSongsList() {
  const result = await api('GET', '/admin/songs');
  if (!result.ok) return;
  songs = result.data || [];
  renderSongsTable();
  updateStats();
}

function renderSongsTable() {
  const tbody = $('songsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  songs.forEach((song, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="drag-handle">⠿</td>
      <td>${idx + 1}</td>
      <td>${escapeHtml(song.title)}</td>
      <td>
        ${song.tg_video_url ? '<span class="badge badge-video">Video</span>' : ''}
        ${song.suno_audio_url ? '<span class="badge badge-audio">Audio</span>' : ''}
      </td>
      <td class="status-cell">
        <label class="toggle">
          <input type="checkbox" ${song.visible ? 'checked' : ''}
            onchange="toggleVisibility(${song.id}, this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        <button class="btn-sm" onclick="editSong(${song.id})">✎</button>
        <button class="btn-sm btn-danger" onclick="deleteSong(${song.id})">✕</button>
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

function updateStats() {
  const total = songs.length;
  const visible = songs.filter(s => s.visible).length;
  $('statTotal').textContent = total;
  $('statVisible').textContent = visible;
  $('statHidden').textContent = total - visible;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

async function toggleVisibility(id, visible) {
  const song = songs.find(s => s.id === id);
  if (!song) return;
  song.visible = visible ? 1 : 0;
  await api('PUT', `/admin/songs/${id}`, { visible: song.visible });
  updateStats();
}

async function deleteSong(id) {
  if (!confirm('Delete this song?')) return;
  await api('DELETE', `/admin/songs/${id}`);
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
  renderSongsTable();
}

// Edit song modal
function editSong(id) {
  const song = songs.find(s => s.id === id);
  if (!song) return;
  $('editId').value = song.id || '';
  $('editTitle').value = song.title || '';
  $('editLyrics').value = song.lyrics || '';
  $('editTgUrl').value = song.tg_video_url || '';
  $('editSunoUrl').value = song.suno_track_url || '';
  $('editLanguage').value = song.language || 'ru';
  $('editModal').classList.remove('hidden');
}

function closeEdit() {
  $('editModal').classList.add('hidden');
}

async function saveEdit() {
  const body = {
    title: $('editTitle').value,
    lyrics: $('editLyrics').value,
    tg_video_url: $('editTgUrl').value || null,
    suno_track_url: $('editSunoUrl').value || null,
    language: $('editLanguage').value,
  };
  const id = $('editId').value;
  if (id) {
    await api('PUT', `/admin/songs/${id}`, body);
  } else {
    await api('POST', '/admin/songs', body);
  }
  closeEdit();
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
  btn.disabled = true;
  btn.textContent = 'Syncing...';
  const result = await api('POST', '/admin/sync', {});
  btn.disabled = false;
  btn.textContent = 'Sync Telegram';
  if (result.ok) {
    loadSongsList();
  }
}

// Settings
async function loadSettings() {
  const result = await api('GET', '/admin/settings');
  if (!result.ok || !result.data) return;
  if (result.data.about_text_ru) $('aboutTextRu').value = result.data.about_text_ru;
  if (result.data.about_text_en) $('aboutTextEn').value = result.data.about_text_en;
}

async function saveSettings() {
  await api('POST', '/admin/settings', {
    about_text_ru: $('aboutTextRu').value,
    about_text_en: $('aboutTextEn').value,
  });
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
