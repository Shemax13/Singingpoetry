const API = 'https://shemax-esm2.shemax.workers.dev/api';

let playerQueue = [];
let currentIndex = -1;
let isPlaying = false;
let playerMode = 'audio';

const player = {
  video: document.getElementById('playerVideo'),
  audio: document.getElementById('playerAudio'),
};

function $(id) { return document.getElementById(id); }

async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  return res.json();
}

// Load songs
async function loadSongs() {
  const container = $('songGrid');
  if (!container) return;

  container.innerHTML = '<div class="loading"></div>';
  const result = await apiGet('/songs?limit=50');

  if (!result.ok || !result.data?.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">♪</div>
        <p data-i18n="noSongs">${getText('noSongs')}</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  playerQueue = result.data;

  result.data.forEach((song, idx) => {
    const card = document.createElement('div');
    card.className = 'song-card';
    card.innerHTML = `
      <div class="song-card-thumb">
        ${song.suno_cover_url
          ? `<img src="${song.suno_cover_url}" alt="${song.title}" loading="lazy">`
          : `<div class="placeholder">♪</div>`}
        <div class="song-card-play">
          <div class="play-icon">▶</div>
        </div>
      </div>
      <div class="song-card-body">
        <div class="song-card-title">${escapeHtml(song.title)}</div>
        <div class="song-card-meta">#${idx + 1}</div>
      </div>`;
    card.addEventListener('click', () => playSong(idx));
    container.appendChild(card);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// Player
function playSong(index) {
  currentIndex = index;
  const song = playerQueue[index];
  if (!song) return;

  const videoUrl = song.tg_video_url;
  const audioUrl = song.suno_audio_url;

  const hasVideo = !!videoUrl;
  const hasAudio = !!audioUrl;

  // Determine available modes
  if (!hasVideo && !hasAudio) return;

  if (playerMode === 'video' && !hasVideo) {
    playerMode = 'audio';
  } else if (playerMode === 'audio' && !hasAudio) {
    playerMode = 'video';
  }

  // Set the src
  if (hasVideo) {
    player.video.src = videoUrl;
  }
  if (hasAudio) {
    player.audio.src = audioUrl;
  }

  // Show/hide mode buttons
  document.querySelectorAll('.mode-switch button').forEach(btn => {
    btn.style.display = 'none';
  });
  if (hasVideo) {
    const videoBtn = document.querySelector('[data-mode="video"]');
    if (videoBtn) { videoBtn.style.display = ''; videoBtn.classList.toggle('active', playerMode === 'video'); }
  }
  if (hasAudio) {
    const audioBtn = document.querySelector('[data-mode="audio"]');
    if (audioBtn) { audioBtn.style.display = ''; audioBtn.classList.toggle('active', playerMode === 'audio'); }
  }

  // Update UI
  updatePlayerUI(song);

  // Show player page
  const playerPage = $('playerPage');
  if (playerPage) {
    playerPage.classList.remove('hidden');
    playerPage.scrollIntoView({ behavior: 'smooth' });
  }

  // Play
  playCurrent();
}

function updatePlayerUI(song) {
  // Player bar
  const barCover = $('playerBarCover');
  const barTitle = $('playerBarTitle');
  if (barCover) {
    barCover.innerHTML = song.suno_cover_url
      ? `<img src="${song.suno_cover_url}" alt="">`
      : '<div class="placeholder">♪</div>';
  }
  if (barTitle) barTitle.textContent = song.title;
  $('playerBar').classList.add('active');

  // Player page
  const pageCover = $('playerPageCover');
  const pageTitle = $('playerPageTitle');
  const pageLyrics = $('playerPageLyrics');
  const pageModeVideo = $('playerPageModeVideo');
  const pageModeAudio = $('playerPageModeAudio');

  if (pageCover) {
    pageCover.innerHTML = song.suno_cover_url
      ? `<img src="${song.suno_cover_url}" alt="${song.title}">`
      : '<div class="placeholder">♪</div>';
  }
  if (pageTitle) pageTitle.textContent = song.title;
  if (pageLyrics) {
    pageLyrics.textContent = song.lyrics || song.title;
  }

  // Toggle video/audio display
  if (playerMode === 'video' && song.tg_video_url) {
    pageModeVideo?.classList.remove('hidden');
    pageModeAudio?.classList.add('hidden');
  } else if (song.suno_audio_url) {
    pageModeVideo?.classList.add('hidden');
    pageModeAudio?.classList.remove('hidden');
  }

  // Update queue
  updateQueue();
}

function playCurrent() {
  const song = playerQueue[currentIndex];
  if (!song) return;

  if (playerMode === 'video' && song.tg_video_url) {
    player.video.classList.remove('hidden');
    player.audio.classList.add('hidden');
    player.video.play().catch(() => {});
  } else if (song.suno_audio_url) {
    player.video.classList.add('hidden');
    player.audio.classList.remove('hidden');
    player.audio.play().catch(() => {});
  }

  isPlaying = true;
  updatePlayButtons();
}

function pauseCurrent() {
  player.video.pause();
  player.audio.pause();
  isPlaying = false;
  updatePlayButtons();
}

function togglePlay() {
  if (isPlaying) {
    pauseCurrent();
  } else {
    playCurrent();
  }
}

function updatePlayButtons() {
  document.querySelectorAll('.play-btn, .pp-play-btn').forEach(btn => {
    btn.innerHTML = isPlaying ? '⏸' : '▶';
  });
}

function nextSong() {
  if (currentIndex < playerQueue.length - 1) {
    playSong(currentIndex + 1);
  } else {
    playSong(0);
  }
}

function prevSong() {
  if (currentIndex > 0) {
    playSong(currentIndex - 1);
  } else {
    playSong(playerQueue.length - 1);
  }
}

function switchMode(mode) {
  if (mode === playerMode) return;
  const song = playerQueue[currentIndex];
  if (!song) return;

  if (mode === 'video' && !song.tg_video_url) return;
  if (mode === 'audio' && !song.suno_audio_url) return;

  playerMode = mode;
  document.querySelectorAll('.mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  if (isPlaying) {
    pauseCurrent();
    playCurrent();
  }

  const pageModeVideo = $('playerPageModeVideo');
  const pageModeAudio = $('playerPageModeAudio');
  if (mode === 'video') {
    pageModeVideo?.classList.remove('hidden');
    pageModeAudio?.classList.add('hidden');
  } else {
    pageModeVideo?.classList.add('hidden');
    pageModeAudio?.classList.remove('hidden');
  }
}

// Queue
function updateQueue() {
  const container = $('playerQueue');
  if (!container) return;

  container.innerHTML = `<div class="queue-title" data-i18n="queueTitle">${getText('queueTitle')}</div>`;

  playerQueue.forEach((song, idx) => {
    const item = document.createElement('div');
    item.className = `queue-item${idx === currentIndex ? ' active' : ''}`;
    item.innerHTML = `
      <div class="queue-item-num">${idx + 1}</div>
      <div class="queue-item-thumb">
        ${song.suno_cover_url
          ? `<img src="${song.suno_cover_url}" alt="">`
          : '<div class="placeholder">♪</div>`}
      </div>
      <div class="queue-item-info">
        <div class="queue-item-title">${escapeHtml(song.title)}</div>
      </div>`;
    item.addEventListener('click', () => playSong(idx));
    container.appendChild(item);
  });
}

// Player events
player.video.addEventListener('ended', nextSong);
player.audio.addEventListener('ended', nextSong);
player.video.addEventListener('timeupdate', updateProgress);
player.audio.addEventListener('timeupdate', updateProgress);

function updateProgress() {
  const el = playerMode === 'video' ? player.video : player.audio;
  const bar = $('playerProgress');
  const time = $('playerTime');
  if (bar && el.duration) {
    bar.value = (el.currentTime / el.duration) * 100;
  }
  if (time) {
    time.textContent = `${formatTime(el.currentTime)} / ${formatTime(el.duration)}`;
  }
}

function formatTime(s) {
  if (!s || !isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function seekTo(e) {
  const el = playerMode === 'video' ? player.video : player.audio;
  if (el.duration) {
    el.currentTime = (e.target.value / 100) * el.duration;
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  initI18n();
  loadSongs();

  const urlParams = new URLSearchParams(window.location.search);
  const songParam = urlParams.get('song');
  if (songParam && parseInt(songParam) >= 0) {
    setTimeout(() => playSong(parseInt(songParam)), 500);
  }
});
