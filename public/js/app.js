const API = 'https://poetry.shemax.workers.dev/api';
const CACHE_TTL = 1800000;

var playerQueue = [];
var currentIndex = -1;
var isPlaying = false;
var playerMode = 'video';
var vizActive = false;
var audioCtx = null;
var analyser = null;
var vizSource = null;
var vizRAF = null;

var videoEl = document.getElementById('playerVideo');
var audioEl = document.getElementById('playerAudio');
var canvas = document.getElementById('audioViz');
var canvasCtx = canvas.getContext('2d');

// Podcast
var isPlayingPodcast = false;
var podcastQueue = [];
var podcastQueueIndex = 0;
var podcastReturnIndex = -1;
var lastPlayedIndex = -1;
var searchTimer = null;
var linksData = {};
var linksPopupOpen = false;

function $(id) { return document.getElementById(id); }

function resizeCanvas() {
  var rect = $('mainScreen').getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  canvasCtx.setTransform(2, 0, 0, 2, 0, 0);
}

async function apiGet(path) {
  var res = await fetch(API + path);
  return res.json();
}

async function loadSongs() {
  var CHUNK = 50;
  // Try cache first
  try {
    var cached = localStorage.getItem('songs_cache');
    if (cached) {
      var parsed = JSON.parse(cached);
      if (parsed.data && parsed.data.length && Date.now() - parsed.ts < CACHE_TTL) {
        playerQueue = parsed.data;
        autoPlay();
        // Refresh in background — load ALL songs in parallel
        var allData = [];
        var result = await apiGet('/songs?limit=' + CHUNK);
        if (result.ok && result.data && result.data.length) {
          allData = result.data;
          // Fire next chunks in parallel
          var morePromises = [];
          for (var off = CHUNK; off < CHUNK + 250; off += CHUNK) {
            morePromises.push(apiGet('/songs?limit=' + CHUNK + '&offset=' + off));
          }
          var results = await Promise.all(morePromises);
          for (var i = 0; i < results.length; i++) {
            if (!results[i].ok || !results[i].data || !results[i].data.length) break;
            allData = allData.concat(results[i].data);
            if (results[i].data.length < CHUNK) break;
          }
          playerQueue = allData;
          localStorage.setItem('songs_cache', JSON.stringify({ ts: Date.now(), data: allData }));
          if (currentIndex >= 0 && currentIndex < playerQueue.length) {
            updateSideScreens();
            if ($('menuDropdown').classList.contains('open')) { renderMenuSongs(); renderMenuQueue(); }
          }
        }
        return;
      }
    }
  } catch(e) {}

  // Phase 1: load first 15 songs fast
  var result = await apiGet('/songs?limit=15');
  if (!result.ok || !result.data || !result.data.length) return;
  playerQueue = result.data;
  autoPlay();

  // Phase 2: load remaining songs in background (parallel)
  loadMoreSongs(15);
}

async function loadMoreSongs(offset) {
  var CHUNK = 50;
  try {
    // Fire up to 5 chunks in parallel
    var offsets = [];
    for (var off = offset; off < offset + 5 * CHUNK; off += CHUNK) {
      offsets.push(off);
    }
    var results = await Promise.all(offsets.map(function(off) {
      return apiGet('/songs?limit=' + CHUNK + '&offset=' + off);
    }));
    var lastFullIdx = -1;
    for (var i = 0; i < results.length; i++) {
      if (!results[i].ok || !results[i].data || !results[i].data.length) break;
      playerQueue = playerQueue.concat(results[i].data);
      lastFullIdx = i;
      if (results[i].data.length < CHUNK) break;
    }
    try { localStorage.setItem('songs_cache', JSON.stringify({ ts: Date.now(), data: playerQueue })); } catch(e) {}
    if ($('menuDropdown').classList.contains('open')) { renderMenuSongs(); renderMenuQueue(); }
    if (lastFullIdx >= 0 && results[lastFullIdx].data && results[lastFullIdx].data.length >= CHUNK) {
      loadMoreSongs(offset + (lastFullIdx + 1) * CHUNK);
    }
  } catch(e) {}
}

