/* The table bell (Bar & Resto): one ring for a tap, a ringing bell for as long as the button is held.
 *   Bell.start()  start ringing (keeps ringing until stop)     Bell.stop()  let the last ring fade out
 *   Bell.ring(ms) ring once (ms 0) or for ms milliseconds — the staff screen replays the customer's press
 *   Bell.on()     true once the browser lets this page play sound (it needs one tap after the page opens)
 *   Bell.onchange called when that changes
 * Staff app only (index.html): the customer menu stays silent. */
(function () {
  const SRC = new URL('bell.mp3', (document.currentScript && document.currentScript.src) || location.href).href;
  const EVERY = 650; // a new strike while held: the rings overlap into one sustained sound
  const MAX = 8000; // nobody rings for longer than this
  let ctx = null, buf = null, loading = null, timer = null, stopAt = null, on = false, gen = 0;
  function ac() {
    try {
      if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch (e) { return null; }
    return ctx;
  }
  function load() {
    if (buf) return Promise.resolve(buf);
    if (loading) return loading;
    const c = ac(); if (!c) return Promise.resolve(null);
    loading = fetch(SRC).then((r) => r.arrayBuffer()).then((a) => new Promise((ok, no) => c.decodeAudioData(a, ok, no)))
      .then((b) => (buf = b)).catch(() => { loading = null; return null; });
    return loading;
  }
  function strike() {
    const c = ac(); if (!c || !buf) return;
    try { const s = c.createBufferSource(); const g = c.createGain(); g.gain.value = 0.7; s.buffer = buf; s.connect(g); g.connect(c.destination); s.start(); } catch (e) { }
  }
  function stop() { on = false; clearInterval(timer); clearTimeout(stopAt); timer = stopAt = null; }
  /* ring until stop() — or for `ms` milliseconds; under one strike's gap it is a single ring */
  function start(ms) {
    stop(); on = true; const my = ++gen; const len = ms == null ? MAX : Math.max(0, Math.min(MAX, Number(ms) || 0));
    load().then(() => {
      if (my !== gen) return; // a newer ring took over
      strike(); if (!on || len < EVERY) { on = false; return; } // released before the sound had loaded: still one ring
      timer = setInterval(strike, EVERY); stopAt = setTimeout(stop, len);
    });
  }
  const ring = (ms) => start(ms || 0);
  // browsers only play sound after the person has touched the page: wake the audio on every touch until it runs
  const isOn = () => !!ctx && ctx.state === 'running';
  const tell = () => { if (typeof window.Bell.onchange === 'function') try { window.Bell.onchange(isOn()); } catch (e) { } };
  const wake = () => {
    if (isOn() && buf) return;
    const c = ac(); load(); if (!c) return;
    if (c.state === 'running') tell(); else c.resume().then(tell, () => {});
    if (!c._watch) { c._watch = 1; c.onstatechange = tell; }
  };
  ['pointerdown', 'keydown', 'touchend'].forEach((ev) => document.addEventListener(ev, wake, { capture: true, passive: true }));
  window.Bell = { start, stop, ring, MAX, EVERY, on: isOn, onchange: null };
})();
