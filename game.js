// =====================================================================
// MINI BATTLE ROYALE — клиент (Solo + Multiplayer)
// =====================================================================
"use strict";

// ---------- DOM ----------
const canvas = document.getElementById("game");
// alpha:false — ускоряет композитинг кадра в 1.5-2x в Chromium
const ctx    = canvas.getContext("2d", { alpha: false, desynchronized: true });
const mini   = document.getElementById("minimap");
const mctx   = mini.getContext("2d", { alpha: true });

const hpEl     = document.getElementById("hp");
const hpFill   = document.getElementById("hp-fill");
const hpVal    = document.getElementById("hp-val");
const armorRow = document.getElementById("armor-row");
const armorFill= document.getElementById("armor-fill");
const armorVal = document.getElementById("armor-val");
function setHpBar(hp, max=100, armor=0, maxArmor=100) {
  if (hpFill) {
    const pct = Math.max(0, Math.min(100, (hp/max)*100));
    hpFill.style.width = pct + "%";
    hpFill.classList.toggle("low", pct < 30);
    if (hpVal) hpVal.textContent = Math.max(0, Math.floor(hp)) + "/" + max;
  }
  if (armorRow) {
    if (armor > 0) {
      armorRow.style.display = "flex";
      const pct = Math.max(0, Math.min(100, (armor/maxArmor)*100));
      armorFill.style.width = pct + "%";
      armorVal.textContent = Math.floor(armor) + "/" + maxArmor;
    } else {
      armorRow.style.display = "none";
    }
  }
}
const aliveEl  = document.getElementById("alive");
const killsEl  = document.getElementById("kills");
const stormEl  = document.getElementById("storm");
const reloadEl = document.getElementById("reload-hint");
const msgEl    = document.getElementById("center-msg");
const wbarEl   = document.getElementById("weapon-bar");
const kfEl     = document.getElementById("killfeed");
const menuEl   = document.getElementById("menu");
const statusEl = document.getElementById("status-line");
const matsEl   = document.getElementById("mats");
const buildHintEl = document.getElementById("build-hint");
const soundHintEl = document.getElementById("sound-hint");

const tabSolo = document.getElementById("tab-solo");
const tabMp   = document.getElementById("tab-mp");
const soloOpts= document.getElementById("solo-opts");
const mpOpts  = document.getElementById("mp-opts");
const playBtn = document.getElementById("play-btn");

let mode = "solo";
tabSolo.onclick = () => { mode="solo"; tabSolo.classList.add("active"); tabMp.classList.remove("active"); soloOpts.style.display="block"; mpOpts.style.display="none"; statusEl.textContent=""; };
tabMp.onclick   = () => {
  mode="mp";
  tabMp.classList.add("active"); tabSolo.classList.remove("active");
  soloOpts.style.display="none"; mpOpts.style.display="block";
  statusEl.textContent="";
  // Auto-detect: если страница загружена через https:// (ngrok/cloudflare/etc) — подставляем wss://
  const serverInput = document.getElementById("server-url");
  if (location.protocol === "https:") {
    serverInput.value = "wss://" + location.host;
  } else if (location.protocol === "http:" && location.hostname !== "" && location.hostname !== "localhost" && !location.hostname.startsWith("file")) {
    serverInput.value = "ws://" + location.host;
  }
};

// ---------- Canvas size ----------
// Render scale: 1.0 = native (полное качество и большой FOV)
// Игровой "зум камеры" остаётся 1:1 в мировых пикселях — изменение RENDER_SCALE
// раньше сжимало canvas и FOV получался меньше. Поэтому 1.0.
let RENDER_SCALE = 1.0;
function resize() {
  canvas.style.width  = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  canvas.width  = Math.floor(window.innerWidth  * RENDER_SCALE);
  canvas.height = Math.floor(window.innerHeight * RENDER_SCALE);
  _canvasScale = RENDER_SCALE;
}
let _canvasScale = RENDER_SCALE;
window.addEventListener("resize", resize);
resize();

// ---------- Utils ----------
const TAU = Math.PI*2;
const rand = (a,b)=> a + Math.random()*(b-a);
const clamp = (v,a,b)=> Math.max(a, Math.min(b,v));
const dist2 = (a,b)=> { const dx=a.x-b.x,dy=a.y-b.y; return dx*dx+dy*dy; };

// ---------- Weapons (общая база) ----------
const WEAPONS = {
  pistol:  { key:"1", name:"Pistol",  emoji:"🔫", dmg:18, cooldown:0.30, mag:12, reload:1.2, spread:0.04, bulletSpeed:850, range:1.0 },
  ar:      { key:"2", name:"AR",      emoji:"🎯", dmg:14, cooldown:0.11, mag:30, reload:1.8, spread:0.07, bulletSpeed:950, range:1.0 },
  shotgun: { key:"3", name:"Shotgun", emoji:"💥", dmg:14, cooldown:0.75, mag:6,  reload:2.2, spread:0.20, bulletSpeed:800, range:0.6, pellets:7 },
  sniper:  { key:"4", name:"Sniper",  emoji:"🎯", dmg:75, cooldown:1.20, mag:5,  reload:2.8, spread:0.005, bulletSpeed:1500, range:1.5 },
  minigun: { key:"5", name:"Minigun", emoji:"⚡", dmg:9,  cooldown:0.04, mag:100,reload:3.5, spread:0.10, bulletSpeed:1100, range:1.0, legendary:true },
  rocket:  { key:"6", name:"Rocket",  emoji:"🚀", dmg:90, cooldown:1.50, mag:3,  reload:3.0, spread:0.0,  bulletSpeed:600, range:2.0, legendary:true },
};
const WEAPON_ORDER = ["pistol","ar","shotgun","sniper"];

// ---------- Build system ----------
const WALL_SIZE = 60;     // размер тайла (квадрат) в пикселях
const WALL_PLACE_DIST = 110;
const STRUCTURES = {
  wall:  { name:"Wall",  cost:10, hp:80,  color:"#a07050", strokeColor:"#5a3a20", blocksMove:true,  blocksBullets:true,  speedMod:1.0 },
  floor: { name:"Floor", cost:5,  hp:40,  color:"#c2a060", strokeColor:"#7a5a30", blocksMove:false, blocksBullets:false, speedMod:1.2 },
  ramp:  { name:"Ramp",  cost:15, hp:60,  color:"#b88a4a", strokeColor:"#6a4a20", blocksMove:false, blocksBullets:true,  speedMod:1.0 }, // блокирует пули, но проходима
};
const STRUCTURE_ORDER = ["wall","floor","ramp"];

// ---------- Input ----------
// Используем e.code (физическая клавиша) — не зависит от раскладки клавиатуры (RU/EN/etc)
const keys = {};
const mouse = { x: window.innerWidth/2, y: window.innerHeight/2, down:false, rdown:false };

// Маппинг физических кодов -> логических имён, которые читает движок
const KEY_MAP = {
  "KeyW":"w","KeyA":"a","KeyS":"s","KeyD":"d","KeyR":"r","KeyQ":"q","KeyM":"m","KeyE":"e",
  "ShiftLeft":"shift","ShiftRight":"shift",
  "ArrowUp":"w","ArrowDown":"s","ArrowLeft":"a","ArrowRight":"d",
  "Digit1":"1","Digit2":"2","Digit3":"3","Digit4":"4",
  "Numpad1":"1","Numpad2":"2","Numpad3":"3","Numpad4":"4",
};

let buildMode = false;
let buildType = "wall";
function toggleBuildMode() {
  // разрешаем и в solo, и в MP
  const aliveSolo = solo && solo.player && solo.player.alive;
  const aliveMP = isMultiplayer && me && me.alive;
  if (!aliveSolo && !aliveMP) return;
  buildMode = !buildMode;
  updateBuildHint();
  Sounds.uiClick();
}
function cycleBuildType() {
  if (!buildMode) return;
  const i = STRUCTURE_ORDER.indexOf(buildType);
  buildType = STRUCTURE_ORDER[(i+1) % STRUCTURE_ORDER.length];
  updateBuildHint();
  Sounds.uiClick();
}
function setBuildType(t) {
  if (!STRUCTURES[t]) return;
  buildType = t;
  if (!buildMode) { buildMode = true; }
  updateBuildHint();
  Sounds.uiClick();
}
function updateBuildHint() {
  if (!buildMode) { buildHintEl.style.display = "none"; return; }
  const s = STRUCTURES[buildType];
  buildHintEl.style.display = "block";
  buildHintEl.innerHTML = `🏗 BUILD: <b>${s.name}</b> (${s.cost}🧱) — ЛКМ ставит, <kbd>B</kbd> сменить тип`;
}
function toggleMute() {
  Sounds.setMuted(!Sounds.isMuted());
  soundHintEl.textContent = Sounds.isMuted() ? "🔇 Sound: OFF (M) | 🎵 Music: N (toggle)" : "🔊 Sound: ON (M) | 🎵 Music: N (toggle)";
}
function toggleMusic() {
  if (Sounds.isMusicOn()) Sounds.stopMusic();
  else Sounds.startMusic();
}

window.addEventListener("keydown", e => {
  const k = KEY_MAP[e.code];
  if (k) {
    keys[k] = true;
    // не даём страницы прокручиваться при WASD/стрелках/пробеле
    if (["w","a","s","d"].includes(k)) e.preventDefault();
  }
  // также пишем по e.key для совместимости (если код не распознан)
  if (e.key) keys[e.key.toLowerCase()] = true;

  if (running) {
    if (k === "1" || e.key === "1") trySwitch("pistol");
    if (k === "2" || e.key === "2") trySwitch("ar");
    if (k === "3" || e.key === "3") trySwitch("shotgun");
    if (k === "4" || e.key === "4") trySwitch("sniper");
    if (k === "r" || (e.key && e.key.toLowerCase()==="r")) tryReload();
    if (k === "q" || (e.key && e.key.toLowerCase()==="q")) { toggleBuildMode(); e.preventDefault(); }
    if (k === "m" || (e.key && e.key.toLowerCase()==="m")) { toggleMute(); }
    if (e.key && e.key.toLowerCase()==="b") { cycleBuildType(); e.preventDefault(); }
    if (e.key && e.key.toLowerCase()==="n") { toggleMusic(); }
    // E — войти/выйти из машины. Срабатывает один раз на нажатие.
    if (k === "e" && !e.repeat) {
      if (isMultiplayer && ws && ws.readyState===1) ws.send(JSON.stringify({ t:"use" }));
      else if (solo && solo.player && solo.player.alive) soloToggleVehicle();
    }
    if (e.key === "F1") { setBuildType("wall"); e.preventDefault(); }
    if (e.key === "F2") { setBuildType("floor"); e.preventDefault(); }
    if (e.key === "F3") { setBuildType("ramp"); e.preventDefault(); }
  }
});
window.addEventListener("keyup",   e => {
  const k = KEY_MAP[e.code];
  if (k) keys[k] = false;
  if (e.key) keys[e.key.toLowerCase()] = false;
});
// При потере фокуса окна — отпускаем все клавиши, чтобы игрок не "застревал"
window.addEventListener("blur", () => { for (const k in keys) keys[k] = false; mouse.down = false; });
canvas.addEventListener("mousemove", e => {
  // конвертируем экранные координаты в координаты внутреннего canvas (с учётом RENDER_SCALE)
  mouse.x = e.clientX * _canvasScale;
  mouse.y = e.clientY * _canvasScale;
});
canvas.addEventListener("mousedown", e => {
  if (e.button === 0) {
    mouse.down = true;
    Sounds.init(); Sounds.resume();
    if (buildMode) {
      if (solo && solo.player.alive) tryPlaceWall();
      else if (isMultiplayer && me && me.alive) { mpTryBuild(); Sounds.build(0); }
    }
  }
  if (e.button === 2) { mouse.rdown = true; }  // ПКМ — снайперский зум/прицел
});
window.addEventListener("mouseup",   e => {
  if (e.button===0) mouse.down = false;
  if (e.button===2) mouse.rdown = false;
});
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("wheel", e => {
  if (!running || !me) return;
  const owned = WEAPON_ORDER.filter(w => me.weapons[w] && me.weapons[w].owned);
  if (owned.length<2) return;
  let idx = owned.indexOf(me.current);
  idx = (idx + (e.deltaY>0?1:-1) + owned.length) % owned.length;
  trySwitch(owned[idx]);
  e.preventDefault();
}, { passive:false });