function autoPlay() {
  if (!playerQueue.length) return;
  for (var i = 0; i < playerQueue.length; i++) {
    var s = playerQueue[i];
    if (s.tg_video_url || s.suno_audio_url || s.podcast_audio_url || s.tg_file_id) {
      playSong(i);
      return;
    }
  }
}

async function playSong(index) {
  if (index < 0 || index >= playerQueue.length) return;
  currentIndex = index;
  var song = playerQueue[index];
  if (!song) return;

  var hasVideo = !!song.tg_video_url;
  var hasSunoAudio = !!song.suno_audio_url;
  var hasPodcastAudio = !!song.podcast_audio_url;
  var hasFileId = !!song.tg_file_id;
  if (!hasVideo && !hasSunoAudio && !hasPodcastAudio && !hasFileId) return;

  // Songs with only tg_file_id (no stored URL) — resolve via /api/media/:id, play as audio
  if (!hasVideo && !hasSunoAudio && !hasPodcastAudio && hasFileId) {
    hasSunoAudio = true;
    song = Object.assign({}, song, { suno_audio_url: API + '/media/' + song.id });
  }

  playerMode = hasVideo ? 'video' : 'audio';

  // Set cover
  var cover = $('mainCover');
  cover.src = '/img/logo.png';
  cover.classList.add('visible');

  // Show loading indicator immediately
  $('loadingIndicator').classList.remove('hidden');

  // Set load timeout
  if (videoEl._loadTimeout) clearTimeout(videoEl._loadTimeout);
  if (audioEl._loadTimeout) clearTimeout(audioEl._loadTimeout);

  // Use direct media URL when available (faster, bypasses proxy)
  var directUrl = song.media_url || null;
  var proxyUrl = API + '/media/' + song.id;

  // Suno CDN audio plays directly
  var audioSourceUrl = null;
  if (hasSunoAudio && !hasVideo) {
    audioSourceUrl = directUrl || song.suno_audio_url;
  } else if (hasPodcastAudio) {
    audioSourceUrl = API + '/media/' + song.id;
  } else if (hasVideo) {
    audioSourceUrl = null; // video handles playback
  }

  // Video
  videoEl.style.display = playerMode === 'video' ? 'block' : 'none';
  if (hasVideo) {
    videoEl.src = directUrl || proxyUrl;
    videoEl.load();
    videoEl._loadTimeout = setTimeout(function() {
      nextSong();
    }, 15000);
  } else {
    videoEl.removeAttribute('src');
  }

  // Audio
  if (audioSourceUrl) {
    audioEl.src = audioSourceUrl;
    audioEl.load();
    audioEl._loadTimeout = setTimeout(function() {
      nextSong();
    }, 15000);
  } else {
    audioEl.removeAttribute('src');
  }

  // Canvas
  if (playerMode === 'audio') {
    canvas.classList.add('active');
    resizeCanvas();
    startViz();
  } else {
    canvas.classList.remove('active');
    stopViz();
  }

  updateMainUI(song);
  updateSideScreens();
  if ($('menuDropdown').classList.contains('open')) {
    renderMenuSongs();
    renderMenuQueue();
  }

  // Show podcast button if song has podcasts
  var podcastBtn = $('podcastBtn');
  var pc = parseInt(song.podcast_count, 10) || 0;
  if (pc > 0 && !isPlayingPodcast) {
    podcastBtn.style.display = 'flex';
  } else {
    podcastBtn.style.display = 'none';
  }

  // Load external links in background
  loadLinks(song.id).then(function(links) {
    var linksBtn = $('linksBtn');
    if (links && links.length > 0) {
      linksBtn.style.display = 'flex';
    } else {
      linksBtn.style.display = 'none';
    }
  });

  isPlaying = true;
  updatePlayBtn();

  // Media Session API
  if ('mediaSession' in navigator) {
    var artworkUrl = song.cover_url || song.suno_cover_url || '/img/logo.png';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: song.title || '',
      artist: 'Shemaxpoetry',
      artwork: [{ src: artworkUrl, sizes: '512x512', type: 'image/png' }]
    });
  }

  if (playerMode === 'video') {
    videoEl.play()['catch'](function(){});
  } else {
    audioEl.play()['catch'](function(){});
  }

  // Show play button briefly then hide
  showPlayBtn();
}

