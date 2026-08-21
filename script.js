/* ===================== BITÁCORA DE STREAMER ===================== */
/* Almacenamiento: localStorage. Todo el registro es manual (excepto los
   cronómetros de Live, que corren automáticamente). */

const SALSA_CUTOFF_HOUR = 18; // 6:00 PM hora local del dispositivo
const LS_KEYS = {
  config: 'bit_config_v2',
  sessions: 'bit_sessions_v2',
  matches: 'bit_matches_v2',
  monetization: 'bit_monetization_v2',
  lives: 'bit_lives_v2',
  breaks: 'bit_breaks_v2',
  goals: 'bit_goals_v2'
};

const DEFAULT_CONFIG = {
  coinsPerUSD: 650,
  formula: 'prod_eff',
  minEffectiveSeconds: 18,
  goalsDefault: { usd: 30, coins: 0, matches: 0, effective: 0, productive: 0, hours: 0 }
};

const BREAK_TYPES = [
  { type:'bano', label:'Ir al baño', icon:'🚻' },
  { type:'ropa', label:'Cambio de ropa', icon:'👗' },
  { type:'comer', label:'Comer', icon:'🍽️' },
  { type:'lactancia', label:'Lactancia', icon:'🍼' },
  { type:'cocinar', label:'Cocinar', icon:'🍳' },
  { type:'break', label:'Break', icon:'☕' }
];

const REGALO_SUBTYPES_PUBLIC = [
  { value:'simple', label:'Regalo simple' },
  { value:'sticker', label:'Sticker' },
  { value:'ruleta', label:'Ruleta' }
];
const REGALO_SUBTYPES_PREMIUM = [
  { value:'simple', label:'Regalo simple' },
  { value:'entrada', label:'Entrada' },
  { value:'sticker', label:'Sticker' },
  { value:'ruleta', label:'Ruleta' },
  { value:'tip_menu', label:'Tip menú' }
];

/* ---------- storage helpers ---------- */
function load(key, fallback){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return fallback;
    return JSON.parse(raw);
  }catch(e){ return fallback; }
}
function save(key, value){ localStorage.setItem(key, JSON.stringify(value)); }

let CONFIG = Object.assign({}, DEFAULT_CONFIG, load(LS_KEYS.config, {}));
let sessions = load(LS_KEYS.sessions, []);
let matches = load(LS_KEYS.matches, []);
let monetization = load(LS_KEYS.monetization, []);
let lives = load(LS_KEYS.lives, []);
let breaks = load(LS_KEYS.breaks, []);
let goals = load(LS_KEYS.goals, {}); // keyed by salsaDay

function persistAll(){
  save(LS_KEYS.config, CONFIG);
  save(LS_KEYS.sessions, sessions);
  save(LS_KEYS.matches, matches);
  save(LS_KEYS.monetization, monetization);
  save(LS_KEYS.lives, lives);
  save(LS_KEYS.breaks, breaks);
  save(LS_KEYS.goals, goals);
}

function uid(){ return (crypto.randomUUID ? crypto.randomUUID() : 'id-'+Date.now()+'-'+Math.random().toString(16).slice(2)); }

/* ---------- date / salsa day helpers ---------- */
function pad(n){ return String(n).padStart(2,'0'); }
function fmtDateLocal(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }

function getSalsaDay(date){
  const d = new Date(date);
  if(d.getHours() >= SALSA_CUTOFF_HOUR){
    d.setDate(d.getDate()+1);
  }
  return fmtDateLocal(d);
}

function nextCutoff(now){
  const n = new Date(now);
  const todayCutoff = new Date(n.getFullYear(), n.getMonth(), n.getDate(), SALSA_CUTOFF_HOUR,0,0,0);
  if(n >= todayCutoff){
    todayCutoff.setDate(todayCutoff.getDate()+1);
  }
  return todayCutoff;
}

function fmtDayLabel(salsaDay){
  const [y,m,d] = salsaDay.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  const days=['dom','lun','mar','mié','jué','vie','sáb'];
  const months=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return `${days[dt.getDay()]} ${d} ${months[m-1]}`;
}

