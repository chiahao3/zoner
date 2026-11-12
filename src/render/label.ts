// Crystallographic index labels on a 2D canvas, with overbars for negative indices.

/** Width (px) drawIdx would use for this label with the current ctx.font. */
export function idxWidth(ctx: CanvasRenderingContext2D, ix: number[], open = '', close = ''): number {
  const sep = ix.every((v) => Math.abs(v) < 10) ? '' : ' ';
  const t = open + ix.map((v) => String(Math.abs(v))).join(sep) + close;
  return ctx.measureText(t).width;
}
export function drawIdx(
  ctx: CanvasRenderingContext2D, ix: number[], x: number, y: number,
  opts: { open?: string; close?: string; align?: 'left' | 'center' } = {},
): number {
  const open = opts.open ?? '', close = opts.close ?? '';
  const sep = ix.every((v) => Math.abs(v) < 10) ? '' : ' ';
  const parts: { t: string; neg: boolean }[] = [];
  if (open) parts.push({ t: open, neg: false });
  ix.forEach((v, i) => {
    parts.push({ t: String(Math.abs(v)), neg: v < 0 });
    if (sep && i < ix.length - 1) parts.push({ t: sep, neg: false });
  });
  if (close) parts.push({ t: close, neg: false });
  const widths = parts.map((p) => ctx.measureText(p.t).width);
  const total = widths.reduce((a, b) => a + b, 0);
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  let cx = opts.align === 'center' ? x - total / 2 : x;
  const fs = parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '11');
  parts.forEach((p, i) => {
    ctx.fillText(p.t, cx, y);
    if (p.neg) ctx.fillRect(cx + 0.5, y - fs * 0.92, widths[i] - 1, Math.max(1, fs * 0.08));
    cx += widths[i];
  });
  ctx.textAlign = prevAlign;
  return total;
}
