// =====================================================================
// MINI BATTLE ROYALE — multiplayer server (Node.js + ws)
// Запуск:
//   1) npm install ws
//   2) node server.js
// Клиенты подключаются: ws://<твой_IP>:8080
// =====================================================================
"use strict";

const http = require("http");
const path = require("path");
const fs   = require("fs");
let WebSocket;
try { WebSocket = require("ws"); }
catch (e) {
  console.error("\n❌ Пакет 'ws' не установлен. Запусти: npm install ws\n");
  process.exit(1);
}

const PORT = process.env.PORT || 8080;

// ----- Раздаём статику (index.html, game.js) с того же порта -----
const server = http.createServer((req, res) => {
  let url = req.url === "/" ? "/index.html" : req.url;
  const file = path.join(__dirname, url);
  if (!file.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(file).toLowerCase();
    const mime = { ".html":"text/html", ".js":"application/javascript",
                   ".css":"text/css", ".png":"image/png" }[ext] || "text/plain";
    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });

// ---------- World config (синхронно с клиентом) ----------
const WORLD_SIZE = 4000;
const TICK_RATE = 30;        // 30 Hz для отзывчивости стрельбы
const SEND_RANGE = 2200;     // обзор
const DT = 1 / TICK_RATE;
const MIN_PLAYERS_TO_START = 2;
const LOBBY_COUNTDOWN = 10;  // секунд после подключения 2-го игрока
const TAU = Math.PI * 2;

const WEAPONS = {
  pistol:  { name:"Pistol",  dmg:18, cooldown:0.30, mag:12, reload:1.2, spread:0.04, bulletSpeed:850, range:1.0 },
  ar:      { name:"AR",      dmg:14, cooldown:0.11, mag:30, reload:1.8, spread:0.07, bulletSpeed:950, range:1.0 },
  shotgun: { name:"Shotgun", dmg:14, cooldown:0.75, mag:6,  reload:2.2, spread:0.20, bulletSpeed:800, range:0.6, pellets:7 },
  sniper:  { name:"Sniper",  dmg:75, cooldown:1.20, mag:5,  reload:2.8, spread:0.005, bulletSpeed:1500, range:1.5 },
  // ЛЕГЕНДАРНЫЕ (только из airdrop)
  minigun: { name:"Minigun", dmg:9,  cooldown:0.04, mag:100, reload:3.5, spread:0.10, bulletSpeed:1100, range:1.0, legendary:true },
  rocket:  { name:"Rocket",  dmg:90, cooldown:1.50, mag:3,  reload:3.0, spread:0.0,  bulletSpeed:600, range:2.0, legendary:true, explosive:true },
};

const WALL_SIZE = 60;
const WALL_PLACE_DIST = 110;
const STRUCTURES = {
  wall:  { cost:10, hp:80, blocksMove:true,  blocksBullets:true,  speedMod:1.0 },
  floor: { cost:5,  hp:40, blocksMove:false, blocksBullets:false, speedMod:1.2 },
  ramp:  { cost:15, hp:60, blocksMove:false, blocksBullets:true,  speedMod:1.0 },
};

// === Vehicles ===
const VEHICLE_SPEED = 460;
const VEHICLE_HP = 200;

const rand = (a,b) => a + Math.random()*(b-a);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const dist2 = (a,b) => { const dx=a.x-b.x, dy=a.y-b.y; return dx*dx+dy*dy; };

// ---------- State ----------
let nextId = 1;
let players = new Map();   // id -> player
let bullets = [];
let pickups = [];
let obstacles = [];        // создаётся ниже сразу
let walls = [];
let vehicles = [];
let airdrops = [];
let killfeed = [];
let phase = "lobby";       // lobby | countdown | playing | ended
let countdown = 0;
let storm = null;
let timeNow = 0;

function makeObstacles() {
  const arr = [];
  for (let i=0;i<220;i++) arr.push({ type:"tree", x:rand(0,WORLD_SIZE), y:rand(0,WORLD_SIZE), r:22 });
  for (let i=0;i<90;i++)  arr.push({ type:"rock", x:rand(0,WORLD_SIZE), y:rand(0,WORLD_SIZE), r:28 });
  return arr;
}

// Здания (детерминированно — те же что и на клиенте)
function makeBuildings() {
  const arr = [];
  const seed = (i) => { const v = Math.sin(i * 9999.12) * 43758.5; return v - Math.floor(v); };
  for (let i=0; i<12; i++) {
    const r1 = seed(i*3+1);
    const r2 = seed(i*3+2);
    const w = 100 + (seed(i*3+3) * 80) | 0;
    const h = 80 + (seed(i*3+4) * 60) | 0;
    const x = WORLD_SIZE/2 + 150 + r1 * (WORLD_SIZE/2 - 300);
    const y = WORLD_SIZE/2 + 150 + r2 * (WORLD_SIZE/2 - 300);
    arr.push({ x, y, w, h });
  }
  arr.push({ x: 800, y: 800, w:130, h:100 });
  arr.push({ x: 3200, y: 800, w:120, h:100 });
  arr.push({ x: 800, y: 3200, w:130, h:100 });
  return arr;
}
const buildings = makeBuildings();

const ZIPLINES = [
  { x1: 600, y1: 600, x2: 1800, y2: 1800 },
  { x1: 3400, y1: 600, x2: 2200, y2: 1800 },
  { x1: 600, y1: 3400, x2: 1800, y2: 2200 },
  { x1: 3400, y1: 3400, x2: 2200, y2: 2200 },
];
let grenades = [];  // {x, y, vx, vy, fuse, owner}
function makePickups() {
  const arr = [];
  for (let i=0;i<100;i++) {
    const t = Math.random();
    let type;
    if (t<0.25) type = "heal";
    else if (t<0.40) type = "ammo";
    else if (t<0.55) type = "armor";  // НОВОЕ: щит/броня
    else if (t<0.70) type = "ar";
    else if (t<0.83) type = "shotgun";
    else type = "sniper";
    arr.push({ id: nextId++, x: rand(100, WORLD_SIZE-100), y: rand(100, WORLD_SIZE-100), type, r: 12 });
  }
  return arr;
}

// === Vehicles spawn ===
function makeVehicles() {
  const arr = [];
  for (let i=0;i<8;i++) {
    arr.push({
      id: nextId++,
      x: rand(300, WORLD_SIZE-300),
      y: rand(300, WORLD_SIZE-300),
      angle: rand(0, TAU),
      hp: VEHICLE_HP, maxHp: VEHICLE_HP,
      driver: null,
    });
  }
  return arr;
}

// === Airdrops ===
let nextAirdropTime = 0;
const AIRDROP_INTERVAL = 45; // секунд между дропами
function spawnAirdrop() {
  // выбираем точку внутри текущей зоны
  const r = storm ? storm.radius * 0.7 : WORLD_SIZE*0.4;
  const cx = storm ? storm.cx : WORLD_SIZE/2;
  const cy = storm ? storm.cy : WORLD_SIZE/2;
  const ang = Math.random()*TAU;
  const d = Math.random() * r;
  const x = Math.max(100, Math.min(WORLD_SIZE-100, cx + Math.cos(ang)*d));
  const y = Math.max(100, Math.min(WORLD_SIZE-100, cy + Math.sin(ang)*d));
  airdrops.push({
    id: nextId++, x, y,
    state: "falling",   // falling -> landed
    fallEnd: timeNow + 5,
    altitude: 1.0,
  });
}
function newStorm() {
  return {
    cx: WORLD_SIZE/2, cy: WORLD_SIZE/2,
    radius: WORLD_SIZE*0.7, targetRadius: WORLD_SIZE*0.7,
    nextShrink: timeNow + 25, shrinkSpeed: 0, dmgPerSec: 6, stage:0,
  };
}

// Сразу создаём карту препятствий при старте сервера, чтобы welcome их отправлял
obstacles = makeObstacles();
pickups = makePickups();

function resetWorld() {
  bullets = [];
  pickups = makePickups();
  // obstacles НЕ пересоздаём при ресете — карта остаётся той же, фон у клиента кэширован
  walls = [];
  killfeed = [];
  storm = newStorm();
  const list = [...players.values()];
  list.forEach((p, i) => {
    const a = (i/list.length)*TAU;
    const R = WORLD_SIZE*0.3;
    p.x = WORLD_SIZE/2 + Math.cos(a)*R;
    p.y = WORLD_SIZE/2 + Math.sin(a)*R;
    p.hp = 100; p.alive = true; p.kills = 0; p.spectator = false;
    p.armor = 0; p.maxArmor = 100;
    p.weapons = { pistol: { ammo: WEAPONS.pistol.mag, owned:true } };
    p.current = "pistol";
    p.reloading = false; p.reloadEnd = 0; p.fireCD = 0;
    p.materials = 100;
    p.vehicleId = null;
    p.grenades_count = 2;
    p.smokes = 2; p.stuns = 1;
    p.bandages = 3; p.medkits = 1; p.energy = 1;
    p.consuming = null; p.stunned = 0; p.meleeCD = 0;
    p.ziplining = null;
  });
  vehicles = makeVehicles();
  grenades = []; specials = [];
  airdrops = [];
  nextAirdropTime = timeNow + 30;  // первый дроп через 30 сек
  waitingQueue = [];
}

function broadcast(obj) {
  const data = JSON.stringify(obj);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}
function sendTo(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// ---------- Connection ----------
// очередь ожидающих игроков (joined во время playing-фазы)
let waitingQueue = [];

wss.on("connection", (ws) => {
  const id = nextId++;
  // если матч уже идёт — игрок становится наблюдателем (spectator)
  const spectating = (phase === "playing");
  const p = {
    id, ws, name: "Player"+id,
    x: WORLD_SIZE/2, y: WORLD_SIZE/2, angle: 0,
    hp: 100, alive: !spectating, kills: 0, spectator: spectating,
    armor: 0, maxArmor: 100,
    color: `hsl(${(id*67)%360},70%,55%)`,
    weapons: { pistol: { ammo: WEAPONS.pistol.mag, owned:true } },
    current: "pistol",
    reloading: false, reloadEnd: 0, fireCD: 0,
    materials: 100,
    vehicleId: null,
    input: { up:false, down:false, left:false, right:false, sprint:false, shoot:false, reload:false, angle:0, action:false },
    lastSeen: Date.now(),
  };
  players.set(id, p);
  sendTo(ws, { t:"welcome", id, world: WORLD_SIZE, weapons: WEAPONS, obstacles });
  if (spectating) {
    sendTo(ws, { t:"event", msg:"⏳ Матч уже идёт — вы в очереди на следующий!" });
    waitingQueue.push(id);
  }
  console.log(`[+] Player ${id} connected (${spectating?"spectator":"alive"}). Total: ${players.size}`);

  if (phase === "lobby" && players.size >= MIN_PLAYERS_TO_START) {
    phase = "countdown"; countdown = LOBBY_COUNTDOWN;
  }

  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    p.lastSeen = Date.now();
    if (m.t === "name") p.name = String(m.name||"Player").slice(0,14);
    else if (m.t === "input") {
      Object.assign(p.input, m.input || {});
    } else if (m.t === "switch") {
      if (p.weapons[m.w] && p.weapons[m.w].owned) {
        p.current = m.w; p.reloading = false;
      }
    } else if (m.t === "reload") {
      tryReload(p);
    } else if (m.t === "build") {
      tryBuild(p, m.btype);
    } else if (m.t === "use") {
      toggleVehicle(p);
    } else if (m.t === "grenade") {
      throwGrenade(p);
    } else if (m.t === "zipline") {
      useZipline(p);
    } else if (m.t === "consume") {
      tryConsume(p, m.c);
    } else if (m.t === "melee") {
      meleeAttack(p);
    } else if (m.t === "special") {
      throwSpecial(p, m.s);
    }
  });

  ws.on("close", () => {
    players.delete(id);
    waitingQueue = waitingQueue.filter(qid => qid !== id);
    console.log(`[-] Player ${id} disconnected. Total: ${players.size}`);
    if (players.size === 0) { phase = "lobby"; storm = null; }
  });
});

