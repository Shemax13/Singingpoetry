const i18n = {
  ru: {
    navHome: 'Главная',
    navSongs: 'Песни',
    navAbout: 'О проекте',
    heroTitle: 'Поэзия в звуке',
    heroSubtitle: 'Авторские песни и стихи',
    heroCta: 'Слушать',
    songsTitle: 'Песни',
    songsSubtitle: 'Авторская поэзия в музыкальном воплощении',
    aboutTitle: 'О проекте',
    aboutText: 'Поэтический проект Shemaxpoetry',
    playerVideo: 'Видео',
    playerAudio: 'Аудио',
    playerNext: 'Далее',
    playerPrev: 'Назад',
    queueTitle: 'Очередь',
    noSongs: 'Песни пока не добавлены',
    loading: 'Загрузка...',
    play: 'Играть',
    pause: 'Пауза',
    switchToVideo: 'Видеорежим',
    switchToAudio: 'Аудиорежим',
  },
  en: {
    navHome: 'Home',
    navSongs: 'Songs',
    navAbout: 'About',
    heroTitle: 'Poetry in Sound',
    heroSubtitle: 'Original songs and poetry',
    heroCta: 'Listen',
    songsTitle: 'Songs',
    songsSubtitle: 'Original poetry brought to life through music',
    aboutTitle: 'About',
    aboutText: 'Shemaxpoetry poetic project',
    playerVideo: 'Video',
    playerAudio: 'Audio',
    playerNext: 'Next',
    playerPrev: 'Prev',
    queueTitle: 'Queue',
    noSongs: 'No songs yet',
    loading: 'Loading...',
    play: 'Play',
    pause: 'Pause',
    switchToVideo: 'Video mode',
    switchToAudio: 'Audio mode',
  }
};

let currentLang = 'ru';

function getText(key) {
  return i18n[currentLang]?.[key] || i18n.ru[key] || key;
}

function setLang(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    el.textContent = getText(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    el.placeholder = getText(key);
  });
  localStorage.setItem('shemax-lang', lang);
}

function initI18n() {
  const saved = localStorage.getItem('shemax-lang');
  if (saved) currentLang = saved;
  setLang(currentLang);
}

function toggleLang() {
  setLang(currentLang === 'ru' ? 'en' : 'ru');
  const btn = document.querySelector('.lang-toggle');
  if (btn) btn.textContent = currentLang === 'ru' ? 'EN' : 'RU';
}
