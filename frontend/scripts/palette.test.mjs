import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function luminance(hex) {
  const [r, g, b] = hex
    .slice(1)
    .match(/../g)
    .map((value) => parseInt(value, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}
function contrast(a, b) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
test('light and dark text, button and feedback tokens meet WCAG AA contrast', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const light = css.match(/:root\s*\{([\s\S]*?)\}/)[1];
  const dark = css.match(/:root\[data-theme=["']dark["']\]\s*\{([\s\S]*?)\}/)[1];
  for (const [theme, block] of [
    ['light', light],
    ['dark', dark],
  ]) {
    const tokens = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map((match) => [match[1], match[2]]),
    );
    for (const bg of ['bg', 'surface', 'raised', 'hover']) {
      for (const text of ['text', 'muted', 'accent'])
        assert.ok(contrast(tokens[text], tokens[bg]) >= 4.5, `${theme}: ${text} on ${bg}`);
      assert.ok(contrast(tokens['control-border'], tokens[bg]) >= 3, `${theme}: control on ${bg}`);
    }
    assert.ok(
      contrast(tokens['button-text'], tokens['button-bg']) >= 4.5,
      `${theme}: primary button`,
    );
    for (const state of ['success', 'error', 'warning', 'info'])
      assert.ok(contrast(tokens[state], tokens[`${state}-bg`]) >= 4.5, `${theme}: ${state}`);
    const hero = block.match(/--hero:\s*linear-gradient\(([^;]+)\);/)[1].match(/#[\da-f]{6}/gi);
    for (const color of hero)
      assert.ok(
        contrast(tokens['hero-muted'], color) >= 4.5,
        `${theme}: muted text on hero ${color}`,
      );
  }
});
