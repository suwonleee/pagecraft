import { t } from './i18n.js';
/** View preferences belong to the editor shell, never to the edited HTML. */
export function initWorkspace({ onLayoutChange = () => {} } = {}) {
  const workspace = document.querySelector('.workspace');
  const canvas = document.querySelector('#canvas');
  const narrow = matchMedia('(max-width: 1120px)');
  const storageKey = 'pagecraft.workspace.v1';
  const panels = {
    files: { panel: document.querySelector('#files-panel'), toggle: document.querySelector('#toggle-files'), close: document.querySelector('#close-files') },
    inspector: { panel: document.querySelector('#inspector-panel'), toggle: document.querySelector('#toggle-inspector'), close: document.querySelector('#close-inspector') },
  };
  const backdrop = document.querySelector('#workspace-backdrop');
  const focusToggle = document.querySelector('#focus-canvas');
  const help = document.querySelector('#shortcuts-dialog');
  // Reserve room to edit on laptops; explicit saved preferences always win.
  let preferences = { files: !matchMedia('(max-width: 1350px)').matches, inspector: true };
  let drawer = null;
  let focused = false;
  let layoutFrame = 0;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    for (const key of Object.keys(preferences)) {
      if (typeof saved?.[key] === 'boolean') preferences[key] = saved[key];
    }
  } catch { /* Storage can be unavailable in a browser privacy mode. */ }

  function render() {
    for (const [name, controls] of Object.entries(panels)) {
      const open = narrow.matches ? drawer === name : !focused && preferences[name];
      controls.panel.hidden = !open;
      controls.toggle.setAttribute('aria-expanded', String(open));
      workspace.dataset[`${name}Open`] = String(open);
    }
    backdrop.hidden = !narrow.matches || !drawer;
    focusToggle.setAttribute('aria-pressed', String(focused));
    focusToggle.title = focused ? t("Restore the previous panel layout") : t("Fold both panels to focus on the canvas");
    // The drawer covers the canvas controls, so keep keyboard focus on visible controls.
    document.querySelector('.canvas-section').inert = narrow.matches && Boolean(drawer);
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => onLayoutChange());
  }

  function setPanel(name, open, moveFocus = true) {
    focused = false;
    if (narrow.matches) drawer = open ? name : null;
    else {
      preferences[name] = open;
      try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* See above. */ }
    }
    render();
    if (moveFocus) {
      if (!open) panels[name].toggle.focus({ preventScroll: true });
      else if (narrow.matches) panels[name].close.focus({ preventScroll: true });
    }
  }

  function closeDrawer({ restoreFocus = true } = {}) {
    if (drawer) setPanel(drawer, false, restoreFocus);
  }

  for (const [name, controls] of Object.entries(panels)) {
    controls.toggle.addEventListener('click', () => setPanel(name, controls.panel.hidden));
    controls.close.addEventListener('click', () => setPanel(name, false));
  }
  backdrop.addEventListener('click', () => closeDrawer());
  // A temporary view, not a new saved preference or a document edit.
  focusToggle.addEventListener('click', () => {
    focused = !focused;
    drawer = null;
    render();
  });
  narrow.addEventListener('change', () => {
    drawer = null;
    focused = false;
    render();
    if (document.activeElement?.closest('aside[hidden]')) canvas.focus({ preventScroll: true });
  });
  workspace.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawer && !event.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      closeDrawer();
    }
  });
  panels.files.panel.addEventListener('click', (event) => {
    if (narrow.matches && event.target.closest('.file-button, .layer')) {
      closeDrawer({ restoreFocus: false });
      canvas.focus({ preventScroll: true });
    }
  });
  document.querySelector('#help').addEventListener('click', () => help.showModal());
  document.querySelector('#close-help').addEventListener('click', () => help.close());
  help.addEventListener('click', (event) => {
    if (event.target !== help) return;
    const bounds = help.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) help.close();
  });
  render();
  return { refresh: render };
}