// ---------- Engine state ----------
let running = false;
let isMultiplayer = false;
let WORLD_SIZE = 4000;
let ws = null;
let myId = null;
let me = null;                    // {hp, weapons, current, ...}
let snap = null;                  // последний snapshot от сервера (MP)
let prevSnap = null;              // предыдущий snapshot (для интерполяции)
let prevSnapTime = 0;
let currSnapTime = 0;
const INTERP_DELAY = 100;         // мс задержки рендера для плавной интерполяции

// === Client-side prediction state ===
// Мгновенно двигаем своего игрока локально на основе input, не дожидаясь ответа сервера
let predictedX = 0, predictedY = 0;
let predictedInit = false;
let timeNow = 0;
let killfeedItems = [];

// Solo state
let solo = null;

// =====================================================================
// SOLO ENGINE
// =====================================================================
function startSolo(botCount, playerName) {
  isMultiplayer = false;
  WORLD_SIZE = 4000;
  bgRendered = false;  // reset bg для новой карты
  solo = {
    name: playerName,
    player: makeSoloPlayer(playerName),
    bots: [], bullets: [], particles: [],
    obstacles: makeObstacles(),
    pickups: makePickups(),
    walls: [],
    vehicles: [],
    airdrops: [],
    nextAirdrop: 30,
    kills: 0,
    storm: {
      cx: WORLD_SIZE/2, cy: WORLD_SIZE/2,
      radius: WORLD_SIZE*0.7, targetRadius: WORLD_SIZE*0.7,
      nextShrink: 25, shrinkSpeed: 0, dmgPerSec: 6, stage: 0,
    },
    timer: 0, footTimer: 0,
    gameOver: false, gameWon: false,
  };
  for (let i=0;i<botCount;i++) solo.bots.push(makeSoloBot(i));
  // спавним 8 машин
  for (let i=0;i<8;i++) {
    solo.vehicles.push({
      id: 1000+i,
      x: rand(300, WORLD_SIZE-300), y: rand(300, WORLD_SIZE-300),
      angle: rand(0, TAU),
      hp: 200, maxHp: 200, driver: null,
    });
  }
  syncWeaponBar(solo.player);
  matsEl.textContent = solo.player.materials;
  buildMode = false;
  buildHintEl.style.display = "none";
  running = true;
  hideMenu();
  Sounds.init(); Sounds.resume();
  Sounds.startMusic();
  showMsg("DROP IN! 🪂", "Удачи!", false);
  ensureLoop();
}

function makeSoloPlayer(name) {
  return {
    x: WORLD_SIZE/2, y: WORLD_SIZE/2, r:14, angle:0,
    name, color:"#3aa3ff",
    hp:100, maxHp:100, speed:220, alive:true, isPlayer:true,
    armor: 0, maxArmor: 100,
    weapons: { pistol: { ammo: WEAPONS.pistol.mag, owned:true } },
    current: "pistol", reloading:false, reloadEnd:0, fireCD:0,
    materials: 100,
  };
}

function makeSoloBot(i) {
  let x,y,t=0;
  do { x=rand(200,WORLD_SIZE-200); y=rand(200,WORLD_SIZE-200); t++; }
  while (t<20 && (x-WORLD_SIZE/2)**2+(y-WORLD_SIZE/2)**2 < 500*500);
  // случайное оружие для разнообразия
  const choices = ["pistol","pistol","ar","shotgun","sniper"];
  const w = choices[Math.floor(Math.random()*choices.length)];
  return {
    x, y, r:14, angle:rand(0,TAU),
    name:"Bot"+(i+1), color:`hsl(${(i*53)%360},70%,55%)`,
    hp:100, maxHp:100, speed:rand(120,180), alive:true, isPlayer:false,
    weapons: { [w]: { ammo: WEAPONS[w].mag, owned:true } },
    current: w, reloading:false, reloadEnd:0, fireCD:rand(0,1.5),
    sightRange:rand(380,560), accuracy:rand(0.08,0.22),
    wanderTimer:0, wanderDir:rand(0,TAU), _strafe: Math.random()<0.5?1:-1,
  };
}

function makeObstacles() {
  const arr=[];
  for (let i=0;i<220;i++) arr.push({type:"tree",x:rand(0,WORLD_SIZE),y:rand(0,WORLD_SIZE),r:22});
  for (let i=0;i<90;i++)  arr.push({type:"rock",x:rand(0,WORLD_SIZE),y:rand(0,WORLD_SIZE),r:28});
  return arr;
}
function makePickups() {
  const arr=[]; let id=1;
  for (let i=0;i<100;i++) {
    const r = Math.random();
    let t;
    if (r<0.22) t = "heal";
    else if (r<0.38) t = "ammo";
    else if (r<0.55) t = "armor";
    else if (r<0.70) t = "ar";
    else if (r<0.85) t = "shotgun";
    else t = "sniper";
    arr.push({id:id++, x:rand(100,WORLD_SIZE-100), y:rand(100,WORLD_SIZE-100), type:t, r:12});
  }
  return arr;
}

function collideObstacles(ent, obstacles, walls) {
  for (const o of obstacles) {
    const dx=ent.x-o.x, dy=ent.y-o.y, d2=dx*dx+dy*dy, rr=ent.r+o.r;
    if (d2<rr*rr && d2>0.0001) {
      const d=Math.sqrt(d2);
      ent.x += (dx/d)*(rr-d); ent.y += (dy/d)*(rr-d);
    }
  }
  // BUILDINGS (стены 4 штуки на каждое здание + дверной проём)
  const bds = worldBuildings || [];
  for (const bd of bds) {
    // дверь на нижней стороне, ширина 24px по центру
    const doorX1 = bd.x - 12, doorX2 = bd.x + 12;
    // 4 стены: top, bottom (с дырой-дверью), left, right
    const walls4 = [
      {x1: bd.x-bd.w/2, y1: bd.y-bd.h/2, x2: bd.x+bd.w/2, y2: bd.y-bd.h/2+4},  // top
      {x1: bd.x-bd.w/2, y1: bd.y-bd.h/2, x2: bd.x-bd.w/2+4, y2: bd.y+bd.h/2},  // left
      {x1: bd.x+bd.w/2-4, y1: bd.y-bd.h/2, x2: bd.x+bd.w/2, y2: bd.y+bd.h/2},  // right
      // bottom - две части: до двери и после
      {x1: bd.x-bd.w/2, y1: bd.y+bd.h/2-4, x2: doorX1, y2: bd.y+bd.h/2},
      {x1: doorX2, y1: bd.y+bd.h/2-4, x2: bd.x+bd.w/2, y2: bd.y+bd.h/2},
    ];
    for (const w of walls4) {
      // AABB collision со стеной игрока (круг)
      const cx = clamp(ent.x, w.x1, w.x2);
      const cy = clamp(ent.y, w.y1, w.y2);
      const dx = ent.x - cx, dy = ent.y - cy;
      const d2 = dx*dx + dy*dy;
      if (d2 < ent.r*ent.r && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        ent.x += (dx/d)*(ent.r - d);
        ent.y += (dy/d)*(ent.r - d);
      }
    }
  }
  // walls (квадратные AABB) — только если blocksMove
  if (walls) {
    for (const w of walls) {
      if (w.hp<=0) continue;
      const spec = STRUCTURES[w.type] || STRUCTURES.wall;
      if (!spec.blocksMove) continue;
      const half = WALL_SIZE/2;
      const cx = clamp(ent.x, w.x-half, w.x+half);
      const cy = clamp(ent.y, w.y-half, w.y+half);
      const dx = ent.x - cx, dy = ent.y - cy;
      const d2 = dx*dx + dy*dy;
      if (d2 < ent.r*ent.r && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        ent.x += (dx/d)*(ent.r - d);
        ent.y += (dy/d)*(ent.r - d);
      } else if (d2 === 0) {
        ent.x += ent.r;
      }
    }
  }
  ent.x = clamp(ent.x, ent.r, WORLD_SIZE-ent.r);
  ent.y = clamp(ent.y, ent.r, WORLD_SIZE-ent.r);
}

// Проверка попадания пули в структуру (AABB) — только если blocksBullets
function bulletHitsWall(b, walls) {
  for (const w of walls) {
    if (w.hp<=0) continue;
    const spec = STRUCTURES[w.type] || STRUCTURES.wall;
    if (!spec.blocksBullets) continue;
    const half = WALL_SIZE/2;
    if (b.x > w.x-half && b.x < w.x+half && b.y > w.y-half && b.y < w.y+half) {
      return w;
    }
  }
  return null;
}

// Найти пол под игроком (для speed boost)
function floorUnder(walls, x, y) {
  const half = WALL_SIZE/2;
  for (const w of walls) {
    if (w.hp<=0) continue;
    if ((STRUCTURES[w.type]||{}).speedMod && STRUCTURES[w.type].speedMod !== 1) {
      if (x > w.x-half && x < w.x+half && y > w.y-half && y < w.y+half) return w;
    }
  }
  return null;
}

// Попытка разместить структуру перед игроком (snap to grid)
function tryPlaceWall() {
  const s = solo; if (!s) return;
  const p = s.player;
  const spec = STRUCTURES[buildType];
  if (p.materials < spec.cost) {
    Sounds.uiClick();
    return;
  }
  const tx = p.x + Math.cos(p.angle)*WALL_PLACE_DIST;
  const ty = p.y + Math.sin(p.angle)*WALL_PLACE_DIST;
  const gx = Math.round(tx / WALL_SIZE) * WALL_SIZE;
  const gy = Math.round(ty / WALL_SIZE) * WALL_SIZE;
  // нельзя дублировать структуру того же типа на той же клетке
  for (const w of s.walls) {
    if (w.hp>0 && w.x===gx && w.y===gy && w.type===buildType) return;
  }
  const half = WALL_SIZE/2;
  // только стена блокирует постановку (полы и рампы можно ставить везде, кроме поверх стен)
  if (spec.blocksMove) {
    for (const o of s.obstacles) {
      const dx = o.x-gx, dy = o.y-gy;
      if (Math.abs(dx) < half+o.r && Math.abs(dy) < half+o.r) return;
    }
    for (const e of [...s.bots]) {
      if (!e.alive) continue;
      if (Math.abs(e.x-gx) < half+e.r && Math.abs(e.y-gy) < half+e.r) return;
    }
  }
  // нельзя ставить ничего поверх существующей стены
  for (const w of s.walls) {
    if (w.hp>0 && w.x===gx && w.y===gy && STRUCTURES[w.type].blocksMove) return;
  }
  s.walls.push({ x:gx, y:gy, hp:spec.hp, maxHp:spec.hp, owner:p, type:buildType });
  p.materials -= spec.cost;
  matsEl.textContent = p.materials;
  Sounds.build(0);
}
function lineHitsObstacle(x1,y1,x2,y2, obstacles) {
  const steps = 8;
  for (let i=1;i<=steps;i++) {
    const t=i/steps, px=x1+(x2-x1)*t, py=y1+(y2-y1)*t;
    for (const o of obstacles) {
      const dx=px-o.x, dy=py-o.y;
      if (dx*dx+dy*dy<o.r*o.r) return true;
    }
  }
  return false;
}

function panFor(shooter) {
  // pan от позиции игрока: -1..+1
  if (!solo || !solo.player) return 0;
  const dx = shooter.x - solo.player.x;
  const dy = shooter.y - solo.player.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return 0;
  return clamp(dx / 600, -1, 1);
}
function distFor(shooter) {
  if (!solo || !solo.player) return 0;
  return Math.hypot(shooter.x - solo.player.x, shooter.y - solo.player.y);
}

function soloShoot(s, shooter, angle) {
  const w = WEAPONS[shooter.current], inv = shooter.weapons[shooter.current];
  if (!w || !inv || shooter.reloading || shooter.fireCD>0 || inv.ammo<=0 || !shooter.alive) return;
  shooter.fireCD = w.cooldown;
  inv.ammo--;
  const pellets = w.pellets || 1;
  for (let i=0;i<pellets;i++) {
    const a = angle + (Math.random()-0.5)*w.spread*2;
    s.bullets.push({
      x: shooter.x + Math.cos(a)*16, y: shooter.y + Math.sin(a)*16,
      vx: Math.cos(a)*w.bulletSpeed, vy: Math.sin(a)*w.bulletSpeed,
      life: 1.0 * w.range, dmg: w.dmg, owner: shooter,
    });
  }
  for (let i=0;i<3;i++) {
    s.particles.push({
      x: shooter.x+Math.cos(angle)*16, y: shooter.y+Math.sin(angle)*16,
      vx: Math.cos(angle)*rand(50,200)+rand(-40,40),
      vy: Math.sin(angle)*rand(50,200)+rand(-40,40),
      life:0.25, color:"#ffcc33", r:3,
    });
  }
  Sounds.shoot(shooter.current, panFor(shooter), distFor(shooter));
}