function fmtHMS(ms){
  if(ms<0) ms=0;
  const s = Math.floor(ms/1000);
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
function fmtHM(ms){
  if(ms<0) ms=0;
  const totalMin = Math.floor(ms/60000);
  const h = Math.floor(totalMin/60);
  const m = totalMin%60;
  return h>0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtUSD(v){ return '$'+(Math.round(v*100)/100).toFixed(2); }
function fmtSec(ms){
  if(ms==null) return '—';
  const s = Math.round(ms/1000);
  if(s<60) return s+'s';
  return Math.floor(s/60)+'m '+(s%60)+'s';
}

/* ---------- current session state ---------- */
function activeSession(){
  return sessions.find(s => s.status==='active') || null;
}
function currentSalsaDay(){
  const s = activeSession();
  return s ? s.salsaDay : getSalsaDay(new Date());
}
function openMatchOf(s){
  if(!s || !s.openMatchId) return null;
  return matches.find(m=>m.id===s.openMatchId) || null;
}
function activeLiveOf(s){
  if(!s || !s.activeLiveId) return null;
  return lives.find(l=>l.id===s.activeLiveId) || null;
}
function activeBreakOf(s){
  if(!s) return null;
  return breaks.find(b=>b.sessionId===s.id && !b.endedAt) || null;
}

/* ---------- CRUD: jornada ---------- */
function startShift(){
  if(activeSession()) return null;
  const now = new Date();
  const s = { id: uid(), salsaDay: getSalsaDay(now), start: now.toISOString(), end: null,
    status: 'active', zone: 'match', openMatchId: null, activeLiveId: null };
  sessions.push(s);
  if(!goals[s.salsaDay]) goals[s.salsaDay] = Object.assign({}, CONFIG.goalsDefault);
  persistAll();
  return s;
}
function endShift(){
  const s = activeSession();
  if(!s) return;
  const now = new Date();
  const b = activeBreakOf(s);
  if(b) b.endedAt = now.toISOString();
  const l = activeLiveOf(s);
  if(l) l.endedAt = now.toISOString();
  s.activeLiveId = null;
  s.status = 'ended';
  s.end = now.toISOString();
  persistAll();
}
function setZone(zone){
  const s = activeSession();
  if(!s) return;
  s.zone = zone;
  persistAll();
}

/* ---------- CRUD: match ---------- */
function startMatch(){
  const s = activeSession();
  if(!s){ toast('Primero inicia tu jornada'); return null; }
  const now = new Date();
  const m = { id: uid(), sessionId: s.id, salsaDay: s.salsaDay,
    startedAt: now.toISOString(), effectiveAt: null, productiveAt: null,
    productiveSource: null, productiveSubtype: null, status: 'iniciado' };
  matches.push(m);
  s.openMatchId = m.id;
  persistAll();
  return m;
}
function setMatchEffective(){
  const s = activeSession();
  const m = openMatchOf(s);
  if(!m || m.status!=='iniciado') return;
  m.effectiveAt = new Date().toISOString();
  m.status = 'efectivo';
  persistAll();
}
function setMatchProductive(source, subtype, coins){
  const s = activeSession();
  const m = openMatchOf(s);
  if(!m || m.status==='productivo') return;
  const now = new Date();
  if(!m.effectiveAt){ m.effectiveAt = now.toISOString(); m.status='efectivo'; }
  m.productiveAt = now.toISOString();
  m.status = 'productivo';
  m.productiveSource = source || null;
  m.productiveSubtype = subtype || null;
  if(coins>0){
    addMonetization({ category:'match', type: source||'otro', subtype: subtype||null, coins, matchId: m.id });
  }
  s.openMatchId = null;
  persistAll();
}

/* ---------- CRUD: monetización ---------- */
function addMonetization(opts){
  const s = activeSession();
  const now = new Date();
  const salsaDay = s ? s.salsaDay : getSalsaDay(now);
  const coins = opts.coins||0;
  const usd = coins / CONFIG.coinsPerUSD;
  const rec = { id: uid(), sessionId: s?s.id:null, salsaDay, timestamp: now.toISOString(),
    category: opts.category, type: opts.type, subtype: opts.subtype||null,
    seconds: opts.seconds||null, coins, usd, matchId: opts.matchId||null, liveId: opts.liveId||null };
  monetization.push(rec);
  persistAll();
  return rec;
}
function addStandaloneCall(seconds, coins){
  const now = new Date();
  const salsaDay = getSalsaDay(now);
  const usd = coins / CONFIG.coinsPerUSD;
  monetization.push({ id: uid(), sessionId: null, salsaDay, timestamp: now.toISOString(),
    category:'standalone', type:'llamada_privada', subtype:null, seconds: seconds||null,
    coins, usd, matchId:null, liveId:null });
  persistAll();
}
function tariffCoins(type, seconds){
  if(seconds==null || isNaN(seconds)) return null;
  if(seconds < 20) return 0;
  if(seconds < 60) return 60;
  return type==='llamada_privada' ? 120 : 60;
}

/* ---------- CRUD: live ---------- */
function startLive(type, entryCoins){
  const s = activeSession();
  if(!s){ toast('Primero inicia tu jornada'); return null; }
  const now = new Date();
  const l = { id: uid(), sessionId: s.id, salsaDay: s.salsaDay, type,
    startedAt: now.toISOString(), endedAt: null, entryCoins: entryCoins||0 };
  lives.push(l);
  s.activeLiveId = l.id;
  persistAll();
  if(type==='premium' && entryCoins>0){
    addMonetization({ category:'live_premium', type:'regalo', subtype:'entrada', coins: entryCoins, liveId: l.id });
  }
  return l;
}
function switchLive(newType, entryCoins){
  const s = activeSession();
  if(!s) return;
  const cur = activeLiveOf(s);
  if(cur){ cur.endedAt = new Date().toISOString(); }
  s.activeLiveId = null;
  persistAll();
  startLive(newType, entryCoins);
}
function endLive(){
  const s = activeSession();
  const l = activeLiveOf(s);
  if(!l) return;
  l.endedAt = new Date().toISOString();
  s.activeLiveId = null;
  persistAll();
}
function addLiveEvent(kind, subtype, coins, seconds){
  const s = activeSession();
  const l = activeLiveOf(s);
  if(!l) return;
  const category = l.type==='premium' ? 'live_premium' : 'live_publico';
  addMonetization({ category, type:kind, subtype: subtype||null, coins, seconds: seconds||null, liveId: l.id });
}
function liveCoinsTotal(liveId){
  return monetization.filter(m=>m.liveId===liveId).reduce((a,m)=>a+m.coins,0);
}
function liveUsdTotal(liveId){
  return monetization.filter(m=>m.liveId===liveId).reduce((a,m)=>a+m.usd,0);
}

/* ---------- CRUD: breaks ---------- */
function startBreak(type, label){
  const s = activeSession();
  if(!s){ toast('Primero inicia tu jornada'); return; }
  if(activeBreakOf(s)){ return; }
  const now = new Date();
  breaks.push({ id: uid(), sessionId: s.id, salsaDay: s.salsaDay, type, label,
    startedAt: now.toISOString(), endedAt: null });
  persistAll();
}
function endActiveBreak(){
  const s = activeSession();
  const b = activeBreakOf(s);
  if(!b) return;
  b.endedAt = new Date().toISOString();
  persistAll();
}

/* ---------- delete ---------- */
function deleteEvent(kind, id){
  if(kind==='match'){
    matches = matches.filter(m=>m.id!==id);
    sessions.forEach(s=>{ if(s.openMatchId===id) s.openMatchId=null; });
    monetization = monetization.filter(m=>m.matchId!==id || true); // keep monetization but unlink
    monetization.forEach(m=>{ if(m.matchId===id) m.matchId=null; });
  }
  if(kind==='mon') monetization = monetization.filter(m=>m.id!==id);
  if(kind==='live'){
    lives = lives.filter(l=>l.id!==id);
    sessions.forEach(s=>{ if(s.activeLiveId===id) s.activeLiveId=null; });
    monetization.forEach(m=>{ if(m.liveId===id) m.liveId=null; });
  }
  if(kind==='break') breaks = breaks.filter(b=>b.id!==id);
  persistAll();
}

/* ---------- day-scoped collections ---------- */
function dayMatches(salsaDay){ return matches.filter(m=>m.salsaDay===salsaDay); }
function dayMon(salsaDay){ return monetization.filter(m=>m.salsaDay===salsaDay); }
function dayLives(salsaDay){ return lives.filter(l=>l.salsaDay===salsaDay); }
function daySessions(salsaDay){ return sessions.filter(s=>s.salsaDay===salsaDay); }
function dayBreaks(salsaDay){ return breaks.filter(b=>b.salsaDay===salsaDay); }

/* ---------- stats computation ---------- */
function conversionOf(effective, productive, initiated){
  const denom = CONFIG.formula==='prod_init' ? initiated : effective;
  if(!denom) return 0;
  return (productive/denom)*100;
}

function avgMs(list){
  if(list.length===0) return null;
  return list.reduce((a,b)=>a+b,0)/list.length;
}

function computeDayStats(salsaDay){
  const dm = dayMatches(salsaDay);
  const initiated = dm.length; // cada Match es UN registro; no se suman por separado
  const effective = dm.filter(m=>m.effectiveAt).length;
  const productive = dm.filter(m=>m.productiveAt).length;
  const timesToEffective = dm.filter(m=>m.effectiveAt).map(m=> new Date(m.effectiveAt)-new Date(m.startedAt));
  const timesToProductive = dm.filter(m=>m.productiveAt).map(m=> new Date(m.productiveAt)-new Date(m.startedAt));

  const mon = dayMon(salsaDay);
  const coins = mon.reduce((a,m)=>a+m.coins,0);
  const usd = mon.reduce((a,m)=>a+m.usd,0);
  const worked = workedMsForDay(salsaDay);
  const hours = worked/3600000;

  return {
    salsaDay, initiated, effective, productive,
    convEffective: initiated? (effective/initiated*100) : 0,
    convProductiveFromEffective: effective? (productive/effective*100) : 0,
    convProductiveFromInitiated: initiated? (productive/initiated*100) : 0,
    conversion: conversionOf(effective, productive, initiated),
    avgTimeToEffective: avgMs(timesToEffective),
    avgTimeToProductive: avgMs(timesToProductive),
    coins, usd, hours,
    usdPerHour: hours>0 ? usd/hours : 0,
    coinsPerHour: hours>0 ? coins/hours : 0,
    lives: dayLives(salsaDay),
    breaks: dayBreaks(salsaDay)
  };
}

function workedMsForDay(salsaDay){
  let total=0;
  daySessions(salsaDay).forEach(s=>{
    const start = new Date(s.start);
    const end = s.end ? new Date(s.end) : new Date();
    let ms = end - start;
    breaks.filter(b=>b.sessionId===s.id).forEach(b=>{
      const bs = new Date(b.startedAt);
      const be = b.endedAt ? new Date(b.endedAt) : new Date();
      ms -= (be-bs);
    });
    total += Math.max(0, ms);
  });
  return total;
}
function breakMsForDay(salsaDay){
  let total=0;
  daySessions(salsaDay).forEach(s=>{
    breaks.filter(b=>b.sessionId===s.id).forEach(b=>{
      const bs=new Date(b.startedAt);
      const be=b.endedAt?new Date(b.endedAt):new Date();
      total += Math.max(0, be-bs);
    });
  });
  return total;
}

function allSalsaDays(){
  const set = new Set();
  matches.forEach(m=>set.add(m.salsaDay));
  monetization.forEach(m=>set.add(m.salsaDay));
  lives.forEach(l=>set.add(l.salsaDay));
  breaks.forEach(b=>set.add(b.salsaDay));
  sessions.forEach(s=>set.add(s.salsaDay));
  return Array.from(set).sort();
}

function hourOfEvent(iso){ return new Date(iso).getHours(); }

function computeHourlyForDay(salsaDay){
  const hours = {};
  for(let h=0; h<24; h++) hours[h] = {usd:0, matches:0, effective:0, productive:0, coins:0};
  dayMatches(salsaDay).forEach(m=>{
    const h = hourOfEvent(m.startedAt);
    hours[h].matches++;
    if(m.effectiveAt) hours[hourOfEvent(m.effectiveAt)].effective++;
    if(m.productiveAt) hours[hourOfEvent(m.productiveAt)].productive++;
  });
  dayMon(salsaDay).forEach(m=>{
    const h = hourOfEvent(m.timestamp);
    hours[h].usd += m.usd;
    hours[h].coins += m.coins;
  });
  return hours;
}

function historicalHourAverages(excludeSalsaDay){
  const sums = {}; const counts = {};
  for(let h=0;h<24;h++){ sums[h]=0; counts[h]=0; }
  const days = allSalsaDays().filter(d=>d!==excludeSalsaDay);
  days.forEach(d=>{
    const h = computeHourlyForDay(d);
    for(let hr=0;hr<24;hr++){
      if(h[hr].usd>0 || h[hr].matches>0){
        sums[hr]+=h[hr].usd; counts[hr]+=1;
      }
    }
  });
  const avg={};
  for(let h=0;h<24;h++){ avg[h] = counts[h]>0 ? sums[h]/counts[h] : null; }
  return {avg, counts};
}

/* ---------- records & comparisons ---------- */
function computeRecords(){
  const days = allSalsaDays();
  if(days.length===0) return null;
  const stats = days.map(computeDayStats);
  const byUSD = [...stats].sort((a,b)=>b.usd-a.usd);
  const byUSDPerHour = [...stats].filter(s=>s.hours>0.05).sort((a,b)=>b.usdPerHour-a.usdPerHour);
  const byConversion = [...stats].filter(s=>s.effective>0).sort((a,b)=>b.conversion-a.conversion);
  const byMatches = [...stats].sort((a,b)=>b.initiated-a.initiated);
  const byEffective = [...stats].sort((a,b)=>b.effective-a.effective);
  const byProductive = [...stats].sort((a,b)=>b.productive-a.productive);
  const byCoins = [...stats].sort((a,b)=>b.coins-a.coins);

  const {avg} = historicalHourAverages(null);
  let bestHour=null, worstHour=null;
  for(let h=0;h<24;h++){
    if(avg[h]===null) continue;
    if(bestHour===null || avg[h]>avg[bestHour]) bestHour=h;
    if(worstHour===null || avg[h]<avg[worstHour]) worstHour=h;
  }

  return {
    stats,
    bestDay: byUSD[0],
    bestUSDPerHour: byUSDPerHour[0]||null,
    bestConversion: byConversion[0]||null,
    mostMatches: byMatches[0],
    mostEffective: byEffective[0],
    mostProductive: byProductive[0],
    mostCoins: byCoins[0],
    bestHour, worstHour, hourAvg: avg
  };
}

function isoWeekKey(salsaDay){
  const [y,m,d] = salsaDay.split('-').map(Number);
  const dt = new Date(y,m-1,d);
  const target = new Date(dt.valueOf());
  const dayNr = (dt.getDay()+6)%7;
  target.setDate(target.getDate()-dayNr+3);
  const firstThursday = new Date(target.getFullYear(),0,4);
  const week = 1 + Math.round(((target-firstThursday)/86400000 - 3 + ((firstThursday.getDay()+6)%7))/7);
  return target.getFullYear()+'-W'+pad(week);
}
function monthKey(salsaDay){ return salsaDay.slice(0,7); }

function computeComparisons(){
  const days = allSalsaDays();
  if(days.length===0) return null;
  const today = getSalsaDay(new Date());
  const stats = days.map(computeDayStats);
  const todayStat = stats.find(s=>s.salsaDay===today) || computeDayStats(today);
  const avgUSD = stats.reduce((a,s)=>a+s.usd,0)/stats.length;
  const bestDayUSD = Math.max(...stats.map(s=>s.usd));

  const curWeek = isoWeekKey(today);
  const weeks = {};
  stats.forEach(s=>{ const k=isoWeekKey(s.salsaDay); weeks[k]=(weeks[k]||0)+s.usd; });
  const weekKeys = Object.keys(weeks).sort();
  const curWeekIdx = weekKeys.indexOf(curWeek);
  const prevWeekUSD = curWeekIdx>0 ? weeks[weekKeys[curWeekIdx-1]] : null;
  const curWeekUSD = weeks[curWeek]||0;

  const curMonth = monthKey(today);
  const months = {};
  stats.forEach(s=>{ const k=monthKey(s.salsaDay); months[k]=(months[k]||0)+s.usd; });
  const monthKeys = Object.keys(months).sort();
  const curMonthIdx = monthKeys.indexOf(curMonth);
  const prevMonthUSD = curMonthIdx>0 ? months[monthKeys[curMonthIdx-1]] : null;
  const curMonthUSD = months[curMonth]||0;

  return { todayStat, avgUSD, bestDayUSD, curWeekUSD, prevWeekUSD, curMonthUSD, prevMonthUSD };
}

function pearson(xs, ys){
  const n = xs.length;
  if(n<3) return null;
  const mx = xs.reduce((a,b)=>a+b,0)/n;
  const my = ys.reduce((a,b)=>a+b,0)/n;
  let num=0, dx2=0, dy2=0;
  for(let i=0;i<n;i++){
    const dx=xs[i]-mx, dy=ys[i]-my;
    num+=dx*dy; dx2+=dx*dx; dy2+=dy*dy;
  }
  if(dx2===0||dy2===0) return null;
  return num/Math.sqrt(dx2*dy2);
}

function computePatterns(){
  const days = allSalsaDays();
  if(days.length < 7) return null;
  const stats = days.map(computeDayStats);
  const rec = computeRecords();
  const notes = [];

  if(rec.bestHour!==null && rec.hourAvg[rec.bestHour]>0){
    notes.push(`Se observa una asociación entre la hora ${pad(rec.bestHour)}:00 y mayores ingresos promedio (${fmtUSD(rec.hourAvg[rec.bestHour])}/hora en esa franja).`);
  }
  if(rec.worstHour!==null && rec.bestHour!==rec.worstHour){
    notes.push(`Tus datos muestran una tendencia a rendir menos alrededor de las ${pad(rec.worstHour)}:00.`);
  }

  const pub = lives.filter(l=>l.type==='publico');
  const prem = lives.filter(l=>l.type==='premium');
  if(pub.length>=2 && prem.length>=2){
    const pubAvg = pub.reduce((a,l)=>a+liveUsdTotal(l.id),0)/pub.length;
    const premAvg = prem.reduce((a,l)=>a+liveUsdTotal(l.id),0)/prem.length;
    if(pubAvg>premAvg*1.15) notes.push(`Este horario parece rendirte mejor en Live público que en Premium (promedio ${fmtUSD(pubAvg)} vs ${fmtUSD(premAvg)} por sesión).`);
    else if(premAvg>pubAvg*1.15) notes.push(`Tus sesiones de Live Premium muestran una tendencia a generar más ingreso promedio que las públicas (${fmtUSD(premAvg)} vs ${fmtUSD(pubAvg)}).`);
  }

  const xs = stats.map(s=>s.initiated);
  const ys = stats.map(s=>s.usd);
  const corr = pearson(xs, ys);
  if(corr!==null){
    if(corr>0.4) notes.push(`Se observa una asociación positiva entre la cantidad de matches y tus ingresos del día (correlación ≈ ${corr.toFixed(2)}). No implica causalidad directa.`);
    else if(corr<-0.4) notes.push(`Curiosamente, tus datos muestran una asociación negativa entre cantidad de matches e ingresos (correlación ≈ ${corr.toFixed(2)}) — vale la pena revisar si matches de baja calidad están restando tiempo.`);
  }

  const xs2 = stats.map(s=>s.hours);
  const corr2 = pearson(xs2, ys);
  if(corr2!==null && xs2.some(v=>v>0)){
    if(corr2>0.4) notes.push(`Se observa una asociación entre más horas trabajadas y mayores ingresos (correlación ≈ ${corr2.toFixed(2)}).`);
  }

  return notes;
}

function currentStats(){
  const day = currentSalsaDay();
  return computeDayStats(day);
}

/* ============================================================
   RENDER
   ============================================================ */
function drawCutoffRing(pctRemaining){
  const canvas = document.getElementById('cutoffCanvas');
  const ctx = canvas.getContext('2d');
  const cx=28, cy=28, r=24;
  ctx.clearRect(0,0,56,56);
  ctx.lineWidth=4;
  ctx.strokeStyle = '#232B40';
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
  ctx.strokeStyle = '#FF3D77';
  ctx.lineCap='round';
  const frac = Math.max(0, Math.min(1, pctRemaining));
  ctx.beginPath();
  ctx.arc(cx,cy,r, -Math.PI/2, -Math.PI/2 + frac*Math.PI*2);
  ctx.stroke();
}
function renderHeader(){
  const now = new Date();
  const day = currentSalsaDay();
  document.getElementById('salsaDayLabel').textContent = 'Día Salsa · '+fmtDayLabel(day);
  const cutoff = nextCutoff(now);
  const diff = cutoff - now;
  const totalWindow = 24*3600000;
  const remaining = diff/totalWindow;
  drawCutoffRing(remaining);
  const h = Math.floor(diff/3600000);
  const m = Math.floor((diff%3600000)/60000);
  document.getElementById('cutoffLabel').textContent = `${h}h ${m}m`;
  document.getElementById('cutoffCountdown').textContent = `Corte en ${h}h ${m}m`;

  const s = activeSession();
  const dot = document.getElementById('liveDot');
  const stateText = document.getElementById('shiftStateText');
  if(s){
    const b = activeBreakOf(s);
    if(b){ dot.classList.remove('on'); stateText.textContent = 'En break · '+(b.label||b.type); }
    else{
      dot.classList.add('on');
      stateText.textContent = 'En jornada · Zona '+(s.zone==='live'?'Live':'Match');
    }
  } else {
    dot.classList.remove('on'); stateText.textContent='Sin jornada activa';
  }
}

function renderShiftCard(){
  const s = activeSession();
  const startRow = document.getElementById('shiftBtnsRow');
  const activeRow = document.getElementById('shiftActiveBtns');
  const standaloneCard = document.getElementById('standaloneCallCard');
  const zoneArea = document.getElementById('zoneArea');

  if(!s){
    startRow.style.display='grid';
    activeRow.style.display='none';
    standaloneCard.style.display='flex';
    zoneArea.style.display='none';
    document.getElementById('shiftTimer').textContent = '00:00:00';
    document.getElementById('shiftBreakTime').textContent = 'En break: 00:00:00';
    return;
  }
  startRow.style.display='none';
  activeRow.style.display='grid';
  standaloneCard.style.display='none';

  const worked = workedMsForDay(s.salsaDay);
  const brk = breakMsForDay(s.salsaDay);
  document.getElementById('shiftTimer').textContent = fmtHMS(worked);
  document.getElementById('shiftBreakTime').textContent = 'En break: '+fmtHMS(brk);

  const activeBreak = activeBreakOf(s);
  if(activeBreak){
    zoneArea.style.display='none';
  } else {
    zoneArea.style.display='block';
    renderZoneTabs(s);
  }
}

function renderZoneTabs(s){
  document.getElementById('tabZoneMatch').classList.toggle('active', s.zone!=='live');
  document.getElementById('tabZoneLive').classList.toggle('active', s.zone==='live');
  document.getElementById('zonePanelMatch').style.display = s.zone==='live' ? 'none':'block';
  document.getElementById('zonePanelLive').style.display = s.zone==='live' ? 'block':'none';
  if(s.zone==='live') renderZoneLive(s); else renderZoneMatch(s);
}

function renderZoneMatch(s){
  const m = openMatchOf(s);
  const banner = document.getElementById('openMatchBanner');
  const qEff = document.getElementById('qEffective');
  const qProd = document.getElementById('qProductive');
  if(!m){
    banner.innerHTML='';
    qEff.setAttribute('disabled','');
    qProd.setAttribute('disabled','');
    return;
  }
  const elapsed = Date.now()-new Date(m.startedAt).getTime();
  const label = m.status==='productivo' ? 'Match productivo ✅💵'
    : m.status==='efectivo' ? 'Match efectivo — ¿se vuelve productivo?'
    : 'Match iniciado — esperando efectivo';
  banner.innerHTML = `<div class="open-match-banner ${m.status==='productivo'?'tone-productive':''}">
    <div><div class="oma-label">${label}</div><div class="oma-time mono">${fmtHMS(elapsed)}</div></div>
  </div>`;
  if(m.status==='iniciado'){ qEff.removeAttribute('disabled'); } else { qEff.setAttribute('disabled',''); }
  if(m.status!=='productivo'){ qProd.removeAttribute('disabled'); } else { qProd.setAttribute('disabled',''); }
}

function renderZoneLive(s){
  const l = activeLiveOf(s);
  const bannerArea = document.getElementById('liveBannerArea');
  const startBtns = document.getElementById('liveStartButtons');
  const activeBtns = document.getElementById('liveActiveButtons');
  if(!l){
    bannerArea.innerHTML='';
    startBtns.style.display='grid';
    activeBtns.style.display='none';
    return;
  }
  startBtns.style.display='none';
  activeBtns.style.display='grid';
  const elapsed = Date.now()-new Date(l.startedAt).getTime();
  const coins = liveCoinsTotal(l.id);
  const title = l.type==='premium' ? 'Live Premium' : 'Live público';
  bannerArea.innerHTML = `<div class="live-banner ${l.type==='premium'?'tone-premium':''}">
    <div class="lb-top"><span class="lb-title">🔴 ${title}</span></div>
    <div class="lb-timer mono">${fmtHMS(elapsed)}</div>
    <div class="lb-coins">${Math.round(coins)} monedas generadas</div>
  </div>`;

  if(l.type==='publico'){
    activeBtns.innerHTML = `
      <div class="qbtn tone-money" id="qLiveRegalo"><span class="qicon">🎁</span><span class="qlabel">REGALO</span></div>
      <div class="qbtn tone-live" id="qLiveCallPrivate"><span class="qicon">🔒</span><span class="qlabel">LLAMADA PRIV.</span></div>
      <div class="qbtn tone-productive" id="qLiveGoPremium"><span class="qicon">🔐</span><span class="qlabel">CAMBIAR A PREMIUM</span></div>
      <div class="qbtn" id="qBreakMenuLive2"><span class="qicon">☕</span><span class="qlabel">BREAKS</span></div>
      <div class="qbtn tone-live" id="qLiveEnd" style="grid-column:span 2;"><span class="qicon">⏹️</span><span class="qlabel">TERMINAR LIVE PÚBLICO</span></div>
    `;
    document.getElementById('qLiveRegalo').onclick = ()=>openLiveRegaloModal(REGALO_SUBTYPES_PUBLIC);
    document.getElementById('qLiveCallPrivate').onclick = ()=>openLiveCallModal();
    document.getElementById('qLiveGoPremium').onclick = ()=>openSwitchToPremiumModal();
    document.getElementById('qBreakMenuLive2').onclick = openBreakMenu;
    document.getElementById('qLiveEnd').onclick = ()=>confirmEndLive('Live público');
  } else {
    activeBtns.innerHTML = `
      <div class="qbtn tone-money" id="qLiveRegalo"><span class="qicon">🎁</span><span class="qlabel">REGALO</span></div>
      <div class="qbtn tone-live" id="qLiveGoPublic"><span class="qicon">📡</span><span class="qlabel">CAMBIAR A PÚBLICO</span></div>
      <div class="qbtn" id="qBreakMenuLive2"><span class="qicon">☕</span><span class="qlabel">BREAKS</span></div>
      <div class="qbtn tone-productive" id="qLiveEnd" style="grid-column:span 3;"><span class="qicon">⏹️</span><span class="qlabel">TERMINAR LIVE PREMIUM</span></div>
    `;
    document.getElementById('qLiveRegalo').onclick = ()=>openLiveRegaloModal(REGALO_SUBTYPES_PREMIUM);
    document.getElementById('qLiveGoPublic').onclick = ()=>{ switchLive('publico', 0); toast('Cambiado a Live público'); renderAll(); };
    document.getElementById('qBreakMenuLive2').onclick = openBreakMenu;
    document.getElementById('qLiveEnd').onclick = ()=>confirmEndLive('Live Premium');
  }
}

function renderMetrics(){
  const st = currentStats();
  document.getElementById('mUSD').textContent = fmtUSD(st.usd);
  document.getElementById('mUSDPerHour').textContent = fmtUSD(st.usdPerHour)+'/hora';
  document.getElementById('mCoins').textContent = Math.round(st.coins);
  document.getElementById('mCoinsPerHour').textContent = Math.round(st.coinsPerHour)+'/hora';
  document.getElementById('mMatches').textContent = st.initiated;
  document.getElementById('mEffective').textContent = st.effective;
  document.getElementById('mEffPct').textContent = Math.round(st.convEffective)+'% de iniciados';
  document.getElementById('mProductive').textContent = st.productive;
  document.getElementById('mProdPct').textContent = Math.round(st.convProductiveFromEffective)+'% de efectivos';
  document.getElementById('mConversion').textContent = Math.round(st.conversion)+'%';
  document.getElementById('mConvSub').textContent = CONFIG.formula==='prod_init' ? 'prod. / iniciados' : 'prod. / efect.';
  document.getElementById('mTimeEff').textContent = fmtSec(st.avgTimeToEffective);
  document.getElementById('mTimeProd').textContent = fmtSec(st.avgTimeToProductive);

  const day = currentSalsaDay();
  const g = goals[day] || CONFIG.goalsDefault;
  const pct = g.usd>0 ? Math.min(100, (st.usd/g.usd)*100) : 0;
  document.getElementById('goalLabel').textContent = `Meta del día: ${fmtUSD(g.usd)}`;
  document.getElementById('goalBar').style.width = pct+'%';
  const falta = Math.max(0, g.usd-st.usd);
  const exced = Math.max(0, st.usd-g.usd);
  document.getElementById('goalSub').textContent = exced>0
    ? `${fmtUSD(st.usd)} de ${fmtUSD(g.usd)} · excedente ${fmtUSD(exced)}`
    : `${fmtUSD(st.usd)} de ${fmtUSD(g.usd)} · faltan ${fmtUSD(falta)}`;
  document.getElementById('goalMiniPct').textContent = Math.round(pct)+'%';
}

function renderHourly(){
  const day = currentSalsaDay();
  const hourly = computeHourlyForDay(day);
  const {avg} = historicalHourAverages(day);
  const card = document.getElementById('hourlyCard');
  const activeHours = [];
  for(let h=0;h<24;h++){ if(hourly[h].usd>0 || hourly[h].matches>0) activeHours.push(h); }
  if(activeHours.length===0){
    card.innerHTML = '<div class="empty-note">Aún no hay actividad registrada en esta jornada.</div>';
    return;
  }
  const maxUsd = Math.max(...activeHours.map(h=>hourly[h].usd), 0.01);
  let html='';
  activeHours.sort((a,b)=>a-b).forEach(h=>{
    const v = hourly[h];
    const historical = avg[h];
    let dotClass = 'dot-neutral';
    if(historical!==null && historical>0){
      const ratio = v.usd/historical;
      if(ratio>=1.1) dotClass='dot-good';
      else if(ratio>=0.9) dotClass='dot-warn';
      else dotClass='dot-bad';
    }
    html += `<div class="hour-row">
      <div class="hour-time mono">${pad(h)}:00</div>
      <div class="hour-bar-track"><div class="hour-bar-fill" style="width:${(v.usd/maxUsd*100).toFixed(0)}%;"></div></div>
      <div class="hour-usd mono">${fmtUSD(v.usd)}</div>
      <div class="hour-dot ${dotClass}"></div>
    </div>`;
  });
  card.innerHTML = html;
}

const TYPE_LABEL = {
  regalo:'Regalo', llamada_publica:'Llamada pública', llamada_privada:'Llamada privada', otro:'Otro'
};
const CATEGORY_LABEL = {
  match:'desde Match', live_publico:'Live público', live_premium:'Live Premium', standalone:'fuera de jornada'
};
const SUBTYPE_LABEL = {
  simple:'simple', sticker:'sticker', ruleta:'ruleta', entrada:'entrada', tip_menu:'tip menú'
};

function eventItemsForDay(day){
  const items = [];
  dayMatches(day).forEach(m=>{
    let label = 'Match iniciado';
    let color = 'var(--text-faint)';
    let sub = '';
    if(m.status==='productivo'){ label='Match productivo'; color='var(--productive)'; }
    else if(m.status==='efectivo'){ label='Match efectivo'; color='var(--effective)'; }
    if(m.effectiveAt) sub += 'Tiempo a efectivo: '+fmtSec(new Date(m.effectiveAt)-new Date(m.startedAt));
    if(m.productiveAt) sub += (sub?' · ':'')+'a productivo: '+fmtSec(new Date(m.productiveAt)-new Date(m.startedAt));
    items.push({ts:m.startedAt, kind:'match', id:m.id, label, sub, color});
  });
  dayMon(day).forEach(m=>{
    const label = `${TYPE_LABEL[m.type]||m.type}${m.subtype?' ('+(SUBTYPE_LABEL[m.subtype]||m.subtype)+')':''} · ${Math.round(m.coins)} monedas (${fmtUSD(m.usd)})`;
    items.push({ts:m.timestamp, kind:'mon', id:m.id, label, sub:CATEGORY_LABEL[m.category]||'', color:'var(--money)'});
  });
  dayLives(day).forEach(l=>{
    const coins = liveCoinsTotal(l.id);
    const dur = (l.endedAt?new Date(l.endedAt):new Date()) - new Date(l.startedAt);
    const label = `${l.type==='premium'?'Live Premium':'Live público'} · ${fmtHM(dur)} · ${Math.round(coins)} monedas`;
    items.push({ts:l.endedAt||l.startedAt, kind:'live', id:l.id, label, sub:'', color:'var(--effective)'});
  });
  dayBreaks(day).forEach(b=>{
    const dur = (b.endedAt?new Date(b.endedAt):new Date()) - new Date(b.startedAt);
    items.push({ts:b.endedAt||b.startedAt, kind:'break', id:b.id, label:`Break: ${b.label||b.type} · ${fmtHM(dur)}`, sub:'', color:'var(--text-faint)'});
  });
  items.sort((a,b)=> new Date(b.ts)-new Date(a.ts));
  return items;
}

function renderEventList(containerId, items){
  const card = document.getElementById(containerId);
  if(items.length===0){ card.innerHTML='<div class="empty-note">Sin eventos registrados.</div>'; return; }
  card.innerHTML = items.slice(0,80).map(it=>{
    const t = new Date(it.ts);
    return `<div class="log-item">
      <div class="log-left"><span class="log-badge" style="background:${it.color};"></span>${it.label}<span class="log-time mono">${pad(t.getHours())}:${pad(t.getMinutes())}</span>${it.sub?`<span class="log-sub">${it.sub}</span>`:''}</div>
      <button class="log-del" data-kind="${it.kind}" data-id="${it.id}">✕</button>
    </div>`;
  }).join('');
  card.querySelectorAll('.log-del').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      deleteEvent(btn.dataset.kind, btn.dataset.id);
      toast('Eliminado');
      renderAll();
    });
  });
}

