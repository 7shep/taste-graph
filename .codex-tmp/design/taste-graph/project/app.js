// Taste Graph — force-directed simulation + dashboard glue
// ---------------------------------------------------------------

const CLUSTERS = {
  east: { id:'east', label:'East Coast / A$AP',     color:'#ef8a6b', x:0.28, y:0.32 },
  atl:  { id:'atl',  label:'Dreamville · ATL',       color:'#e9bd5a', x:0.72, y:0.32 },
  tde:  { id:'tde',  label:'TDE · West Coast',       color:'#7fd4a8', x:0.28, y:0.72 },
  ovo:  { id:'ovo',  label:'OVO · Toronto',          color:'#9aa9ee', x:0.72, y:0.72 },
};

// 24 nodes — four hero artists + satellites + a few bridges.
const ARTISTS = [
  // EAST  ───────────────────────────────────
  { id:'asap-rocky',  name:'A$AP Rocky',       cluster:'east', plays:1247, hours:62,  hero:true,
    top:[
      {title:'Praise The Lord (Da Shine)', album:'TESTING',     plays:84},
      {title:'L$D',                        album:'LONG.LIVE.A$AP',plays:71},
      {title:'F**kin\u2019 Problems',      album:'LONG.LIVE.A$AP',plays:58},
      {title:'Sundress',                   album:'Single 2018',  plays:46},
      {title:'Goldie',                     album:'LONG.LIVE.A$AP',plays:39},
    ],
    quote:'Discovered via Skepta · 2 yrs ago. Most-played in the rotation since April.',
  },
  { id:'asap-ferg',     name:'A$AP Ferg',         cluster:'east', plays:428, hours:18 },
  { id:'asap-mob',      name:'A$AP Mob',          cluster:'east', plays:198, hours:8 },
  { id:'playboi-carti', name:'Playboi Carti',     cluster:'east', plays:612, hours:24 },
  { id:'tyler',         name:'Tyler, The Creator',cluster:'east', plays:891, hours:41 },
  { id:'lil-uzi',       name:'Lil Uzi Vert',      cluster:'east', plays:367, hours:14 },
  { id:'denzel',        name:'Denzel Curry',      cluster:'east', plays:284, hours:11 },

  // ATL / Dreamville  ───────────────────────
  { id:'jid',           name:'JID',               cluster:'atl',  plays:1089, hours:51, hero:true,
    top:[
      {title:'Surround Sound (ft. 21 Savage)', album:'The Forever Story', plays:92},
      {title:'NEVER',                          album:'DiCaprio 2',        plays:67},
      {title:'151 Rum',                        album:'DiCaprio 2',        plays:54},
      {title:'Off Deez (ft. J. Cole)',         album:'DiCaprio 2',        plays:48},
      {title:'Dance Now',                      album:'The Forever Story', plays:41},
    ],
    quote:'Spiked 340% the week The Forever Story dropped. Anchors your Atlanta cluster.',
  },
  { id:'jcole',     name:'J. Cole',         cluster:'atl', plays:1432, hours:69 },
  { id:'earthgang', name:'EarthGang',       cluster:'atl', plays:521, hours:21 },
  { id:'bas',       name:'Bas',             cluster:'atl', plays:289, hours:12 },
  { id:'ari',       name:'Ari Lennox',      cluster:'atl', plays:345, hours:15 },
  { id:'cozz',      name:'Cozz',            cluster:'atl', plays:142, hours:6 },

  // TDE / West  ─────────────────────────────
  { id:'kendrick',  name:'Kendrick Lamar',  cluster:'tde', plays:2103, hours:104, hero:true,
    top:[
      {title:'Money Trees (ft. Jay Rock)', album:'good kid, m.A.A.d city', plays:128},
      {title:'King Kunta',                 album:'To Pimp a Butterfly',    plays:103},
      {title:'HUMBLE.',                    album:'DAMN.',                  plays:97},
      {title:'N95',                        album:'Mr. Morale',             plays:86},
      {title:'Alright',                    album:'To Pimp a Butterfly',    plays:74},
    ],
    quote:'Your most-played artist of all time. Bridges TDE, Dreamville, and East via Baby Keem + Cole.',
  },
  { id:'sza',         name:'SZA',           cluster:'tde', plays:1567, hours:78 },
  { id:'schoolboy',   name:'ScHoolboy Q',   cluster:'tde', plays:478, hours:20 },
  { id:'jay-rock',    name:'Jay Rock',      cluster:'tde', plays:312, hours:13 },
  { id:'ab-soul',     name:'Ab-Soul',       cluster:'tde', plays:234, hours:10 },
  { id:'baby-keem',   name:'Baby Keem',     cluster:'tde', plays:723, hours:30 }, // bridge

  // OVO / Toronto  ──────────────────────────
  { id:'drake',     name:'Drake',           cluster:'ovo', plays:1876, hours:91, hero:true,
    top:[
      {title:'Passionfruit',            album:'More Life',           plays:112},
      {title:'Nice For What',           album:'Scorpion',            plays:88},
      {title:'Marvins Room',            album:'Take Care',           plays:79},
      {title:'One Dance (ft. WizKid)',  album:'Views',               plays:71},
      {title:'God\u2019s Plan',         album:'Scorpion',            plays:63},
    ],
    quote:'Steady through the year, no spikes. Your late-night driving cluster lives here.',
  },
  { id:'weeknd',  name:'The Weeknd',      cluster:'ovo', plays:1234, hours:62 },
  { id:'pnd',     name:'PARTYNEXTDOOR',   cluster:'ovo', plays:567, hours:25 },
  { id:'roy',     name:'Roy Woods',       cluster:'ovo', plays:198, hours:9 },
  { id:'dvsn',    name:'dvsn',            cluster:'ovo', plays:289, hours:13 },
  { id:'travis',  name:'Travis Scott',    cluster:'ovo', plays:945, hours:46 }, // bridge to east
];