function updateMainUI(song) {
  $('mainPlayBtn').dataset.paused = 'false';
  var title = song.title || '';
  var el = $('mainTitleText');
  var clone = $('mainTitleTextClone');
  el.textContent = title;
  if (clone) clone.textContent = '';
  var container = $('mainBottom');
  container.classList.remove('scrolling');
  if (el.scrollWidth > container.clientWidth) {
    if (clone) clone.textContent = title;
    void el.offsetWidth;
    container.classList.add('scrolling');
  }
}

function setSideTitle(el, text) {
  var title = text || '';
  el.innerHTML = '<div class="side-title-track"><span class="side-title-text"></span><span class="side-title-text"></span></div>';
  var spans = el.querySelectorAll('.side-title-text');
  spans[0].textContent = title;
  spans[1].textContent = '';
  el.classList.remove('scrolling');
  if (spans[0].scrollWidth > el.clientWidth) {
    spans[1].textContent = title;
    void el.offsetWidth;
    el.classList.add('scrolling');
  }
}

function updateSideScreens() {
  // Left: next older song (plays after current ends)
  var nextIdx = currentIndex < playerQueue.length - 1 ? currentIndex + 1 : 0;
  var nextSong = playerQueue[nextIdx];
  if (nextSong && playerQueue.length > 1) {
    var lc = $('leftCover');
    var lcUrl = nextSong.cover_url || nextSong.suno_cover_url;
    var lcImg = document.createElement('img');
    lcImg.src = '/img/logo.png';
    lcImg.className = 'side-placeholder-img';
    lcImg.alt = '';
    lcImg.dataset.src = lcUrl || '';
    lc.innerHTML = '';
    lc.appendChild(lcImg);
    if (lcUrl) {
      var bg = new Image();
      bg.onload = function() { lcImg.src = lcUrl; lcImg.className = ''; };
      bg.src = lcUrl;
    }
    setSideTitle($('leftTitle'), nextSong.title);
    $('leftScreen').style.display = '';
  } else {
    $('leftScreen').style.display = 'none';
  }

  // Right: last played song (for re-listen), random on initial load
  var ri = lastPlayedIndex;
  if (ri < 0 || ri >= playerQueue.length || ri === currentIndex || ri === nextIdx) {
    if (playerQueue.length > 2) {
      do { ri = Math.floor(Math.random() * playerQueue.length); }
      while (ri === currentIndex || ri === nextIdx);
    } else {
      $('rightScreen').style.display = 'none';
      return;
    }
  }
  if (ri >= 0) {
    var rs = playerQueue[ri];
    var rc = $('rightCover');
    var rcUrl = rs.cover_url || rs.suno_cover_url;
    var rcImg = document.createElement('img');
    rcImg.src = '/img/logo.png';
    rcImg.className = 'side-placeholder-img';
    rcImg.alt = '';
    rcImg.dataset.src = rcUrl || '';
    rc.innerHTML = '';
    rc.appendChild(rcImg);
    if (rcUrl) {
      var bg = new Image();
      bg.onload = function() { rcImg.src = rcUrl; rcImg.className = ''; };
      bg.src = rcUrl;
    }
    setSideTitle($('rightTitle'), rs.title);
    $('rightScreen').style.display = '';
  }
}

function playLeft() {
  if (playerQueue.length < 2) return;
  if (isPlayingPodcast) { isPlayingPodcast = false; podcastQueue = []; }
  nextSong();
}

function playRight() {
  if (isPlayingPodcast) { isPlayingPodcast = false; podcastQueue = []; }
  var ri = lastPlayedIndex;
  if (ri >= 0 && ri < playerQueue.length && ri !== currentIndex) {
    playSong(ri);
  } else if (playerQueue.length > 1) {
    var r = Math.floor(Math.random() * playerQueue.length);
    while (r === currentIndex) r = Math.floor(Math.random() * playerQueue.length);
    playSong(r);
  }
}

// === Play / Pause ===