// ---------- Game logic ----------
function collideObstacles(ent) {
  const radius = ent.r || 14;
  for (const o of obstacles) {
    const dx=ent.x-o.x, dy=ent.y-o.y, d2=dx*dx+dy*dy, rr=radius+o.r;
    if (d2 < rr*rr && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      ent.x += (dx/d)*(rr-d); ent.y += (dy/d)*(rr-d);
    }
  }
  // здания — 4 стены AABB с дверью снизу
  for (const bd of buildings) {
    const doorX1 = bd.x - 12, doorX2 = bd.x + 12;
    const walls4 = [
      {x1: bd.x-bd.w/2, y1: bd.y-bd.h/2, x2: bd.x+bd.w/2, y2: bd.y-bd.h/2+4},
      {x1: bd.x-bd.w/2, y1: bd.y-bd.h/2, x2: bd.x-bd.w/2+4, y2: bd.y+bd.h/2},
      {x1: bd.x+bd.w/2-4, y1: bd.y-bd.h/2, x2: bd.x+bd.w/2, y2: bd.y+bd.h/2},
      {x1: bd.x-bd.w/2, y1: bd.y+bd.h/2-4, x2: doorX1, y2: bd.y+bd.h/2},
      {x1: doorX2, y1: bd.y+bd.h/2-4, x2: bd.x+bd.w/2, y2: bd.y+bd.h/2},
    ];
    for (const w of walls4) {
      const cx = clamp(ent.x, w.x1, w.x2);
      const cy = clamp(ent.y, w.y1, w.y2);
      const dx = ent.x - cx, dy = ent.y - cy;
      const d2 = dx*dx + dy*dy;
      if (d2 < radius*radius && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        ent.x += (dx/d)*(radius - d);
        ent.y += (dy/d)*(radius - d);
      }
    }
  }
  // walls
  for (const w of walls) {
    if (w.hp<=0) continue;
    const spec = STRUCTURES[w.type]; if (!spec || !spec.blocksMove) continue;
    const half = WALL_SIZE/2;
    const cx = clamp(ent.x, w.x-half, w.x+half);
    const cy = clamp(ent.y, w.y-half, w.y+half);
    const dx = ent.x - cx, dy = ent.y - cy;
    const d2 = dx*dx + dy*dy;
    if (d2 < 14*14 && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      ent.x += (dx/d)*(14 - d); ent.y += (dy/d)*(14 - d);
    }
  }
  ent.x = clamp(ent.x, 14, WORLD_SIZE-14);
  ent.y = clamp(ent.y, 14, WORLD_SIZE-14);
}

