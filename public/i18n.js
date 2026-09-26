import { messages as korean } from './locales-ko.js';

// Language changes affect the editor shell, never a user's HTML document.
const storageKey = 'pagecraft-language';
function preferredLanguage() {
  try { return localStorage.getItem(storageKey) === 'ko' ? 'ko' : 'en'; }
  catch { return 'en'; }
}
export const language = preferredLanguage();

/** Translate a literal or tagged template. Values are substituted once, never interpreted as HTML. */
export function t(message, ...values) {
  const key = Array.isArray(message)
    ? message.reduce((text, part, index) => text + (index ? `{${index - 1}}` : '') + part, '')
    : message;
  if (key == null) return key;
  const translated = language === 'ko' ? (korean[key] ?? key) : key;
  return values.length ? translated.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match) : translated;
}

export function initLanguage() {
  document.documentElement.lang = language;
  // Run once, before app initialization. No observer, document iframe access, or per-frame work.
  if (language === 'ko') {
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('script, style, #language')) continue;
      const text = node.textContent.trim();
      if (text && korean[text]) node.textContent = node.textContent.replace(text, korean[text]);
    }
    for (const element of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
      for (const attribute of ['aria-label', 'title', 'placeholder']) {
        const value = element.getAttribute(attribute);
        if (value && korean[value]) element.setAttribute(attribute, korean[value]);
      }
    }
  }
  const selector = document.querySelector('#language');
  selector.value = language;
  selector.addEventListener('change', () => {
    // Use the editor's existing unsaved-change dialog before reloading its shell.
    selector.dispatchEvent(new CustomEvent('pagecraft-language-request', { bubbles: true, detail: selector.value }));
  });
}

export function applyLanguage(next) {
  try { localStorage.setItem(storageKey, next === 'ko' ? 'ko' : 'en'); }
  catch { return false; }
  location.reload();
  return true;
}
