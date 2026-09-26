import { t } from './i18n.js';
export function initInstall({ onUpdate } = {}) {
  const button = document.querySelector('#install-app');
  const status = document.querySelector('#offline-state');
  if (location.protocol === 'chrome-extension:') {
    status.textContent = t("The installed extension works offline. Select your file again.");
    return;
  }
  let deferred;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => { deferred = undefined; button.hidden = true; });
  button.addEventListener('click', async () => {
    if (!deferred) return;
    const prompt = deferred;
    deferred = undefined;
    button.hidden = true;
    try { await prompt.prompt(); } catch { /* The browser can withdraw installation eligibility. */ }
  });
  if ('serviceWorker' in navigator && isSecureContext) {
    navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), { scope: './' }).then(async (registration) => {
      await navigator.serviceWorker.ready;
      status.textContent = t("Ready for offline use · Select your file again. File contents are not uploaded.");
      // A waiting worker means this tab is still running the previous version. The
      // editor is never swapped underneath an open document, so say it instead.
      const announce = () => { if (registration.waiting && navigator.serviceWorker.controller) onUpdate?.(); };
      announce();
      registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', announce);
      });
    }).catch(() => { status.textContent = t("Use the app online for now. Offline setup is not complete."); });
  }
}