const CONSUMABLES_S = {
  bandage: { time: 3.0, hp: 15, maxHp: 75, slot:"bandages" },
  medkit:  { time: 5.0, hp: 100, maxHp: 100, slot:"medkits" },
  energy:  { time: 4.0, armor: 100, slot:"energy" },
};
function tryConsume(p, type) {
  if (!p.alive || p.consuming || !CONSUMABLES_S[type]) return;
  const spec = CONSUMABLES_S[type];
  if ((p[spec.slot]||0) <= 0) return;
  if (type === "bandage" && p.hp >= spec.maxHp) return;
  if (type === "medkit" && p.hp >= 100) return;
  if (type === "energy" && p.armor >= 100) return;
  p[spec.slot]--;
  p.consuming = { type, end: timeNow + spec.time };
}
function tickConsume(p) {
  if (p.consuming && timeNow >= p.consuming.end) {
    const spec = CONSUMABLES_S[p.consuming.type];
    if (spec.hp) p.hp = Math.min(spec.maxHp, p.hp + spec.hp);
    if (p.consuming.type === "medkit") p.hp = 100;
    if (spec.armor) p.armor = Math.min(p.maxArmor, p.armor + spec.armor);
    p.consuming = null;
  }
}
function meleeAttack(p) {
  if (!p.alive || p.vehicleId) return;
  if ((p.meleeCD||0) > 0) return;
  p.meleeCD = 0.6;
  for (const o of players.values()) {
    if (o === p || !o.alive) continue;
    const dx=o.x-p.x, dy=o.y-p.y, d=Math.hypot(dx,dy);
    if (d > 60) continue;
    const angTo = Math.atan2(dy, dx);
    let diff = angTo - p.angle;
    while (diff > Math.PI) diff -= 2*Math.PI;
    while (diff < -Math.PI) diff += 2*Math.PI;
    if (Math.abs(diff) < Math.PI/4) {
      let dmg = 50;
      if (o.armor > 0) { const a = Math.min(o.armor, dmg*0.5); o.armor -= a; dmg -= a; }
      o.hp -= dmg;
      if (o.hp <= 0) {
        killPlayer(o, p, "knife");
        p.materials = Math.min(500, (p.materials||0)+25);
      }
    }
  }
}
let specials = [];  // {type,x,y,vx,vy,fuse,owner,active,duration,life}
function throwSpecial(p, type) {
  if (!p.alive || p.vehicleId) return;
  const slot = type === "smoke" ? "smokes" : "stuns";
  if ((p[slot]||0) <= 0) return;
  p[slot]--;
  const speed = 500;
  specials.push({
    type, x:p.x+Math.cos(p.angle)*20, y:p.y+Math.sin(p.angle)*20,
    vx: Math.cos(p.angle)*speed, vy: Math.sin(p.angle)*speed,
    fuse: 1.5, owner: p.id,
    active: false, duration: type === "smoke" ? 8.0 : 2.5,
  });
}
function updateSpecials(dt) {
  for (let i=specials.length-1;i>=0;i--) {
    const sp = specials[i];
    if (!sp.active) {
      sp.x += sp.vx*dt; sp.y += sp.vy*dt;
      sp.vx *= 0.92; sp.vy *= 0.92;
      sp.fuse -= dt;
      if (sp.fuse <= 0) {
        sp.active = true; sp.life = sp.duration;
        if (sp.type === "stun") {
          for (const o of players.values()) {
            if (!o.alive) continue;
            const d = Math.hypot(o.x-sp.x, o.y-sp.y);
            if (d < 100) o.stunned = (o.stunned||0) + 2.5;
          }
        }
      }
    } else {
      sp.life -= dt;
      if (sp.life <= 0) specials.splice(i, 1);
    }
  }
}

