// =====================================================================
// MINI BATTLE ROYALE — Sound engine (procedural WebAudio, no files)
// Все звуки генерируются на лету через осцилляторы и шум.
// =====================================================================
"use strict";

const Sounds = (() => {
  let ctx = null;
  let masterGain = null;
  let muted = false;
  let inited = false;
  // буфер белого шума для дробовика/попаданий/шагов
  let noiseBuf = null;

  function init() {
    if (inited) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.35;
      masterGain.connect(ctx.destination);
      // noise buffer
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i=0;i<len;i++) d[i] = Math.random()*2 - 1;
      inited = true;
    } catch (e) {
      console.warn("WebAudio not available", e);
    }
  }

  function resume() {
    if (ctx && ctx.state === "suspended") ctx.resume();
  }

  function tone({ freq=440, type="sine", dur=0.1, vol=0.3, attack=0.005, decay=0.08, freqEnd=null, pan=0 } = {}) {
    if (!inited || muted) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); p.connect(masterGain);
    } else {
      g.connect(masterGain);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise({ dur=0.1, vol=0.3, lp=8000, hp=100, pan=0 } = {}) {
    if (!inited || muted) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass"; lpf.frequency.value = lp;
    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass"; hpf.frequency.value = hp;
    src.connect(hpf); hpf.connect(lpf); lpf.connect(g);
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); p.connect(masterGain);
    } else {
      g.connect(masterGain);
    }
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  // ---------- Конкретные звуки ----------
  // pan: -1 = слева, 0 = центр (свой), 1 = справа. Громкость зависит от расстояния.
  function shoot(weapon, pan=0, dist=0) {
    const vol = Math.max(0.05, 0.6 * (1 - Math.min(1, dist/1500)));
    if (weapon === "pistol") {
      tone({ freq: 700, type:"square", dur:0.08, vol:vol*0.5, freqEnd:120, pan });
      noise({ dur:0.06, vol:vol*0.4, lp:3500, hp:300, pan });
    } else if (weapon === "ar") {
      tone({ freq: 900, type:"sawtooth", dur:0.06, vol:vol*0.45, freqEnd:200, pan });
      noise({ dur:0.05, vol:vol*0.35, lp:4500, hp:400, pan });
    } else if (weapon === "shotgun") {
      tone({ freq: 220, type:"square", dur:0.18, vol:vol*0.5, freqEnd:60, pan });
      noise({ dur:0.22, vol:vol*0.7, lp:2500, hp:80, pan });
    } else if (weapon === "sniper") {
      tone({ freq: 1400, type:"sawtooth", dur:0.25, vol:vol*0.6, freqEnd:90, pan });
      noise({ dur:0.18, vol:vol*0.4, lp:5000, hp:200, pan });
    } else {
      tone({ freq:600, type:"square", dur:0.07, vol:vol*0.4, freqEnd:150, pan });
    }
  }

  function hit(pan=0, dist=0) {
    const vol = Math.max(0.05, 0.55 * (1 - Math.min(1, dist/1200)));
    noise({ dur:0.1, vol:vol*0.5, lp:1800, hp:120, pan });
    tone({ freq:160, type:"sine", dur:0.09, vol:vol*0.4, freqEnd:60, pan });
  }

  function reload() {
    tone({ freq: 380, type:"square", dur:0.06, vol:0.25 });
    setTimeout(() => tone({ freq: 250, type:"square", dur:0.08, vol:0.25 }), 90);
    setTimeout(() => tone({ freq: 500, type:"square", dur:0.06, vol:0.25 }), 250);
  }

  function reloadDone() {
    tone({ freq: 800, type:"square", dur:0.05, vol:0.22 });
    setTimeout(() => tone({ freq: 1100, type:"square", dur:0.07, vol:0.22 }), 60);
  }

  function pickup(type="ammo") {
    if (type === "heal") {
      tone({ freq:660, type:"sine", dur:0.1, vol:0.25 });
      setTimeout(() => tone({ freq:990, type:"sine", dur:0.12, vol:0.25 }), 90);
    } else if (type === "ammo") {
      tone({ freq:520, type:"triangle", dur:0.07, vol:0.2 });
      setTimeout(() => tone({ freq:780, type:"triangle", dur:0.09, vol:0.2 }), 70);
    } else {
      // weapon
      tone({ freq:440, type:"sawtooth", dur:0.08, vol:0.25 });
      setTimeout(() => tone({ freq:660, type:"sawtooth", dur:0.08, vol:0.25 }), 80);
      setTimeout(() => tone({ freq:880, type:"sawtooth", dur:0.1, vol:0.25 }), 160);
    }
  }

  function step(pan=0) {
    noise({ dur:0.07, vol:0.12, lp:600, hp:80, pan });
  }

  function build(pan=0) {
    noise({ dur:0.05, vol:0.25, lp:1200, hp:150, pan });
    tone({ freq:350, type:"square", dur:0.07, vol:0.18, freqEnd:600, pan });
  }

  function buildBreak(pan=0) {
    noise({ dur:0.2, vol:0.45, lp:1500, hp:100, pan });
    tone({ freq:200, type:"sawtooth", dur:0.18, vol:0.3, freqEnd:50, pan });
  }

  function buildHit(pan=0) {
    noise({ dur:0.04, vol:0.18, lp:2500, hp:400, pan });
    tone({ freq:900, type:"square", dur:0.04, vol:0.12, freqEnd:1400, pan });
  }

  function death() {
    tone({ freq:400, type:"sawtooth", dur:0.5, vol:0.4, freqEnd:60 });
    noise({ dur:0.4, vol:0.3, lp:1500, hp:80 });
  }

  function victory() {
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => tone({ freq:f, type:"square", dur:0.18, vol:0.3 }), i*140);
    });
  }

  function uiClick() { tone({ freq:600, type:"square", dur:0.04, vol:0.15 }); }

  function setMuted(m) { muted = m; }
  function isMuted() { return muted; }
  function setVolume(v) { if (masterGain) masterGain.gain.value = Math.max(0, Math.min(1, v)); }

  // ---------- Фоновая музыка (процедурная, ambient + бас) ----------
  let musicTimer = null;
  let musicOn = false;
  let musicNode = null;

  // Простая мелодия: тоник + квинта + минорная септима, медленный аккордовый ход
  // Уровни Battle Royale-стиля: тревожная, неспешная.
  const SCALE = [220.00, 246.94, 277.18, 293.66, 329.63, 369.99, 415.30, 440.00]; // A minor pentatonic-ish
  const CHORDS = [
    [110, 164.81, 220],   // A
    [98,  146.83, 196],   // G
    [123.47, 185, 246.94],// B dim-ish
    [82.41, 123.47, 164.81], // E
  ];
  let chordIdx = 0;
  let beat = 0;

  function playChord(notes, dur=4.0, vol=0.04) {
    if (!inited || muted || !musicOn) return;
    const t0 = ctx.currentTime;
    notes.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i===0 ? "sine" : "triangle";
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.8);
      g.gain.linearRampToValueAtTime(vol*0.7, t0 + dur*0.5);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(masterGain);
      osc.start(t0); osc.stop(t0 + dur + 0.1);
    });
  }

  function playArp(rootIdx) {
    if (!inited || muted || !musicOn) return;
    const notes = [SCALE[rootIdx%SCALE.length], SCALE[(rootIdx+2)%SCALE.length], SCALE[(rootIdx+4)%SCALE.length], SCALE[(rootIdx+6)%SCALE.length]];
    notes.forEach((f, i) => {
      setTimeout(() => {
        if (!musicOn) return;
        const t0 = ctx.currentTime;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f * 2;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.025, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
        osc.connect(g); g.connect(masterGain);
        osc.start(t0); osc.stop(t0 + 0.55);
      }, i * 220);
    });
  }

  function startMusic() {
    if (musicOn) return;
    init(); resume();
    musicOn = true;
    chordIdx = 0; beat = 0;
    const tick = () => {
      if (!musicOn) return;
      playChord(CHORDS[chordIdx % CHORDS.length], 4.0, 0.045);
      if (beat % 2 === 0) playArp((chordIdx*2) % SCALE.length);
      chordIdx++;
      beat++;
      musicTimer = setTimeout(tick, 4000);
    };
    tick();
  }

  function stopMusic() {
    musicOn = false;
    if (musicTimer) { clearTimeout(musicTimer); musicTimer = null; }
  }

  function isMusicOn() { return musicOn; }

  return {
    init, resume, setMuted, isMuted, setVolume,
    shoot, hit, reload, reloadDone, pickup, step,
    build, buildBreak, buildHit, death, victory, uiClick,
    startMusic, stopMusic, isMusicOn,
  };
})();
