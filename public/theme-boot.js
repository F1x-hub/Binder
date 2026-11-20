// Ставит тему до первой отрисовки, чтобы окно не мигало цветами другой темы.
// Встроенные скрипты MV3 запрещает, поэтому это отдельный файл.
// Источник правды: chrome.storage.sync, копию сюда кладёт src/lib/settings.ts.
try {
  var theme = localStorage.getItem('binder:theme');
  if (/^(mono|light|poke|retro)$/.test(theme || '')) {
    document.documentElement.setAttribute('data-theme', theme);
  }
} catch (error) {
  // Хранилище недоступно: остаётся тема по умолчанию из разметки.
}