function renderTodayLog(){
  renderEventList('todayLogCard', eventItemsForDay(currentSalsaDay()));
}
/* ---------- history view ---------- */
let histRangeMode = 'day';
let histCursor = new Date();
let histSelectedDay = null;
let charts = {};

function histRangeDays(){
  const days = allSalsaDays();
  if(histRangeMode==='day'){
    return [getSalsaDay(histCursor)];
  }
  if(histRangeMode==='week'){
    const wk = isoWeekKey(getSalsaDay(histCursor));
    return days.filter(d=>isoWeekKey(d)===wk).length ? days.filter(d=>isoWeekKey(d)===wk) : [getSalsaDay(histCursor)];
  }
  const mk = monthKey(getSalsaDay(histCursor));
  return days.filter(d=>monthKey(d)===mk);
}

function renderHistoryLabel(){
  const label = document.getElementById('histLabel');
  const day = getSalsaDay(histCursor);
  if(histRangeMode==='day') label.textContent = fmtDayLabel(day);
  else if(histRangeMode==='week') label.textContent = 'Semana '+isoWeekKey(day);
  else label.textContent = monthKey(day);
}

function destroyChart(key){ if(charts[key]){ charts[key].destroy(); charts[key]=null; } }

function renderHistoryCharts(){
  const days = allSalsaDays();
  const relevant = histRangeMode==='day' ? days.slice(-14) : days;
  const stats = relevant.map(computeDayStats);
  const labels = relevant.map(d=>fmtDayLabel(d).replace(/^\S+ /,''));

  const gridColor='rgba(255,255,255,0.06)';
  const commonOpts = {
    responsive:true, maintainAspectRatio:false,
    plugins:{legend:{display:false}},
    scales:{ x:{ticks:{color:'#8891A6',font:{size:10}}, grid:{color:gridColor}}, y:{ticks:{color:'#8891A6',font:{size:10}}, grid:{color:gridColor}} }
  };

  destroyChart('ingresos');
  charts.ingresos = new Chart(document.getElementById('chartIngresos'), {
    type:'bar',
    data:{labels, datasets:[{data:stats.map(s=>Number(s.usd.toFixed(2))), backgroundColor:'#F5B700', borderRadius:4}]},
    options: commonOpts
  });

  destroyChart('conversion');
  charts.conversion = new Chart(document.getElementById('chartConversion'), {
    type:'line',
    data:{labels, datasets:[{data:stats.map(s=>Number(s.conversion.toFixed(1))), borderColor:'#35D0C8', backgroundColor:'rgba(53,208,200,0.15)', fill:true, tension:0.3, pointRadius:2}]},
    options: commonOpts
  });

  destroyChart('matches');
  charts.matches = new Chart(document.getElementById('chartMatches'), {
    type:'bar',
    data:{labels, datasets:[
      {label:'Iniciados', data:stats.map(s=>s.initiated), backgroundColor:'#3A4260'},
      {label:'Efectivos', data:stats.map(s=>s.effective), backgroundColor:'#35D0C8'},
      {label:'Productivos', data:stats.map(s=>s.productive), backgroundColor:'#8B5CF6'}
    ]},
    options: Object.assign({}, commonOpts, {plugins:{legend:{display:true, labels:{color:'#8891A6', font:{size:10}}}}})
  });

  destroyChart('tiempo');
  charts.tiempo = new Chart(document.getElementById('chartTiempo'), {
    type:'bar',
    data:{labels, datasets:[{data:stats.map(s=>Number(s.hours.toFixed(2))), backgroundColor:'#FF3D77', borderRadius:4}]},
    options: commonOpts
  });
}

