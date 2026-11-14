(() => {
  const invoke = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
  const originalError = console.error.bind(console);
  const text = value => {
    if (value instanceof Error) return value.stack || value.message;
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
  };
  const send = (level, message) => {
    void invoke('app_log', { level, message }).catch(error => originalError('Cannot forward log to Nodrec', error));
  };
  for (const method of ['debug', 'info', 'log', 'warn', 'error']) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      send(method === 'log' ? 'info' : method, args.map(text).join(' '));
    };
  }
  const log = stage => send('info', `[startup] page +${performance.now().toFixed(1)}ms ${stage}`);
  window.__nodrecStartupLog = log;
  log(`document initialization | WebView=${navigator.userAgent} | languages=${navigator.languages.join(',')} | devicePixelRatio=${devicePixelRatio}`);
  document.addEventListener('DOMContentLoaded', () => log('DOMContentLoaded'), { once: true });
  window.addEventListener('load', () => {
    log('window load');
    for (const entry of performance.getEntriesByType('resource').sort((a, b) => b.duration - a.duration).slice(0, 10)) {
      log(`resource ${new URL(entry.name).pathname} start=${entry.startTime.toFixed(1)}ms duration=${entry.duration.toFixed(1)}ms`);
    }
  }, { once: true });
  window.addEventListener('error', event => send('error', `Page error: ${event.error ? text(event.error) : event.message || 'resource failed'} ${event.filename || event.target?.src || event.target?.href || ''}`), true);
  window.addEventListener('unhandledrejection', event => send('error', `Unhandled rejection: ${text(event.reason)}`));
  for (const seconds of [2, 5, 10, 20, 60]) {
    setTimeout(() => log(`checkpoint ${seconds}s readyState=${document.readyState} rootChildren=${document.getElementById('root')?.childElementCount ?? 0}`), seconds * 1000);
  }
})();
