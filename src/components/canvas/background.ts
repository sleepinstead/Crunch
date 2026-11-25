// The board background: pattern, colour and density as CSS.
import { type CSSProperties } from 'react';
import { type Project } from '../../api';
import { isDark } from '../../color';

export function backgroundStyle(project: Project, v: { x: number; y: number }): CSSProperties {
  const style: CSSProperties = { backgroundColor: project.bgColor };
  if (project.pattern === 'plain') return style;
  const dark = isDark(project.bgColor);
  const density = project.density || 1;
  const rgb = dark ? '255,255,255' : '0,0,0';
  const scale = Math.pow(density, 0.8);

  if (project.pattern === 'dots') {
    const step = 22 / scale;
    const r = 1.1 * Math.min(1, Math.pow(density, -0.3));
    style.backgroundImage = `radial-gradient(circle at ${step / 2}px ${step / 2}px, rgba(${rgb},0.17) ${r}px, transparent ${r + 0.7}px)`;
    style.backgroundSize = `${step}px ${step}px`;
    style.backgroundPosition = `${v.x - step / 2}px ${v.y - step / 2}px`;
  } else {
    const step = 32 / scale;
    const a = dark ? 0.07 : 0.065;
    style.backgroundImage = `linear-gradient(to right, rgba(${rgb},${a}) 1px, transparent 1px), linear-gradient(to bottom, rgba(${rgb},${a}) 1px, transparent 1px)`;
    style.backgroundSize = `${step}px ${step}px`;
    style.backgroundPosition = `${v.x}px ${v.y}px`;
  }
  return style;
}