function renderHistoryDaysList(){
  const card = document.getElementById('histDaysCard');
  const days = allSalsaDays().slice().reverse();
  if(days.length===0){ card.innerHTML='<div class="empty-note">No hay jornadas registradas todavía.</div>'; return; }
  card.innerHTML = days.map(d=>{
    const st = computeDayStats(d);
    const sess = daySessions(d);
    const durLabel = sess.length ? fmtHM(st.hours*3600000) : '—';
    return `<div class="record-row" data-day="${d}" style="cursor:pointer;">
      <div>
        <div class="record-label" style="color:var(--text);font-weight:600;">${fmtDayLabel(d)}</div>
        <div class="record-label">${st.initiated} matches · ${Math.round(st.conversion)}% conv. · ${durLabel}</div>
      </div>
      <div class="record-value mono" style="color:var(--money);">${fmtUSD(st.usd)}</div>
    </div>`;
  }).join('');
  card.querySelectorAll('[data-day]').forEach(row=>{
    row.addEventListener('click', ()=>{
      histSelectedDay = row.dataset.day;
      renderHistDetail();
    });
  });
}

function renderHistDetail(){
  const card = document.getElementById('histDetailCard');
  if(!histSelectedDay){ card.innerHTML='<div class="empty-note">Selecciona un día para ver su detalle cronológico.</div>'; return; }
  const day = histSelectedDay;
  const sess = daySessions(day);
  let head = '';
  if(sess.length){
    sess.forEach(s=>{
      const dur = s.end ? (new Date(s.end)-new Date(s.start)) : (Date.now()-new Date(s.start));
      head += `<div class="record-row"><div class="record-label">Jornada ${s.status==='active'?'(activa)':''}</div>
        <div class="record-value" style="font-size:12px;">${new Date(s.start).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})} → ${s.end?new Date(s.end).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'}):'—'} · ${fmtHM(dur)}</div></div>`;
    });
  }
  card.innerHTML = `<div class="card-title" style="margin-bottom:4px;">${fmtDayLabel(day)}</div>` + head + `<div id="histDetailEvents"></div>`;
  const items = eventItemsForDay(day);
  const evCard = document.createElement('div');
  card.appendChild(evCard);
  if(items.length===0){
    evCard.innerHTML = '<div class="empty-note">Sin eventos ese día.</div>';
  } else {
    evCard.innerHTML = items.map(it=>{
      const t = new Date(it.ts);
      return `<div class="log-item"><div class="log-left"><span class="log-badge" style="background:${it.color};"></span>${it.label}<span class="log-time mono">${pad(t.getHours())}:${pad(t.getMinutes())}</span>${it.sub?`<span class="log-sub">${it.sub}</span>`:''}</div></div>`;
    }).join('');
  }
}

