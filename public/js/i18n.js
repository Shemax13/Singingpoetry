var i18n = {
  ru: {
    navSongs: 'Песни',
    navAbout: 'О проекте',
    navQueue: 'Очередь',
    aboutTitle: 'О проекте',
    aboutText: 'Поэтический проект Shemaxpoetry',
    searchPlaceholder: 'Поиск...',
    allLanguages: 'Все',
    podcast: 'Подкаст',
    externalLinks: 'Внешние ссылки',
    privacy: 'Политика конфиденциальности',
  },
  en: {
    navSongs: 'Songs',
    navAbout: 'About',
    navQueue: 'Queue',
    aboutTitle: 'About',
    aboutText: 'Shemaxpoetry poetic project',
    searchPlaceholder: 'Search...',
    allLanguages: 'All',
    podcast: 'Podcast',
    externalLinks: 'External Links',
    privacy: 'Privacy Policy',
  }
};

var currentLang = 'ru';

function getText(key) {
  return i18n[currentLang]?.[key] || i18n.ru[key] || key;
}

function setLang(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    el.textContent = getText(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el) {
    el.placeholder = getText(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('.lang-toggle').forEach(function(btn) {
    btn.textContent = currentLang === 'ru' ? 'EN' : 'RU';
  });
  localStorage.setItem('shemax-lang', lang);
}

function initI18n() {
  var saved = localStorage.getItem('shemax-lang');
  if (saved) currentLang = saved;
  setLang(currentLang);
}

function toggleLang() {
  setLang(currentLang === 'ru' ? 'en' : 'ru');
}