function togglePlay() {
  if (currentIndex < 0 || !playerQueue[currentIndex]) return;
  if (playerMode === 'audio') ensureAudioCtx();
  var el = playerMode === 'video' ? videoEl : audioEl;
  if (el.paused) {
    isPlaying = true;
    el.play()['catch'](function(){});
    if (playerMode === 'audio') startViz();
  } else {
    el.pause();
    isPlaying = false;
    if (playerMode === 'audio') stopViz();
  }
  updatePlayBtn();
}

function showPlayBtn() {
  var btn = $('mainPlayBtn');
  btn.classList.add('visible');
  btn.textContent = '▶';
  clearTimeout(btn._hideTimer);
  btn._hideTimer = setTimeout(function() {
    if (isPlaying) btn.classList.remove('visible');
  }, 1500);
}

function updatePlayBtn() {
  var btn = $('mainPlayBtn');
  btn.textContent = isPlaying ? '⏸' : '▶';
  if (!isPlaying) btn.classList.add('visible');
}

videoEl.addEventListener('play', function(){ isPlaying = true; updatePlayBtn(); showPlayBtn(); $('loadingIndicator').classList.add('hidden'); });
videoEl.addEventListener('pause', function(){ isPlaying = false; updatePlayBtn(); });
videoEl.addEventListener('waiting', function(){ $('loadingIndicator').classList.remove('hidden'); });
audioEl.addEventListener('waiting', function(){ $('loadingIndicator').classList.remove('hidden'); });
audioEl.addEventListener('play', function(){ isPlaying = true; updatePlayBtn(); showPlayBtn(); $('loadingIndicator').classList.add('hidden'); });
audioEl.addEventListener('pause', function(){ isPlaying = false; updatePlayBtn(); });

function preloadNextSong() {
  if (isPlayingPodcast) return;
  var nextIdx = currentIndex < playerQueue.length - 1 ? currentIndex + 1 : 0;
  if (nextIdx === currentIndex) return;
  var next = playerQueue[nextIdx];
  if (!next || next._preloaded) return;
  next._preloaded = true;
  var preloadUrl = null;
  var preloadAs = 'audio';
  if (next.media_url) {
    preloadUrl = next.media_url;
    preloadAs = next.tg_video_url ? 'video' : 'audio';
  } else if (next.tg_video_url) {
    preloadUrl = API + '/media/' + next.id;
    preloadAs = 'video';
  } else if (next.tg_file_id) {
    preloadUrl = API + '/media/' + next.id;
    fetch(API + '/tg-file-url/' + next.id).catch(function(){});
  } else if (next.suno_audio_url) {
    preloadUrl = next.suno_audio_url;
  }
  if (preloadUrl) {
    var link = document.createElement('link');
    link.rel = 'preload';
    link.href = preloadUrl;
    link.as = preloadAs;
    next._preloadLink = link;
    document.head.appendChild(link);
    setTimeout(function(){if(link.parentNode)link.parentNode.removeChild(link);}, 10000);
  }
}

function nextPlayableIndex(fromIdx) {
  for (var i = fromIdx; i < playerQueue.length; i++) {
    var s = playerQueue[i];
    if (s.tg_file_id || s.tg_video_url || s.suno_audio_url || s.podcast_audio_url) return i;
  }
  for (var i = 0; i < fromIdx; i++) {
    var s = playerQueue[i];
    if (s.tg_file_id || s.tg_video_url || s.suno_audio_url || s.podcast_audio_url) return i;
  }
  return fromIdx < playerQueue.length ? fromIdx : 0;
}

videoEl.addEventListener('canplay', function() {
  $('loadingIndicator').classList.add('hidden');
  if (videoEl._loadTimeout) { clearTimeout(videoEl._loadTimeout); videoEl._loadTimeout = null; }
  if (isPlaying) videoEl.play()['catch'](function(){});
  preloadNextSong();
});
audioEl.addEventListener('canplay', function() {
  $('loadingIndicator').classList.add('hidden');
  if (audioEl._loadTimeout) { clearTimeout(audioEl._loadTimeout); audioEl._loadTimeout = null; }
  if (isPlaying) audioEl.play()['catch'](function(){});
  preloadNextSong();
});