function renderHistory(){
  renderHistoryLabel();
  renderHistoryCharts();
  renderHistoryDaysList();
  renderHistDetail();
}

/* ---------- records view ---------- */
function renderRecords(){
  const rec = computeRecords();
  const card = document.getElementById('recordsCard');
  if(!rec){ card.innerHTML='<div class="empty-note">Aún no hay suficientes datos para calcular récords.</div>'; }
  else{
    const rows = [
      ['Mejor ingreso diario', rec.bestDay ? `${fmtUSD(rec.bestDay.usd)} · ${fmtDayLabel(rec.bestDay.salsaDay)}` : '—'],
      ['Mejor ingreso/hora', rec.bestUSDPerHour ? `${fmtUSD(rec.bestUSDPerHour.usdPerHour)}/h · ${fmtDayLabel(rec.bestUSDPerHour.salsaDay)}` : '—'],
      ['Mejor conversión', rec.bestConversion ? `${Math.round(rec.bestConversion.conversion)}% · ${fmtDayLabel(rec.bestConversion.salsaDay)}` : '—'],
      ['Más matches', rec.mostMatches ? `${rec.mostMatches.initiated} · ${fmtDayLabel(rec.mostMatches.salsaDay)}` : '—'],
      ['Más efectivos', rec.mostEffective ? `${rec.mostEffective.effective} · ${fmtDayLabel(rec.mostEffective.salsaDay)}` : '—'],
      ['Más productivos', rec.mostProductive ? `${rec.mostProductive.productive} · ${fmtDayLabel(rec.mostProductive.salsaDay)}` : '—'],
      ['Más monedas', rec.mostCoins ? `${Math.round(rec.mostCoins.coins)} · ${fmtDayLabel(rec.mostCoins.salsaDay)}` : '—'],
      ['Mejor horario', rec.bestHour!==null ? `${pad(rec.bestHour)}:00` : '—'],
      ['Peor horario', rec.worstHour!==null ? `${pad(rec.worstHour)}:00` : '—'],
    ];
    card.innerHTML = rows.map(r=>`<div class="record-row"><div class="record-label">${r[0]}</div><div class="record-value">${r[1]}</div></div>`).join('');
  }

  const cmp = computeComparisons();
  const cCard = document.getElementById('comparisonCard');
  if(!cmp){ cCard.innerHTML='<div class="empty-note">Registra al menos una jornada para ver comparativas.</div>'; }
  else{
    function deltaSpan(cur, ref){
      if(ref===null || ref===undefined) return '<span class="delta-flat">sin datos previos</span>';
      const diff = cur-ref;
      const cls = diff>0.001?'delta-up':diff<-0.001?'delta-down':'delta-flat';
      const sign = diff>0?'+':'';
      return `<span class="${cls}">${sign}${fmtUSD(diff)}</span>`;
    }
    const rows = [
      ['Hoy vs promedio', `${fmtUSD(cmp.todayStat.usd)} · ${deltaSpan(cmp.todayStat.usd, cmp.avgUSD)}`],
      ['Hoy vs mejor día', `${fmtUSD(cmp.todayStat.usd)} · ${deltaSpan(cmp.todayStat.usd, cmp.bestDayUSD)}`],
      ['Esta semana vs anterior', `${fmtUSD(cmp.curWeekUSD)} · ${deltaSpan(cmp.curWeekUSD, cmp.prevWeekUSD)}`],
      ['Este mes vs anterior', `${fmtUSD(cmp.curMonthUSD)} · ${deltaSpan(cmp.curMonthUSD, cmp.prevMonthUSD)}`],
    ];
    cCard.innerHTML = rows.map(r=>`<div class="compare-row"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('');
  }

  const patterns = computePatterns();
  const pCard = document.getElementById('patternsCard');
  if(!patterns){ pCard.innerHTML = '<div class="empty-note">Se necesitan al menos 7 jornadas registradas para detectar patrones.</div>'; }
  else if(patterns.length===0){ pCard.innerHTML = '<div class="empty-note">Todavía no se detectan patrones claros con los datos actuales.</div>'; }
  else{ pCard.innerHTML = patterns.map(p=>`<div class="record-row" style="display:block;"><div style="font-size:12.5px;line-height:1.5;">${p}</div></div>`).join(''); }
}

/* ---------- config view ---------- */
function renderConfig(){
  document.getElementById('cfgCoinsPerUSD').value = CONFIG.coinsPerUSD;
  document.getElementById('cfgFormula').value = CONFIG.formula;
  document.getElementById('cfgMinEffectiveSeconds').value = CONFIG.minEffectiveSeconds;
  document.getElementById('cfgGoalUSD').value = CONFIG.goalsDefault.usd;
  document.getElementById('cfgGoalCoins').value = CONFIG.goalsDefault.coins;
  document.getElementById('cfgGoalMatches').value = CONFIG.goalsDefault.matches;
  document.getElementById('cfgGoalEffective').value = CONFIG.goalsDefault.effective;
  document.getElementById('cfgGoalProductive').value = CONFIG.goalsDefault.productive;
  document.getElementById('cfgGoalHours').value = CONFIG.goalsDefault.hours;
}

/* ---------- master render ---------- */
function renderAll(){
  renderHeader();
  renderShiftCard();
  renderMetrics();
  renderHourly();
  renderTodayLog();
  const activeView = document.querySelector('.view.active').id;
  if(activeView==='view-historial') renderHistory();
  if(activeView==='view-records') renderRecords();
  if(activeView==='view-config') renderConfig();
}
/* ============================================================
   UI WIRING
   ============================================================ */
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>t.classList.remove('show'), 1800);
}

function openModal(html){
  document.getElementById('modalSheet').innerHTML = html;
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal(){ document.getElementById('modalOverlay').classList.remove('open'); }
document.getElementById('modalOverlay').addEventListener('click', (e)=>{ if(e.target.id==='modalOverlay') closeModal(); });

/* -- tabs -- */
document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-'+btn.dataset.view).classList.add('active');
    renderAll();
  });
});

/* -- zone tabs -- */
document.getElementById('tabZoneMatch').addEventListener('click', ()=>{ setZone('match'); renderAll(); });
document.getElementById('tabZoneLive').addEventListener('click', ()=>{ setZone('live'); renderAll(); });
document.getElementById('qGoLive').addEventListener('click', ()=>{ setZone('live'); renderAll(); });

/* -- shift controls -- */
document.getElementById('btnStartShift').addEventListener('click', ()=>{
  const day = getSalsaDay(new Date());
  openModal(`
    <div class="modal-title">¿Iniciar jornada?</div>
    <div class="hint" style="margin-bottom:16px;">Día Salsa ${fmtDayLabel(day)} a las ${pad(new Date().getHours())}:${pad(new Date().getMinutes())}.</div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-primary" id="mConfirm">Sí, iniciar</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{ startShift(); closeModal(); toast('Jornada iniciada'); renderAll(); };
});
function endShiftFlow(){
  openModal(`
    <div class="modal-title">¿Finalizar jornada?</div>
    <div class="hint" style="margin-bottom:16px;">Se guardará completa en tu historial: horas, matches, monetización, lives y breaks.</div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-danger" id="mConfirm">Finalizar</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{ endShift(); closeModal(); toast('Jornada guardada en el historial'); renderAll(); };
}
document.getElementById('btnEndShift').addEventListener('click', endShiftFlow);

function editGoalsFlow(){
  const day = currentSalsaDay();
  const g = goals[day] || Object.assign({}, CONFIG.goalsDefault);
  openModal(`
    <div class="modal-title">Metas de hoy · ${fmtDayLabel(day)}</div>
    <div class="field-row">
      <div class="field"><label>Meta $</label><input type="number" id="gUSD" value="${g.usd}" step="0.01"></div>
      <div class="field"><label>Meta monedas</label><input type="number" id="gCoins" value="${g.coins}" step="1"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Meta matches</label><input type="number" id="gMatches" value="${g.matches}" step="1"></div>
      <div class="field"><label>Meta efectivos</label><input type="number" id="gEffective" value="${g.effective}" step="1"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Meta productivos</label><input type="number" id="gProductive" value="${g.productive}" step="1"></div>
      <div class="field"><label>Meta horas</label><input type="number" id="gHours" value="${g.hours}" step="0.5"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-primary" id="mConfirm">Guardar</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{
    goals[day] = {
      usd: parseFloat(document.getElementById('gUSD').value)||0,
      coins: parseFloat(document.getElementById('gCoins').value)||0,
      matches: parseFloat(document.getElementById('gMatches').value)||0,
      effective: parseFloat(document.getElementById('gEffective').value)||0,
      productive: parseFloat(document.getElementById('gProductive').value)||0,
      hours: parseFloat(document.getElementById('gHours').value)||0
    };
    persistAll(); closeModal(); toast('Metas guardadas'); renderAll();
  };
}
document.getElementById('btnEditGoals').addEventListener('click', editGoalsFlow);
document.getElementById('btnEditGoals2').addEventListener('click', editGoalsFlow);

/* -- ZONA MATCH -- */
document.getElementById('qMatch').addEventListener('click', ()=>{ startMatch(); toast('Match registrado'); renderAll(); });
document.getElementById('qEffective').addEventListener('click', ()=>{ setMatchEffective(); toast('Match efectivo'); renderAll(); });

function openProductiveModal(){
  const s = activeSession();
  const m = openMatchOf(s);
  if(!m){ toast('No hay match abierto'); return; }
  openModal(`
    <div class="modal-title">Match productivo</div>
    <div class="field">
      <label>¿Qué lo hizo productivo?</label>
      <select id="pType">
        <option value="regalo">Regalo</option>
        <option value="llamada_publica">Videollamada pública</option>
        <option value="llamada_privada">Videollamada privada</option>
        <option value="otro">Otro</option>
      </select>
    </div>
    <div class="field">
      <label>Monedas recibidas (opcional)</label>
      <input type="number" id="pCoins" placeholder="0" min="0" step="1">
    </div>
    <div class="hint" style="margin-bottom:8px;">Este match ya cuenta como efectivo automáticamente si aún no lo era.</div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-productive" id="mConfirm">Registrar</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{
    const type = document.getElementById('pType').value;
    const coins = parseFloat(document.getElementById('pCoins').value)||0;
    setMatchProductive(type, null, coins);
    closeModal(); toast('Productivo registrado'); renderAll();
  };
}
document.getElementById('qProductive').addEventListener('click', openProductiveModal);

function openMonetizacionModal(){
  openModal(`
    <div class="modal-title">Monetización</div>
    <div class="hint" style="margin-bottom:10px;">Categoría independiente — no se vincula automáticamente a ningún Match.</div>
    <div class="modal-options">
      <button class="btn btn-outline" id="mRegalo">🎁 Regalo</button>
      <button class="btn btn-outline" id="mCallPub">📞 Videollamada pública</button>
      <button class="btn btn-outline" id="mCallPriv">🔒 Videollamada privada</button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel" style="width:100%;">Cancelar</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mRegalo').onclick = ()=>openCoinsModal({title:'Regalo', category:'match', type:'regalo'});
  document.getElementById('mCallPub').onclick = ()=>openCallModal({title:'Videollamada pública', category:'match', type:'llamada_publica'});
  document.getElementById('mCallPriv').onclick = ()=>openCallModal({title:'Videollamada privada', category:'match', type:'llamada_privada'});
}
document.getElementById('qMonetizacion').addEventListener('click', openMonetizacionModal);

function openCoinsModal({title, category, type, subtype, liveId}){
  openModal(`
    <div class="modal-title">${title}</div>
    <div class="field"><label>Monedas recibidas</label><input type="number" id="cCoins" min="0" step="1" placeholder="0"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-primary" id="mConfirm">Registrar</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{
    const coins = parseFloat(document.getElementById('cCoins').value)||0;
    addMonetization({category, type, subtype, coins, liveId});
    closeModal(); toast('Registrado'); renderAll();
  };
}

function openCallModal({title, category, type, liveId}){
  openModal(`
    <div class="modal-title">${title}</div>
    <div class="field"><label>Duración (segundos)</label><input type="number" id="callSec" min="0" step="1" placeholder="0"></div>
    <div class="field"><label>Monedas recibidas</label><input type="number" id="callCoins" min="0" step="1" placeholder="0"></div>
    <div class="hint" id="callHint">Tarifa: primeros 20s = 60 · al minuto: ${type==='llamada_privada'?'privada 120':'pública 60'}.</div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-primary" id="mConfirm">Registrar</button>
    </div>`);
  const secInput = document.getElementById('callSec');
  const coinsInput = document.getElementById('callCoins');
  secInput.addEventListener('input', ()=>{
    const sec = parseFloat(secInput.value);
    const suggested = tariffCoins(type, sec);
    if(suggested!==null) coinsInput.value = suggested;
  });
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{
    const seconds = parseFloat(secInput.value)||0;
    const coins = parseFloat(coinsInput.value)||0;
    addMonetization({category, type, coins, seconds, liveId});
    closeModal(); toast('Registrado'); renderAll();
  };
}

/* -- llamada privada fuera de jornada -- */
document.getElementById('btnStandaloneCall').addEventListener('click', ()=>{
  openModal(`
    <div class="modal-title">🔒 Videollamada privada (sin jornada)</div>
    <div class="field"><label>Duración (segundos)</label><input type="number" id="scSec" min="0" step="1" placeholder="0"></div>
    <div class="field"><label>Monedas recibidas</label><input type="number" id="scCoins" min="0" step="1" placeholder="0"></div>
    <div class="hint">Se guardará en el historial del Día Salsa de hoy, aunque no tengas jornada activa.</div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-primary" id="mConfirm">Registrar</button>
    </div>`);
  const secInput = document.getElementById('scSec');
  const coinsInput = document.getElementById('scCoins');
  secInput.addEventListener('input', ()=>{
    const sec = parseFloat(secInput.value);
    const suggested = tariffCoins('llamada_privada', sec);
    if(suggested!==null) coinsInput.value = suggested;
  });
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{
    const seconds = parseFloat(secInput.value)||0;
    const coins = parseFloat(coinsInput.value)||0;
    addStandaloneCall(seconds, coins);
    closeModal(); toast('Llamada privada registrada'); renderAll();
  };
});

/* -- ZONA LIVE -- */
document.getElementById('qStartLivePublic').addEventListener('click', ()=>{
  startLive('publico', 0); toast('Live público iniciado'); renderAll();
});
document.getElementById('qStartLivePremium').addEventListener('click', ()=>{
  openModal(`
    <div class="modal-title">Iniciar Live Premium</div>
    <div class="field"><label>Monedas de entrada / pase</label><input type="number" id="entCoins" min="0" step="1" placeholder="0"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-productive" id="mConfirm">Iniciar</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{
    const coins = parseFloat(document.getElementById('entCoins').value)||0;
    startLive('premium', coins);
    closeModal(); toast('Live Premium iniciado'); renderAll();
  };
});

function openSwitchToPremiumModal(){
  openModal(`
    <div class="modal-title">Cambiar a Live Premium</div>
    <div class="hint" style="margin-bottom:10px;">Se finalizará el Live público actual y comenzará un cronómetro nuevo para Premium (quedan como sesiones independientes).</div>
    <div class="field"><label>Monedas de entrada / pase</label><input type="number" id="entCoins" min="0" step="1" placeholder="0"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-productive" id="mConfirm">Cambiar</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{
    const coins = parseFloat(document.getElementById('entCoins').value)||0;
    switchLive('premium', coins);
    closeModal(); toast('Cambiado a Live Premium'); renderAll();
  };
}

function openLiveRegaloModal(subtypes){
  const opts = subtypes.map(o=>`<option value="${o.value}">${o.label}</option>`).join('');
  openModal(`
    <div class="modal-title">Regalo</div>
    <div class="field"><label>Tipo</label><select id="lgType">${opts}</select></div>
    <div class="field"><label>Monedas recibidas</label><input type="number" id="lgCoins" min="0" step="1" placeholder="0"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-primary" id="mConfirm">Registrar</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{
    const subtype = document.getElementById('lgType').value;
    const coins = parseFloat(document.getElementById('lgCoins').value)||0;
    addLiveEvent('regalo', subtype, coins);
    closeModal(); toast('Regalo registrado'); renderAll();
  };
}

function openLiveCallModal(){
  openModal(`
    <div class="modal-title">🔒 Videollamada privada (en Live)</div>
    <div class="field"><label>Duración (segundos)</label><input type="number" id="lcSec" min="0" step="1" placeholder="0"></div>
    <div class="field"><label>Monedas recibidas</label><input type="number" id="lcCoins" min="0" step="1" placeholder="0"></div>
    <div class="hint">Tarifa: primeros 20s = 60 · al minuto = 120.</div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-primary" id="mConfirm">Registrar</button>
    </div>`);
  const secInput = document.getElementById('lcSec');
  const coinsInput = document.getElementById('lcCoins');
  secInput.addEventListener('input', ()=>{
    const sec = parseFloat(secInput.value);
    const suggested = tariffCoins('llamada_privada', sec);
    if(suggested!==null) coinsInput.value = suggested;
  });
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{
    const seconds = parseFloat(secInput.value)||0;
    const coins = parseFloat(coinsInput.value)||0;
    addLiveEvent('llamada_privada', null, coins, seconds);
    closeModal(); toast('Llamada privada registrada'); renderAll();
  };
}

function confirmEndLive(title){
  openModal(`
    <div class="modal-title">¿Terminar ${title}?</div>
    <div class="hint" style="margin-bottom:14px;">Se guardará como una sesión de Live independiente en el historial.</div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-danger" id="mConfirm">Terminar</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{ endLive(); closeModal(); toast(title+' finalizado'); renderAll(); };
}

/* -- breaks -- */
function openBreakMenu(){
  const opts = BREAK_TYPES.map(b=>`<button class="btn btn-outline" data-break="${b.type}" data-label="${b.label}">${b.icon} ${b.label}</button>`).join('');
  openModal(`
    <div class="modal-title">Break rápido</div>
    <div class="modal-options">${opts}</div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel" style="width:100%;">Cancelar</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.querySelectorAll('[data-break]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      startBreak(btn.dataset.break, btn.dataset.label);
      closeModal(); toast('Break iniciado: '+btn.dataset.label); renderAll();
    });
  });
}
document.getElementById('qBreakMenuMatch').addEventListener('click', openBreakMenu);
document.getElementById('qBreakMenuLive').addEventListener('click', openBreakMenu);

