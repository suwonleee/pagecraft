import { t } from './i18n.js';
// Geometry is captured once per drag. Pointer updates use numbers, never DOM scans.
const MAX_TARGETS = 200;
const MAX_VISITS = 800;
const THRESHOLD = 6;
const PREFERENCE = 'pagecraft.snap.enabled';

function bounds(rects) {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function anchors(rect, axis) {
  return axis === 'x' ? [rect.left, rect.left + rect.width / 2, rect.right]
    : [rect.top, rect.top + rect.height / 2, rect.bottom];
}

function nearest(start, delta, positions, threshold) {
  let best;
  let ambiguous = false;
  for (const point of start) for (const position of positions) {
    const adjustment = position - point - delta;
    const distance = Math.abs(adjustment);
    if (distance > threshold) continue;
    if (!best || distance < best.distance - .001) {
      best = { adjustment, distance, position };
      ambiguous = false;
    } else if (Math.abs(distance - best.distance) < .001 && Math.abs(adjustment - best.adjustment) > .001) {
      ambiguous = true;
    }
  }
  return ambiguous ? undefined : best;
}

function collectTargets(elements, frame, camera, canvas) {
  const selected = new Set(elements);
  const visited = new Set(elements);
  const parents = new Set();
  const origins = new Set();
  const cursors = [];
  // Follow neighbors of the actual selection instead of starting at document node 1.
  for (const element of elements.slice(0, MAX_TARGETS)) {
    let current = element;
    for (let depth = 0; current?.parentElement && depth < 4; depth++, current = current.parentElement) {
      const parent = current.parentElement;
      parents.add(parent);
      if (!origins.has(current)) {
        origins.add(current);
        cursors.push({ previous: current.previousElementSibling, next: current.nextElementSibling });
      }
    }
  }
  const targets = [];
  let reads = 0;
  let visits = 0;
  const { x, y, scale } = camera.view;
  const visible = { left: (-x - 128) / scale, top: (-y - 128) / scale,
    right: (canvas.clientWidth - x + 128) / scale, bottom: (canvas.clientHeight - y + 128) / scale };
  const add = (element) => {
    if (!element || reads >= MAX_TARGETS || ++visits > MAX_VISITS) return;
    if (visited.has(element)) return;
    visited.add(element);
    for (let parent = element; parent; parent = parent.parentElement) if (selected.has(parent)) return;
    const rect = element.getBoundingClientRect();
    reads++;
    if (rect.width <= 0 || rect.height <= 0 || rect.right < visible.left || rect.left > visible.right || rect.bottom < visible.top || rect.top > visible.bottom) return;
    const css = element.ownerDocument.defaultView.getComputedStyle(element);
    if (css.visibility === 'hidden' || css.visibility === 'collapse') return;
    targets.push(rect);
  };
  // Parent edges are useful alignment references, while the remaining budget goes to peers.
  for (const parent of parents) add(parent);
  let pending = true;
  while (pending && reads < MAX_TARGETS && visits < MAX_VISITS) {
    pending = false;
    for (const cursor of cursors) {
      if (reads >= MAX_TARGETS || visits >= MAX_VISITS) break;
      if (cursor.previous) {
        const element = cursor.previous;
        cursor.previous = element.previousElementSibling;
        add(element);
        pending = true;
      }
      if (cursor.next) {
        const element = cursor.next;
        cursor.next = element.nextElementSibling;
        add(element);
        pending = true;
      }
    }
  }
  targets.push({ left: 0, top: 0, right: frame.clientWidth, bottom: frame.clientHeight, width: frame.clientWidth, height: frame.clientHeight });
  return { x: targets.flatMap((rect) => anchors(rect, 'x')), y: targets.flatMap((rect) => anchors(rect, 'y')) };
}

export function createMoveSnapping({ canvas, getFrame, camera, toggle }) {
  let enabled = true;
  try { enabled = localStorage.getItem(PREFERENCE) !== 'false'; } catch { /* Storage is optional. */ }
  let session;
  const guides = ['x', 'y'].map((axis) => {
    const guide = document.createElement('div');
    guide.className = `snap-guide snap-guide-${axis}`;
    guide.setAttribute('aria-hidden', 'true');
    guide.hidden = true;
    canvas.querySelector('#frame-wrap').append(guide);
    return guide;
  });
  const hide = () => { for (const guide of guides) guide.hidden = true; };
  function reflectToggle() {
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.title = t`Drag snapping ${enabled ? t('on') : t('off')} · Hold Alt/Option to move freely`;
  }
  toggle.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem(PREFERENCE, String(enabled)); } catch { /* Editing remains available. */ }
    reflectToggle();
    hide();
  });
  reflectToggle();

  return {
    begin(elements) {
      this.clear();
      if (!enabled || !elements.length) return;
      const frame = getFrame();
      const moving = elements.filter((element) => element.isConnected && element.ownerDocument === frame.contentDocument);
      if (!moving.length) return;
      const rect = bounds(moving.map((element) => element.getBoundingClientRect()));
      session = { rect, targets: collectTargets(moving, frame, camera, canvas), scale: camera.view.scale };
    },
    update(dx, dy, { altKey = false, axis } = {}) {
      if (!enabled || !session || altKey) { hide(); return { dx, dy }; }
      const threshold = THRESHOLD / session.scale;
      const matches = [
        axis !== 'y' && nearest(anchors(session.rect, 'x'), dx, session.targets.x, threshold),
        axis !== 'x' && nearest(anchors(session.rect, 'y'), dy, session.targets.y, threshold),
      ];
      for (let index = 0; index < guides.length; index++) {
        const match = matches[index];
        const guide = guides[index];
        guide.hidden = !match;
        if (match) guide.style[index ? 'top' : 'left'] = `${match.position}px`;
      }
      return { dx: dx + (matches[0]?.adjustment || 0), dy: dy + (matches[1]?.adjustment || 0) };
    },
    clear() { session = undefined; hide(); },
  };
}