function soloReload(shooter) {
  const w=WEAPONS[shooter.current], inv=shooter.weapons[shooter.current];
  if (!w||!inv||shooter.reloading||inv.ammo>=w.mag) return;
  shooter.reloading = true;
  shooter.reloadEnd = solo.timer + w.reload;
  if (shooter.isPlayer) Sounds.reload();
}

function soloBotTick(s, b, dt) {
  if (!b.alive) return;
  // ближайшая цель: игрок ИЛИ другие боты
  let nearest=null, nd2 = b.sightRange*b.sightRange;
  if (s.player.alive) {
    const d2 = dist2(b, s.player);
    if (d2<nd2) { nearest=s.player; nd2=d2; }
  }
  // боты теперь видят друг друга
  for (const o of s.bots) {
    if (o === b || !o.alive) continue;
    const d2 = dist2(b, o);
    if (d2 < nd2) { nearest = o; nd2 = d2; }
  }
  if (nearest) {
    const dx=nearest.x-b.x, dy=nearest.y-b.y;
    const ang = Math.atan2(dy,dx);
    b.angle = ang;
    const d = Math.sqrt(dx*dx+dy*dy);
    let moveAng = ang;
    const optimal = b.current==="shotgun" ? 140 : b.current==="sniper" ? 500 : 260;
    if (d < optimal*0.7) moveAng = ang + Math.PI;
    else if (d > optimal*1.3) moveAng = ang;
    else moveAng = ang + Math.PI/2 * b._strafe;
    if (Math.random()<0.01) b._strafe = Math.random()<0.5?1:-1;
    b.x += Math.cos(moveAng)*b.speed*dt;
    b.y += Math.sin(moveAng)*b.speed*dt;
    if (!lineHitsObstacle(b.x,b.y,nearest.x,nearest.y,s.obstacles) && d<b.sightRange) {
      const jitter = (Math.random()-0.5)*b.accuracy*2;
      soloShoot(s, b, ang+jitter);
    }
  } else {
    // ИИ: если бот вне зоны — бежать в центр
    const sdx = b.x - s.storm.cx, sdy = b.y - s.storm.cy;
    const sd2 = sdx*sdx + sdy*sdy;
    const safeR = s.storm.radius * 0.85;
    if (sd2 > safeR*safeR) {
      // бежать к центру зоны
      const a = Math.atan2(s.storm.cy - b.y, s.storm.cx - b.x);
      b.angle = a;
      b.x += Math.cos(a)*b.speed*dt;
      b.y += Math.sin(a)*b.speed*dt;
    } else {
      // блуждать в зоне
      b.wanderTimer -= dt;
      if (b.wanderTimer<=0) { b.wanderTimer = rand(1,3); b.wanderDir = rand(0,TAU); }
      const nx = b.x + Math.cos(b.wanderDir)*b.speed*0.4*dt;
      const ny = b.y + Math.sin(b.wanderDir)*b.speed*0.4*dt;
      // если выйдут из зоны — развернуть
      const dxn = nx - s.storm.cx, dyn = ny - s.storm.cy;
      if (dxn*dxn + dyn*dyn < safeR*safeR) {
        b.x = nx; b.y = ny;
      } else {
        b.wanderDir = Math.atan2(s.storm.cy - b.y, s.storm.cx - b.x);
      }
      b.angle = b.wanderDir;
    }
  }
  // pickups
  for (let i=s.pickups.length-1;i>=0;i--) {
    const p = s.pickups[i];
    if (dist2(b,p) < (b.r+p.r)**2) {
      if (p.type==="heal") b.hp = Math.min(b.maxHp, b.hp+35);
      else if (p.type==="ammo") {
        const w=WEAPONS[b.current], inv=b.weapons[b.current];
        if (inv) inv.ammo = Math.min(w.mag, inv.ammo+Math.ceil(w.mag*0.6));
      } else if (WEAPONS[p.type]) {
        if (!b.weapons[p.type]) b.weapons[p.type] = { ammo:WEAPONS[p.type].mag, owned:true };
        b.current = p.type;
      }
      s.pickups.splice(i,1);
    }
  }
  collideObstacles(b, s.obstacles, s.walls);
  // auto-reload
  if (!b.reloading) {
    const inv = b.weapons[b.current];
    if (inv && inv.ammo===0) soloReload(b);
  }
  if (b.reloading && s.timer >= b.reloadEnd) {
    b.reloading = false;
    b.weapons[b.current].ammo = WEAPONS[b.current].mag;
  }
  if (b.fireCD>0) b.fireCD -= dt;
  // storm
  const sdx=b.x-s.storm.cx, sdy=b.y-s.storm.cy;
  if (sdx*sdx+sdy*sdy > s.storm.radius*s.storm.radius) b.hp -= s.storm.dmgPerSec*dt;
  if (b.hp<=0) { b.alive=false; spawnBlood(s, b.x,b.y); }
}

function soloToggleVehicle() {
  const s = solo; if (!s) return;
  const p = s.player;
  if (p.vehicleId) {
    const v = s.vehicles.find(x => x.id === p.vehicleId);
    if (v) v.driver = null;
    p.vehicleId = null;
    showMsg("Exited vehicle", "", false);
    return;
  }
  let nearest=null, nd2=120*120;  // 120 px радиус (был 70) — легче сесть
  for (const v of s.vehicles) {
    if (v.hp<=0 || v.driver) continue;
    const dx=v.x-p.x, dy=v.y-p.y, d2=dx*dx+dy*dy;
    if (d2<nd2) { nearest=v; nd2=d2; }
  }
  if (nearest) {
    nearest.driver = p;
    p.vehicleId = nearest.id;
    Sounds.uiClick();
    showMsg("🚗 Driving!", "WASD двигает • E чтобы выйти", false);
  } else {
    // показать дистанцию до ближайшей машины
    let closest=Infinity;
    for (const v of s.vehicles) {
      if (v.hp<=0) continue;
      const d = Math.hypot(v.x-p.x, v.y-p.y);
      if (d < closest) closest = d;
    }
    if (isFinite(closest)) {
      showMsg("No vehicle near", `Closest: ${Math.round(closest)}px (need <120)`, false);
    } else {
      showMsg("No vehicles available", "", false);
    }
  }
}

function spawnBlood(s, x,y) {
  for (let i=0;i<8;i++) s.particles.push({x,y,vx:rand(-150,150),vy:rand(-150,150),life:0.5,color:"#c0392b",r:3});
}