/* -- history controls -- */
document.querySelectorAll('#histRange button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('#histRange button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    histRangeMode = btn.dataset.range;
    renderHistory();
  });
});
document.getElementById('histPrev').addEventListener('click', ()=>{
  if(histRangeMode==='day') histCursor.setDate(histCursor.getDate()-1);
  else if(histRangeMode==='week') histCursor.setDate(histCursor.getDate()-7);
  else histCursor.setMonth(histCursor.getMonth()-1);
  renderHistory();
});
document.getElementById('histNext').addEventListener('click', ()=>{
  if(histRangeMode==='day') histCursor.setDate(histCursor.getDate()+1);
  else if(histRangeMode==='week') histCursor.setDate(histCursor.getDate()+7);
  else histCursor.setMonth(histCursor.getMonth()+1);
  renderHistory();
});

/* -- config -- */
document.getElementById('btnSaveConfig').addEventListener('click', ()=>{
  CONFIG.coinsPerUSD = parseFloat(document.getElementById('cfgCoinsPerUSD').value)||650;
  CONFIG.formula = document.getElementById('cfgFormula').value;
  CONFIG.minEffectiveSeconds = parseFloat(document.getElementById('cfgMinEffectiveSeconds').value)||18;
  persistAll(); toast('Configuración guardada'); renderAll();
});
document.getElementById('btnSaveGoalsDefault').addEventListener('click', ()=>{
  CONFIG.goalsDefault = {
    usd: parseFloat(document.getElementById('cfgGoalUSD').value)||0,
    coins: parseFloat(document.getElementById('cfgGoalCoins').value)||0,
    matches: parseFloat(document.getElementById('cfgGoalMatches').value)||0,
    effective: parseFloat(document.getElementById('cfgGoalEffective').value)||0,
    productive: parseFloat(document.getElementById('cfgGoalProductive').value)||0,
    hours: parseFloat(document.getElementById('cfgGoalHours').value)||0
  };
  persistAll(); toast('Metas por defecto guardadas'); renderAll();
});

