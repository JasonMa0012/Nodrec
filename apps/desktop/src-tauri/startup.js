(() => {
  const log = (stage) => {
    const message = `page +${performance.now().toFixed(1)}ms ${stage}`;
    console.info(`[startup] ${message}`);
    window.__TAURI_INTERNALS__.invoke('startup_log', { stage: message }).catch(console.error);
  };
  window.__nodrecStartupLog = log;
  log('document initialization');
  document.addEventListener('DOMContentLoaded', () => log('DOMContentLoaded'), { once: true });
  window.addEventListener('load', () => {
    log('window load');
    for (const entry of performance.getEntriesByType('resource').sort((a, b) => b.duration - a.duration).slice(0, 10)) {
      log(`resource ${new URL(entry.name).pathname} start=${entry.startTime.toFixed(1)}ms duration=${entry.duration.toFixed(1)}ms`);
    }
  }, { once: true });
  window.addEventListener('error', (event) => log(`error ${event.message || 'resource failed'} ${event.filename || event.target?.src || event.target?.href || ''}`), true);
  window.addEventListener('unhandledrejection', (event) => log(`unhandled rejection ${String(event.reason)}`));
  for (const seconds of [2, 5, 10, 20, 60]) {
    setTimeout(() => log(`checkpoint ${seconds}s readyState=${document.readyState} rootChildren=${document.getElementById('root')?.childElementCount ?? 0}`), seconds * 1000);
  }
})();
