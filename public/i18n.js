import { messages as korean } from './locales-ko.js';
import { messages as chinese } from './locales-zh-CN.js';
import { messages as japanese } from './locales-ja.js';

const dictionaries = { en: {}, ko: korean, 'zh-CN': chinese, ja: japanese };
const normalizeLanguage = value => Object.hasOwn(dictionaries, value) ? value : 'en';

// Language changes affect the editor shell, never a user's HTML document.
const storageKey = 'pagecraft-language';
function preferredLanguage() {
  try { return normalizeLanguage(localStorage.getItem(storageKey)); }
  catch { return 'en'; }
}
export const language = preferredLanguage();
export const dateLocale = { en: 'en-US', ko: 'ko-KR', 'zh-CN': 'zh-CN', ja: 'ja-JP' }[language];
const messages = dictionaries[language];

/** Translate a literal or tagged template. Values are substituted once, never interpreted as HTML. */
export function t(message, ...values) {
  const key = Array.isArray(message)
    ? message.reduce((text, part, index) => text + (index ? `{${index - 1}}` : '') + part, '')
    : message;
  if (key == null) return key;
  const translated = Object.hasOwn(messages, key) ? messages[key] : key;
  return values.length ? translated.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match) : translated;
}

export function initLanguage() {
  document.documentElement.lang = language;
  // Run once, before app initialization. No observer, document iframe access, or per-frame work.
  if (language !== 'en') {
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('script, style, #language')) continue;
      const text = node.textContent.trim();
      if (text && Object.hasOwn(messages, text)) node.textContent = node.textContent.replace(text, messages[text]);
    }
    for (const element of document.querySelectorAll('[aria-label], [title], [placeholder]')) {
      for (const attribute of ['aria-label', 'title', 'placeholder']) {
        const value = element.getAttribute(attribute);
        if (value && Object.hasOwn(messages, value)) element.setAttribute(attribute, messages[value]);
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
  try { localStorage.setItem(storageKey, normalizeLanguage(next)); }
  catch { return false; }
  location.reload();
  return true;
}