// Edges encode co-listening strength (0..1). Cross-cluster bridges intentional.
const EDGES = [
  // east intra
  ['asap-rocky','asap-ferg',0.95],['asap-rocky','asap-mob',0.78],['asap-ferg','asap-mob',0.71],
  ['asap-rocky','playboi-carti',0.62],['asap-rocky','tyler',0.74],['tyler','playboi-carti',0.55],
  ['playboi-carti','lil-uzi',0.81],['lil-uzi','asap-ferg',0.42],['denzel','asap-rocky',0.58],
  ['denzel','tyler',0.49],
  // atl intra
  ['jid','jcole',0.92],['jid','earthgang',0.78],['jid','bas',0.65],['jcole','bas',0.71],
  ['earthgang','bas',0.66],['ari','jcole',0.58],['ari','jid',0.42],['cozz','jcole',0.61],
  ['cozz','bas',0.48],
  // tde intra
  ['kendrick','sza',0.84],['kendrick','schoolboy',0.79],['kendrick','jay-rock',0.74],
  ['kendrick','ab-soul',0.66],['kendrick','baby-keem',0.88],['schoolboy','jay-rock',0.68],
  ['schoolboy','ab-soul',0.58],['jay-rock','ab-soul',0.55],['sza','baby-keem',0.46],
  // ovo intra
  ['drake','weeknd',0.81],['drake','pnd',0.86],['drake','travis',0.72],
  ['weeknd','pnd',0.61],['weeknd','dvsn',0.52],['pnd','dvsn',0.59],['pnd','roy',0.64],
  ['dvsn','roy',0.55],
  // cross-cluster bridges
  ['jid','kendrick',0.72],     // ATL ↔ TDE
  ['kendrick','jcole',0.69],   // TDE ↔ ATL
  ['baby-keem','tyler',0.51],  // TDE ↔ East
  ['travis','asap-rocky',0.58],// OVO ↔ East
  ['travis','playboi-carti',0.49],
  ['drake','jcole',0.44],      // OVO ↔ ATL
  ['kendrick','drake',0.31],   // legend lol
  ['sza','drake',0.41],
  ['tyler','jid',0.46],
];