function soloUpdate(dt) {
  const s = solo;
  s.timer += dt;
  const p = s.player;
  if (p.alive) {
    let dx=0,dy=0;
    if (keys["w"]) dy--; if (keys["s"]) dy++;
    if (keys["a"]) dx--; if (keys["d"]) dx++;
    const ln=Math.hypot(dx,dy); if (ln>0){dx/=ln;dy/=ln;}
    // aim в мировых координатах
    const aimWX = mouse.x + (p.x - canvas.width/2);
    const aimWY = mouse.y + (p.y - canvas.height/2);
    p.angle = Math.atan2(aimWY-p.y, aimWX-p.x);
    // === Вождение машины (Solo) ===
    // WASD — это направление движения (как top-down arcade).
    // Машина сама поворачивает в сторону куда едет, плавно (lerp).
    let inVehicle = false;
    if (p.vehicleId) {
      const v = s.vehicles.find(x => x.id === p.vehicleId);
      if (v && v.hp > 0) {
        inVehicle = true;
        let mvx = 0, mvy = 0;
        if (keys["w"]) mvy--;
        if (keys["s"]) mvy++;
        if (keys["a"]) mvx--;
        if (keys["d"]) mvx++;
        const mlen = Math.hypot(mvx, mvy);
        const VS = 280;
        if (mlen > 0) {
          mvx /= mlen; mvy /= mlen;
          v.x += mvx * VS * dt;
          v.y += mvy * VS * dt;
          // целевой угол = направление движения
          const targetAng = Math.atan2(mvy, mvx);
          // плавный поворот к цели (lerp по самому короткому пути)
          let diff = targetAng - v.angle;
          while (diff > Math.PI) diff -= 2*Math.PI;
          while (diff < -Math.PI) diff += 2*Math.PI;
          v.angle += diff * Math.min(1, dt * 8);  // быстрый поворот
        }
        v.x = clamp(v.x, 30, WORLD_SIZE-30);
        v.y = clamp(v.y, 30, WORLD_SIZE-30);
        // таран ботов (только при движении)
        if (mlen > 0) {
          for (const o of s.bots) {
            if (!o.alive) continue;
            const ddx=o.x-v.x, ddy=o.y-v.y;
            if (ddx*ddx+ddy*ddy < 35*35) {
              o.hp -= 25;
              if (o.hp<=0) {
                o.alive=false; spawnBlood(s, o.x, o.y);
                s.kills++; killsEl.textContent = s.kills;
                addKillfeed(`💥 Rammed ${o.name}!`);
                p.materials = Math.min(500, p.materials + 25);
                matsEl.textContent = p.materials;
              }
            }
          }
        }
        p.x = v.x; p.y = v.y;
        p.angle = v.angle;
      } else { p.vehicleId = null; }
    }
    let speedMul = (keys["shift"]?1.5:1);
    const floor = floorUnder(s.walls, p.x, p.y);
    if (floor) speedMul *= STRUCTURES[floor.type].speedMod;
    const sp = speedMul * p.speed;
    if (!inVehicle) { p.x += dx*sp*dt; p.y += dy*sp*dt; }
    // в build-режиме ЛКМ ставит стену, а не стреляет
    // в машине вообще нельзя стрелять
    if (mouse.down && !buildMode && !inVehicle) soloShoot(s, p, p.angle);
    if (p.fireCD>0) p.fireCD -= dt;
    if (p.reloading && s.timer>=p.reloadEnd) {
      p.reloading = false;
      p.weapons[p.current].ammo = WEAPONS[p.current].mag;
      Sounds.reloadDone();
    }
    collideObstacles(p, s.obstacles, s.walls);
    // footsteps
    const moving = (dx!==0 || dy!==0);
    if (moving && p.alive) {
      s.footTimer -= dt;
      if (s.footTimer <= 0) {
        s.footTimer = keys["shift"] ? 0.22 : 0.32;
        Sounds.step(0);
      }
    } else {
      s.footTimer = 0;
    }
    // pickups
    for (let i=s.pickups.length-1;i>=0;i--) {
      const pk = s.pickups[i];
      if (dist2(p, pk) < (p.r+pk.r)**2) {
        if (pk.type==="heal") p.hp = Math.min(p.maxHp, p.hp+35);
        else if (pk.type==="armor") p.armor = Math.min(p.maxArmor, p.armor + 50);
        else if (pk.type==="ammo") {
          const w=WEAPONS[p.current], inv=p.weapons[p.current];
          if (inv) inv.ammo = Math.min(w.mag, inv.ammo+Math.ceil(w.mag*0.6));
        } else if (pk.type === "material") {
          p.materials = Math.min(500, p.materials + 20);
          matsEl.textContent = p.materials;
        } else if (WEAPONS[pk.type]) {
          if (!p.weapons[pk.type]) p.weapons[pk.type] = { ammo:WEAPONS[pk.type].mag, owned:true };
          else p.weapons[pk.type].ammo = WEAPONS[pk.type].mag;
          p.current = pk.type; p.reloading = false;
          addKillfeed(`Picked up ${WEAPONS[pk.type].name}`);
        }
        Sounds.pickup(pk.type);
        s.pickups.splice(i,1);
        syncWeaponBar(p);
      }
    }
    // storm
    const sdx=p.x-s.storm.cx, sdy=p.y-s.storm.cy;
    if (sdx*sdx+sdy*sdy > s.storm.radius*s.storm.radius) p.hp -= s.storm.dmgPerSec*dt;
    if (p.hp<=0) {
      p.alive=false; spawnBlood(s, p.x,p.y);
      s.gameOver = true;
      Sounds.death();
      const place = 1 + s.bots.filter(b=>b.alive).length;
      showMsg("YOU DIED 💀", `Место: #${place}. Kills: ${s.kills}. Нажми F5 для рестарта.`, true);
    }
  }
  // bots
  for (const b of s.bots) soloBotTick(s, b, dt);
  // bullets
  for (let i=s.bullets.length-1;i>=0;i--) {
    const b = s.bullets[i];
    b.x += b.vx*dt; b.y += b.vy*dt; b.life -= dt;
    let dead = b.life<=0 || b.x<0||b.y<0||b.x>WORLD_SIZE||b.y>WORLD_SIZE;
    if (!dead) {
      for (const o of s.obstacles) {
        const dx=b.x-o.x, dy=b.y-o.y;
        if (dx*dx+dy*dy < o.r*o.r) { dead=true; break; }
      }
    }
    // здания (стены блокируют пули, окна — нет)
    if (!dead && worldBuildings) {
      for (const bd of worldBuildings) {
        const halfW = bd.w/2, halfH = bd.h/2;
        // быстрая проверка bbox
        if (Math.abs(b.x - bd.x) > halfW || Math.abs(b.y - bd.y) > halfH) continue;
        // внутри прямоугольника здания — проверяем близость к стене (4px)
        const distToLeft = b.x - (bd.x - halfW);
        const distToRight = (bd.x + halfW) - b.x;
        const distToTop = b.y - (bd.y - halfH);
        const distToBottom = (bd.y + halfH) - b.y;
        const minDist = Math.min(distToLeft, distToRight, distToTop, distToBottom);
        if (minDist < 5) {
          // в зоне стены — проверяем не в окне ли (окна по 14px каждые ~50px на верх/низ)
          const inDoor = (b.y > bd.y + halfH - 22 && b.x > bd.x - 12 && b.x < bd.x + 12);
          if (!inDoor) { dead = true; break; }
        }
      }
    }
    // walls (built)
    if (!dead) {
      const wall = bulletHitsWall(b, s.walls);
      if (wall) {
        wall.hp -= b.dmg;
        Sounds.buildHit(panFor({x:b.x,y:b.y}));
        if (wall.hp <= 0) {
          Sounds.buildBreak(panFor({x:b.x,y:b.y}));
          // spawn material drop
          s.pickups.push({ id:Date.now()+Math.random(), x:wall.x, y:wall.y, type:"material", r:10 });
        }
        for (let k=0;k<4;k++) {
          s.particles.push({ x:b.x, y:b.y, vx:rand(-100,100), vy:rand(-100,100), life:0.3, color:"#cccccc", r:2 });
        }
        dead = true;
      }
    }
    if (!dead) {
      const all = [p, ...s.bots];
      for (const t of all) {
        if (!t.alive || t===b.owner) continue;
        const dx=b.x-t.x, dy=b.y-t.y;
        if (dx*dx+dy*dy < t.r*t.r) {
          let dmg = b.dmg;
          if (t.armor && t.armor > 0) {
            const absorbed = Math.min(t.armor, dmg * 0.5);
            t.armor -= absorbed; dmg -= absorbed;
          }
          t.hp -= dmg; spawnBlood(s, b.x, b.y); dead=true;
          Sounds.hit(panFor(t), distFor(t));
          if (t.hp<=0) {
            t.alive=false;
            if (t === p) {
              // игрок убит — обработка в основном цикле
            } else if (b.owner===p) {
              s.kills++; killsEl.textContent = s.kills;
              addKillfeed(`You killed ${t.name} (${WEAPONS[p.current].name})`);
              p.materials = Math.min(500, p.materials + 25);
              matsEl.textContent = p.materials;
            } else if (b.owner === t) {
              // self-damage (не должно случиться)
            } else {
              // бот убил бота или игрока
              addKillfeed(`${b.owner.name} killed ${t.name}`);
            }
          }
          break;
        }
      }
    }
    if (dead) s.bullets.splice(i,1);
  }
  // удаляем разрушенные стены
  s.walls = s.walls.filter(w => w.hp > 0);
  // particles
  for (let i=s.particles.length-1;i>=0;i--) {
    const p2 = s.particles[i];
    p2.x += p2.vx*dt; p2.y += p2.vy*dt; p2.vx*=0.9; p2.vy*=0.9; p2.life-=dt;
    if (p2.life<=0) s.particles.splice(i,1);
  }
  // airdrops (Solo)
  if (s.timer >= s.nextAirdrop) {
    const r = s.storm.radius * 0.7;
    const ang = Math.random()*TAU;
    const d = Math.random() * r;
    const x = clamp(s.storm.cx + Math.cos(ang)*d, 100, WORLD_SIZE-100);
    const y = clamp(s.storm.cy + Math.sin(ang)*d, 100, WORLD_SIZE-100);
    s.airdrops.push({ id:Date.now(), x, y, state:"falling", altitude:1.0 });
    s.nextAirdrop = s.timer + 45;
    addKillfeed("🪂 Airdrop incoming!");
  }
  for (let i=s.airdrops.length-1;i>=0;i--) {
    const a = s.airdrops[i];
    if (a.state === "falling") {
      a.altitude -= dt / 5;
      if (a.altitude <= 0) { a.altitude = 0; a.state = "landed"; }
    } else if (a.state === "landed" && p.alive) {
      const dx = p.x-a.x, dy = p.y-a.y;
      if (dx*dx+dy*dy < (14+20)*(14+20)) {
        const legendaries = ["minigun","rocket"];
        const w = legendaries[Math.floor(Math.random()*legendaries.length)];
        if (!p.weapons[w]) p.weapons[w] = { ammo:WEAPONS[w].mag, owned:true };
        else p.weapons[w].ammo = WEAPONS[w].mag;
        p.current = w; p.reloading = false; p.armor = p.maxArmor;
        addKillfeed(`🎁 Picked up ${WEAPONS[w].name}!`);
        s.airdrops.splice(i,1);
        syncWeaponBar(p);
      }
    }
  }
  // storm
  if (s.timer >= s.storm.nextShrink && s.storm.targetRadius > 80) {
    s.storm.stage++;
    s.storm.targetRadius = Math.max(80, s.storm.radius*0.55);
    s.storm.shrinkSpeed = (s.storm.radius - s.storm.targetRadius)/30;
    s.storm.nextShrink = s.timer + 60;
    s.storm.dmgPerSec += 3;
    const ang = rand(0,TAU);
    const off = rand(0, s.storm.radius - s.storm.targetRadius);
    s.storm.cx = clamp(s.storm.cx+Math.cos(ang)*off, s.storm.targetRadius, WORLD_SIZE-s.storm.targetRadius);
    s.storm.cy = clamp(s.storm.cy+Math.sin(ang)*off, s.storm.targetRadius, WORLD_SIZE-s.storm.targetRadius);
  }
  if (s.storm.radius > s.storm.targetRadius) {
    s.storm.radius = Math.max(s.storm.targetRadius, s.storm.radius - s.storm.shrinkSpeed*dt);
  }
  stormEl.textContent = Math.max(0, Math.ceil(s.storm.nextShrink - s.timer));
  const aliveN = (p.alive?1:0) + s.bots.filter(b=>b.alive).length;
  aliveEl.textContent = aliveN;
  setHpBar(p.hp, p.maxHp, p.armor || 0, p.maxArmor || 100);
  if (hpEl) hpEl.textContent = Math.max(0, Math.floor(p.hp));
  reloadEl.style.display = p.reloading ? "block" : "none";
  if (p.alive && s.bots.every(b=>!b.alive) && !s.gameWon) {
    s.gameWon = true;
    Sounds.victory();
    showMsg("🏆 VICTORY ROYALE!", `Kills: ${s.kills}. F5 для рестарта.`, true);
  }
}

// =====================================================================
// MULTIPLAYER
// =====================================================================
function startMP(url, name) {
  isMultiplayer = true;
  bgRendered = false;
  lastObstacles = null;
  predictedInit = false;
  statusEl.textContent = "Connecting...";
  try { ws = new WebSocket(url); }
  catch(e) { statusEl.textContent = "❌ Bad URL"; statusEl.classList.add("err"); return; }
  ws.onopen = () => {
    statusEl.textContent = "✅ Connected. Waiting for players...";
    ws.send(JSON.stringify({ t:"name", name }));
    hideMenu(); running = true;
    buildMode = false; buildHintEl.style.display = "none";
    Sounds.init(); Sounds.resume(); Sounds.startMusic();
    startNetLoop();
    ensureLoop();
  };
  ws.onerror = () => { statusEl.textContent = "❌ Connection error"; statusEl.classList.add("err"); };
  ws.onclose = () => {
    if (running) showMsg("Disconnected", "Сервер закрыл соединение. F5 для возврата.", true);
    running = false;
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t==="welcome") {
      myId = m.id; WORLD_SIZE = m.world;
      if (m.obstacles) lastObstacles = m.obstacles;
    }
    else if (m.t==="s" || m.t==="state") {
      // Нормализуем компактный формат в старый, чтобы остальной код не менять
      const norm = {
        phase: m.ph || m.phase,
        countdown: m.cd != null ? m.cd : m.countdown,
        vehicles: m.vs || [],
        airdrops: m.ads || [],
        players: (m.ps || m.players || []).map(p => ({
          id: p.id, n: p.n, x: p.x, y: p.y, a: p.a, hp: p.hp,
          al: p.al, k: p.k || 0, c: p.c, w: p.w, rl: p.rl,
        })),
        bullets: (() => {
          if (!m.bs && !m.bullets) return [];
          if (Array.isArray(m.bs) && (m.bs.length === 0 || typeof m.bs[0] === "number")) {
            // плоский массив [x,y,x,y,...]
            const out = [];
            for (let i=0;i<m.bs.length;i+=2) out.push({ x:m.bs[i], y:m.bs[i+1] });
            return out;
          }
          return m.bs || m.bullets;
        })(),
        pickups: (m.pks || m.pickups || []).map(p => ({
          id: p.id || (p.x*10000+p.y), x:p.x, y:p.y, type: p.t || p.type
        })),
        walls: (m.ws || m.walls || []).map(w => ({
          x:w.x, y:w.y, hp:w.hp, maxHp:w.mh || w.maxHp, type:w.ty || w.type
        })),
        storm: m.st || m.storm,
        killfeed: m.kf || m.killfeed || [],
      };
      const meRaw = m.me || {};
      const meNorm = {
        hp: meRaw.hp,
        armor: meRaw.ar || 0,
        maxArmor: meRaw.mar || 100,
        weapons: meRaw.we || meRaw.weapons,
        current: meRaw.c || meRaw.current,
        reloading: meRaw.rl != null ? meRaw.rl : meRaw.reloading,
        kills: meRaw.k != null ? meRaw.k : meRaw.kills,
        alive: meRaw.al != null ? meRaw.al : meRaw.alive,
        materials: meRaw.ma != null ? meRaw.ma : meRaw.materials,
        vehicleId: meRaw.vi || null,
      };
      prevSnap = snap;
      prevSnapTime = currSnapTime || performance.now();
      snap = norm;
      currSnapTime = performance.now();
      me = meNorm;
      updateMPHud();
    }
    else if (m.t==="event") { showMsg(m.msg, "", false); }
  };
}

let netInputTimer = 0;
function startNetLoop() {
  netInputTimer = 0;
}
function sendInput() {
  if (!ws || ws.readyState!==1 || !snap) return;
  const meEnt = snap.players.find(p => p.id===myId);
  if (!meEnt) return;
  const wx = mouse.x + (meEnt.x - canvas.width/2);
  const wy = mouse.y + (meEnt.y - canvas.height/2);
  const angle = Math.atan2(wy-meEnt.y, wx-meEnt.x);
  // В build-режиме НЕ стреляем — ЛКМ только ставит стену
  const shouldShoot = mouse.down && !buildMode;
  ws.send(JSON.stringify({
    t:"input",
    input: {
      up: !!keys["w"], down: !!keys["s"], left: !!keys["a"], right: !!keys["d"],
      sprint: !!keys["shift"], shoot: shouldShoot, reload:false,
      angle,
    }
  }));
}
function trySwitch(w) {
  // нельзя менять оружие в машине
  if (solo && solo.player && solo.player.vehicleId) return;
  if (me && me.vehicleId) return;
  if (isMultiplayer) {
    if (ws && ws.readyState===1) ws.send(JSON.stringify({ t:"switch", w }));
  } else if (solo && solo.player.alive) {
    const inv = solo.player.weapons[w];
    if (inv && inv.owned) { solo.player.current = w; solo.player.reloading = false; syncWeaponBar(solo.player); }
  }
}
function tryReload() {
  if (isMultiplayer) {
    if (ws && ws.readyState===1) ws.send(JSON.stringify({ t:"reload" }));
  } else if (solo) soloReload(solo.player);
}