function throwGrenade(p) {
  if (!p.alive || p.vehicleId) return;
  if ((p.grenades_count||0) <= 0) return;
  p.grenades_count--;
  const speed = 600;
  grenades.push({
    x: p.x + Math.cos(p.angle)*20,
    y: p.y + Math.sin(p.angle)*20,
    vx: Math.cos(p.angle)*speed,
    vy: Math.sin(p.angle)*speed,
    fuse: 2.0,
    owner: p.id,
  });
}

function useZipline(p) {
  if (!p.alive || p.vehicleId) return;
  if (p.ziplining) { p.ziplining = null; return; }
  let best = null, bd = 80*80;
  for (const z of ZIPLINES) {
    const d1 = (p.x-z.x1)**2 + (p.y-z.y1)**2;
    if (d1 < bd) { bd = d1; best = { z, fromStart:true }; }
    const d2 = (p.x-z.x2)**2 + (p.y-z.y2)**2;
    if (d2 < bd) { bd = d2; best = { z, fromStart:false }; }
  }
  if (!best) return;
  const dist = Math.hypot(best.z.x2-best.z.x1, best.z.y2-best.z.y1);
  p.ziplining = {
    x1: best.fromStart?best.z.x1:best.z.x2,
    y1: best.fromStart?best.z.y1:best.z.y2,
    x2: best.fromStart?best.z.x2:best.z.x1,
    y2: best.fromStart?best.z.y2:best.z.y1,
    t: 0, duration: dist / 600,
  };
}

function updateGrenades(dt) {
  for (let i=grenades.length-1;i>=0;i--) {
    const g = grenades[i];
    g.x += g.vx*dt; g.y += g.vy*dt;
    g.vx *= 0.92; g.vy *= 0.92;
    g.fuse -= dt;
    if (g.fuse <= 0) {
      // взрыв 90px радиус 70 урона
      const R = 90;
      for (const t of players.values()) {
        if (!t.alive) continue;
        const d = Math.hypot(t.x-g.x, t.y-g.y);
        if (d < R) {
          const falloff = 1 - d/R;
          let dmg = 70 * falloff;
          if (t.armor > 0) {
            const absorbed = Math.min(t.armor, dmg * 0.5);
            t.armor -= absorbed; dmg -= absorbed;
          }
          t.hp -= dmg;
          if (t.hp <= 0) {
            const owner = players.get(g.owner);
            killPlayer(t, owner, "grenade");
            if (owner && t.id !== owner.id) owner.materials = Math.min(500, (owner.materials||0)+25);
          }
        }
      }
      grenades.splice(i, 1);
    }
  }
}