videoEl.addEventListener('ended', function() { $('loadingIndicator').classList.add('hidden'); lastPlayedIndex = currentIndex; nextSong(); });
videoEl.addEventListener('error', function() {
  $('loadingIndicator').classList.add('hidden');
  var nextIdx = nextPlayableIndex(currentIndex + 1);
  if (nextIdx !== currentIndex) { playSong(nextIdx); return; }
  nextSong();
});
audioEl.addEventListener('error', function() {
  $('loadingIndicator').classList.add('hidden');
  if (isPlayingPodcast) {
    podcastQueueIndex++;
    if (podcastQueueIndex < podcastQueue.length) {
      audioEl.src = podcastQueue[podcastQueueIndex].file_url;
      audioEl.load();
      audioEl.play()['catch'](function(){});
    } else {
      isPlayingPodcast = false;
      $('podcastBtn').style.display = 'none';
      if (podcastReturnIndex >= 0) playSong(podcastReturnIndex);
    }
    return;
  }
  var nextIdx = nextPlayableIndex(currentIndex + 1);
  if (nextIdx !== currentIndex) { playSong(nextIdx); return; }
  nextSong();
});
audioEl.addEventListener('ended', function() {
  if (isPlayingPodcast) {
    podcastQueueIndex++;
    if (podcastQueueIndex < podcastQueue.length) {
      audioEl.src = podcastQueue[podcastQueueIndex].file_url;
      audioEl.load();
      audioEl.play()['catch'](function(){});
    } else {
      isPlayingPodcast = false;
      $('podcastBtn').style.display = 'none';
      if (podcastReturnIndex >= 0) playSong(podcastReturnIndex);
    }
  } else {
    lastPlayedIndex = currentIndex;
    nextSong();
  }
});

function prevSong() {
  if (isPlayingPodcast) {
    isPlayingPodcast = false;
    podcastQueue = [];
    $('podcastBtn').style.display = 'none';
    if (podcastReturnIndex >= 0) playSong(podcastReturnIndex);
    return;
  }
  var idx = currentIndex > 0 ? currentIndex - 1 : playerQueue.length - 1;
  playSong(idx);
}

function nextSong() {
  if (isPlayingPodcast) {
    isPlayingPodcast = false;
    podcastQueue = [];
    $('podcastBtn').style.display = 'none';
    if (podcastReturnIndex >= 0) playSong(podcastReturnIndex);
    return;
  }
  var idx = currentIndex < playerQueue.length - 1 ? currentIndex + 1 : 0;
  playSong(idx);
}

function togglePodcast() {
  if (isPlayingPodcast) {
    isPlayingPodcast = false;
    podcastQueue = [];
    audioEl.pause();
    $('podcastBtn').style.display = 'none';
    if (podcastReturnIndex >= 0) playSong(podcastReturnIndex);
    return;
  }
  var song = playerQueue[currentIndex];
  if (!song) return;
  podcastReturnIndex = currentIndex;
  videoEl.pause();
  audioEl.pause();
  (async function() {
    var res = await fetch(API + '/song/' + song.id + '/podcasts');
    var data = await res.json();
    if (!data.ok || !data.data || !data.data.length) return;
    podcastQueue = data.data;
    podcastQueueIndex = 0;
    isPlayingPodcast = true;
    $('podcastBtn').innerHTML = '✕';
    $('podcastBtn').style.display = 'flex';
    ensureAudioCtx();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    audioEl.src = podcastQueue[0].file_url;
    audioEl.load();
    audioEl.play()['catch'](function(){});
  })();
}

// === Audio Visualizer ===

function startViz() {
  if (vizActive) return;
  if (!audioCtx) return; // Will be set up on first interaction
  if (audioEl.paused && !audioEl.src) return;
  vizActive = true;
  drawViz();
}

function stopViz() {
  vizActive = false;
  if (vizRAF) { cancelAnimationFrame(vizRAF); vizRAF = null; }
  if (canvasCtx) canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
}

function ensureAudioCtx() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    vizSource = audioCtx.createMediaElementSource(audioEl);
    vizSource.connect(analyser);
    analyser.connect(audioCtx.destination);
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch(e) {}
}

