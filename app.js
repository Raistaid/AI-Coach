import { createCoachEngine, analyzePose, createAnalysisState, POSE_CONNECTIONS } from './coach-engine.js';

const $ = id => document.getElementById(id);
const app = $('app');
const video = $('cameraVideo');
const overlay = $('poseCanvas');
const demoCanvas = $('demoCanvas');
const storage = {
  read(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
  write(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing can restrict storage. */ } },
};
const skills = {
  football: { goal: 'Учусь чеканить мяч', label: 'Подъёмы стопы', description: 'Начни с устойчивой стойки и невысоких подъёмов стопы. Считаем движения ноги, а не касания мяча.' },
  squats: { goal: 'Приседаю с контролем', label: 'Приседания', description: 'Встань боком или немного под углом к камере. Приседай в комфортной амплитуде, без боли.' },
  balance: { goal: 'Улучшаю баланс', label: 'Подъёмы ноги', description: 'Поднимай одну стопу и сохраняй устойчивое положение. Рядом должно быть место для опоры.' },
};
const saved = storage.read('ai-coach:preferences', {});
const prefs = { voice: false, skeleton: true, mirror: false, ...saved };
let history = storage.read('ai-coach:sessions', []);
if (!Array.isArray(history)) history = [];
history = history.filter(s => s && typeof s.seconds === 'number' && skills[s.skill]).slice(0, 8);
let state = 'ready';
let mode = 'camera';
let source = 'camera';
let facingMode = 'environment';
let stream = null;
let engine = null;
let enginePromise = null;
let generation = 0;
let raf = 0;
let elapsedMs = 0;
let lastTick = 0;
let lastAnalysis = 0;
let lastVideoTime = -1;
let cues = [];
let movements = 0;
let movementOffset = 0;
let lastSpoken = 0;
let toastTimer;
let objectUrl;
let wakeLock;
let demoState = createAnalysisState('football');
let demoLastCue = 0;
let sessionSkill = 'football';
let sessionGoal = skills.football.goal;

const formatTime = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const text = (id, value) => { if ($(id)) $(id).textContent = value; };
function toast(message) {
  text('toast', message); $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function setState(next) {
  state = next;
  app.dataset.state = next;
  const active = ['live', 'paused', 'loading'].includes(next);
  $('skillSelect').disabled = active;
  $('goalInput').disabled = active;
  text('statusText', {ready:'Готов к тренировке',loading:'Подключаем тренера',live:mode === 'demo' ? 'Демонстрация тренировки' : 'Тренер наблюдает',paused:'Тренировка на паузе',finished:'Тренировка завершена',error:'Давай попробуем ещё раз'}[next]);
  $('cameraPlaceholder').hidden = !['ready', 'error', 'finished'].includes(next);
  $('pauseSession').setAttribute('aria-label', next === 'paused' ? 'Продолжить тренировку' : 'Приостановить тренировку');
  $('pauseSession').querySelector('span').textContent = next === 'paused' ? 'Продолжить' : 'Пауза';
  $('switchCamera').disabled = mode === 'demo' || source === 'file' || next === 'loading';
}
function updateSkill() {
  const skill = skills[$('skillSelect').value] || skills.football;
  $('goalInput').value = skill.goal;
  text('sessionGoal', skill.goal);
  text('skillDescription', skill.description);
  text('movementLabel', skill.label);
}
function applyPreferences() {
  for (const key of ['voice', 'skeleton', 'mirror']) $(key+'Input').checked = !!prefs[key];
  $('toggleVoice').setAttribute('aria-pressed', String(!!prefs.voice));
  $('toggleSkeleton').setAttribute('aria-pressed', String(!!prefs.skeleton));
  overlay.style.opacity = prefs.skeleton ? '1' : '0';
  video.style.transform = prefs.mirror && source !== 'file' ? 'scaleX(-1)' : '';
  overlay.style.transform = prefs.mirror && source !== 'file' ? 'scaleX(-1)' : '';
  storage.write('ai-coach:preferences', prefs);
}
function speak(message) {
  if (!prefs.voice || !('speechSynthesis' in window) || performance.now() - lastSpoken < 6000 || state !== 'live') return;
  lastSpoken = performance.now();
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = 'ru-RU'; utterance.rate = 1.03;
  const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith('ru'));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}