// для мультиплеера: при клике мыши в build-режиме шлём команду серверу
function mpTryBuild() {
  if (!isMultiplayer || !ws || ws.readyState!==1) return;
  ws.send(JSON.stringify({ t:"build", btype: buildType }));
}

// HUD update — троттлим до 5 раз/сек, не 30
let lastHudUpdate = 0;
let lastKillfeedJson = "";
let lastWeaponBarJson = "";
function updateMPHud() {
  if (!me) return;
  const now = performance.now();
  if (now - lastHudUpdate < 200) return;
  lastHudUpdate = now;
  setHpBar(me.hp || 0, 100, me.armor || 0, me.maxArmor || 100);
  if (hpEl) hpEl.textContent = me.hp;
  killsEl.textContent = me.kills;
  let aliveN = 0;
  for (const p of snap.players) if (p.al) aliveN++;
  aliveEl.textContent = aliveN;
  stormEl.textContent = snap.storm.next;
  matsEl.textContent = me.materials||0;
  reloadEl.style.display = me.reloading ? "block" : "none";
  // killfeed — обновляем только если изменился (избегаем reflow)
  const kfStr = JSON.stringify(snap.killfeed || []);
  if (kfStr !== lastKillfeedJson) {
    lastKillfeedJson = kfStr;
    kfEl.innerHTML = (snap.killfeed||[]).slice(0,5).map(k =>
      `<div>${k.killer ? `<b>${escapeHtml(k.killer)}</b> 🔫 ` : "⛈️ "}${escapeHtml(k.victim)}</div>`
    ).join("");
  }
  // weapon bar — кэшируем
  const wbStr = me.current + "_" + JSON.stringify(me.weapons);
  if (wbStr !== lastWeaponBarJson) {
    lastWeaponBarJson = wbStr;
    syncWeaponBarMP();
  }
  if (snap.phase==="countdown") {
    showMsg(`STARTING IN ${snap.countdown}`, "Подключите больше игроков и приготовьтесь!", true);
  } else if (snap.phase==="playing" && msgEl.dataset.lock !== "1") {
    msgEl.style.display = "none";
  }
}
function escapeHtml(s){return String(s).replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;" }[c]));}

// =====================================================================
// UI: weapon bar, killfeed, message
// =====================================================================
function syncWeaponBar(p) {
  // Solo
  wbarEl.innerHTML = WEAPON_ORDER.map(w => {
    const inv = p.weapons[w]; const W = WEAPONS[w];
    const owned = inv && inv.owned;
    const active = p.current === w;
    return `<div class="wslot ${active?"active":""}" style="${owned?"":"opacity:0.35;"}">
      <div><span class="num">${W.key}</span> ${W.emoji} <span class="name">${W.name}</span></div>
      <div class="ammo">${owned ? inv.ammo+"/"+W.mag : "—"}</div>
    </div>`;
  }).join("");
}
function syncWeaponBarMP() {
  if (!me) return;
  wbarEl.innerHTML = WEAPON_ORDER.map(w => {
    const inv = me.weapons[w]; const W = WEAPONS[w];
    const owned = inv && inv.owned;
    const active = me.current === w;
    return `<div class="wslot ${active?"active":""}" style="${owned?"":"opacity:0.35;"}">
      <div><span class="num">${W.key}</span> ${W.emoji} <span class="name">${W.name}</span></div>
      <div class="ammo">${owned ? inv.ammo+"/"+W.mag : "—"}</div>
    </div>`;
  }).join("");
}
function addKillfeed(text) {
  killfeedItems.unshift({ text, t: Date.now() });
  killfeedItems = killfeedItems.slice(0,5);
  kfEl.innerHTML = killfeedItems.map(k => `<div>${escapeHtml(k.text)}</div>`).join("");
}
function showMsg(title, sub, persistent) {
  msgEl.innerHTML = title + (sub ? `<small>${sub}</small>` : "");
  msgEl.style.display = "block";
  msgEl.dataset.lock = persistent ? "1" : "0";
  if (!persistent) setTimeout(()=>{ if(msgEl.dataset.lock!=="1") msgEl.style.display="none"; }, 2200);
}
function hideMenu() {
  menuEl.style.display = "none";
  canvas.focus();
}

// =====================================================================
// RENDER (общий для solo и MP)
// =====================================================================
function getEntitiesForRender() {
  if (isMultiplayer) {
    if (!snap) return { ents: [], bullets: [], pickups: [], obstacles: [], storm: null, camX:0, camY:0, alive:true };
    let interpT = 1;
    if (prevSnap && currSnapTime > prevSnapTime) {
      const renderTime = performance.now() - INTERP_DELAY;
      interpT = (renderTime - prevSnapTime) / (currSnapTime - prevSnapTime);
      interpT = Math.max(0, Math.min(1, interpT));
    }
    const prevById = {};
    if (prevSnap) for (const p of prevSnap.players) prevById[p.id] = p;
    const interpPlayers = snap.players.map(p => {
      const pp = prevById[p.id];
      if (!pp) return p;
      return {
        id:p.id, n:p.n, c:p.c, hp:p.hp, al:p.al, k:p.k, w:p.w, rl:p.rl,
        x: pp.x + (p.x - pp.x) * interpT,
        y: pp.y + (p.y - pp.y) * interpT,
        a: pp.a + ((p.a - pp.a + Math.PI*3) % (Math.PI*2) - Math.PI) * interpT,
      };
    });
    // === Client-side prediction для своего игрока ===
    // Заменяем серверную позицию на локально предсказанную (для мгновенного отклика)
    const meEntServer = interpPlayers.find(p => p.id === myId);
    if (meEntServer && me && me.alive) {
      // инициализация позиции при первом получении себя
      if (!predictedInit) {
        predictedX = meEntServer.x;
        predictedY = meEntServer.y;
        predictedInit = true;
      }
      // плавная коррекция к серверной позиции (если расхождение большое — резко)
      const dx = meEntServer.x - predictedX;
      const dy = meEntServer.y - predictedY;
      const dist = Math.hypot(dx, dy);
      if (dist > 80) {
        // teleport (телепорт или серьёзная рассинхронизация)
        predictedX = meEntServer.x;
        predictedY = meEntServer.y;
      } else if (dist > 1) {
        // плавно подтягиваемся (20% за кадр)
        predictedX += dx * 0.2;
        predictedY += dy * 0.2;
      }
      meEntServer.x = predictedX;
      meEntServer.y = predictedY;
      // целимся в направлении мыши (всегда мгновенно — без серверной задержки)
      const aimWX = mouse.x + (predictedX - canvas.width/2);
      const aimWY = mouse.y + (predictedY - canvas.height/2);
      meEntServer.a = Math.atan2(aimWY - predictedY, aimWX - predictedX);
    }
    const meEnt = meEntServer;
    const camTarget = meEnt || { x: WORLD_SIZE/2, y: WORLD_SIZE/2 };
    // строим объект игрока для зум-проверки / превью стройки
    let myPlayer = null;
    if (meEnt) {
      myPlayer = {
        x: meEnt.x, y: meEnt.y, angle: meEnt.a, alive: !!meEnt.al,
        current: me ? me.current : meEnt.w,
        materials: me ? (me.materials||0) : 0,
        isPlayer: true,
      };
    }
    return {
      ents: interpPlayers.map(p => ({
        x:p.x, y:p.y, r:14, angle:p.a, color:p.c, hp:p.hp, maxHp:100,
        alive: !!p.al, name:p.n, current:p.w, reloading:!!p.rl,
        isPlayer: p.id === myId,
      })),
      bullets: snap.bullets,
      pickups: snap.pickups,
      vehicles: snap.vehicles || [],
      airdrops: snap.airdrops || [],
      walls: snap.walls || [],
      obstacles: snap.obstacles,
      storm: snap.storm ? { cx:snap.storm.cx, cy:snap.storm.cy, radius:snap.storm.r, targetRadius:snap.storm.tr } : null,
      camX: camTarget.x - canvas.width/2,
      camY: camTarget.y - canvas.height/2,
      particles: [],
      alive: meEnt ? !!meEnt.al : true,
      player: myPlayer,
    };
  } else {
    const s = solo;
    return {
      ents: [s.player, ...s.bots],
      bullets: s.bullets, pickups: s.pickups, obstacles: s.obstacles, particles: s.particles,
      walls: s.walls,
      vehicles: s.vehicles || [],
      airdrops: s.airdrops || [],
      storm: s.storm,
      camX: s.player.x - canvas.width/2,
      camY: s.player.y - canvas.height/2,
      alive: s.player.alive,
      player: s.player,
    };
  }
}

// Кэш для obstacles из MP (приходят редко, не хотим каждый кадр)
let lastObstacles = null;
// Pre-rendered background (grass + grid + obstacles) — рисуется один раз
let bgCanvas = null;
let bgRendered = false;

// BG_SCALE — фоновая текстура рисуется в меньшем разрешении и потом растягивается.
// Это снижает потребление видеопамяти в SCALE^2 раз и ускоряет drawImage на интегр. GPU.
const BG_SCALE = 0.5;  // 4000*0.5 = 2000px → ~4M пикселей вместо 16M
// === BIOMES ===
// Карта 4000×4000 разделена на 4 биома (квадранты):
//   ↖ FOREST (зелёный лес)   ↗ DESERT (песок)
//   ↙ SNOW (снег)            ↘ CITY (асфальт + здания)
function biomeAt(x, y) {
  const halfW = WORLD_SIZE / 2;
  const isLeft = x < halfW;
  const isTop = y < halfW;
  if (isLeft && isTop) return "forest";
  if (!isLeft && isTop) return "desert";
  if (isLeft && !isTop) return "snow";
  return "city";
}
const BIOME_COLORS = {
  forest: { base:[55,110,55], dark:[30,70,30], light:[100,160,80] },
  desert: { base:[200,180,110], dark:[160,140,80], light:[230,210,140] },
  snow:   { base:[220,230,240], dark:[180,200,220], light:[255,255,255] },
  city:   { base:[100,100,105], dark:[60,60,65],   light:[140,140,145] },
};

function buildBackground(obstacles) {
  if (!obstacles || obstacles.length === 0) return;
  bgCanvas = document.createElement("canvas");
  bgCanvas.width = Math.floor(WORLD_SIZE * BG_SCALE);
  bgCanvas.height = Math.floor(WORLD_SIZE * BG_SCALE);
  const bg = bgCanvas.getContext("2d", { alpha: false });
  bg.scale(BG_SCALE, BG_SCALE);

  // Псевдо-случайный хеш для детерминированного шума
  function h(x, y) {
    const v = Math.sin(x*12.9898 + y*78.233) * 43758.5453;
    return v - Math.floor(v);
  }
  const BS = 40;
  // === MINECRAFT-STYLE BLOCKS с биомами ===
  for (let y=0; y<WORLD_SIZE; y+=BS) {
    for (let x=0; x<WORLD_SIZE; x+=BS) {
      const biome = biomeAt(x + BS/2, y + BS/2);
      const colors = BIOME_COLORS[biome];
      const n = h(x/BS, y/BS);
      const shade = Math.floor(n * 30) - 15;
      const r = Math.max(0, Math.min(255, colors.base[0] + shade));
      const g = Math.max(0, Math.min(255, colors.base[1] + shade));
      const b = Math.max(0, Math.min(255, colors.base[2] + shade));
      bg.fillStyle = `rgb(${r},${g},${b})`;
      bg.fillRect(x, y, BS, BS);
      // тёмные точки (камешки/трава/песчинки)
      const dotCount = biome === "city" ? 2 : 5;
      bg.fillStyle = `rgba(${colors.dark[0]},${colors.dark[1]},${colors.dark[2]},0.45)`;
      for (let i=0; i<dotCount; i++) {
        const dx = (h(x+i, y) * BS) | 0;
        const dy = (h(x, y+i*3) * BS) | 0;
        const sz = biome === "city" ? 4 : 2;
        bg.fillRect(x+dx, y+dy, sz, sz);
      }
      // светлые блики
      bg.fillStyle = `rgba(${colors.light[0]},${colors.light[1]},${colors.light[2]},0.25)`;
      for (let i=0; i<2; i++) {
        const dx = (h(x+i*7, y+3) * BS) | 0;
        const dy = (h(x+5, y+i*11) * BS) | 0;
        bg.fillRect(x+dx, y+dy, 2, 2);
      }
      // CITY имеет линии разметки (дороги)
      if (biome === "city") {
        // тонкие полосы как дороги (каждые 200px)
        if ((x % 200) < BS && x > 0) {
          bg.fillStyle = "rgba(255,255,180,0.4)";
          bg.fillRect(x, y+BS/2-1, BS, 2);
        }
        if ((y % 200) < BS && y > 0) {
          bg.fillStyle = "rgba(255,255,180,0.4)";
          bg.fillRect(x+BS/2-1, y, 2, BS);
        }
      }
      // тонкие границы блоков
      bg.strokeStyle = "rgba(0,0,0,0.08)"; bg.lineWidth = 1;
      bg.strokeRect(x+0.5, y+0.5, BS-1, BS-1);
    }
  }

  // === Границы биомов (тонкая линия перехода)
  bg.strokeStyle = "rgba(255,255,255,0.15)"; bg.lineWidth = 4;
  bg.beginPath();
  bg.moveTo(WORLD_SIZE/2, 0); bg.lineTo(WORLD_SIZE/2, WORLD_SIZE);
  bg.moveTo(0, WORLD_SIZE/2); bg.lineTo(WORLD_SIZE, WORLD_SIZE/2);
  bg.stroke();

  // Границы мира — каменная стена
  bg.fillStyle = "#333";
  bg.fillRect(0, 0, WORLD_SIZE, 12);
  bg.fillRect(0, WORLD_SIZE-12, WORLD_SIZE, 12);
  bg.fillRect(0, 0, 12, WORLD_SIZE);
  bg.fillRect(WORLD_SIZE-12, 0, 12, WORLD_SIZE);

  // === OBSTACLES (стилизация под биом) ===
  for (const o of obstacles) {
    const biome = biomeAt(o.x, o.y);
    if (o.type === "tree") {
      bg.fillStyle = "rgba(0,0,0,0.35)";
      bg.beginPath(); bg.arc(o.x+3, o.y+5, o.r, 0, TAU); bg.fill();
      if (biome === "desert") {
        // КАКТУС
        bg.fillStyle = "#3a7030";
        bg.fillRect(o.x-5, o.y-o.r, 10, o.r*2);
        bg.fillRect(o.x-12, o.y-5, 7, 12);  // боковая ветка
        bg.fillRect(o.x+5, o.y-10, 7, 12);
        bg.fillStyle = "#2a5020";
        bg.fillRect(o.x-3, o.y-o.r+2, 2, o.r*2-4);
      } else if (biome === "snow") {
        // ЁЛКА (треугольники)
        bg.fillStyle = "#1a3a1a";
        bg.beginPath();
        bg.moveTo(o.x, o.y - o.r);
        bg.lineTo(o.x - o.r, o.y + o.r);
        bg.lineTo(o.x + o.r, o.y + o.r);
        bg.closePath(); bg.fill();
        // снег на ёлке
        bg.fillStyle = "rgba(255,255,255,0.8)";
        bg.beginPath();
        bg.moveTo(o.x, o.y - o.r);
        bg.lineTo(o.x - o.r*0.6, o.y + o.r*0.3);
        bg.lineTo(o.x + o.r*0.6, o.y + o.r*0.3);
        bg.closePath(); bg.fill();
        bg.fillStyle = "#5a3a1a";
        bg.fillRect(o.x-2, o.y+o.r-2, 4, 6);
      } else if (biome === "city") {
        // ФОНАРНЫЙ СТОЛБ
        bg.fillStyle = "#2a2a2a";
        bg.fillRect(o.x-2, o.y-o.r, 4, o.r*2);
        bg.fillStyle = "#ffe066";
        bg.beginPath(); bg.arc(o.x, o.y-o.r, 8, 0, TAU); bg.fill();
        bg.strokeStyle = "#aa7700"; bg.lineWidth = 2; bg.stroke();
      } else {
        // ОБЫЧНОЕ ДЕРЕВО (forest)
        bg.fillStyle = "#2d5016";
        bg.beginPath(); bg.arc(o.x, o.y, o.r+2, 0, TAU); bg.fill();
        bg.fillStyle = "#3d7020";
        bg.beginPath(); bg.arc(o.x-2, o.y-2, o.r-2, 0, TAU); bg.fill();
        bg.fillStyle = "#5aa030";
        bg.beginPath(); bg.arc(o.x-4, o.y-4, o.r-8, 0, TAU); bg.fill();
        bg.fillStyle = "#5a3a1a";
        bg.fillRect(o.x-3, o.y+o.r-4, 6, 6);
      }
    } else {
      // КАМЕНЬ
      bg.fillStyle = "rgba(0,0,0,0.35)";
      bg.beginPath(); bg.arc(o.x+3, o.y+5, o.r, 0, TAU); bg.fill();
      let rockColor = "#666";
      if (biome === "desert") rockColor = "#a08060";
      else if (biome === "snow") rockColor = "#dde2e8";
      bg.fillStyle = rockColor;
      bg.beginPath(); bg.arc(o.x, o.y, o.r, 0, TAU); bg.fill();
      bg.fillStyle = "rgba(255,255,255,0.3)";
      bg.beginPath(); bg.arc(o.x-3, o.y-3, o.r*0.7, 0, TAU); bg.fill();
    }
  }

  // === BUILDINGS (только в city + по 1 в каждом другом биоме) ===
  // Генерируем здания детерминированно
  const buildings = generateBuildings();
  for (const b of buildings) {
    // тень
    bg.fillStyle = "rgba(0,0,0,0.4)";
    bg.fillRect(b.x - b.w/2 + 6, b.y - b.h/2 + 6, b.w, b.h);
    // тело здания
    bg.fillStyle = b.color;
    bg.fillRect(b.x - b.w/2, b.y - b.h/2, b.w, b.h);
    // рамка
    bg.strokeStyle = "#222"; bg.lineWidth = 3;
    bg.strokeRect(b.x - b.w/2, b.y - b.h/2, b.w, b.h);
    // окна (4 окна на каждую сторону)
    bg.fillStyle = "#88ccff";
    const winSize = 14;
    // верхняя стена окна
    for (let i=0;i<3;i++) {
      const wx = b.x - b.w/2 + 20 + i * (b.w-40)/2 - winSize/2;
      bg.fillRect(wx, b.y - b.h/2 + 10, winSize, winSize);
      bg.fillRect(wx, b.y + b.h/2 - 10 - winSize, winSize, winSize);
    }
    // дверь
    bg.fillStyle = "#553a20";
    bg.fillRect(b.x - 10, b.y + b.h/2 - 22, 20, 22);
    bg.fillStyle = "#ffcc00";
    bg.fillRect(b.x + 5, b.y + b.h/2 - 12, 3, 3);  // ручка
    // крыша
    bg.fillStyle = b.roofColor;
    bg.fillRect(b.x - b.w/2 - 4, b.y - b.h/2 - 4, b.w + 8, 8);
  }
  // сохраним для коллизий
  worldBuildings = buildings;
  bgRendered = true;
}

// Генерация зданий (используется и для рендера и для коллизий)
let worldBuildings = null;
function generateBuildings() {
  if (worldBuildings) return worldBuildings;
  const arr = [];
  // 12 зданий в city биоме (правый нижний квадрант)
  const seed = (i) => {
    const v = Math.sin(i * 9999.12) * 43758.5;
    return v - Math.floor(v);
  };
  for (let i=0; i<12; i++) {
    const r1 = seed(i*3+1);
    const r2 = seed(i*3+2);
    const w = 100 + (seed(i*3+3) * 80) | 0;
    const h = 80 + (seed(i*3+4) * 60) | 0;
    const x = WORLD_SIZE/2 + 150 + r1 * (WORLD_SIZE/2 - 300);
    const y = WORLD_SIZE/2 + 150 + r2 * (WORLD_SIZE/2 - 300);
    const color = ["#a08060","#8a8a90","#b89070","#909a80","#a0a0aa"][i % 5];
    const roofColor = ["#7a3030","#3a3a40","#5a2520","#4a4a30","#6a3030"][i % 5];
    arr.push({ x, y, w, h, color, roofColor, hp: 99999 });
  }
  // 1 здание в каждом из остальных биомов
  arr.push({ x: 800, y: 800, w:130, h:100, color:"#8b6a3a", roofColor:"#5a2520", hp:99999 });
  arr.push({ x: 3200, y: 800, w:120, h:100, color:"#c0a070", roofColor:"#7a5a30", hp:99999 });
  arr.push({ x: 800, y: 3200, w:130, h:100, color:"#aabac8", roofColor:"#5a6a80", hp:99999 });
  return arr;
}

function draw() {
  const R = getEntitiesForRender();

  if (isMultiplayer && R.obstacles && R.obstacles.length) lastObstacles = R.obstacles;
  if (isMultiplayer && (!R.obstacles || !R.obstacles.length) && lastObstacles) R.obstacles = lastObstacles;

  if (!bgRendered && R.obstacles && R.obstacles.length) buildBackground(R.obstacles);

  // === SKY / VOID за пределами карты ===
  // Заливаем весь экран небом (градиент)
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#5b8ec9");   // голубое небо вверху
  sky.addColorStop(0.5, "#9bc1e4"); // светлее в середине
  sky.addColorStop(1, "#cde2f0");   // почти белое внизу (горизонт)
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Облака — пара статичных кругов в небе
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  const cloudOffset = (timeNow * 3) % canvas.width;
  for (let i=0; i<4; i++) {
    const cx = (i*250 + cloudOffset) % (canvas.width + 200) - 100;
    const cy = 50 + (i%2)*30;
    ctx.beginPath();
    ctx.arc(cx, cy, 28, 0, TAU);
    ctx.arc(cx+22, cy, 24, 0, TAU);
    ctx.arc(cx+44, cy, 28, 0, TAU);
    ctx.fill();
  }

  // Снайперский зум: если игрок жив, в руке снайперка и удерживается ПКМ — увеличиваем мир
  let zoom = 1;
  const meEnt = R.player || (R.ents && R.ents.find(e=>e.isPlayer));
  const sniperActive = meEnt && meEnt.alive && meEnt.current === "sniper" && mouse.rdown;
  if (sniperActive) zoom = 2.0;

  ctx.save();
  if (zoom !== 1) {
    ctx.translate(canvas.width/2, canvas.height/2);
    ctx.scale(zoom, zoom);
    ctx.translate(-canvas.width/2, -canvas.height/2);
  }
  ctx.translate(-R.camX, -R.camY);

  // ===== VIEWPORT CULLING =====
  // Видимый прямоугольник в мировых координатах + буфер
  const buf = 100;
  const visW = canvas.width / zoom;
  const visH = canvas.height / zoom;
  const visCx = R.camX + canvas.width/2;
  const visCy = R.camY + canvas.height/2;
  const view = {
    x1: visCx - visW/2 - buf,
    y1: visCy - visH/2 - buf,
    x2: visCx + visW/2 + buf,
    y2: visCy + visH/2 + buf,
  };
  function inView(x, y, r=0) {
    return x+r >= view.x1 && x-r <= view.x2 && y+r >= view.y1 && y-r <= view.y2;
  }

  // Тёмная "пропасть"-обводка ВНЕ карты (создаёт эффект острова)
  // Рисуем тёмную рамку чуть за границей карты, чтобы was сверху видно небо
  ctx.fillStyle = "rgba(20, 30, 50, 0.85)";  // тёмная пропасть
  // Только за пределами мира
  if (view.x1 < 0) ctx.fillRect(view.x1, view.y1, -view.x1, view.y2-view.y1);
  if (view.x2 > WORLD_SIZE) ctx.fillRect(WORLD_SIZE, view.y1, view.x2-WORLD_SIZE, view.y2-view.y1);
  if (view.y1 < 0) ctx.fillRect(Math.max(0,view.x1), view.y1, Math.min(WORLD_SIZE,view.x2)-Math.max(0,view.x1), -view.y1);
  if (view.y2 > WORLD_SIZE) ctx.fillRect(Math.max(0,view.x1), WORLD_SIZE, Math.min(WORLD_SIZE,view.x2)-Math.max(0,view.x1), view.y2-WORLD_SIZE);

  // Pre-rendered background
  if (bgRendered) {
    const sx = Math.max(0, view.x1);
    const sy = Math.max(0, view.y1);
    const sw = Math.min(WORLD_SIZE, view.x2) - sx;
    const sh = Math.min(WORLD_SIZE, view.y2) - sy;
    if (sw > 0 && sh > 0) {
      ctx.drawImage(bgCanvas,
        sx*BG_SCALE, sy*BG_SCALE, sw*BG_SCALE, sh*BG_SCALE,
        sx, sy, sw, sh);
    }
  } else {
    // фоллбэк: тонкая сетка
    ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
    const gs = 100;
    const gx0 = Math.floor(view.x1/gs)*gs, gy0 = Math.floor(view.y1/gs)*gs;
    ctx.beginPath();
    for (let x=gx0; x<view.x2+gs; x+=gs) { ctx.moveTo(x, view.y1); ctx.lineTo(x, view.y2); }
    for (let y=gy0; y<view.y2+gs; y+=gs) { ctx.moveTo(view.x1, y); ctx.lineTo(view.x2, y); }
    ctx.stroke();
  }

  // pickups (cull)
  for (const p of R.pickups) {
    if (!inView(p.x, p.y, 15)) continue;
    if (p.type==="heal") {
      ctx.fillStyle="#2ecc71"; ctx.fillRect(p.x-8,p.y-3,16,6); ctx.fillRect(p.x-3,p.y-8,6,16);
    } else if (p.type==="ammo") {
      ctx.fillStyle="#f1c40f"; ctx.fillRect(p.x-7,p.y-7,14,14);
      ctx.fillStyle="#000"; ctx.fillRect(p.x-5,p.y-2,10,4);
    } else if (p.type==="material") {
      ctx.fillStyle="#cfa05a"; ctx.fillRect(p.x-7,p.y-7,14,14);
      ctx.strokeStyle="#7a5a30"; ctx.lineWidth=1; ctx.strokeRect(p.x-7,p.y-7,14,14);
      ctx.fillStyle="#000"; ctx.font = "bold 9px monospace"; ctx.textAlign="center";
      ctx.fillText("M", p.x, p.y+3);
    } else if (p.type==="armor") {
      // синий щит
      ctx.fillStyle = "#3498db";
      ctx.beginPath();
      ctx.moveTo(p.x, p.y-9);
      ctx.lineTo(p.x+8, p.y-5);
      ctx.lineTo(p.x+6, p.y+8);
      ctx.lineTo(p.x, p.y+10);
      ctx.lineTo(p.x-6, p.y+8);
      ctx.lineTo(p.x-8, p.y-5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
    } else {
      // weapon pickup
      const colors = { ar:"#e67e22", shotgun:"#c0392b", sniper:"#8e44ad" };
      ctx.fillStyle = colors[p.type] || "#fff";
      ctx.fillRect(p.x-10, p.y-5, 20, 10);
      ctx.fillStyle="#000"; ctx.font = "bold 10px monospace"; ctx.textAlign="center";
      ctx.fillText(p.type.toUpperCase().slice(0,3), p.x, p.y+3);
    }
  }

  // walls/floors/ramps
  if (R.walls) {
    // сначала полы (под всё остальное)
    for (const w of R.walls) {
      if (w.hp<=0 || w.type!=="floor") continue;
      if (!inView(w.x, w.y, WALL_SIZE)) continue;
      const spec = STRUCTURES[w.type];
      const half = WALL_SIZE/2;
      ctx.fillStyle = spec.color;
      ctx.fillRect(w.x-half, w.y-half, WALL_SIZE, WALL_SIZE);
      ctx.strokeStyle = spec.strokeColor; ctx.lineWidth = 1;
      // паркетные полоски
      for (let i=1;i<4;i++) {
        ctx.beginPath();
        ctx.moveTo(w.x-half, w.y-half+i*(WALL_SIZE/4));
        ctx.lineTo(w.x+half, w.y-half+i*(WALL_SIZE/4));
        ctx.stroke();
      }
      ctx.strokeRect(w.x-half, w.y-half, WALL_SIZE, WALL_SIZE);
    }
    // потом стены и рампы
    for (const w of R.walls) {
      if (w.hp<=0 || w.type==="floor") continue;
      if (!inView(w.x, w.y, WALL_SIZE)) continue;
      const spec = STRUCTURES[w.type] || STRUCTURES.wall;
      const half = WALL_SIZE/2;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(w.x-half+3, w.y-half+3, WALL_SIZE, WALL_SIZE);
      ctx.fillStyle = spec.color;
      ctx.fillRect(w.x-half, w.y-half, WALL_SIZE, WALL_SIZE);
      if (w.type === "wall") {
        ctx.fillStyle = "#7a5230";
        ctx.fillRect(w.x-half, w.y-half+WALL_SIZE/3-2, WALL_SIZE, 4);
        ctx.fillRect(w.x-half, w.y-half+2*WALL_SIZE/3-2, WALL_SIZE, 4);
      } else if (w.type === "ramp") {
        // диагональные полосы — обозначаем "пандус"
        ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 3;
        for (let i=-WALL_SIZE; i<WALL_SIZE; i+=14) {
          ctx.beginPath();
          ctx.moveTo(w.x-half+i, w.y-half);
          ctx.lineTo(w.x-half+i+WALL_SIZE, w.y+half);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = spec.strokeColor; ctx.lineWidth = 2;
      ctx.strokeRect(w.x-half, w.y-half, WALL_SIZE, WALL_SIZE);
      // hp бар
      const ratio = w.hp / w.maxHp;
      ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(w.x-half, w.y-half-8, WALL_SIZE, 5);
      ctx.fillStyle = ratio>0.5?"#2ecc71":ratio>0.25?"#f1c40f":"#e74c3c";
      ctx.fillRect(w.x-half, w.y-half-8, WALL_SIZE*ratio, 5);
    }
  }

  // build mode preview (solo & MP)
  if (buildMode && R.player && R.player.alive) {
    const p = R.player;
    const tx = p.x + Math.cos(p.angle)*WALL_PLACE_DIST;
    const ty = p.y + Math.sin(p.angle)*WALL_PLACE_DIST;
    const gx = Math.round(tx / WALL_SIZE) * WALL_SIZE;
    const gy = Math.round(ty / WALL_SIZE) * WALL_SIZE;
    const half = WALL_SIZE/2;
    const spec = STRUCTURES[buildType];
    const ok = p.materials >= spec.cost;
    ctx.fillStyle = ok ? "rgba(120,200,255,0.35)" : "rgba(255,80,80,0.35)";
    ctx.fillRect(gx-half, gy-half, WALL_SIZE, WALL_SIZE);
    ctx.strokeStyle = ok ? "#88ccff" : "#ff5555"; ctx.lineWidth = 2;
    ctx.setLineDash([6,4]);
    ctx.strokeRect(gx-half, gy-half, WALL_SIZE, WALL_SIZE);
    ctx.setLineDash([]);
    // подпись типа
    ctx.fillStyle = ok ? "#88ccff" : "#ff5555";
    ctx.font = "bold 14px Arial"; ctx.textAlign = "center";
    ctx.fillText(spec.name, gx, gy-half-12);
  }

  // obstacles уже нарисованы в pre-rendered background, пропускаем
  if (!bgRendered) {
    for (const o of R.obstacles) {
      if (!inView(o.x, o.y, o.r)) continue;
      if (o.type==="tree") {
        ctx.fillStyle="#1e3d1e"; ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,TAU); ctx.fill();
        ctx.fillStyle="#6b4423"; ctx.beginPath(); ctx.arc(o.x,o.y,6,0,TAU); ctx.fill();
      } else {
        ctx.fillStyle="#7f8c8d"; ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,TAU); ctx.fill();
        ctx.fillStyle="#95a5a6"; ctx.beginPath(); ctx.arc(o.x-6,o.y-6,o.r*0.4,0,TAU); ctx.fill();
      }
    }
  }

  // entities (cull) — спрайты-человечки top-down
  // если игрок в машине — собираем ID водителей
  const drivers = new Set();
  if (R.vehicles) for (const v of R.vehicles) {
    if (v.dr) drivers.add(v.dr);
    if (v.driver && v.driver.x !== undefined) drivers.add(v.driver);
  }
  // Для Solo: если у игрока есть vehicleId — скрыть его спрайт (он в машине)
  const myVehicleId = (me && me.vehicleId) || (solo && solo.player && solo.player.vehicleId);
  for (const e of R.ents) {
    if (!inView(e.x, e.y, 30)) continue;
    // Скрываем спрайт игрока если он в машине
    if (e.isPlayer && myVehicleId) continue;
    if (!e.alive) {
      // труп
      ctx.fillStyle="rgba(60,0,0,0.5)";
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r+2, e.r-2, e.angle||0, 0, TAU); ctx.fill();
      ctx.strokeStyle="rgba(0,0,0,0.6)"; ctx.lineWidth=1.5; ctx.stroke();
      // крестик глаз
      ctx.strokeStyle="#000"; ctx.lineWidth=2;
      ctx.beginPath();
      ctx.moveTo(e.x-4, e.y-3); ctx.lineTo(e.x+0, e.y+1);
      ctx.moveTo(e.x+4, e.y-3); ctx.lineTo(e.x+0, e.y+1);
      ctx.stroke();
      continue;
    }
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle);
    // тень
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(2, 3, e.r+1, e.r-2, 0, 0, TAU); ctx.fill();
    // НОГИ (видны снизу из-под тела)
    ctx.fillStyle = "#3a4060";
    ctx.fillRect(-8, -5, 5, 4);
    ctx.fillRect(3, -5, 5, 4);
    // ТЕЛО (овал по направлению)
    const bodyColor = e.isPlayer ? "#3aa3ff" : e.color;
    ctx.fillStyle = bodyColor;
    ctx.beginPath(); ctx.ellipse(0, 0, e.r+1, e.r-3, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5; ctx.stroke();
    // РУКИ — обе держат оружие
    ctx.fillStyle = "#f4c590"; // кожа
    ctx.beginPath(); ctx.arc(8, -7, 4, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "#f4c590";
    ctx.beginPath(); ctx.arc(8, 7, 4, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.stroke();
    // ГОЛОВА
    ctx.fillStyle = "#f4c590";
    ctx.beginPath(); ctx.arc(2, 0, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1.5; ctx.stroke();
    // волосы/шапка
    ctx.fillStyle = e.isPlayer ? "#1a4a80" : "#2a2a2a";
    ctx.beginPath(); ctx.arc(2, 0, 7, -Math.PI*0.85, -Math.PI*0.15); ctx.fill();
    // глаза (точки спереди)
    ctx.fillStyle = "#000";
    ctx.fillRect(7, -2, 1.5, 1.5);
    ctx.fillRect(7, 1, 1.5, 1.5);
    // ОРУЖИЕ в руках
    const w = e.current;
    const gunLen = w==="sniper"?32 : w==="shotgun"?22 : w==="ar"?28 : w==="minigun"?30 : w==="rocket"?30 : 18;
    const gunW = w==="shotgun"||w==="minigun"||w==="rocket" ? 6 : 4;
    ctx.fillStyle = w==="minigun" ? "#444" : w==="rocket" ? "#553a20" : "#2a2a2a";
    ctx.fillRect(8, -gunW/2, gunLen, gunW);
    // ствол (тёмнее)
    ctx.fillStyle = "#111";
    ctx.fillRect(8 + gunLen - 4, -gunW/2, 4, gunW);
    // если снайперка — оптика
    if (w === "sniper") {
      ctx.fillStyle = "#444";
      ctx.fillRect(14, -gunW/2-3, 8, 3);
    }
    ctx.restore();
    // === HP bar ===
    const w2=34, h=4;
    ctx.fillStyle="rgba(0,0,0,0.7)"; ctx.fillRect(e.x-w2/2, e.y-e.r-14, w2, h);
    ctx.fillStyle = e.hp>50?"#2ecc71":e.hp>25?"#f1c40f":"#e74c3c";
    ctx.fillRect(e.x-w2/2, e.y-e.r-14, w2*(e.hp/(e.maxHp||100)), h);
    // имя
    if (e.name) {
      ctx.fillStyle = e.isPlayer ? "#aaddff" : "#fff";
      ctx.font = "bold 11px Arial"; ctx.textAlign="center";
      ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
      ctx.strokeText(e.name, e.x, e.y-e.r-18);
      ctx.fillText(e.name, e.x, e.y-e.r-18);
    }
  }

  // vehicles
  if (R.vehicles) {
    for (const v of R.vehicles) {
      if (!inView(v.x, v.y, 35)) continue;
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(v.a);
      // тень
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(-25, -16, 50, 32);
      // тело машины
      ctx.fillStyle = "#cc3333";
      ctx.fillRect(-24, -15, 48, 30);
      // капот (передняя часть светлее)
      ctx.fillStyle = "#ee5555";
      ctx.fillRect(8, -12, 14, 24);
      // окна
      ctx.fillStyle = "#222";
      ctx.fillRect(-12, -10, 18, 20);
      // колёса
      ctx.fillStyle = "#111";
      ctx.fillRect(-20, -18, 8, 5);
      ctx.fillRect(-20, 13, 8, 5);
      ctx.fillRect(12, -18, 8, 5);
      ctx.fillRect(12, 13, 8, 5);
      ctx.restore();
      // hp бар
      const ratio = v.hp / v.mh;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(v.x-25, v.y-32, 50, 5);
      ctx.fillStyle = ratio>0.5 ? "#2ecc71" : ratio>0.25 ? "#f1c40f" : "#e74c3c";
      ctx.fillRect(v.x-25, v.y-32, 50*ratio, 5);
      // подсказка "E"
      if (!v.dr && me && me.alive && Math.hypot(R.player.x-v.x, R.player.y-v.y) < 80) {
        ctx.fillStyle = "#ffcc33";
        ctx.font = "bold 14px Arial"; ctx.textAlign = "center";
        ctx.fillText("[E] DRIVE", v.x, v.y-40);
      }
    }
  }

  // airdrops
  if (R.airdrops) {
    for (const a of R.airdrops) {
      if (!inView(a.x, a.y, 30)) continue;
      // приземлённый = сундук
      if (a.s === "landed") {
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(a.x-18, a.y-13, 36, 26);
        ctx.fillStyle = "#cc8800";
        ctx.fillRect(a.x-16, a.y-12, 32, 24);
        ctx.fillStyle = "#ffcc33";
        ctx.fillRect(a.x-16, a.y-2, 32, 4);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 10px monospace"; ctx.textAlign = "center";
        ctx.fillText("LOOT", a.x, a.y+12);
      } else {
        // падающий — рисуем парашют выше
        const yOff = -100 * a.al;
        // тень-цель на земле (мигает)
        const blink = (Math.floor(performance.now()/200) % 2) ? "rgba(255,80,80,0.5)" : "rgba(255,200,100,0.3)";
        ctx.strokeStyle = blink; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(a.x, a.y, 40, 0, TAU); ctx.stroke();
        // ящик
        ctx.fillStyle = "#cc8800";
        ctx.fillRect(a.x-12, a.y+yOff-8, 24, 16);
        // парашют
        ctx.fillStyle = "#ffcc33";
        ctx.beginPath();
        ctx.arc(a.x, a.y+yOff-14, 22, Math.PI, 0);
        ctx.fill();
        ctx.strokeStyle = "#cc8800"; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(a.x-20, a.y+yOff-12); ctx.lineTo(a.x-8, a.y+yOff-2);
        ctx.moveTo(a.x+20, a.y+yOff-12); ctx.lineTo(a.x+8, a.y+yOff-2);
        ctx.stroke();
      }
    }
  }

  // bullets (cull + batched)
  ctx.fillStyle = "#fff8a0";
  ctx.beginPath();
  for (const b of R.bullets) {
    if (!inView(b.x, b.y, 5)) continue;
    ctx.moveTo(b.x+3, b.y);
    ctx.arc(b.x, b.y, 3, 0, TAU);
  }
  ctx.fill();

  // particles (solo only) - cull
  if (R.particles) {
    for (const p of R.particles) {
      if (!inView(p.x, p.y, 5)) continue;
      ctx.globalAlpha = Math.max(0, p.life*2);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // storm
  if (R.storm) {
    ctx.save();
    ctx.fillStyle = "rgba(120,60,200,0.32)";
    ctx.beginPath();
    ctx.rect(R.camX-50, R.camY-50, canvas.width+100, canvas.height+100);
    ctx.arc(R.storm.cx, R.storm.cy, R.storm.radius, 0, TAU, true);
    ctx.fill("evenodd");
    ctx.restore();
    ctx.strokeStyle="#a060ff"; ctx.lineWidth=3;
    ctx.beginPath(); ctx.arc(R.storm.cx, R.storm.cy, R.storm.radius, 0, TAU); ctx.stroke();
    if (R.storm.targetRadius < R.storm.radius) {
      ctx.strokeStyle="rgba(255,255,255,0.6)"; ctx.setLineDash([10,8]);
      ctx.beginPath(); ctx.arc(R.storm.cx, R.storm.cy, R.storm.targetRadius, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.restore();

  // Снайперский прицел overlay
  if (sniperActive) {
    drawSniperScope();
  } else if (meEnt && meEnt.alive && meEnt.current === "sniper") {
    // мягкая подсказка
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "12px monospace"; ctx.textAlign = "center";
    ctx.fillText("🔍 hold RMB to scope", canvas.width/2, canvas.height-30);
  }
  // обычный crosshair для остального оружия
  if (meEnt && meEnt.alive && !sniperActive) {
    drawCrosshair(meEnt.current);
  }

  drawMinimap(R);
}

function drawCrosshair(weapon) {
  const x = mouse.x, y = mouse.y;
  const spread = { pistol:6, ar:10, shotgun:18, sniper:3 }[weapon] || 8;
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x-spread-6, y); ctx.lineTo(x-spread, y);
  ctx.moveTo(x+spread, y); ctx.lineTo(x+spread+6, y);
  ctx.moveTo(x, y-spread-6); ctx.lineTo(x, y-spread);
  ctx.moveTo(x, y+spread); ctx.lineTo(x, y+spread+6);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath(); ctx.arc(x, y, 1.5, 0, TAU); ctx.fill();
}

function drawSniperScope() {
  // тёмная виньетка с круглым "окуляром" по центру
  const cx = canvas.width/2, cy = canvas.height/2;
  const R = Math.min(canvas.width, canvas.height) * 0.42;
  // затемнение вне круга
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.85)";
  ctx.beginPath();
  ctx.rect(0,0,canvas.width,canvas.height);
  ctx.arc(cx, cy, R, 0, TAU, true);
  ctx.fill("evenodd");
  ctx.restore();
  // окантовка
  ctx.strokeStyle = "#000"; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
  ctx.strokeStyle = "#222"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(cx, cy, R-4, 0, TAU); ctx.stroke();
  // перекрестие
  ctx.strokeStyle = "rgba(40,255,40,0.9)"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx-R, cy); ctx.lineTo(cx-12, cy);
  ctx.moveTo(cx+12, cy); ctx.lineTo(cx+R, cy);
  ctx.moveTo(cx, cy-R); ctx.lineTo(cx, cy-12);
  ctx.moveTo(cx, cy+12); ctx.lineTo(cx, cy+R);
  ctx.stroke();
  // деления
  ctx.fillStyle = "rgba(40,255,40,0.9)";
  for (let i=1;i<=4;i++) {
    const d = (R-10) * (i/5);
    [[d,0],[-d,0],[0,d],[0,-d]].forEach(([dx,dy]) => {
      ctx.fillRect(cx+dx-1, cy+dy-1, 2, 2);
    });
  }
  // центральная точка
  ctx.fillStyle = "rgba(255,40,40,0.95)";
  ctx.beginPath(); ctx.arc(cx, cy, 2, 0, TAU); ctx.fill();
}

// Минимапка — обновляем 5 раз/сек, не каждый кадр
let lastMinimapDraw = 0;
function drawMinimap(R) {
  const now = performance.now();
  if (now - lastMinimapDraw < 200) return;
  lastMinimapDraw = now;
  const s = mini.width/WORLD_SIZE;
  // зелёный фон зоны (без clip — рисуем заливку и потом круг бури другим цветом)
  mctx.fillStyle = "#406040";
  mctx.fillRect(0,0,mini.width, mini.height);
  if (R.storm) {
    // фиолетовая зона снаружи
    mctx.fillStyle = "rgba(160,96,255,0.55)";
    mctx.beginPath();
    mctx.rect(0,0,mini.width,mini.height);
    mctx.arc(R.storm.cx*s, R.storm.cy*s, R.storm.radius*s, 0, TAU, true);
    mctx.fill("evenodd");
    mctx.strokeStyle="#a060ff"; mctx.lineWidth = 1;
    mctx.beginPath(); mctx.arc(R.storm.cx*s, R.storm.cy*s, R.storm.radius*s, 0, TAU); mctx.stroke();
  }
  // батчим красные точки ботов
  mctx.fillStyle = "#e74c3c";
  for (const e of R.ents) {
    if (!e.alive || e.isPlayer) continue;
    mctx.fillRect(e.x*s - 1, e.y*s - 1, 3, 3);
  }
  // потом синий игрок
  for (const e of R.ents) {
    if (!e.alive || !e.isPlayer) continue;
    mctx.fillStyle = "#3aa3ff";
    mctx.fillRect(e.x*s - 2, e.y*s - 2, 5, 5);
  }
}

// =====================================================================
// MAIN LOOP
// =====================================================================
let last = performance.now();
let loopRunning = false;
// FPS counter + adaptive scaling
let fpsLastSec = performance.now();
let fpsFrames = 0;
let measuredFps = 60;
let _adapted = false;
function loop(now) {
  if (!running) { loopRunning = false; return; }
  const dt = Math.min(0.05, (now-last)/1000);
  last = now;
  timeNow += dt;
  if (!isMultiplayer) {
    if (solo && !solo.gameOver && !solo.gameWon) soloUpdate(dt);
    else if (solo) {
      for (let i=solo.particles.length-1;i>=0;i--) {
        const p2 = solo.particles[i];
        p2.x += p2.vx*dt; p2.y += p2.vy*dt; p2.vx*=0.9; p2.vy*=0.9; p2.life-=dt;
        if (p2.life<=0) solo.particles.splice(i,1);
      }
    }
  } else {
    // Client-side prediction: двигаем своего игрока локально каждый кадр
    if (predictedInit && me && me.alive) {
      let dx=0, dy=0;
      if (keys["w"]) dy--; if (keys["s"]) dy++;
      if (keys["a"]) dx--; if (keys["d"]) dx++;
      const len = Math.hypot(dx,dy);
      if (len>0) { dx/=len; dy/=len; }
      const sp = (keys["shift"]?1.5:1) * 220;
      predictedX += dx * sp * dt;
      predictedY += dy * sp * dt;
      // границы карты
      predictedX = Math.max(14, Math.min(WORLD_SIZE-14, predictedX));
      predictedY = Math.max(14, Math.min(WORLD_SIZE-14, predictedY));
    }
    // Отправка input на сервер 30 раз/сек
    netInputTimer += dt;
    if (netInputTimer > 1/30) { netInputTimer = 0; sendInput(); }
  }
  draw();
  fpsFrames++;
  if (now - fpsLastSec >= 1000) {
    measuredFps = fpsFrames;
    fpsFrames = 0;
    fpsLastSec = now;
    // Адаптивное снижение разрешения убрано — оно ломало FOV.
    // Вместо этого, если очень медленно, можем понизить чуть-чуть, но дать кадру быть чётким.
    // Пока ничего не трогаем — пусть FPS говорит сам за себя.
    // показываем FPS в HUD
    if (stormEl && stormEl.parentNode) {
      let fpsEl = document.getElementById("fps-el");
      if (!fpsEl) {
        fpsEl = document.createElement("div");
        fpsEl.id = "fps-el";
        fpsEl.style.color = "#88ff88";
        fpsEl.style.fontSize = "12px";
        stormEl.parentNode.appendChild(fpsEl);
      }
      fpsEl.textContent = `📈 FPS: ${measuredFps} (scale ${(RENDER_SCALE*100).toFixed(0)}%)`;
    }
  }
  requestAnimationFrame(loop);
}
function ensureLoop() {
  if (!loopRunning) {
    loopRunning = true;
    last = performance.now();
    requestAnimationFrame(loop);
  }
}
// loop запускается только при старте игры (через startSolo/startMP), не при загрузке страницы

// ---------- Play button ----------
playBtn.addEventListener("click", () => {
  Sounds.init(); Sounds.resume();
  Sounds.uiClick();
  if (mode==="solo") {
    const name = (document.getElementById("name-solo").value || "Player").slice(0,14);
    const bots = parseInt(document.getElementById("bot-count").value, 10) || 49;
    startSolo(bots, name);
  } else {
    const name = (document.getElementById("name-mp").value || "Player").slice(0,14);
    const url  = document.getElementById("server-url").value || "ws://localhost:8080";
    statusEl.classList.remove("err");
    startMP(url, name);
  }
});

// Гарантированный фолбэк: даже если main loop не успел нарисовать, экран всё равно зелёный
// (если что-то и упадёт — меню остаётся видимым).
