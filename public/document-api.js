import { t } from './i18n.js';
// The canvas shares one document contract across local-server and browser storage.
export const browserMode = document.querySelector('meta[name="pagecraft-storage"]')?.content === 'browser';
export const browserStorage = browserMode ? await import('./browser-storage.js') : null;
export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

export async function api(path, options = {}) {
  if (browserStorage) return browserStorage.api(path, options);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, { ...options, signal: controller.signal });
    let payload;
    try { payload = await response.json(); }
    catch { throw new ApiError(t("Could not read the server response. Check the connection and try again."), response.status); }
    if (!response.ok) throw new ApiError(t(payload.message || payload.error) || t`Request failed (${response.status})`, response.status);
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(controller.signal.aborted
      ? t("The server timed out. Your edits are kept. Check whether the save completed before trying again.")
      : t("Could not connect to the local server. Your edits are kept. Check the server and try again."));
  } finally { clearTimeout(timeout); }
}

export function post(path, body) {
  if (browserStorage) return browserStorage.api(path, { body });
  return api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