function updateZipliners(dt) {
  for (const p of players.values()) {
    if (!p.alive || !p.ziplining) continue;
    p.ziplining.t += dt;
    const k = Math.min(1, p.ziplining.t / p.ziplining.duration);
    p.x = p.ziplining.x1 + (p.ziplining.x2 - p.ziplining.x1) * k;
    p.y = p.ziplining.y1 + (p.ziplining.y2 - p.ziplining.y1) * k;
    if (k >= 1) p.ziplining = null;
  }
}

function toggleVehicle(p) {
  if (!p.alive) return;
  if (p.vehicleId) {
    const v = vehicles.find(x => x.id === p.vehicleId);
    if (v) v.driver = null;
    p.vehicleId = null;
    return;
  }
  let nearest=null, nd2=120*120;  // увеличил радиус с 60 до 120
  for (const v of vehicles) {
    if (v.hp<=0 || v.driver) continue;
    const dx=v.x-p.x, dy=v.y-p.y, d2=dx*dx+dy*dy;
    if (d2<nd2) { nearest=v; nd2=d2; }
  }
  if (nearest) {
    nearest.driver = p.id;
    p.vehicleId = nearest.id;
  }
}

function tryBuild(p, btype) {
  if (!p.alive) return;
  const spec = STRUCTURES[btype]; if (!spec) return;
  if ((p.materials||0) < spec.cost) return;
  const tx = p.x + Math.cos(p.angle)*WALL_PLACE_DIST;
  const ty = p.y + Math.sin(p.angle)*WALL_PLACE_DIST;
  const gx = Math.round(tx / WALL_SIZE) * WALL_SIZE;
  const gy = Math.round(ty / WALL_SIZE) * WALL_SIZE;
  for (const w of walls) {
    if (w.hp>0 && w.x===gx && w.y===gy && w.type===btype) return;
  }
  const half = WALL_SIZE/2;
  if (spec.blocksMove) {
    for (const o of obstacles) {
      if (Math.abs(o.x-gx) < half+o.r && Math.abs(o.y-gy) < half+o.r) return;
    }
    for (const pl of players.values()) {
      if (!pl.alive || pl === p) continue;
      if (Math.abs(pl.x-gx) < half+14 && Math.abs(pl.y-gy) < half+14) return;
    }
  }
  for (const w of walls) {
    if (w.hp>0 && w.x===gx && w.y===gy && STRUCTURES[w.type] && STRUCTURES[w.type].blocksMove) return;
  }
  walls.push({ x:gx, y:gy, hp:spec.hp, maxHp:spec.hp, type:btype, owner:p.id });
  p.materials -= spec.cost;
}

function tryReload(p) {
  const w = WEAPONS[p.current];
  const inv = p.weapons[p.current];
  if (!w || !inv || p.reloading || inv.ammo >= w.mag) return;
  p.reloading = true; p.reloadEnd = timeNow + w.reload;
}

function shoot(p) {
  const w = WEAPONS[p.current];
  const inv = p.weapons[p.current];
  if (!w || !inv || p.reloading || p.fireCD > 0 || inv.ammo <= 0 || !p.alive) return;
  p.fireCD = w.cooldown;
  inv.ammo--;
  const pellets = w.pellets || 1;
  for (let i=0;i<pellets;i++) {
    const ang = p.input.angle + (Math.random()-0.5)*w.spread*2;
    bullets.push({
      x: p.x + Math.cos(ang)*16, y: p.y + Math.sin(ang)*16,
      vx: Math.cos(ang)*w.bulletSpeed, vy: Math.sin(ang)*w.bulletSpeed,
      life: 1.0 * w.range, dmg: w.dmg, owner: p.id,
    });
  }
}

function floorUnder(x, y) {
  const half = WALL_SIZE/2;
  for (const w of walls) {
    if (w.hp<=0) continue;
    const spec = STRUCTURES[w.type];
    if (!spec || spec.speedMod === 1) continue;
    if (x>w.x-half && x<w.x+half && y>w.y-half && y<w.y+half) return w;
  }
  return null;
}