// ───────────────────────────────────────────────────────────────
// Simulation
// ───────────────────────────────────────────────────────────────

const canvas = document.getElementById('graph');
const ctx = canvas.getContext('2d');
let DPR = Math.max(1, window.devicePixelRatio || 1);
let W = 0, H = 0;

const state = {
  nodes: [],
  edges: [],
  hover: null,
  selected: null,
  dragging: null,
  pan:{x:0,y:0},
  zoom:1,
  labelMode:'all', // 'all' | 'hero'
  active: new Set(Object.keys(CLUSTERS)),
};

function size(){
  const rect = canvas.parentElement.getBoundingClientRect();
  W = rect.width; H = rect.height;
  canvas.width = W * DPR; canvas.height = H * DPR;
  canvas.style.width = W+'px'; canvas.style.height = H+'px';
  ctx.setTransform(DPR,0,0,DPR,0,0);
}
window.addEventListener('resize', ()=>{ size(); state.nodes.forEach(n=>{ n.r = radiusForPlays(n.plays) * (n.hero?1.35:1); }); seedPositions(false); });

function radiusForPlays(p){
  // log scale, hero artists get a floor; smaller on narrow viewports
  const small = Math.min(W||1200, H||800) < 700;
  const base = small ? 5 : 6;
  const max = small ? 20 : 26;
  return Math.max(7, Math.min(max, base + Math.sqrt(p)/4.4));
}

function seedPositions(reset=true){
  const cx = W/2, cy = H/2;
  // tighter cluster spread so nodes stay in central usable area
  const R = Math.min(W,H) * 0.22;
  // Pull cluster centers inward when viewport is narrow
  const sq = Math.min(W,H);
  const inset = sq < 700 ? 0.10 : 0;
  state.nodes.forEach((n)=>{
    if(!reset && n._seeded) return;
    const c = CLUSTERS[n.cluster];
    const a = Math.random()*Math.PI*2;
    const r = Math.random()*R*0.5;
    // adjust cluster center toward middle on small viewports
    const ccx = 0.5 + (c.x - 0.5) * (1 - inset);
    const ccy = 0.5 + (c.y - 0.5) * (1 - inset);
    n.x = (ccx*W) + Math.cos(a)*r;
    n.y = (ccy*H) + Math.sin(a)*r;
    n.vx = 0; n.vy = 0;
    n._seeded = true;
  });
}

function buildGraph(){
  state.nodes = ARTISTS.map(a => ({
    ...a,
    r: radiusForPlays(a.plays) * (a.hero?1.35:1),
    color: CLUSTERS[a.cluster].color,
  }));
  const byId = Object.fromEntries(state.nodes.map(n=>[n.id,n]));
  state.edges = EDGES.map(([a,b,w])=>({
    a:byId[a], b:byId[b], w,
    cross: byId[a].cluster !== byId[b].cluster,
  })).filter(e=>e.a && e.b);
}