/* -- import/export -- */
document.getElementById('btnExportJSON').addEventListener('click', ()=>{
  const data = { config:CONFIG, sessions, matches, monetization, lives, breaks, goals, exportedAt:new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bitacora-streamer-${fmtDateLocal(new Date())}.json`;
  a.click();
});
document.getElementById('btnExportCSV').addEventListener('click', ()=>{
  const rows = [['tipo','salsaDay','fecha_hora','detalle1','detalle2','monedas','usd']];
  matches.forEach(m=>rows.push(['match', m.salsaDay, m.startedAt, m.status, m.productiveSource||'', '', '']));
  monetization.forEach(m=>rows.push(['monetizacion', m.salsaDay, m.timestamp, m.category+':'+m.type, m.subtype||'', m.coins, m.usd.toFixed(4)]));
  lives.forEach(l=>rows.push(['live', l.salsaDay, l.startedAt, l.type, 'fin:'+(l.endedAt||''), liveCoinsTotal(l.id), liveUsdTotal(l.id).toFixed(4)]));
  breaks.forEach(b=>rows.push(['break', b.salsaDay, b.startedAt, b.type, 'fin:'+(b.endedAt||''), '', '']));
  sessions.forEach(s=>rows.push(['jornada', s.salsaDay, s.start, s.status, s.end||'', '', '']));
  const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `bitacora-streamer-${fmtDateLocal(new Date())}.csv`;
  a.click();
});
document.getElementById('btnImportJSON').addEventListener('click', ()=> document.getElementById('fileImport').click());
document.getElementById('fileImport').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const data = JSON.parse(reader.result);
      if(data.config) CONFIG = Object.assign({}, DEFAULT_CONFIG, data.config);
      sessions = data.sessions||[];
      matches = data.matches||[];
      monetization = data.monetization||[];
      lives = data.lives||[];
      breaks = data.breaks||[];
      goals = data.goals||{};
      persistAll();
      toast('Datos importados');
      renderAll();
    }catch(err){ toast('Archivo inválido'); }
  };
  reader.readAsText(file);
  e.target.value='';
});
document.getElementById('btnResetData').addEventListener('click', ()=>{
  openModal(`
    <div class="modal-title">¿Borrar todos los datos?</div>
    <div class="hint" style="margin-bottom:16px;">Esta acción no se puede deshacer. Exporta primero si quieres conservar tu historial.</div>
    <div class="modal-actions">
      <button class="btn btn-outline" id="mCancel">Cancelar</button>
      <button class="btn btn-danger" id="mConfirm">Borrar todo</button>
    </div>`);
  document.getElementById('mCancel').onclick = closeModal;
  document.getElementById('mConfirm').onclick = ()=>{
    sessions=[]; matches=[]; monetization=[]; lives=[]; breaks=[]; goals={};
    persistAll(); closeModal(); toast('Datos borrados'); renderAll();
  };
});
/* ---------- burbuja flotante ---------- */
let bubbleWindow = null;
let bubbleInterval = null;
let bubbleVideo = null;
let bubbleCanvas = null;

function buildBubbleContent(doc){
  const root = doc.createElement('div');
  root.className = 'bubble-root';
  root.innerHTML = `
    <div class="b-title">🫧 En vivo</div>
    <div class="b-row"><span class="b-label">⏱ Tiempo</span><span class="b-value" id="bTime">00:00:00</span></div>
    <div class="b-row"><span class="b-label">💰 Ganancia</span><span class="b-value" id="bUsd">$0.00</span></div>
    <div class="b-row"><span class="b-label">🎯 Meta</span><span class="b-value" id="bGoal">0%</span></div>
    <div class="b-row"><span class="b-label">👤 Matches</span><span class="b-value" id="bMatches">0</span></div>
    <div class="b-row"><span class="b-label">✅ Efectivos</span><span class="b-value" id="bEff">0</span></div>
    <div class="b-row"><span class="b-label">💵 Productivos</span><span class="b-value" id="bProd">0</span></div>
    <div class="b-row"><span class="b-label">📈 Conversión</span><span class="b-value" id="bConv">0%</span></div>
  `;
  return root;
}

function updateBubbleContent(doc){
  const st = currentStats();
  const day = currentSalsaDay();
  const g = goals[day] || CONFIG.goalsDefault;
  const pct = g.usd>0 ? Math.min(100, (st.usd/g.usd)*100) : 0;
  const worked = workedMsForDay(day);
  const set = (id,val)=>{ const el = doc.getElementById(id); if(el) el.textContent = val; };
  set('bTime', fmtHMS(worked));
  set('bUsd', fmtUSD(st.usd));
  set('bGoal', Math.round(pct)+'%');
  set('bMatches', st.initiated);
  set('bEff', st.effective);
  set('bProd', st.productive);
  set('bConv', Math.round(st.conversion)+'%');
}

function bubbleSnapshot(){
  const st = currentStats();
  const day = currentSalsaDay();
  const g = goals[day] || CONFIG.goalsDefault;
  const pct = g.usd>0 ? Math.min(100, (st.usd/g.usd)*100) : 0;
  const worked = workedMsForDay(day);
  return [
    ['⏱ Tiempo', fmtHMS(worked), '#E7EAF2'],
    ['💰 Ganancia', fmtUSD(st.usd), '#F5B700'],
    ['🎯 Meta', Math.round(pct)+'%', '#F5B700'],
    ['👤 Matches', String(st.initiated), '#FF3D77'],
    ['✅ Efectivos', String(st.effective), '#35D0C8'],
    ['💵 Productivos', String(st.productive), '#8B5CF6'],
    ['📈 Conversión', Math.round(st.conversion)+'%', '#35D0C8'],
  ];
}

function drawBubbleCanvas(){
  if(!bubbleCanvas) return;
  const ctx = bubbleCanvas.getContext('2d');
  const w = bubbleCanvas.width, h = bubbleCanvas.height;
  ctx.fillStyle = '#0B0E14';
  ctx.fillRect(0,0,w,h);
  ctx.fillStyle = '#8891A6';
  ctx.font = '600 15px Inter, sans-serif';
  ctx.fillText('🫧 EN VIVO', 16, 30);
  ctx.strokeStyle = '#252D40';
  ctx.beginPath(); ctx.moveTo(16,42); ctx.lineTo(w-16,42); ctx.stroke();

  const rows = bubbleSnapshot();
  let y = 68;
  rows.forEach(([label, value, color])=>{
    ctx.fillStyle = '#8891A6';
    ctx.font = '400 15px Inter, sans-serif';
    ctx.fillText(label, 16, y);
    ctx.fillStyle = color;
    ctx.font = '700 17px "JetBrains Mono", monospace';
    const tw = ctx.measureText(value).width;
    ctx.fillText(value, w-16-tw, y);
    ctx.strokeStyle = '#1B2233';
    ctx.beginPath(); ctx.moveTo(16,y+14); ctx.lineTo(w-16,y+14); ctx.stroke();
    y += 33;
  });
}

async function openBubbleViaDocumentPiP(){
  bubbleWindow = await documentPictureInPicture.requestWindow({ width:210, height:250, disallowReturnToOpener:false });
  const style = bubbleWindow.document.createElement('style');
  style.textContent = `body{margin:0;background:#0B0E14;}
    .bubble-root{font-family:'Inter',-apple-system,sans-serif;background:#0B0E14;color:#E7EAF2;width:100%;height:100%;padding:10px;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;font-size:12px;}
    .bubble-root .b-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #252D40;}
    .bubble-root .b-row:last-child{border-bottom:none;}
    .bubble-root .b-label{color:#8891A6;font-size:11px;}
    .bubble-root .b-value{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px;}
    .bubble-root .b-title{font-size:11px;font-weight:700;color:#8891A6;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px;}`;
  bubbleWindow.document.head.appendChild(style);
  bubbleWindow.document.body.appendChild(buildBubbleContent(bubbleWindow.document));
  updateBubbleContent(bubbleWindow.document);
  bubbleInterval = setInterval(()=>updateBubbleContent(bubbleWindow.document), 1000);
  bubbleWindow.addEventListener('pagehide', ()=>{
    clearInterval(bubbleInterval); bubbleInterval=null; bubbleWindow=null;
  });
}

async function openBubbleViaVideoPiP(){
  bubbleCanvas = document.createElement('canvas');
  bubbleCanvas.width = 260; bubbleCanvas.height = 300;
  drawBubbleCanvas();
  const stream = bubbleCanvas.captureStream(2);
  bubbleVideo = document.createElement('video');
  bubbleVideo.muted = true;
  bubbleVideo.playsInline = true;
  bubbleVideo.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:260px;height:300px;';
  bubbleVideo.srcObject = stream;
  document.body.appendChild(bubbleVideo);
  await bubbleVideo.play();
  bubbleInterval = setInterval(drawBubbleCanvas, 1000);
  bubbleVideo.addEventListener('leavepictureinpicture', ()=>{
    clearInterval(bubbleInterval); bubbleInterval=null;
    if(bubbleVideo){ bubbleVideo.remove(); bubbleVideo=null; }
    bubbleCanvas=null;
  });
  await bubbleVideo.requestPictureInPicture();
}

async function openBubble(){
  if(bubbleWindow){ try{ bubbleWindow.focus(); }catch(e){} return; }
  if(document.pictureInPictureElement){ try{ await document.exitPictureInPicture(); }catch(e){} return; }

  if('documentPictureInPicture' in window){
    try{ await openBubbleViaDocumentPiP(); toast('Burbuja abierta'); return; }
    catch(err){ /* sigue con el siguiente método */ }
  }
  if(document.pictureInPictureEnabled && window.HTMLVideoElement && HTMLVideoElement.prototype.requestPictureInPicture){
    try{ await openBubbleViaVideoPiP(); toast('Burbuja abierta'); return; }
    catch(err){ /* sigue al mensaje de no soportado */ }
  }
  openModal(`
    <div class="modal-title">🫧 Burbuja flotante</div>
    <div class="hint" style="margin-bottom:14px;line-height:1.6;">
      Este navegador/WebView no soporta ninguna forma de ventana flotante (ni Document Picture-in-Picture
      ni Video Picture-in-Picture). Esto es normal en wrappers muy básicos, ya que flotar sobre otras apps
      requiere un permiso nativo de Android que solo se puede activar agregando código nativo a la app
      (por ejemplo con un plugin de Capacitor). Si estás en Chrome/Android reciente, actualiza el navegador
      e inténtalo de nuevo.
    </div>
    <div class="modal-actions">
      <button class="btn btn-primary" id="mConfirm" style="width:100%;">Entendido</button>
    </div>`);
  document.getElementById('mConfirm').onclick = closeModal;
}
document.getElementById('btnBubble').addEventListener('click', openBubble);

/* ---------- boot ---------- */
renderConfig();
renderAll();
setInterval(renderAll, 1000);
