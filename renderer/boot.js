/* Load WebGL view first, then classic game.js (globals for smoke/console).
   Always load game.js even if WebGL/3D init fails — otherwise title/music die. */
const CACHE = 'v232k';

async function loadGameScript() {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `game.js?v=${CACHE}`;
    s.onload = resolve;
    s.onerror = () => reject(new Error('failed to load game.js'));
    document.body.appendChild(s);
  });
}

try {
  const { createLot3D } = await import(`./world3d.js?v=${CACHE}`);
  const host = document.getElementById('view3d');
  const sceneCv = document.getElementById('scene');
  try {
    window.Lot3D = createLot3D(host, sceneCv.width, sceneCv.height);
  } catch (err) {
    console.warn('WebGL panorama unavailable; using 2D fallback', err);
    window.Lot3D = null;
  }
} catch (err) {
  console.warn('world3d module failed; using 2D fallback', err);
  window.Lot3D = null;
}

await loadGameScript();