function updatePlayer(p, dt) {
  if (!p.alive) return;
  let dx=0,dy=0;
  if (p.input.up) dy--;
  if (p.input.down) dy++;
  if (p.input.left) dx--;
  if (p.input.right) dx++;
  const len = Math.hypot(dx,dy);
  if (len>0) { dx/=len; dy/=len; }
  p.angle = p.input.angle;

  // Если игрок в машине — двигаем машину top-down arcade style
  if (p.vehicleId) {
    const v = vehicles.find(x => x.id === p.vehicleId);
    if (v && v.hp > 0) {
      let mvx = 0, mvy = 0;
      if (p.input.up) mvy--;
      if (p.input.down) mvy++;
      if (p.input.left) mvx--;
      if (p.input.right) mvx++;
      const mlen = Math.hypot(mvx, mvy);
      const VS = 280;
      let movedDist = 0;
      if (mlen > 0) {
        mvx /= mlen; mvy /= mlen;
        const oldX = v.x, oldY = v.y;
        v.x += mvx * VS * dt;
        v.y += mvy * VS * dt;
        // коллизия машины с препятствиями
        v.r = 25;
        collideObstacles(v);
        movedDist = Math.hypot(v.x - oldX, v.y - oldY);
        const targetAng = Math.atan2(mvy, mvx);
        let diff = targetAng - v.angle;
        while (diff > Math.PI) diff -= 2*Math.PI;
        while (diff < -Math.PI) diff += 2*Math.PI;
        v.angle += diff * Math.min(1, dt * 8);
      }
      v.x = clamp(v.x, 30, WORLD_SIZE-30);
      v.y = clamp(v.y, 30, WORLD_SIZE-30);
      // ТАРАН только при реальной скорости
      const speed = movedDist / Math.max(0.001, dt);
      if (speed > 100) {
        for (const o of players.values()) {
          if (o === p || !o.alive || o.vehicleId) continue;
          const ddx=o.x-v.x, ddy=o.y-v.y;
          if (ddx*ddx+ddy*ddy < 40*40) {
            o.hp -= 25;
            if (o.hp <= 0) killPlayer(o, p, "ram");
          }
        }
      }
      p.x = v.x; p.y = v.y; p.angle = v.angle;
      if (p.fireCD > 0) p.fireCD -= dt;
      return;
    } else {
      p.vehicleId = null;
    }
  }

  let mul = (p.input.sprint?1.5:1);
  const fl = floorUnder(p.x, p.y);
  if (fl) mul *= STRUCTURES[fl.type].speedMod;
  const sp = mul * 220;
  p.x += dx*sp*dt; p.y += dy*sp*dt;

  if (p.input.shoot) shoot(p);
  if (p.input.reload) { tryReload(p); p.input.reload = false; }
  if (p.fireCD > 0) p.fireCD -= dt;
  if (p.reloading && timeNow >= p.reloadEnd) {
    p.reloading = false;
    p.weapons[p.current].ammo = WEAPONS[p.current].mag;
  }
  collideObstacles(p);

  // pickups
  for (let i=pickups.length-1;i>=0;i--) {
    const pk = pickups[i];
    const ddx=p.x-pk.x, ddy=p.y-pk.y;
    if (ddx*ddx+ddy*ddy < (14+pk.r)*(14+pk.r)) {
      if (pk.type === "heal") p.hp = Math.min(100, p.hp+35);
      else if (pk.type === "armor") p.armor = Math.min(p.maxArmor, p.armor + 50);
      else if (pk.type === "ammo") {
        const w = WEAPONS[p.current], inv = p.weapons[p.current];
        if (inv) inv.ammo = Math.min(w.mag, inv.ammo + Math.ceil(w.mag*0.6));
      } else if (WEAPONS[pk.type]) {
        if (!p.weapons[pk.type]) p.weapons[pk.type] = { ammo: WEAPONS[pk.type].mag, owned:true };
        else p.weapons[pk.type].ammo = WEAPONS[pk.type].mag;
        p.current = pk.type; p.reloading = false;
      }
      pickups.splice(i,1);
    }
  }
  // airdrops (только приземлившиеся можно подобрать)
  for (let i=airdrops.length-1;i>=0;i--) {
    const a = airdrops[i];
    if (a.state !== "landed") continue;
    const ddx=p.x-a.x, ddy=p.y-a.y;
    if (ddx*ddx+ddy*ddy < (14+20)*(14+20)) {
      // даём легендарное оружие
      const legendaries = ["minigun", "rocket"];
      const w = legendaries[Math.floor(Math.random()*legendaries.length)];
      p.weapons[w] = { ammo: WEAPONS[w].mag, owned:true };
      p.current = w; p.reloading = false;
      p.armor = p.maxArmor; // полная броня
      airdrops.splice(i,1);
    }
  }

  // storm
  const sdx=p.x-storm.cx, sdy=p.y-storm.cy;
  if (sdx*sdx+sdy*sdy > storm.radius*storm.radius) {
    p.hp -= storm.dmgPerSec*dt;
  }
  if (p.hp <= 0) killPlayer(p, null, "storm");
}

function killPlayer(p, killer, cause) {
  if (!p.alive) return;
  p.alive = false; p.hp = 0;
  killfeed.unshift({
    killer: killer ? killer.name : null,
    victim: p.name, cause: cause || (killer ? killer.current : "?"),
    t: timeNow,
  });
  killfeed = killfeed.slice(0, 6);
  if (killer && killer !== p) killer.kills++;
}

