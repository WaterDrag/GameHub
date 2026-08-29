// Pixi bootstrap – jedna Application na celý Hub, hry do ní jen
// vkládají svůj root kontejner. Renderer se tak nevytváří pořád dokola.
import * as PIXI from 'https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.mjs';
import { colors, onThemeChange } from './theme.js';

export { PIXI };

let app = null;
let host = null;

export async function getApp(container) {
  if (app) {
    if (host !== container) { container.append(app.canvas); host = container; }
    app.resizeTo = container;
    app.resize();
    return app;
  }
  app = new PIXI.Application();
  await app.init({
    background: colors().bg,
    resizeTo: container,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    preference: 'webgl',
  });
  app.canvas.style.display = 'block';
  container.append(app.canvas);
  host = container;
  // pozadí plátna musí jít s motivem, jinak kolem desky svítí cizí barva
  onThemeChange(({ colors: c }) => { if (app) app.renderer.background.color = c.bg; });
  return app;
}

export function clearStage() {
  if (!app) return;
  app.stage.removeChildren().forEach(c => c.destroy({ children: true }));
}

// Plynulé dojezdy – bez toho vypadá i 60 fps kostrbatě.
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