function drawViz() {
  if (!vizActive) return;
  vizRAF = requestAnimationFrame(drawViz);
  var w = canvas.width / 2;
  var h = canvas.height / 2;
  if (canvasCtx) {
    canvasCtx.clearRect(0, 0, w, h);
    if (!analyser) return;
    var bufferLength = analyser.frequencyBinCount;
    var dataArray = new Uint8Array(bufferLength);
    try { analyser.getByteTimeDomainData(dataArray); } catch(e) { return; }
    canvasCtx.lineWidth = 2;
    canvasCtx.strokeStyle = 'rgba(212, 168, 83, 0.8)';
    canvasCtx.shadowBlur = 8;
    canvasCtx.shadowColor = 'rgba(212, 168, 83, 0.3)';
    canvasCtx.beginPath();
    var sliceWidth = w / bufferLength;
    var x = 0;
    for (var i = 0; i < bufferLength; i++) {
      var v = dataArray[i] / 128.0;
      var y = h / 2 + (v - 1) * (h / 3);
      if (i === 0) canvasCtx.moveTo(x, y);
      else canvasCtx.lineTo(x, y);
      x += sliceWidth;
    }
    canvasCtx.lineTo(w, h / 2);
    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0;
  }
}

// === Buger Menu ===

function toggleMenu() {
  var menu = $('menuDropdown');
  var btn = $('hamburgerBtn');
  var open = menu.classList.contains('open');
  menu.classList.toggle('open');
  btn.classList.toggle('active');
  document.body.classList.toggle('menu-open');
  if (!open) {
    renderMenuSongs();
    renderMenuQueue();
    ensureAudioCtx();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
}

function switchMenuTab(tab) {
  document.querySelectorAll('.menu-tab').forEach(function(t) {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('.menu-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'menu' + tab.charAt(0).toUpperCase() + tab.slice(1));
  });
  if (tab === 'songs') renderMenuSongs();
  if (tab === 'queue') renderMenuQueue();
}

document.querySelector('.menu-tabs').addEventListener('click', function(e) {
  var tab = e.target.closest('.menu-tab[data-tab]');
  if (tab) switchMenuTab(tab.dataset.tab);
});

// Search input
document.getElementById('menuSearch')?.addEventListener('input', filterSongs);

// Close menu on click outside menu inner
document.addEventListener('click', function(e) {
  if ($('menuDropdown').classList.contains('open') && !e.target.closest('.menu-dropdown-inner, #hamburgerBtn')) {
    toggleMenu();
  }
});

// Language filter
document.getElementById('langFilter')?.addEventListener('click', function(e) {
  var btn = e.target.closest('.lang-btn');
  if (!btn) return;
  this.querySelectorAll('.lang-btn').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  filterSongs();
});

function filterSongs() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderMenuSongs, 200);
}

// === External Links ===

async function loadLinks(songId) {
  if (linksData[songId]) return linksData[songId];
  try {
    var res = await fetch(API + '/song/' + songId + '/links');
    var data = await res.json();
    linksData[songId] = data.ok ? data.data : [];
    return linksData[songId];
  } catch(e) { return []; }
}

function renderLinks() {
  var song = playerQueue[currentIndex];
  if (!song) return;
  var body = $('linksPopupBody');
  var links = linksData[song.id] || [];
  if (!links.length) {
    body.innerHTML = '<div class="links-popup-empty">' + getText('externalLinks') + '</div>';
    return;
  }
  body.innerHTML = '';
  links.forEach(function(l) {
    var item = document.createElement('a');
    item.className = 'links-popup-item';
    item.href = l.url;
    item.target = '_blank';
    item.rel = 'noopener noreferrer';
    item.innerHTML = '<div class="links-popup-item-icon">' + (l.link_type_icon || '🔗') + '</div>' +
      '<div class="links-popup-item-info">' +
      '<div class="links-popup-item-title">' + escapeHtml(l.link_type_name || '') + '</div>' +
      (l.description ? '<div class="links-popup-item-desc">' + escapeHtml(l.description) + '</div>' : '') +
      '</div>';
    body.appendChild(item);
  });
}

function toggleLinks() {
  var popup = $('linksPopup');
  linksPopupOpen = !linksPopupOpen;
  popup.classList.toggle('open', linksPopupOpen);
  if (linksPopupOpen) renderLinks();
}

function closeLinks(e) {
  if (e && e.target !== $('linksPopup')) return;
  linksPopupOpen = false;
  $('linksPopup').classList.remove('open');
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && linksPopupOpen) closeLinks();
});