function updateBullets(dt) {
  for (let i=bullets.length-1;i>=0;i--) {
    const b = bullets[i];
    b.x += b.vx*dt; b.y += b.vy*dt;
    b.life -= dt;
    let dead = b.life<=0 || b.x<0||b.y<0||b.x>WORLD_SIZE||b.y>WORLD_SIZE;
    if (!dead) {
      for (const o of obstacles) {
        const dx=b.x-o.x,dy=b.y-o.y;
        if (dx*dx+dy*dy < o.r*o.r) { dead=true; break; }
      }
    }
    if (!dead) {
      for (const w of walls) {
        if (w.hp<=0) continue;
        const spec = STRUCTURES[w.type]; if (!spec || !spec.blocksBullets) continue;
        const half = WALL_SIZE/2;
        if (b.x>w.x-half && b.x<w.x+half && b.y>w.y-half && b.y<w.y+half) {
          w.hp -= b.dmg; dead=true; break;
        }
      }
    }
    // машины ловят пули
    if (!dead) {
      for (const v of vehicles) {
        if (v.hp<=0) continue;
        const dx=b.x-v.x, dy=b.y-v.y;
        if (dx*dx+dy*dy < 28*28) {
          v.hp -= b.dmg; dead=true;
          if (v.hp<=0 && v.driver) {
            const drv = players.get(v.driver);
            if (drv) { drv.vehicleId = null; drv.hp -= 30; if (drv.hp<=0) killPlayer(drv, null, "explosion"); }
          }
          break;
        }
      }
    }
    if (!dead) {
      for (const p of players.values()) {
        if (!p.alive || p.id === b.owner) continue;
        const dx=b.x-p.x, dy=b.y-p.y;
        if (dx*dx+dy*dy < 14*14) {
          // броня поглощает половину урона
          let dmg = b.dmg;
          if (p.armor > 0) {
            const absorbed = Math.min(p.armor, dmg * 0.5);
            p.armor -= absorbed;
            dmg -= absorbed;
          }
          p.hp -= dmg; dead=true;
          if (p.hp <= 0) {
            killPlayer(p, players.get(b.owner));
            const killer = players.get(b.owner);
            if (killer) killer.materials = Math.min(500, (killer.materials||0)+25);
          }
          break;
        }
      }
    }
    if (dead) bullets.splice(i,1);
  }
  walls = walls.filter(w => w.hp > 0);
  vehicles = vehicles.filter(v => v.hp > 0);
}

function updateStorm(dt) {
  if (timeNow >= storm.nextShrink && storm.targetRadius > 80) {
    storm.stage++;
    storm.targetRadius = Math.max(80, storm.radius * 0.55);
    storm.shrinkSpeed = (storm.radius - storm.targetRadius) / 30;
    storm.nextShrink = timeNow + 60;
    storm.dmgPerSec += 3;
  }
  if (storm.radius > storm.targetRadius) {
    storm.radius = Math.max(storm.targetRadius, storm.radius - storm.shrinkSpeed*dt);
  }
}

function snapshot() {
  const ps = [...players.values()].map(p => ({
    id:p.id, n:p.name, x:Math.round(p.x), y:Math.round(p.y),
    a:+p.angle.toFixed(2), hp:Math.max(0,Math.floor(p.hp)),
    al:p.alive?1:0, k:p.kills, c:p.color, w:p.current, rl:p.reloading?1:0,
  }));
  return {
    t:"state",
    phase, countdown: Math.ceil(countdown),
    players: ps,
    bullets: bullets.map(b => ({ x:Math.round(b.x), y:Math.round(b.y) })),
    pickups: pickups.map(p => ({ id:p.id, x:p.x, y:p.y, type:p.type })),
    walls: walls.map(w => ({ x:w.x, y:w.y, hp:w.hp, maxHp:w.maxHp, type:w.type })),
    // obstacles НЕ шлём каждый тик — отправляем только в welcome (клиент кэширует)
    storm: storm ? { cx:storm.cx, cy:storm.cy, r:Math.round(storm.radius), tr:Math.round(storm.targetRadius), next:Math.ceil(storm.nextShrink-timeNow) } : { cx:WORLD_SIZE/2, cy:WORLD_SIZE/2, r:WORLD_SIZE/2, tr:WORLD_SIZE/2, next:0 },
    killfeed,
    me: null,
  };
}

