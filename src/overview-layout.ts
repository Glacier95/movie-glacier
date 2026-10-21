// Deterministic circle packing: no force simulation can drift beyond the viewport.
export function packBubbles(values: number[], width: number, height: number) {
  const max = Math.max(1, ...values);
  const placed: { x: number; y: number; radius: number }[] = [];
  for (const value of values) {
    const radius = 42 * Math.sqrt(Math.max(0, value) / max);
    let x = 0, y = 0;
    for (let step = 0; ; step++) {
      const distance = 3 * Math.sqrt(step), angle = step * 2.399963;
      x = distance * Math.cos(angle); y = distance * Math.sin(angle);
      if (placed.every(p => Math.hypot(x - p.x, y - p.y) >= radius + p.radius + 10)) break;
    }
    placed.push({ x, y, radius });
  }
  if (!placed.length) return [];
  const left = Math.min(...placed.map(p => p.x - p.radius)), right = Math.max(...placed.map(p => p.x + p.radius));
  const top = Math.min(...placed.map(p => p.y - p.radius)), bottom = Math.max(...placed.map(p => p.y + p.radius));
  const scale = Math.min(1.2, Math.max(1, width - 80) / (right - left || 1), Math.max(1, height - 70) / (bottom - top || 1));
  return placed.map(p => ({ x: width / 2 + (p.x - (left + right) / 2) * scale,
    y: height / 2 + (p.y - (top + bottom) / 2) * scale, radius: p.radius * scale }));
}