function renderMenuSongs() {
  var q = ($('menuSearch').value || '').toLowerCase().trim();
  var lang = ($('langFilter')?.querySelector('.lang-btn.active')?.dataset?.lang) || '';
  var container = $('menuSongList');
  if (!container) return;
  container.innerHTML = '';
  var filtered = playerQueue.filter(function(s) {
    if (q && s.title.toLowerCase().indexOf(q) === -1
        && (s.lyrics || '').toLowerCase().indexOf(q) === -1) return false;
    if (lang && s.language !== lang) return false;
    return true;
  });
  renderMenuItems(filtered, container);
}

function renderMenuItems(list, container) {
  list.forEach(function(song, idx) {
    var item = document.createElement('div');
    item.className = 'menu-list-item' + (song === playerQueue[currentIndex] ? ' active' : '');
    var thumbUrl = song.cover_url || song.suno_cover_url;
    item.innerHTML = '<div class="menu-list-item-thumb">' +
      '<img src="/img/logo.png" class="side-placeholder-img" alt="">' +
      '</div><div class="menu-list-item-info"><div class="menu-list-item-title">' + escapeHtml(song.title) + '</div>' +
      '<div class="menu-list-item-num">#' + (idx + 1) + '</div></div>';
    item.addEventListener('click', function() { toggleMenu(); setTimeout(function() { playSong(playerQueue.indexOf(song)); }, 300); });
    container.appendChild(item);
  });
}

function renderMenuQueue() {
  var container = $('menuQueueList');
  if (container) renderMenuItems(playerQueue, container);
}

var _escMap = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function escapeHtml(str) {
  return (str || '').replace(/[&<>"']/g, function(m) { return _escMap[m]; });
}

// === Touch Swipe ===

var touchStartX = 0;
var touchStartY = 0;
var touchSwiped = false;

mainScreen.addEventListener('touchstart', function(e) {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchSwiped = false;
  mainScreen.style.transition = 'none';
});

mainScreen.addEventListener('touchmove', function(e) {
  var dx = e.touches[0].clientX - touchStartX;
  var dy = e.touches[0].clientY - touchStartY;
  if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
    touchSwiped = true;
    mainScreen.style.transform = 'translateX(' + dx * 0.6 + 'px)';
  }
});

mainScreen.addEventListener('touchend', function(e) {
  var dx = e.changedTouches[0].clientX - touchStartX;
  mainScreen.style.transition = '';
  mainScreen.style.transform = '';
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(e.changedTouches[0].clientY - touchStartY)) {
    if (dx > 0) { var idx = currentIndex > 0 ? currentIndex - 1 : playerQueue.length - 1; playSong(idx); }
    else { var idx = currentIndex < playerQueue.length - 1 ? currentIndex + 1 : 0; playSong(idx); }
  }
});

mainScreen.addEventListener('click', function(e) {
  if (touchSwiped) { touchSwiped = false; return; }
  togglePlay();
});

// === Init ===

  document.addEventListener('DOMContentLoaded', function() {
  initI18n();
  loadSongs();
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('previoustrack', function(){ prevSong(); });
    navigator.mediaSession.setActionHandler('nexttrack', function(){ nextSong(); });
  }
  // Event listeners (replaces old inline onclick handlers for CSP compliance)
  $('leftScreen').addEventListener('click', function() { playLeft(); });
  $('rightScreen').addEventListener('click', function() { playRight(); });
  $('hamburgerBtn').addEventListener('click', function(e) { e.stopPropagation(); toggleMenu(); });
  $('podcastBtn').addEventListener('click', function() { togglePodcast(); });
  $('linksBtn').addEventListener('click', function() { toggleLinks(); });
  $('langToggleBtn').addEventListener('click', function() { toggleLang(); });
  $('closeTabBtn').addEventListener('click', function() { toggleMenu(); });
  $('linksPopup').addEventListener('click', function(e) { closeLinks(e); });
  $('linksPopupCloseBtn').addEventListener('click', function() { closeLinks(); });
  $('mainLogo').addEventListener('click', function() { window.open('https://t.me/shemaxpoetry', '_blank'); });
});