function addFeedback(feedback) {
  if (!feedback?.text) return;
  if (cues.at(-1)?.text === feedback.text && elapsedMs - cues.at(-1).at < 12000) return;
  cues.push({ text: feedback.text, kind: feedback.kind || 'tip', tag: feedback.tag || 'Техника', at: elapsedMs });
  cues = cues.slice(-100);
  const item = document.createElement('div'); item.className = `feedback-item ${feedback.kind || 'tip'}`;
  const avatar = document.createElement('span'); avatar.className = 'feedback-avatar'; avatar.textContent = '✦';
  const bubble = document.createElement('div'); bubble.className = 'feedback-bubble';
  const author = document.createElement('strong'); author.textContent = mode === 'demo' ? 'AI-тренер · демо' : 'AI-тренер';
  const p = document.createElement('p'); p.textContent = feedback.text;
  bubble.append(author, p); item.append(avatar, bubble); $('feedbackList').append(item);
  while ($('feedbackList').children.length > 3) $('feedbackList').firstElementChild.remove();
  renderInsights(); text('cueValue', cues.length); speak(feedback.text);
}
function renderInsights() {
  $('insightList').replaceChildren();
  for (const cue of cues.slice(-4).reverse()) {
    const item = document.createElement('div'); item.className = 'insight-item';
    const label = document.createElement('small'); label.textContent = `${formatTime(Math.floor(cue.at/1000))} · ${cue.tag}`;
    const p = document.createElement('p'); p.textContent = cue.text;
    item.append(label, p); $('insightList').append(item);
  }
}
function renderHistory() {
  $('historyList').replaceChildren();
  $('clearHistory').disabled = history.length === 0;
  if (!history.length) {
    const empty = document.createElement('div'); empty.className = 'history-empty';
    const copy = document.createElement('div');
    const h = document.createElement('h3'); h.textContent = 'Первая тренировка — начало истории';
    const p = document.createElement('p'); p.textContent = 'Здесь появятся итоги твоих тренировок. Демо в историю не записывается.';
    copy.append(h,p); empty.append(copy); $('historyList').append(empty); return;
  }
  for (const session of history) {
    const row = document.createElement('article'); row.className = 'history-session';
    const title = document.createElement('strong'); title.textContent = session.goal;
    const details = document.createElement('span'); details.textContent = `${new Date(session.date).toLocaleDateString('ru-RU',{day:'numeric',month:'short'})} · ${formatTime(session.seconds)} · ${session.movements} движений · ${session.cues} подсказок`;
    row.append(title,details); $('historyList').append(row);
  }
}
function releaseMedia() {
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null; video.pause(); video.srcObject = null;
  video.removeAttribute('src'); video.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  if (wakeLock) { wakeLock.release().catch(()=>{}); wakeLock = null; }
}
function cancelRun() {
  generation++; cancelAnimationFrame(raf); raf = 0; releaseMedia();
  overlay.getContext('2d').clearRect(0,0,overlay.width,overlay.height);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
async function ensureEngine(run) {
  if (!enginePromise) {
    const pending = createCoachEngine({ onStatus(message) { if (generation === run) text('modelStatus', message); } })
      .then(value => {
        if (enginePromise !== pending) { value.close(); throw new DOMException('Session cancelled','AbortError'); }
        engine = value; return value;
      }).catch(error => { if (enginePromise === pending) enginePromise = null; throw error; });
    enginePromise = pending;
  }
  return enginePromise;
}
function resetSession(newMode, newSource) {
  cancelRun();
  mode = newMode; source = newSource; app.dataset.mode = mode;
  elapsedMs = 0; cues = []; movements = 0; movementOffset = 0; lastAnalysis = 0; lastVideoTime = -1; lastSpoken = -10000;
  sessionSkill = $('skillSelect').value;
  sessionGoal = $('goalInput').value.trim() || skills[sessionSkill].goal;
  text('sessionGoal', sessionGoal); text('movementLabel',skills[sessionSkill].label);
  text('timerValue','00:00'); text('movementValue','0'); text('cueValue','0');
  $('sessionProgress').style.width = '0%'; $('feedbackList').replaceChildren(); $('insightList').replaceChildren();
  $('cameraError').hidden = true;
  $('summaryDialog').close();
  text('sessionLabel', mode === 'demo' ? 'РЕЖИМ ЗНАКОМСТВА' : 'ПРИВАТНАЯ СЕССИЯ');
  text('modeBadge',mode === 'demo' ? 'ДЕМО' : source === 'file' ? 'ВИДЕО' : 'LIVE');
  applyPreferences();
  return generation;
}
async function startCamera() {
  const run = resetSession('camera','camera'); setState('loading');
  text('modelStatus','Подключаем камеру…');
  try {
    if (!window.isSecureContext) throw new Error('Для камеры нужна HTTPS-ссылка или localhost. Открой опубликованную версию.');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Этот браузер не поддерживает камеру. Открой сайт в Safari или Chrome.');
    const media = await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:720},height:{ideal:1280}}});
    if (generation !== run) { media.getTracks().forEach(t=>t.stop()); return; }
    stream = media; video.srcObject = media; await video.play();
    await ensureEngine(run); if (generation !== run) return;
    engine.reset(sessionSkill); beginLive(run);
  } catch (error) { if (generation === run) showError(error); }
}
async function startFile(file) {
  if (!file) return;
  if (!file.type.startsWith('video/')) { toast('Выбери видеофайл.'); return; }
  const run = resetSession('camera','file'); setState('loading'); text('modelStatus','Подготавливаем видео…');
  try {
    objectUrl = URL.createObjectURL(file); video.src = objectUrl; video.loop = false;
    await video.play(); await ensureEngine(run); if (generation !== run) return;
    video.currentTime = 0;
    await video.play(); if (generation !== run) return;
    engine.reset(sessionSkill); beginLive(run);
  } catch (error) { if (generation === run) showError(error); }
}
function startDemo() {
  const run = resetSession('demo','demo'); demoState = createAnalysisState(sessionSkill); demoLastCue = -10000;
  text('modelStatus','Демо · симуляция движений'); beginLive(run);
  addFeedback({text:'Это демонстрация интерфейса. В тренировке подсказки будут зависеть от твоих движений.',tag:'Знакомство',kind:'tip'});
}
function beginLive(run) {
  setState('live'); lastTick = performance.now(); text('stageHint',mode === 'demo' ? 'Симуляция · не анализ камеры' : 'Встань так, чтобы были видны обе стопы и плечи');
  if (mode !== 'demo') text('modelStatus','Тренер готов · анализ на устройстве');
  if (navigator.wakeLock && mode !== 'demo') navigator.wakeLock.request('screen').then(lock=>{if(generation===run) wakeLock=lock; else lock.release();}).catch(()=>{});
  raf = requestAnimationFrame(t=>tick(t,run));
}
function showError(error) {
  cancelRun(); setState('error'); text('modelStatus','Тренер пока не подключён');
  const messages = {NotAllowedError:'Доступ к камере не разрешён. Разреши камеру в настройках сайта или попробуй демо.',NotFoundError:'Камера не найдена. Подключи камеру или открой видеофайл.',NotReadableError:'Камера занята другим приложением. Закрой его и попробуй снова.'};
  const message = messages[error.name] || (error.message?.includes('HTTPS') ? error.message : 'Не удалось подготовить тренировку. Проверь интернет и доступ к камере. Можно открыть демо.');
  text('cameraError',message); $('cameraError').hidden = false; text('stageHint','Демо доступно без камеры');
  console.warn('AI-Coach session:',error.name,error.message);
}
function stopSession(showSummary = true) {
  const wasActive = ['live','paused'].includes(state);
  const wasDemo = mode === 'demo';
  const record = {date:new Date().toISOString(),goal:sessionGoal,skill:sessionSkill,seconds:Math.floor(elapsedMs/1000),movements,cues:cues.length};
  cancelRun(); engine?.reset(sessionSkill); setState('finished');
  text('stageHint','Готов к следующему шагу?');
  if (!wasActive || !showSummary) return;
  if (!wasDemo && record.seconds > 0) { history.unshift(record); history = history.slice(0,8); storage.write('ai-coach:sessions',history); renderHistory(); }
  text('summaryTime',formatTime(record.seconds)); text('summaryMovements',movements); text('summaryCues',cues.length);
  $('summaryNotes').replaceChildren();
  const note = document.createElement('p'); note.textContent = wasDemo ? 'Это была демонстрация. Её показатели условные и не сохранены в истории. Попробуй тренировку с камерой.' : 'Сохранён итог без видео. Движения определяются по позе: это не точный счёт касаний мяча и не оценка техники профессиональным тренером.';
  $('summaryNotes').append(note);
  for (const cue of cues.slice(-2)) { const p=document.createElement('p');p.textContent=cue.text;$('summaryNotes').append(p); }
  $('summaryDialog').querySelector('.summary-private').textContent = wasDemo ? 'Демо не сохраняется в историю.' : 'Сохранён только итог. Видео не записывалось.';
  $('summaryDialog').showModal();
}
async function togglePause() {
  if (state === 'live') {
    setState('paused'); cancelAnimationFrame(raf); video.pause();
    stream?.getVideoTracks().forEach(t=>{t.enabled=false;});
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    text('stageHint','Пауза · продолжи, когда будешь готов');
  } else if (state === 'paused') {
    stream?.getVideoTracks().forEach(t=>{t.enabled=true;});
    if (mode !== 'demo') { try { await video.play(); } catch(error) { showError(error);return; } }
    if (state !== 'paused') return;
    setState('live'); lastTick=performance.now(); raf=requestAnimationFrame(t=>tick(t,generation));
    text('stageHint',mode === 'demo' ? 'Симуляция · не анализ камеры' : 'Продолжаем · двигайся в своём темпе');
  }
}
function tick(now, run) {
  if (run !== generation || state !== 'live') return;
  elapsedMs += Math.min(now-lastTick,1000); lastTick = now;
  text('timerValue',formatTime(Math.floor(elapsedMs/1000)));
  $('sessionProgress').style.width = `${Math.min(elapsedMs/180000*100,100)}%`;
  if (mode === 'demo') renderDemo(now);
  else if (now-lastAnalysis >= 120 && video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastAnalysis=now; lastVideoTime=video.currentTime;
    try {
      const result=engine.analyze(video,now,sessionSkill);
      movements=movementOffset+(result.metrics.movements || result.metrics.reps || 0);
      text('movementValue',movements); drawPose(result.landmarks);
      text('stageHint',result.quality==='missing' ? 'Не вижу всё тело · отойди от камеры и добавь света' : result.quality==='partial' ? 'Проверь, что плечи, колени и стопы в кадре' : 'Движения видны · продолжай в своём темпе');
      if (result.feedback) addFeedback(result.feedback);
    } catch(error) { showError(error); return; }
  }
  raf=requestAnimationFrame(t=>tick(t,run));
}
function canvasContext(canvas) {
  const {width,height}=canvas.getBoundingClientRect(); const ratio=Math.min(devicePixelRatio||1,2);
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);return {ctx,width,height};
}
function drawPose(landmarks) {
  const {ctx,width,height}=canvasContext(overlay); ctx.clearRect(0,0,width,height);
  if (!landmarks?.length || !prefs.skeleton || !video.videoWidth) return;
  const scale=Math.max(width/video.videoWidth,height/video.videoHeight);
  const ox=(width-video.videoWidth*scale)/2,oy=(height-video.videoHeight*scale)/2;
  const point=p=>({x:p.x*video.videoWidth*scale+ox,y:p.y*video.videoHeight*scale+oy});
  ctx.lineWidth=2;ctx.strokeStyle='rgba(212,255,90,.8)';ctx.fillStyle='#e1ff8a';
  for(const [a,b] of POSE_CONNECTIONS){const p=landmarks[a],q=landmarks[b];if(!p||!q||(p.visibility??1)<.5||(q.visibility??1)<.5)continue;const u=point(p),v=point(q);ctx.beginPath();ctx.moveTo(u.x,u.y);ctx.lineTo(v.x,v.y);ctx.stroke();}
  for(const p of landmarks){if((p.visibility??1)<.5)continue;const v=point(p);ctx.beginPath();ctx.arc(v.x,v.y,3,0,Math.PI*2);ctx.fill();}
}
function demoPose(seconds) {
  const p=Array.from({length:33},()=>({x:.5,y:.25,z:0,visibility:1}));
  const set=(i,x,y)=>{p[i]={x,y,z:0,visibility:1};};
  set(0,.5,.19);set(11,.42,.31);set(12,.58,.31);set(13,.36,.43);set(14,.65,.42);set(15,.31,.52);set(16,.69,.49);set(23,.45,.53);set(24,.55,.53);set(25,.43,.7);set(26,.58,.7);set(27,.41,.88);set(28,.61,.88);set(29,.40,.89);set(30,.62,.89);set(31,.37,.9);set(32,.66,.9);
  const lift=Math.pow(Math.max(0,Math.sin(seconds*1.55)),2)*.2;
  if(sessionSkill==='squats'){
    const d=(Math.sin(seconds*1.25)+1)/2;
    for(const i of [0,11,12,13,14,15,16,23,24])p[i].y+=d*.15;
    p[25].x=.43-d*.15;p[26].x=.58+d*.15;
  }else{
    for(const i of [28,30,32])p[i].y-=sessionSkill==='balance'?.13:lift;
    p[26].y-=lift*.45;p[26].x+=lift*.2;
  }
  return p;
}
function renderDemo(now) {
  const {ctx,width:w,height:h}=canvasContext(demoCanvas);ctx.clearRect(0,0,w,h);
  const gradient=ctx.createLinearGradient(0,0,w,h);gradient.addColorStop(0,'#25312c');gradient.addColorStop(1,'#0e1713');ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='rgba(212,255,90,.09)';ctx.lineWidth=1;
  for(let n=0;n<9;n++){ctx.beginPath();ctx.moveTo(w/2,h*.38);ctx.lineTo(w*(n/8),h);ctx.stroke();}
  for(let n=0;n<7;n++){const y=h*(.47+n*.085);ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  const points=demoPose(elapsedMs/1000);
  const map=p=>({x:p.x*w,y:p.y*h*.82+h*.05});
  const parts=[[11,12],[11,23],[12,24],[23,24],[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28],[27,31],[28,32]];
  ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=w*.026;ctx.strokeStyle='#92b795';
  for(const [a,b]of parts){const u=map(points[a]),v=map(points[b]);ctx.beginPath();ctx.moveTo(u.x,u.y);ctx.lineTo(v.x,v.y);ctx.stroke();}
  const head=map(points[0]);ctx.fillStyle='#b1c8ab';ctx.beginPath();ctx.arc(head.x,head.y,w*.049,0,Math.PI*2);ctx.fill();
  ctx.lineWidth=2;ctx.strokeStyle='#d4ff5a';ctx.fillStyle='#d4ff5a';
  for(const i of [11,12,13,14,23,24,25,26,27,28]){const v=map(points[i]);ctx.beginPath();ctx.arc(v.x,v.y,4,0,Math.PI*2);ctx.fill();}
  if(sessionSkill==='football'){
    const foot=map(points[32]);const ballY=foot.y-30-Math.abs(Math.sin(elapsedMs/1000*1.55))*h*.1;
    ctx.fillStyle='#e0ff88';ctx.beginPath();ctx.arc(foot.x+14,ballY,w*.042,0,Math.PI*2);ctx.fill();ctx.fillStyle='#1a2616';ctx.font=`${w*.035}px sans-serif`;ctx.fillText('⬡',foot.x+6,ballY+5);
  }
  if(now-lastAnalysis>120){
    const result=analyzePose(points,sessionSkill,demoState,now);demoState=result.state;lastAnalysis=now;
    movements=result.metrics.movements||result.metrics.reps||0;text('movementValue',movements);
    if(now-demoLastCue>6500){
      const examples={football:['Сначала попробуй без мяча: приподними стопу и верни её на пол.','Опорная нога помогает держать равновесие. Начни с невысокого подъёма.','Держи плечи спокойно. Лучше несколько контролируемых движений, чем спешка.'],squats:['Двигайся плавно и оставляй пятки на полу.','Выбирай комфортную глубину. Не продолжай через боль.','После приседания вернись в исходное положение.'],balance:['Найди устойчивую точку перед собой и смотри на неё.','Приподними одну стопу. Держи опору рядом.','Верни ногу на пол, если теряешь равновесие.']};
      const list=examples[sessionSkill];addFeedback({text:list[Math.floor(elapsedMs/6500)%list.length],tag:'Пример подсказки',kind:'tip'});demoLastCue=now;
    }
  }
}

$('startCamera').addEventListener('click',startCamera);
$('startDemo').addEventListener('click',startDemo);
$('stopSession').addEventListener('click',()=>stopSession());
$('pauseSession').addEventListener('click',togglePause);
$('switchCamera').addEventListener('click',async()=>{
  if(!['live','paused'].includes(state)||source!=='camera')return;
  const previousFacing=facingMode;
  facingMode=facingMode==='user'?'environment':'user';
  const offset=movements;
  cancelRun();const run=generation;setState('loading');
  text('modelStatus','Переключаем камеру…');
  try{
    const media=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:720},height:{ideal:1280}}});
    if(run!==generation){media.getTracks().forEach(t=>t.stop());return;}
    stream=media;video.srcObject=media;await video.play();if(run!==generation)return;
    engine.reset(sessionSkill);movementOffset=offset;lastVideoTime=-1;
    applyPreferences();beginLive(run);toast('Камера переключена. Тренировка продолжается.');
  }catch(error){facingMode=previousFacing;if(run===generation)showError(error);}
});
$('toggleVoice').addEventListener('click',()=>{prefs.voice=!prefs.voice;applyPreferences();if(!prefs.voice&&'speechSynthesis'in window)speechSynthesis.cancel();toast(prefs.voice?'Голосовые подсказки включены':'Голосовые подсказки выключены');});
$('toggleSkeleton').addEventListener('click',()=>{prefs.skeleton=!prefs.skeleton;applyPreferences();});
$('openSettings').addEventListener('click',()=>$('settingsDialog').showModal());
$('closeSettings').addEventListener('click',()=>$('settingsDialog').close());
$('closeSummary').addEventListener('click',()=>$('summaryDialog').close());
$('restartSession').addEventListener('click',()=>{$('summaryDialog').close();setState('ready');startCamera();});
for(const key of ['voice','skeleton','mirror'])$(key+'Input').addEventListener('change',()=>{prefs[key]=$(key+'Input').checked;applyPreferences();if(key==='voice'&&!prefs.voice&&'speechSynthesis'in window)speechSynthesis.cancel();});
for(const dialog of [$('settingsDialog'),$('summaryDialog')])dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
$('skillSelect').addEventListener('change',updateSkill);
$('goalInput').addEventListener('input',()=>text('sessionGoal',$('goalInput').value.trim()||skills[$('skillSelect').value].goal));
$('clearHistory').addEventListener('click',()=>{history=[];storage.write('ai-coach:sessions',history);renderHistory();toast('История тренировок очищена');});
$('uploadVideo').addEventListener('click',()=>$('videoFile').click());
$('videoFile').addEventListener('change',e=>{startFile(e.target.files[0]);e.target.value='';});
video.addEventListener('ended',()=>{if(source==='file'&&state==='live')stopSession();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state==='live'){togglePause();toast('Тренировка на паузе, пока вкладка скрыта');}});
window.addEventListener('pagehide',()=>{const pending=enginePromise;cancelRun();engine=null;enginePromise=null;pending?.then(value=>{value.close();if(engine===value)engine=null;}).catch(()=>{});setState('ready');});
window.addEventListener('pageshow',event=>{if(event.persisted){setState('ready');text('modelStatus','AI подключится при старте');}});
applyPreferences();updateSkill();renderHistory();setState('ready');