// Verlet-ish force step
function step(){
  const damping = 0.85;
  const center = {x:W/2, y:H/2};

  // 1) cluster attractor (light, stronger on small viewports)
  const small = Math.min(W,H) < 700;
  const attractK = small ? 0.0028 : 0.0012;
  for(const n of state.nodes){
    const c = CLUSTERS[n.cluster];
    const inset = small ? 0.10 : 0;
    const tx = (0.5 + (c.x - 0.5)*(1-inset))*W;
    const ty = (0.5 + (c.y - 0.5)*(1-inset))*H;
    n.vx += (tx - n.x) * attractK;
    n.vy += (ty - n.y) * attractK;
  }
  // 2) edge springs
  for(const e of state.edges){
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
    const d = Math.hypot(dx,dy) || 0.001;
    const rest = e.cross ? 220 : 110 + (1-e.w)*60;
    const k = e.cross ? 0.0025 : 0.012 * (0.4 + e.w);
    const f = (d - rest) * k;
    const ux = dx/d, uy = dy/d;
    e.a.vx += ux*f; e.a.vy += uy*f;
    e.b.vx -= ux*f; e.b.vy -= uy*f;
  }
  // 3) repulsion (n^2 but n=24)
  const repulseBase = small ? 900 : 1800;
  for(let i=0;i<state.nodes.length;i++){
    const a = state.nodes[i];
    for(let j=i+1;j<state.nodes.length;j++){
      const b = state.nodes[j];
      const dx = b.x-a.x, dy = b.y-a.y;
      const d2 = dx*dx + dy*dy + 0.01;
      const d = Math.sqrt(d2);
      const minD = a.r + b.r + 8;
      const f = (repulseBase + (d<minD?900:0)) / d2;
      const ux = dx/d, uy = dy/d;
      a.vx -= ux*f; a.vy -= uy*f;
      b.vx += ux*f; b.vy += uy*f;
    }
  }
  // 4) center gravity (mild)
  for(const n of state.nodes){
    n.vx += (center.x - n.x) * 0.00015;
    n.vy += (center.y - n.y) * 0.00015;
  }
  // 5) integrate
  for(const n of state.nodes){
    if(state.dragging === n) continue;
    n.vx *= damping; n.vy *= damping;
    n.x += n.vx; n.y += n.vy;
    // keep inside viewport with soft border
    const pad = n.r + 30;
    if(n.x<pad){ n.x=pad; n.vx*=-0.4; }
    if(n.y<pad){ n.y=pad; n.vy*=-0.4; }
    if(n.x>W-pad){ n.x=W-pad; n.vx*=-0.4; }
    if(n.y>H-pad){ n.y=H-pad; n.vy*=-0.4; }
  }
}

// ───────────────────────────────────────────────────────────────
// Rendering
// ───────────────────────────────────────────────────────────────

function hexToRgba(hex, a){
  const h = hex.replace('#','');
  const r = parseInt(h.substr(0,2),16);
  const g = parseInt(h.substr(2,2),16);
  const b = parseInt(h.substr(4,2),16);
  return `rgba(${r},${g},${b},${a})`;
}

function neighborsOf(node){
  const s = new Set();
  for(const e of state.edges){
    if(e.a===node) s.add(e.b);
    if(e.b===node) s.add(e.a);
  }
  return s;
}