// Серверный цикл
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.1, (now-lastTick)/1000);
  lastTick = now;
  timeNow += dt;

  if (phase === "countdown") {
    countdown -= dt;
    if (countdown <= 0) {
      phase = "playing";
      resetWorld();
      broadcast({ t:"event", msg:"DROP IN! 🪂" });
    }
  } else if (phase === "playing") {
    for (const p of players.values()) updatePlayer(p, dt);
    updateBullets(dt);
    updateGrenades(dt);
    updateSpecials(dt);
    updateZipliners(dt);
    for (const p of players.values()) {
      tickConsume(p);
      if (p.meleeCD > 0) p.meleeCD -= dt;
      if (p.stunned > 0) p.stunned -= dt;
    }
    updateStorm(dt);
    // airdrops tick
    if (timeNow >= nextAirdropTime) {
      spawnAirdrop();
      nextAirdropTime = timeNow + AIRDROP_INTERVAL;
      broadcast({ t:"event", msg:"🪂 Airdrop incoming!" });
    }
    for (const a of airdrops) {
      if (a.state === "falling") {
        a.altitude -= dt / 5;  // 5 секунд падения
        if (a.altitude <= 0) { a.altitude = 0; a.state = "landed"; }
      }
    }
    const alive = [...players.values()].filter(p=>p.alive);
    if (alive.length <= 1 && players.size >= 2) {
      phase = "ended";
      const winner = alive[0];
      broadcast({ t:"event", msg: winner ? `🏆 ${winner.name} WINS!` : "Draw" });
      setTimeout(() => {
        phase = players.size >= MIN_PLAYERS_TO_START ? "countdown" : "lobby";
        countdown = LOBBY_COUNTDOWN;
      }, 6000);
    }
  }

  // Персональные снапшоты с culling по дистанции (компактный формат, целые числа)
  const stormObj = storm ? { cx:Math.round(storm.cx), cy:Math.round(storm.cy), r:Math.round(storm.radius), tr:Math.round(storm.targetRadius), next:Math.ceil(storm.nextShrink-timeNow) } : { cx:WORLD_SIZE/2, cy:WORLD_SIZE/2, r:WORLD_SIZE/2, tr:WORLD_SIZE/2, next:0 };
  const R2 = SEND_RANGE * SEND_RANGE;
  for (const p of players.values()) {
    if (p.ws.readyState !== 1) continue;
    const cx = p.x, cy = p.y;
    const ps = [];
    for (const o of players.values()) {
      if (!o.alive) continue; // мёртвых вообще не шлём
      const dx=o.x-cx, dy=o.y-cy;
      if (o.id !== p.id && dx*dx+dy*dy > R2) continue;
      ps.push({ id:o.id, n:o.name, x:o.x|0, y:o.y|0,
        a:Math.round(o.angle*100)/100, hp:o.hp|0,
        al:1, c:o.color, w:o.current, rl:o.reloading?1:0 });
    }
    const bs = [];
    for (let i=0;i<bullets.length;i++) {
      const b = bullets[i];
      const dx=b.x-cx, dy=b.y-cy;
      if (dx*dx+dy*dy > R2) continue;
      bs.push(b.x|0, b.y|0);  // плоский массив [x1,y1,x2,y2,...] — компактнее
    }
    const pks = [];
    for (let i=0;i<pickups.length;i++) {
      const pk = pickups[i];
      const dx=pk.x-cx, dy=pk.y-cy;
      if (dx*dx+dy*dy > R2) continue;
      pks.push({ x:pk.x|0, y:pk.y|0, t:pk.type });
    }
    const ws_ = [];
    for (let i=0;i<walls.length;i++) {
      const w = walls[i];
      const dx=w.x-cx, dy=w.y-cy;
      if (dx*dx+dy*dy > R2) continue;
      ws_.push({ x:w.x, y:w.y, hp:w.hp|0, mh:w.maxHp, ty:w.type });
    }
    // машины и airdrops в радиусе
    const vs = [];
    for (let i=0;i<vehicles.length;i++) {
      const v = vehicles[i];
      const dx=v.x-cx, dy=v.y-cy;
      if (dx*dx+dy*dy > R2) continue;
      vs.push({ id:v.id, x:v.x|0, y:v.y|0, a:Math.round(v.angle*100)/100, hp:v.hp|0, mh:v.maxHp, dr:v.driver });
    }
    const ads = [];
    for (let i=0;i<airdrops.length;i++) {
      const a = airdrops[i];
      const dx=a.x-cx, dy=a.y-cy;
      if (dx*dx+dy*dy > R2) continue;
      ads.push({ id:a.id, x:a.x|0, y:a.y|0, s:a.state, al:Math.round(a.altitude*100)/100 });
    }
    // гранаты в радиусе
    const gs = [];
    for (const g of grenades) {
      const dx=g.x-cx, dy=g.y-cy;
      if (dx*dx+dy*dy > R2) continue;
      gs.push({ x:g.x|0, y:g.y|0, f:Math.round(g.fuse*10)/10 });
    }
    // спец-предметы (дым/стан) в радиусе
    const sps = [];
    for (const sp of specials) {
      const dx=sp.x-cx, dy=sp.y-cy;
      if (dx*dx+dy*dy > R2) continue;
      sps.push({ x:sp.x|0, y:sp.y|0, t:sp.type, a:sp.active?1:0, l:sp.life ? (Math.round(sp.life*10)/10) : 0, d:sp.duration });
    }
    const msg = {
      t:"s",
      ph: phase, cd: Math.ceil(countdown),
      ps, bs, pks, ws: ws_, vs, ads, gs, sps,
      zl: ZIPLINES,  // зиплайны статичны, шлём всегда
      st: stormObj,
      kf: killfeed,
      me: {
        hp:p.hp|0, ar:p.armor|0, mar:p.maxArmor,
        we: p.weapons, c: p.current, rl: p.reloading,
        rL: p.reloading ? Math.round((p.reloadEnd - timeNow)*100)/100 : 0,
        k: p.kills, al: p.alive, ma: p.materials||0,
        vi: p.vehicleId,
        gr: p.grenades_count||0,
        zi: p.ziplining ? 1 : 0,
        sm: p.smokes||0, st: p.stuns||0,
        ba: p.bandages||0, mk: p.medkits||0, en: p.energy||0,
        cu: p.consuming ? p.consuming.type : null,
      },
    };
    p.ws.send(JSON.stringify(msg));
  }
}, 1000/TICK_RATE);

server.listen(PORT, () => {
  console.log(`\n🎮 Mini Battle Royale server running on port ${PORT}`);
  console.log(`   Open http://localhost:${PORT}/ in your browser`);
  console.log(`   Or connect via WebSocket: ws://localhost:${PORT}\n`);
});
