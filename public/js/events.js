document.addEventListener('DOMContentLoaded', function() {
  function $(id) { return document.getElementById(id); }
  $('leftScreen').addEventListener('click', function() { if (window.playLeft) playLeft(); });
  $('rightScreen').addEventListener('click', function() { if (window.playRight) playRight(); });
  $('hamburgerBtn').addEventListener('click', function(e) { e.stopPropagation(); if (window.toggleMenu) toggleMenu(); });
  $('podcastBtn').addEventListener('click', function() { if (window.togglePodcast) togglePodcast(); });
  $('linksBtn').addEventListener('click', function() { if (window.toggleLinks) toggleLinks(); });
  $('langToggleBtn').addEventListener('click', function() { if (window.toggleLang) toggleLang(); });
  $('closeTabBtn').addEventListener('click', function() { if (window.toggleMenu) toggleMenu(); });
  $('linksPopup').addEventListener('click', function(e) { if (window.closeLinks) closeLinks(e); });
  $('linksPopupCloseBtn').addEventListener('click', function() { if (window.closeLinks) closeLinks(); });
});