function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(state.pan.x, state.pan.y);
  ctx.scale(state.zoom, state.zoom);

  const focus = state.selected || state.hover;
  const neighbors = focus ? neighborsOf(focus) : null;

  // edges
  for(const e of state.edges){
    const aActive = state.active.has(e.a.cluster);
    const bActive = state.active.has(e.b.cluster);
    if(!aActive || !bActive) continue;

    let alpha = 0.10 + e.w * 0.22;
    let width = 0.5 + e.w * 1.1;
    let dim = false;
    if(focus){
      if(e.a===focus || e.b===focus){
        alpha = 0.55 + e.w * 0.35;
        width = 1.2 + e.w * 1.8;
      } else {
        dim = true; alpha = 0.04; width = 0.5;
      }
    }
    // gradient edge between two cluster colors
    const grad = ctx.createLinearGradient(e.a.x, e.a.y, e.b.x, e.b.y);
    grad.addColorStop(0, hexToRgba(e.a.color, alpha));
    grad.addColorStop(1, hexToRgba(e.b.color, alpha));
    ctx.strokeStyle = grad;
    ctx.lineWidth = width;
    if(e.cross && !dim){
      ctx.setLineDash([3,3]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.moveTo(e.a.x, e.a.y);
    ctx.lineTo(e.b.x, e.b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // nodes
  for(const n of state.nodes){
    const active = state.active.has(n.cluster);
    let dim = !active;
    if(focus && active && n !== focus && !neighbors.has(n)) dim = true;

    const a = dim ? 0.22 : 1;

    // glow
    const glowR = n.r + (focus===n ? 18 : 9);
    const g = ctx.createRadialGradient(n.x, n.y, n.r*0.4, n.x, n.y, glowR);
    g.addColorStop(0, hexToRgba(n.color, 0.55 * a));
    g.addColorStop(1, hexToRgba(n.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(n.x, n.y, glowR, 0, Math.PI*2);
    ctx.fill();

    // core
    ctx.fillStyle = hexToRgba(n.color, a);
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI*2);
    ctx.fill();

    // inner shading
    const inner = ctx.createRadialGradient(n.x - n.r*0.3, n.y - n.r*0.4, 0, n.x, n.y, n.r);
    inner.addColorStop(0, `rgba(255,255,255,${0.35*a})`);
    inner.addColorStop(0.6, `rgba(255,255,255,0)`);
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.r, 0, Math.PI*2);
    ctx.fill();

    // ring on selected
    if(focus === n){
      ctx.strokeStyle = hexToRgba(n.color, 0.85);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 6, 0, Math.PI*2);
      ctx.stroke();
      // outer faint
      ctx.strokeStyle = hexToRgba(n.color, 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 12, 0, Math.PI*2);
      ctx.stroke();
    }

    // label
    const showLabel = state.labelMode==='all' ? (!dim) : (n.hero || focus===n);
    if(showLabel){
      const fontSize = n.hero ? 13 : 11;
      ctx.font = `${n.hero?'600':'500'} ${fontSize}px "DM Sans", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const label = n.name;
      const ly = n.y + n.r + 7;
      // subtle text bg
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = `rgba(10,10,13,${0.5*a})`;
      ctx.fillRect(n.x - tw/2 - 5, ly - 1, tw + 10, fontSize + 4);
      ctx.fillStyle = `rgba(244,237,227,${0.95*a})`;
      ctx.fillText(label, n.x, ly);
    }
  }

  ctx.restore();
}

let lastT = 0;
function tick(t){
  const dt = t - lastT; lastT = t;
  step();
  draw();
  requestAnimationFrame(tick);
}

// ───────────────────────────────────────────────────────────────
// Pointer interactions
// ───────────────────────────────────────────────────────────────

function nodeAt(x,y){
  for(let i=state.nodes.length-1;i>=0;i--){
    const n = state.nodes[i];
    const dx = x-n.x, dy = y-n.y;
    if(dx*dx+dy*dy <= (n.r+4)*(n.r+4) && state.active.has(n.cluster)) return n;
  }
  return null;
}

const tip = document.getElementById('tip');
canvas.addEventListener('mousemove', (e)=>{
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if(state.dragging){
    state.dragging.x = x; state.dragging.y = y;
    state.dragging.vx = 0; state.dragging.vy = 0;
    return;
  }
  const n = nodeAt(x,y);
  state.hover = n;
  canvas.style.cursor = n ? 'pointer' : 'grab';

  if(n){
    tip.classList.add('on');
    tip.style.left = (x) + 'px';
    tip.style.top = (y) + 'px';
    tip.querySelector('.t-name').textContent = n.name;
    tip.querySelector('.t-meta').textContent = `${n.plays.toLocaleString()} plays · ${n.hours}h · ${CLUSTERS[n.cluster].label}`;
  } else {
    tip.classList.remove('on');
  }
});

canvas.addEventListener('mousedown', (e)=>{
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const n = nodeAt(x,y);
  if(n){
    state.dragging = n;
    canvas.classList.add('dragging');
  }
});
window.addEventListener('mouseup', (e)=>{
  if(state.dragging){
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const dx = x-state.dragging.x, dy = y-state.dragging.y;
    // click if minimal drag
    if(dx*dx+dy*dy < 12){
      select(state.dragging);
    }
  }
  state.dragging = null;
  canvas.classList.remove('dragging');
});
canvas.addEventListener('mouseleave', ()=>{
  state.hover = null;
  tip.classList.remove('on');
});
canvas.addEventListener('click', (e)=>{
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const n = nodeAt(x,y);
  if(n) select(n);
});

// Controls
document.getElementById('btn-zoom-in').onclick  = ()=>{ state.zoom = Math.min(2, state.zoom*1.15); };
document.getElementById('btn-zoom-out').onclick = ()=>{ state.zoom = Math.max(0.5, state.zoom/1.15); };
document.getElementById('btn-zoom-reset').onclick = ()=>{ state.zoom = 1; state.pan = {x:0,y:0}; };
document.getElementById('btn-labels').onclick = (e)=>{
  state.labelMode = state.labelMode==='all' ? 'hero' : 'all';
  e.currentTarget.classList.toggle('active', state.labelMode==='hero');
};
document.getElementById('btn-play').onclick = ()=>{
  // re-jitter velocities and re-seed positions to re-simulate
  state.nodes.forEach(n=>{ n._seeded=false; });
  seedPositions(true);
};

// ───────────────────────────────────────────────────────────────
// Legend
// ───────────────────────────────────────────────────────────────

function renderLegend(){
  const counts = {};
  state.nodes.forEach(n=>{ counts[n.cluster]=(counts[n.cluster]||0)+1; });
  const el = document.getElementById('legend');
  el.innerHTML = '<h4>Clusters</h4>' + Object.values(CLUSTERS).map(c=>`
    <div class="legend-row" data-cluster="${c.id}" style="color:${c.color}">
      <span class="legend-dot" style="background:${c.color}"></span>
      <span style="color:var(--paper-dim)">${c.label}</span>
      <span class="legend-count">${counts[c.id]||0}</span>
    </div>
  `).join('');
  el.querySelectorAll('.legend-row').forEach(row=>{
    row.addEventListener('click', ()=>{
      const id = row.dataset.cluster;
      if(state.active.has(id)) state.active.delete(id);
      else state.active.add(id);
      row.classList.toggle('muted', !state.active.has(id));
    });
  });
}

// ───────────────────────────────────────────────────────────────
// Right rail (selected artist detail)
// ───────────────────────────────────────────────────────────────

function spark(values, color){
  // generate a slightly noisy 26-week trend line
  const w = 308, h = 42, pad = 4;
  const max = Math.max(...values), min = Math.min(...values);
  const xs = values.map((_,i)=> pad + (i/(values.length-1)) * (w - pad*2));
  const ys = values.map(v => pad + (1 - (v-min)/(max-min || 1)) * (h - pad*2));
  const d = xs.map((x,i)=> (i?'L':'M') + x.toFixed(1) + ' ' + ys[i].toFixed(1)).join(' ');
  const dArea = d + ` L ${xs[xs.length-1].toFixed(1)} ${h} L ${xs[0].toFixed(1)} ${h} Z`;
  return `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${dArea}" fill="url(#sg)"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${xs[xs.length-1]}" cy="${ys[ys.length-1]}" r="2.5" fill="${color}"/>
    </svg>`;
}

function generateTrend(seed, peak){
  // pseudo-random but stable per-seed
  let s = seed;
  const r = ()=>{ s = (s*9301 + 49297) % 233280; return s/233280; };
  const out = [];
  const len = 26;
  for(let i=0;i<len;i++){
    const x = i / (len-1);
    const bell = Math.exp(-Math.pow((x - peak)*2.4, 2)) * 1;
    const noise = (r() - 0.5) * 0.3;
    out.push(Math.max(0.05, 0.25 + bell + noise));
  }
  return out;
}

function topNeighbors(node, n=6){
  const arr = [];
  for(const e of state.edges){
    if(e.a===node) arr.push({other:e.b, w:e.w});
    else if(e.b===node) arr.push({other:e.a, w:e.w});
  }
  return arr.sort((a,b)=>b.w-a.w).slice(0,n);
}

function renderRail(node){
  const c = CLUSTERS[node.cluster];
  const accent = c.color;
  const top = node.top || [];
  const trend = generateTrend(node.plays + node.name.length, node.hero?0.7:0.5);
  const peakWeek = trend.indexOf(Math.max(...trend));
  const weeksAgo = trend.length - 1 - peakWeek;
  const neigh = topNeighbors(node);

  const sharePct = ((node.plays / 14302) * 100).toFixed(1);

  const rail = document.getElementById('rail');
  rail.style.setProperty('--accent', accent);
  rail.innerHTML = `
    <div class="detail" style="--accent:${accent}">
      <div class="detail-eye">
        Now selected · ${node.hero ? 'Anchor artist' : 'Satellite'}
      </div>
      <div class="detail-name">${node.name}</div>
      <div class="detail-cluster">
        <span>${c.label}</span>
        <span class="sep">·</span>
        <span style="font-family:var(--mono); font-size:10.5px; color:var(--paper-mute)">${sharePct}% of all plays</span>
      </div>

      <div class="detail-bars">
        <div class="bar-stat">
          <div class="l">Plays</div>
          <div class="v">${node.plays.toLocaleString()}</div>
        </div>
        <div class="bar-stat">
          <div class="l">Hours</div>
          <div class="v">${node.hours}<span class="u">h</span></div>
        </div>
        <div class="bar-stat">
          <div class="l">Edges</div>
          <div class="v">${neigh.length}</div>
        </div>
      </div>

      <div class="sparkbox">
        <div class="sparkbox-h">
          <span class="l">Last 26 weeks</span>
          <span class="r">peak ${weeksAgo===0?'this week':weeksAgo+'w ago'}</span>
        </div>
        ${spark(trend, accent)}
      </div>
    </div>

    ${top.length ? `
    <section class="section">
      <h3>Top tracks <a href="#">View all</a></h3>
      ${top.map((t,i)=>`
        <div class="track">
          <div class="track-n">${String(i+1).padStart(2,'0')}</div>
          <div class="track-info">
            <div class="track-title">${t.title}</div>
            <div class="track-sub">${t.album}</div>
          </div>
          <div class="track-plays">${t.plays}</div>
        </div>
      `).join('')}
    </section>` : ''}

    <section class="section">
      <h3>Co-listened with <a href="#">${neigh.length} total</a></h3>
      ${neigh.map(({other,w})=>`
        <div class="neighbor" data-node="${other.id}" style="color:${other.color}">
          <span class="neighbor-name">${other.name}</span>
          <span class="neighbor-strength"><i style="width:${(w*100).toFixed(0)}%"></i></span>
          <span class="neighbor-score">${Math.round(w*100)}%</span>
        </div>
      `).join('')}
    </section>

  `;

  // wire neighbor clicks
  rail.querySelectorAll('.neighbor').forEach(el=>{
    el.addEventListener('click', ()=>{
      const id = el.dataset.node;
      const n = state.nodes.find(x=>x.id===id);
      if(n) select(n);
    });
  });
}

function select(node){
  state.selected = node;
  renderRail(node);
}

// ───────────────────────────────────────────────────────────────
// Boot
// ───────────────────────────────────────────────────────────────

buildGraph();
size();
// re-compute radii now that W/H are known
state.nodes.forEach(n=>{ n.r = radiusForPlays(n.plays) * (n.hero?1.35:1); });
seedPositions(true);
renderLegend();

// default selection — Kendrick (your most-played)
const def = state.nodes.find(n=>n.id==='kendrick');
select(def);

requestAnimationFrame(tick);
