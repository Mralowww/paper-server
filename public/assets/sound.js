/* Mc.Tierlist.Asia — soft UI sounds, synthesized with Web Audio (no audio files) */
(() => {
  const KEY_ON = 'mctl-sound-on';
  const KEY_VOL = 'mctl-sound-vol';
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* storage blocked */ } };
  let enabled = read(KEY_ON, '1') === '1';
  let volume = Math.min(1, Math.max(0, Number(read(KEY_VOL, '0.4')) || 0));
  let ctx = null;
  let master = null;
  let lastAt = 0;

  function ensure() {
    if (ctx) return ctx.state === 'suspended' ? (ctx.resume(), ctx) : ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
    return ctx;
  }

  /** One enveloped oscillator note. */
  function tone({ f = 880, f2 = null, type = 'sine', t = 0, dur = 0.08, gain = 0.2, attack = 0.004 }) {
    const now = ctx.currentTime + t;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, now);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + dur);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(master);
    o.start(now);
    o.stop(now + dur + 0.02);
  }

  /** Filtered noise sweep ("whoosh"). */
  function whoosh({ t = 0, dur = 0.16, from = 500, to = 2600, gain = 0.08 }) {
    const now = ctx.currentTime + t;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(from, now);
    bp.frequency.exponentialRampToValueAtTime(to, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  const SOUNDS = {
    tap: () => tone({ f: 1500, f2: 1100, type: 'sine', dur: 0.045, gain: 0.12 }),
    hover: () => tone({ f: 2400, type: 'sine', dur: 0.02, gain: 0.025 }),
    switch: () => { tone({ f: 740, type: 'triangle', dur: 0.06, gain: 0.1 }); tone({ f: 1110, type: 'triangle', t: 0.045, dur: 0.07, gain: 0.09 }); },
    toggleOn: () => tone({ f: 620, f2: 980, type: 'sine', dur: 0.09, gain: 0.13 }),
    toggleOff: () => tone({ f: 900, f2: 560, type: 'sine', dur: 0.09, gain: 0.11 }),
    open: () => { whoosh({ dur: 0.14, from: 400, to: 1800, gain: 0.05 }); tone({ f: 520, f2: 860, type: 'sine', dur: 0.12, gain: 0.08 }); },
    close: () => { whoosh({ dur: 0.12, from: 1600, to: 400, gain: 0.04 }); tone({ f: 760, f2: 420, type: 'sine', dur: 0.1, gain: 0.06 }); },
    pop: () => tone({ f: 1250, f2: 820, type: 'sine', dur: 0.06, gain: 0.11 }),
    select: () => { tone({ f: 1320, type: 'sine', dur: 0.05, gain: 0.09 }); tone({ f: 1760, type: 'sine', t: 0.035, dur: 0.06, gain: 0.07 }); },
    success: () => [1046.5, 1318.5, 1568].forEach((f, i) => tone({ f, type: 'sine', t: i * 0.065, dur: 0.16, gain: 0.1 })),
    error: () => { tone({ f: 330, type: 'triangle', dur: 0.11, gain: 0.12 }); tone({ f: 247, type: 'triangle', t: 0.09, dur: 0.16, gain: 0.12 }); },
    copy: () => { tone({ f: 1760, type: 'sine', dur: 0.04, gain: 0.08 }); tone({ f: 2349, type: 'sine', t: 0.04, dur: 0.07, gain: 0.07 }); },
    send: () => { whoosh({ dur: 0.18, from: 600, to: 3200, gain: 0.07 }); tone({ f: 880, f2: 1400, type: 'sine', dur: 0.1, gain: 0.07 }); },
    message: () => { tone({ f: 1318.5, type: 'sine', dur: 0.22, gain: 0.1 }); tone({ f: 1975.5, type: 'sine', t: 0.09, dur: 0.3, gain: 0.08 }); },
    notify: () => { tone({ f: 988, type: 'triangle', dur: 0.12, gain: 0.08 }); tone({ f: 1318.5, type: 'triangle', t: 0.08, dur: 0.16, gain: 0.07 }); },
    big: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f, type: 'sine', t: i * 0.08, dur: 0.26, gain: 0.1 })),
    launch: () => {
      [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568].forEach((f, i) => tone({ f, type: 'sine', t: i * 0.09, dur: 0.4, gain: 0.09 }));
      whoosh({ t: 0.45, dur: 0.6, from: 2000, to: 7000, gain: 0.04 });
    },
  };

  /**
   * Plays a sound. `weak` sounds (generic taps) yield to anything that played in the last 70 ms,
   * so one click that also opens a dialog makes one sound, not two.
   */
  function play(name, { weak = false, force = false } = {}) {
    if ((!enabled && !force) || !SOUNDS[name]) return;
    const nowMs = performance.now();
    if (weak && nowMs - lastAt < (typeof weak === 'number' ? weak : 70)) return;
    if (!ensure()) return;
    lastAt = nowMs;
    try { SOUNDS[name](); } catch { /* audio not ready */ }
  }

  function setVolume(v) {
    volume = Math.min(1, Math.max(0, v));
    write(KEY_VOL, volume);
    if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.02);
  }
  function setEnabled(on) {
    enabled = !!on;
    write(KEY_ON, enabled ? '1' : '0');
  }

  // ---------------------------------------------------------------- automatic hooks
  const SWITCH_SEL = '.pf-tabs button, .pfx-tabs button, .side-nav [data-tab], .seg button, .inbox-seg button, .au-range button, [data-tab]:not(.ctx-item)';
  const OPEN_SEL = '.dd-toggle, .nsel-btn, .menu-btn';
  document.addEventListener('pointerdown', () => ensure(), { capture: true, once: true });
  document.addEventListener('keydown', () => ensure(), { capture: true, once: true });

  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('button, a[href], [role=button], [role=option], label, .sp-stat, .sp-card, .inbox-item, .au-row, .pf-match, input[type=checkbox], input[type=radio]');
    if (!el || el.disabled) return;
    if (el.matches('input[type=checkbox]')) return play(el.checked ? 'toggleOn' : 'toggleOff');
    if (el.matches('input[type=radio], label')) return setTimeout(() => play('select', { weak: true }), 12);
    if (el.matches(SWITCH_SEL)) return setTimeout(() => play('switch', { weak: true }), 12);
    if (el.matches(OPEN_SEL)) return setTimeout(() => play('pop', { weak: true }), 12);
    if (el.closest('.nsel-menu, .dd-menu, .cmdk-item')) return setTimeout(() => play('select', { weak: true }), 12);
    setTimeout(() => play('tap', { weak: true }), 12);
  }, true);

  // Soft tick when moving through menus with the mouse.
  let hoverEl = null;
  document.addEventListener('pointerover', (e) => {
    const it = e.target.closest?.('.ctx-item:not(:disabled), .nsel-opt, .cmdk-item');
    if (it && it !== hoverEl) { hoverEl = it; play('hover', { weak: true }); }
  });

  const ADDED = [
    ['.nt-bg.err', 'error'], ['.nt-bg', 'success'], ['.sp-success', 'big'], ['.ctx', 'pop'],
    ['.modal-bg, .pfx-bg, .lightbox, .cmdk-bg', 'open'],
  ];
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        const hit = ADDED.find(([sel]) => n.matches(sel));
        // Toasts right after an action (e.g. a copy) don't add a second sound.
        if (hit) { play(hit[1], { weak: n.matches('.nt-bg.ok') ? 200 : false }); continue; }
        // Support chat: new bubbles that slide in.
        if (n.matches('.sp-msg.sp-in')) { play(n.classList.contains('mine') ? 'send' : 'message'); continue; }
        if (n.matches('.sp-sys.sp-in')) play('notify');
      }
      if (m.type === 'attributes' && m.target.nodeType === 1) {
        const el = m.target;
        const was = m.oldValue || '';
        const has = (c) => el.classList.contains(c);
        if (el.matches('.nt-bg') && has('out') && !was.includes('out')) play('close', { weak: true });
        else if (el.matches('.au-drawer') && has('open') !== was.includes('open')) play(has('open') ? 'open' : 'close');
        else if ((el.matches('.modal-bg, .pfx-bg, .lightbox') && has('closing') && !was.includes('closing'))
          || (el.matches('.lightbox, .cmdk-bg') && has('out') && !was.includes('out'))) play('close');
        else if (el === document.body && has('gate-open') && !was.includes('gate-open')) play('launch');
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });

  // Copy actions announce themselves through toasts; give clipboard writes their own sound.
  const clip = navigator.clipboard;
  if (clip?.writeText) {
    const orig = clip.writeText.bind(clip);
    clip.writeText = (...a) => orig(...a).then((r) => { play('copy'); return r; });
  }

  window.MCTL_SOUND = {
    play, setVolume, setEnabled,
    get enabled() { return enabled; },
    get volume() { return volume; },
    names: Object.keys(SOUNDS),
  };
})();
