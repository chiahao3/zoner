// Pointer helpers: drag with capture, click vs drag, wheel, double click.
import { Store } from './state';

export interface DragHandlers {
  onDrag?: (x: number, y: number, px: number, py: number, e: PointerEvent) => void;
  onRightDrag?: (dx: number, dy: number) => void;
  onClick?: (x: number, y: number, e: PointerEvent) => void;
  onWheel?: (dy: number, e: WheelEvent) => void;
  onDbl?: (x: number, y: number) => void;
}

export function attachPointer(elm: HTMLElement, store: Store, h: DragHandlers, onEnd: () => void) {
  let down = false, right = false, moved = false;
  let px = 0, py = 0, sx = 0, sy = 0;
  const local = (e: { clientX: number; clientY: number }) => {
    const r = elm.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  elm.addEventListener('contextmenu', (e) => e.preventDefault());
  elm.addEventListener('pointerdown', (e) => {
    down = true;
    right = e.button === 2 || (e.button === 0 && e.ctrlKey);
    moved = false;
    [px, py] = local(e);
    [sx, sy] = [px, py];
    elm.setPointerCapture(e.pointerId);
    if (!right) store.interacting = true;
    e.preventDefault();
  });
  elm.addEventListener('pointermove', (e) => {
    if (!down) return;
    const [x, y] = local(e);
    if (Math.hypot(x - sx, y - sy) > 3) moved = true;
    if (!moved) return;
    if (right) h.onRightDrag?.(x - px, y - py);
    else h.onDrag?.(x, y, px, py, e);
    [px, py] = [x, y];
  });
  const up = (e: PointerEvent) => {
    if (!down) return;
    down = false;
    store.interacting = false;
    if (!moved && !right) {
      const [x, y] = local(e);
      h.onClick?.(x, y, e);
    }
    onEnd();
  };
  elm.addEventListener('pointerup', up);
  elm.addEventListener('pointercancel', up);
  elm.addEventListener('dblclick', (e) => {
    const [x, y] = local(e);
    h.onDbl?.(x, y);
  });
  if (h.onWheel)
    elm.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        h.onWheel!(e.deltaY, e);
      },
      { passive: false },
    );
}
