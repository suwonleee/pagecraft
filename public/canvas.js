// Camera coordinates belong to the editor, never to the HTML document or its undo history.
export const isTextInput = (target) => Boolean(target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));

// Respect Latin layouts (Dvorak/AZERTY too); non-Latin IMEs use the physical key.
export function shortcutLetter(event) {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  return /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : '';
}

export const isComposingKey = (event) => event.isComposing || event.keyCode === 229;

export function createCanvasView({ canvas, artboard, frame, onChange, onPanStart }) {
  const view = { x: 28, y: 28, scale: 1 };
  let space = false;
  let hand = false;
  let panning = false;
  let suppressClick = false;
  let suppressDoubleUntil = 0;
  let cancelPan;
  let frameDocument;
  let renderFrame = 0;
  let renderedScale = view.scale;
  const rendered = {};
  const $ = (selector) => document.querySelector(selector);
  const panMode = () => space || hand;
  // Measured on document, panel and window changes so panning never reads layout.
  let bounds = { canvas: canvas.clientWidth, artboard: artboard.offsetWidth };
  /** Remeasures, and reports whether the canvas itself changed size: a fitted view
   *  follows the workspace, but must not move because the document grew. */
  const measure = () => {
    const previous = bounds.canvas;
    bounds = { canvas: canvas.clientWidth, artboard: artboard.offsetWidth };
    return bounds.canvas !== previous;
  };
  // 25% is the floor for ordinary pages. A document too wide for it — a 4K slide
  // deck, a poster — lowers the floor instead of losing its right edge.
  const minScale = () => Math.max(.01, Math.min(.25, (bounds.canvas - 56) / (bounds.artboard || 1)));
  // Screen mode keeps the document's own scrolling so `vh`, sticky and fixed layout
  // behave as they would in a browser window of the selected size.
  let scrollable = false;
  // A view left at "fit" stays fitted when the window or panels change size. Once a
  // person zooms or pans, the view is theirs and a resize must not move it.
  let fitted = false;

  function screenPoint(event) {
    if (event.view === frame.contentWindow || event.target?.ownerDocument === frameDocument) {
      const rect = frame.getBoundingClientRect();
      // Wheel events can update the next view before its DOM render. Event
      // coordinates still belong to the last rendered iframe transform.
      return { x: rect.left + event.clientX * renderedScale, y: rect.top + event.clientY * renderedScale };
    }
    return { x: event.clientX, y: event.clientY };
  }

  function render() {
    cancelAnimationFrame(renderFrame);
    renderFrame = 0;
    const positionChanged = rendered.x !== view.x || rendered.y !== view.y;
    const scaleChanged = rendered.scale !== view.scale;
    const mode = panMode();
    if (positionChanged || scaleChanged) artboard.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    if (positionChanged) canvas.style.backgroundPosition = `${view.x}px ${view.y}px`;
    const minimum = minScale();
    if (scaleChanged) {
      artboard.style.setProperty('--canvas-scale', view.scale);
      canvas.style.backgroundSize = `${16 * view.scale}px ${16 * view.scale}px`;
      $('#zoom-value').textContent = `${Math.round(view.scale * 100)}%`;
      $('#zoom-in').disabled = view.scale >= 3;
    }
    if (scaleChanged || rendered.minimum !== minimum) $('#zoom-out').disabled = view.scale <= minimum * 1.001;
    if (rendered.mode !== mode) canvas.classList.toggle('hand-mode', mode);
    if (rendered.panning !== panning) canvas.classList.toggle('panning', panning);
    // View-only attributes: no element style patches or document history changes.
    if (frameDocument?.documentElement) {
      if (rendered.mode !== mode || rendered.panning !== panning) frameDocument.documentElement.toggleAttribute('data-muse-pan', mode || panning);
      if (rendered.panning !== panning) frameDocument.documentElement.style.setProperty('--muse-cursor', panning ? 'grabbing' : 'grab');
    }
    if (rendered.hand !== hand) {
      $('#tool-select').setAttribute('aria-pressed', String(!hand));
      $('#tool-hand').setAttribute('aria-pressed', String(hand));
    }
    Object.assign(rendered, view, { mode, panning, hand, minimum });
    renderedScale = view.scale;
    onChange?.();
  }

  function scheduleRender() {
    if (!renderFrame) renderFrame = requestAnimationFrame(render);
  }

  function zoomTo(scale, anchor, deferred = false) {
    fitted = false;
    const next = Math.max(minScale(), Math.min(3, scale));
    const rect = canvas.getBoundingClientRect();
    const point = anchor ? { x: anchor.x - rect.left, y: anchor.y - rect.top } : { x: rect.width / 2, y: rect.height / 2 };
    view.x = point.x - (point.x - view.x) * next / view.scale;
    view.y = point.y - (point.y - view.y) * next / view.scale;
    view.scale = next;
    if (deferred) scheduleRender(); else render();
  }

  function zoomStep(direction) {
    const percent = view.scale * 100;
    // Below 25% the fixed grid would jump to the floor in a single step, so a
    // large document steps proportionally instead.
    const next = percent < 25 || (percent <= 25 && direction < 0)
      ? percent * (direction > 0 ? 1.25 : .8)
      : direction > 0 ? (Math.floor(percent / 25) + 1) * 25 : (Math.ceil(percent / 25) - 1) * 25;
    zoomTo(next / 100);
  }

  function fit() {
    measure();
    view.scale = Math.max(minScale(), Math.min(1, (bounds.canvas - 56) / bounds.artboard));
    view.x = (bounds.canvas - bounds.artboard * view.scale) / 2;
    view.y = 28;
    fitted = true;
    render();
  }

  function centerElement(element) {
    fitted = false;
    const rect = element.getBoundingClientRect();
    view.x = (canvas.clientWidth - rect.width * view.scale) / 2 - rect.left * view.scale;
    view.y = Math.max(28, (canvas.clientHeight - rect.height * view.scale) / 2) - rect.top * view.scale;
    render();
  }

  function focusElement(element) {
    const rect = element?.getBoundingClientRect();
    fitted = false;
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    view.scale = Math.max(minScale(), Math.min(1, Math.max(1, canvas.clientWidth - 64) / rect.width, Math.max(1, canvas.clientHeight - 64) / rect.height));
    view.x = (canvas.clientWidth - rect.width * view.scale) / 2 - rect.left * view.scale;
    view.y = (canvas.clientHeight - rect.height * view.scale) / 2 - rect.top * view.scale;
    render();
  }

  function pointerDown(event) {
    suppressClick = false;
    suppressDoubleUntil = 0;
    if (!(event.button === 1 || (event.button === 0 && panMode()))) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onPanStart?.();
    // Commit pending wheel updates before fixing this gesture's coordinate basis.
    if (renderFrame) render();
    const start = screenPoint(event);
    const original = { ...view };
    const target = event.target;
    const owner = target.ownerDocument;
    panning = true;
    target.setPointerCapture(event.pointerId);
    render();
    const move = (next) => {
      if (next.pointerId !== event.pointerId) return;
      fitted = false;
      const point = screenPoint(next);
      view.x = original.x + point.x - start.x;
      view.y = original.y + point.y - start.y;
      scheduleRender();
      next.preventDefault();
    };
    const end = (next) => {
      if (next && next.pointerId !== event.pointerId) return;
      owner.removeEventListener('pointermove', move, true);
      owner.removeEventListener('pointerup', end, true);
      owner.removeEventListener('pointercancel', end, true);
      target.removeEventListener('lostpointercapture', end);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      panning = false;
      cancelPan = undefined;
      suppressClick = true;
      suppressDoubleUntil = performance.now() + 300;
      render();
    };
    cancelPan = () => end();
    owner.addEventListener('pointermove', move, { capture: true, passive: false });
    owner.addEventListener('pointerup', end, true);
    owner.addEventListener('pointercancel', end, true);
    target.addEventListener('lostpointercapture', end);
  }

  function wheel(event) {
    // In screen mode an ordinary wheel belongs to the document inside the frame.
    if (scrollable && !(event.ctrlKey || event.metaKey)
      && (event.view === frame.contentWindow || event.target?.ownerDocument === frameDocument)) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    if (event.ctrlKey || event.metaKey) zoomTo(view.scale * Math.exp(-event.deltaY * unit * .005), screenPoint(event), true);
    else {
      fitted = false;
      view.x -= (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * unit;
      view.y -= (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * unit;
      scheduleRender();
    }
  }

  function keyDown(event) {
    if (event.defaultPrevented || isTextInput(event.target) || isComposingKey(event) || event.metaKey || event.ctrlKey || event.altKey || event.getModifierState?.('AltGraph')) return;
    // Native editor controls own their keyboard activation. HTML buttons inside
    // the preview remain part of the canvas, where Space is the temporary hand tool.
    if (event.target?.ownerDocument === document && event.target.closest?.('button, summary, a[href], [role="button"], [role="link"], dialog[open]')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      if (!space) { space = true; render(); }
    } else {
      const letter = shortcutLetter(event);
      const zoomKey = ['+', '=', '-', '0'].includes(event.key) ? event.key : { Equal: '+', NumpadAdd: '+', Minus: '-', NumpadSubtract: '-', Digit0: '0', Numpad0: '0' }[event.code];
      if (letter === 'h') { hand = true; render(); }
      else if (letter === 'v') { hand = false; render(); }
      else if (event.shiftKey && event.code === 'Digit1') { event.preventDefault(); fit(); }
      else if (zoomKey === '+' || zoomKey === '=') { event.preventDefault(); zoomStep(1); }
      else if (zoomKey === '-') { event.preventDefault(); zoomStep(-1); }
      else if (zoomKey === '0') { event.preventDefault(); zoomTo(1); }
    }
  }

  function keyUp(event) {
    if (event.code === 'Space' && space) { space = false; render(); }
  }

  function resetKeys() { space = false; cancelPan?.(); render(); }
  function blur() { setTimeout(() => { if (!document.hasFocus()) resetKeys(); }, 0); }

  canvas.addEventListener('pointerdown', pointerDown, true);
  canvas.addEventListener('wheel', wheel, { passive: false });
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetKeys(); });
  $('#zoom-in').addEventListener('click', () => zoomStep(1));
  $('#zoom-out').addEventListener('click', () => zoomStep(-1));
  $('#zoom-reset').addEventListener('click', () => zoomTo(1));
  $('#zoom-fit').addEventListener('click', fit);
  $('#tool-select').addEventListener('click', () => { hand = false; render(); });
  $('#tool-hand').addEventListener('click', () => { onPanStart?.(); hand = true; render(); });

  return {
    view, screenPoint, fit, render, measure, centerElement, focusElement,
    panMode,
    isFitted: () => fitted,
    setScrollable(value) {
      scrollable = value;
      frameDocument?.documentElement?.toggleAttribute('data-muse-clip', !scrollable);
    },
    ignoreClick() { const ignored = suppressClick || panMode(); suppressClick = false; return ignored; },
    ignoreDoubleClick: () => panMode() || performance.now() < suppressDoubleUntil,
    suppressNextClick() { suppressClick = true; suppressDoubleUntil = performance.now() + 300; },
    attach(preview) {
      cancelPan?.();
      space = false;
      frame = preview.defaultView.frameElement;
      frameDocument = preview;
      measure();
      delete rendered.mode;
      delete rendered.panning;
      const style = preview.createElement('style');
      style.textContent = 'html[data-muse-clip]{overflow:hidden!important}html[data-muse-pan],html[data-muse-pan] *{cursor:var(--muse-cursor)!important;user-select:none!important}';
      preview.head.append(style);
      preview.documentElement.toggleAttribute('data-muse-clip', !scrollable);
      preview.addEventListener('pointerdown', pointerDown, true);
      preview.addEventListener('wheel', wheel, { passive: false });
      preview.addEventListener('keydown', keyDown);
      preview.addEventListener('keyup', keyUp);
      preview.defaultView.addEventListener('blur', blur);
      render();
    },
  };
}
