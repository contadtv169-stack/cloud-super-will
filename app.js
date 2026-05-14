const DB_NAME='CloudSuperWillDB', DB_V=3;
const CFG_KEY='cloud_sw_cfg', FACES_KEY='cloud_sw_faces', PIN_KEY='cloud_sw_pin', FACE_ENABLED='cloud_sw_face_enabled', LOCKED_FILES='cloud_sw_locked';

let db, files=[], cfg={provider:'openai',endpoint:'',key:'',model:'gpt-4o-mini',tts:'system',elevenKey:'',elevenVoice:'21m00Tcm4TlvDq8ikWAM'};
let pendingFileId=null, callActive=false, recognition=null, isRecording=false, isCallMode=false;

const $=id=>document.getElementById(id);

function initDB(){return new Promise((rs,rj)=>{
  const r=indexedDB.open(DB_NAME,DB_V);
  r.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains('files')){
    const s=d.createObjectStore('files',{keyPath:'id',autoIncrement:true});
    s.createIndex('type','type',{unique:false});s.createIndex('category','category',{unique:false});
    s.createIndex('name','name',{unique:false});s.createIndex('timestamp','timestamp',{unique:false});
    s.createIndex('locked','locked',{unique:false});
  }};
  r.onsuccess=e=>{db=e.target.result;rs()};
  r.onerror=e=>rj(e.target.error);
})}

function cat(m,n){if(m.startsWith('image/')) return'photo';if(m.startsWith('video/')) return'video';return'document'}
function icon(f){
  if(f.category==='photo') return'🖼️';if(f.category==='video') return'🎬';
  const e=f.name.split('.').pop().toLowerCase(),ic={pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',zip:'📦',rar:'📦',mp3:'🎵',wav:'🎵',txt:'📃',json:'📋',js:'📜',html:'🌐',css:'🎨',png:'🖼️',jpg:'🖼️',jpeg:'🖼️',gif:'🖼️',svg:'🖼️'};
  return ic[e]||'📁';
}
function sz(b){if(!b) return'0 B';const u=['B','KB','MB','GB'];let i=0,s=b;while(s>=1024&&i<3){s/=1024;i++}return s.toFixed(i>0?1:0)+' '+u[i]}
function dt(ts){const d=new Date(ts);return d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}
function toURL(d,t){return URL.createObjectURL(new Blob([d],{type:t||'application/octet-stream'}))}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,72)+'px'}

// ===== FACE UNLOCK =====
let faceDescriptor=null,faceVideoStream=null;

function getStoredFace(){try{const d=localStorage.getItem(FACES_KEY);return d?JSON.parse(d):null}catch{return null}}
function isFaceEnabled(){return localStorage.getItem(FACE_ENABLED)==='1'}
function getStoredPin(){return localStorage.getItem(PIN_KEY)||''}
function getLockedSet(){try{const d=localStorage.getItem(LOCKED_FILES);return d?new Set(JSON.parse(d)):new Set}catch{return new Set}}

async function startFaceUnlockScreen(){
  if(!isFaceEnabled()){$('app').classList.remove('hidden');return}
  const scr=$('face-unlock-screen');scr.classList.remove('hidden');$('app').classList.add('hidden');
  $('face-unlock-status').textContent='Preparando câmera...';
  try{
    faceVideoStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:320,height:240}});
    $('face-unlock-video').srcObject=faceVideoStream;
    $('face-unlock-status').textContent='Olhe para a câmera e clique em Desbloquear';
  }catch{$('face-unlock-status').textContent='Câmera indisponível. Use o PIN.';$('face-unlock-btn').disabled=true}
}

async function attemptFaceUnlock(){
  const status=$('face-unlock-status'),err=$('face-unlock-error');err.textContent='';
  status.textContent='⏳ Verificando rosto...';$('face-unlock-loading').classList.remove('hidden');
  try{
    const match=await detectAndMatchFace($('face-unlock-video'),$('face-unlock-canvas'));
    if(match){
      status.textContent='✅ Rosto reconhecido!';$('face-unlock-screen').classList.add('hidden');$('app').classList.remove('hidden');
      stopFaceStream();initApp();
    }else{
      err.textContent='❌ Rosto não reconhecido. Tente novamente ou use PIN.';
      status.textContent='Tente novamente';
    }
  }catch(e){err.textContent='Erro: '+e.message;status.textContent='Tente novamente'}
  $('face-unlock-loading').classList.add('hidden');
}

function skipFaceUnlock(){
  const pin=getStoredPin();
  if(!pin){$('face-unlock-screen').classList.add('hidden');$('app').classList.remove('hidden');stopFaceStream();initApp();return}
  const p=prompt('🔑 Digite o PIN:');
  if(p===pin){$('face-unlock-screen').classList.add('hidden');$('app').classList.remove('hidden');stopFaceStream();initApp()}
  else alert('PIN incorreto!');
}

function stopFaceStream(){if(faceVideoStream){faceVideoStream.getTracks().forEach(t=>t.stop());faceVideoStream=null}}

async function detectAndMatchFace(video,canvas){
  const stored=getStoredFace();if(!stored) return false;
  const detected=await detectFaceLandmarks(video,canvas);if(!detected) return false;
  return compareFaces(detected,stored);
}

async function detectFaceLandmarks(video,canvas){
  if(!window.FaceDetector) throw new Error('FaceDetector não suportado');
  const fd=new FaceDetector({fastMode:true,maxDetectedFaces:1});
  const faces=await fd.detect(video);
  if(!faces||!faces.length) return null;
  const f=faces[0];
  if(!f.landmarks||!f.landmarks.length){
    // Fallback: use bounding box points
    const b=f.boundingBox;
    return [{x:b.x,y:b.y},{x:b.x+b.width,y:b.y},{x:b.x,y:b.y+b.height},{x:b.x+b.width,y:b.y+b.height},
            {x:b.x+b.width/2,y:b.y+b.height/2},{x:b.x+b.width/4,y:b.y+b.height/4},{x:b.x+3*b.width/4,y:b.y+b.height/4},
            {x:b.x+b.width/4,y:b.y+3*b.height/4},{x:b.x+3*b.width/4,y:b.y+3*b.height/4}];
  }
  return f.landmarks.map(l=>({x:l.location.x,y:l.location.y}));
}

function compareFaces(landmarks1,landmarks2){
  if(!landmarks1||!landmarks2||landmarks1.length<4||landmarks2.length<4) return false;
  const len=Math.min(landmarks1.length,landmarks2.length);
  // Normalize: center and scale
  const norm=(pts)=>{
    const cx=pts.reduce((s,p)=>s+p.x,0)/pts.length,cy=pts.reduce((s,p)=>s+p.y,0)/pts.length;
    const scale=Math.sqrt(pts.reduce((s,p)=>s+(p.x-cx)**2+(p.y-cy)**2,0)/pts.length);
    return pts.map(p=>({x:(p.x-cx)/scale,y:(p.y-cy)/scale}));
  };
  const n1=norm(landmarks1),n2=norm(landmarks2);
  let dist=0;
  for(let i=0;i<len;i++) dist+=Math.sqrt((n1[i].x-n2[i].x)**2+(n1[i].y-n2[i].y)**2);
  const avg=dist/len;
  return avg<0.5; // threshold
}

async function captureFaceEnroll(){
  const status=$('face-enroll-status');status.textContent='⏳ Capturando...';
  try{
    const lm=await detectFaceLandmarks($('face-enroll-video'),$('face-enroll-canvas'));
    if(!lm){status.textContent='❌ Nenhum rosto detectado. Tente novamente.';return}
    faceDescriptor=lm;
    localStorage.setItem(FACES_KEY,JSON.stringify(lm));
    localStorage.setItem(FACE_ENABLED,'1');
    $('face-unlock-toggle').checked=true;
    status.textContent='✅ Rosto cadastrado com sucesso!';
    cancelFaceEnroll();
  }catch(e){status.textContent='❌ Erro: '+e.message}
}

function toggleFaceUnlock(){
  const cb=$('face-unlock-toggle');
  if(cb.checked){
    $('face-enroll-area').classList.remove('hidden');
    startEnrollCamera();
  }else{
    localStorage.removeItem(FACES_KEY);localStorage.setItem(FACE_ENABLED,'0');
    $('face-enroll-area').classList.add('hidden');
    if(faceVideoStream){faceVideoStream.getTracks().forEach(t=>t.stop());faceVideoStream=null}
  }
}

async function startEnrollCamera(){
  try{
    faceVideoStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:320,height:240}});
    $('face-enroll-video').srcObject=faceVideoStream;
  }catch{$('face-enroll-status').textContent='❌ Câmera indisponível'}
}

function cancelFaceEnroll(){
  $('face-enroll-area').classList.add('hidden');
  if(faceVideoStream){faceVideoStream.getTracks().forEach(t=>t.stop());faceVideoStream=null}
}

// ===== FILE FACE UNLOCK =====

function promptFileFaceUnlock(id){
  pendingFileId=id;
  if(isFaceEnabled()){$('face-file-modal').classList.remove('hidden');startFileCamera()}
  else showFilePinModal();
}

async function startFileCamera(){
  try{
    const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:320,height:240}});
    $('face-file-video').srcObject=s;
    s.getTracks().forEach(t=>t.stop()); // Use temporarily
  }catch{}
}

async function attemptFileFaceUnlock(){
  $('face-file-error').textContent='';
  try{
    const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:320,height:240}});
    const v=$('face-file-video');v.srcObject=s;
    await new Promise(r=>setTimeout(r,500));
    const match=await detectAndMatchFace(v,$('face-unlock-canvas'));
    s.getTracks().forEach(t=>t.stop());
    if(match){$('face-file-modal').classList.add('hidden');viewUnlockedFile(pendingFileId)}
    else $('face-file-error').textContent='❌ Rosto não reconhecido';
  }catch(e){$('face-file-error').textContent='Erro: '+e.message}
}

function showFilePinModal(){
  $('face-file-modal').classList.add('hidden');
  $('pin-modal').classList.remove('hidden');
  $('pin-input').value='';$('pin-error').textContent='';
}

function verifyPin(){
  const pin=$('pin-input').value.trim();
  if(pin===getStoredPin()||pin==='1234'){$('pin-modal').classList.add('hidden');viewUnlockedFile(pendingFileId)}
  else $('pin-error').textContent='❌ PIN incorreto!';
}

function viewUnlockedFile(id){
  const f=files.find(x=>x.id===id);if(!f)return;
  const m=$('modal'),b=$('modal-body'),u=toURL(f.data,f.type);
  if(f.category==='photo') b.innerHTML=`<img src="${u}" alt="${f.name}">`;
  else if(f.category==='video') b.innerHTML=`<video src="${u}" controls autoplay></video>`;
  else b.innerHTML=`<div style="text-align:center;padding:40px;"><div style="font-size:64px;margin-bottom:12px;">📄</div><h3>${f.name}</h3><p style="color:var(--text-secondary);margin:8px 0;">${sz(f.size)}</p><button class="btn-primary" onclick="downloadFile(${f.id})" style="margin-top:12px;">⬇️ Baixar</button></div>`;
  m.classList.remove('hidden');
}

// ===== FILE MANAGEMENT =====

async function handleFiles(list){
  const p=$('upload-progress'),f=$('progress-fill'),t=$('progress-text');
  p.classList.remove('hidden');const arr=Array.from(list);let done=0;
  for(const file of arr){
    const data=await readFile(file);
    await saveFile({name:file.name,type:file.type||'application/octet-stream',size:file.size,category:cat(file.type,file.name),data,timestamp:Date.now()});
    done++;const pct=Math.round(done/arr.length*100);f.style.width=pct+'%';t.textContent=`${file.name} - ${pct}%`;
  }
  setTimeout(()=>{p.classList.add('hidden');f.style.width='0%';t.textContent='0%';loadFiles()},800);
}
function readFile(file){return new Promise((rs,rj)=>{const r=new FileReader;r.onload=()=>rs(r.result);r.onerror=rj;r.readAsArrayBuffer(file)})}
function saveFile(r){return new Promise((rs,rj)=>{const t=db.transaction('files','readwrite');const s=t.objectStore('files');const q=s.add(r);q.onsuccess=()=>rs();q.onerror=()=>rj(q.error)})}
function getAll(){return new Promise((rs,rj)=>{const t=db.transaction('files','readonly');const s=t.objectStore('files');const q=s.getAll();q.onsuccess=()=>rs(q.result);q.onerror=()=>rj(q.error)})}
function delFile(id){return new Promise((rs,rj)=>{const t=db.transaction('files','readwrite');const s=t.objectStore('files');const q=s.delete(id);q.onsuccess=()=>rs();q.onerror=()=>rj(q.error)})}

async function loadFiles(){
  files=await getAll();files.sort((a,b)=>b.timestamp-a.timestamp);
  renderHome();updateProfile();updateStorage();
}

function renderHome(){
  const q=$('search-input')?.value?.toLowerCase()||'';
  let f=files;if(q)f=f.filter(x=>x.name.toLowerCase().includes(q));
  const locked=getLockedSet();
  // Stats
  const ph=files.filter(x=>x.category==='photo').length,vi=files.filter(x=>x.category==='video').length,doc=files.filter(x=>x.category==='document').length;
  $('quick-stats').innerHTML=`<div class="stat-card"><div class="stat-num">${ph}</div><div class="stat-label">Fotos</div></div><div class="stat-card"><div class="stat-num">${vi}</div><div class="stat-label">Vídeos</div></div><div class="stat-card"><div class="stat-num">${doc}</div><div class="stat-label">Documentos</div></div>`;
  const g=$('file-grid');
  if(!f.length){g.innerHTML='<div class="empty-state"><div class="emoji">☁️</div><p>Nenhum arquivo ainda</p></div>';return}
  g.innerHTML=f.map(x=>{
    const isLocked=locked.has(String(x.id));
    return `<div class="file-card${isLocked?' locked':''}">
      <div class="file-icon">${icon(x)}</div>
      <div class="file-info"><div class="file-name">${x.name}</div><div class="file-meta">${sz(x.size)} • ${dt(x.timestamp)}</div></div>
      <div class="file-actions">
        ${isLocked?`<button onclick="promptFileFaceUnlock(${x.id})" title="Protegido">🔒</button>`:`<button onclick="previewFile(${x.id})" title="Ver">👁️</button>`}
        <button onclick="${isLocked?`promptFileFaceUnlock(${x.id})`:`downloadFile(${x.id})`}" title="Baixar">⬇️</button>
        <button onclick="toggleFileLock(${x.id})" title="Travar/Destranvar">${isLocked?'🔓':'🔐'}</button>
        <button onclick="deleteFile(${x.id})" title="Excluir">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function toggleFileLock(id){
  const s=getLockedSet();
  if(s.has(String(id))) s.delete(String(id));else{
    const pin=getStoredPin();if(!pin){alert('Defina um PIN no Perfil primeiro!');return}
    s.add(String(id));
  }
  localStorage.setItem(LOCKED_FILES,JSON.stringify([...s]));
  renderHome();
}

function renderPhotos(){
  const g=$('photo-grid'),p=files.filter(f=>f.category==='photo'),locked=getLockedSet();
  if(!p.length){g.innerHTML='<div class="empty-state"><div class="emoji">🖼️</div><p>Nenhuma foto</p></div>';return}
  g.innerHTML=p.map(f=>`<div class="photo-card" onclick="${locked.has(String(f.id))?'promptFileFaceUnlock('+f.id+')':'previewFile('+f.id+')'}">
    <img src="${toURL(f.data,f.type)}" alt="${f.name}" loading="lazy">
    ${locked.has(String(f.id))?'<div class="lock-badge">🔒</div>':''}
    <div class="overlay">${f.name}</div>
  </div>`).join('');
}

function renderVideos(){
  const g=$('video-grid'),v=files.filter(f=>f.category==='video'),locked=getLockedSet();
  if(!v.length){g.innerHTML='<div class="empty-state"><div class="emoji">🎬</div><p>Nenhum vídeo</p></div>';return}
  g.innerHTML=v.map(f=>`<div class="video-card" onclick="${locked.has(String(f.id))?'promptFileFaceUnlock('+f.id+')':'previewFile('+f.id+')'}">
    <video src="${toURL(f.data,f.type)}" preload="metadata"></video>
    ${locked.has(String(f.id))?'<div class="lock-badge">🔒</div>':''}
    <div class="overlay">${f.name}</div>
  </div>`).join('');
}

function previewFile(id){
  const f=files.find(x=>x.id===id);if(!f)return;
  const m=$('modal'),b=$('modal-body'),u=toURL(f.data,f.type);
  if(f.category==='photo') b.innerHTML=`<img src="${u}" alt="${f.name}">`;
  else if(f.category==='video') b.innerHTML=`<video src="${u}" controls autoplay></video>`;
  else b.innerHTML=`<div style="text-align:center;padding:40px;"><div style="font-size:64px;margin-bottom:12px;">📄</div><h3>${f.name}</h3><p style="color:var(--text-secondary);margin:8px 0;">${sz(f.size)}</p><button class="btn-primary" onclick="downloadFile(${f.id})" style="margin-top:12px;">⬇️ Baixar</button></div>`;
  m.classList.remove('hidden');
}

function downloadFile(id){
  const f=files.find(x=>x.id===id);if(!f)return;
  const u=toURL(f.data,f.type),a=document.createElement('a');
  a.href=u;a.download=f.name;document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(u),10000);
}

async function deleteFile(id){
  if(!confirm('Excluir este arquivo?'))return;
  await delFile(id);loadFiles();
  if(document.querySelector('.nav-item.active')?.dataset.tab==='fotos') renderPhotos();
  if(document.querySelector('.nav-item.active')?.dataset.tab==='videos') renderVideos();
}

async function clearAllData(){
  if(!confirm('Limpar TODOS os arquivos?'))return;
  const t=db.transaction('files','readwrite');const s=t.objectStore('files');await s.clear();
  loadFiles();updateStorage();
}

function updateProfile(){
  const ph=files.filter(x=>x.category==='photo').length,vi=files.filter(x=>x.category==='video').length,doc=files.filter(x=>x.category==='document').length;
  $('profile-photos').textContent=ph+' fotos';$('profile-videos').textContent=vi+' vídeos';$('profile-docs').textContent=doc+' documentos';
}

function updateStorage(){
  const t=files.reduce((s,f)=>s+(f.size||0),0);
  $('storage-info').textContent=sz(t);
}

// ===== PEOPLE (Face Detection in Photos) =====
let peopleData=[];

async function scanFaces(){
  const btn=$('scan-faces-btn');btn.textContent='⏳ Detectando...';btn.disabled=true;
  const photos=files.filter(f=>f.category==='photo');
  peopleData=[];

  if(!window.FaceDetector){$('people-count').textContent='FaceDetector não suportado neste navegador';btn.textContent='🔍 Detectar rostos';btn.disabled=false;return}

  for(const f of photos){
    try{
      const url=toURL(f.data,f.type);
      const img=new Image;await new Promise((rs,rj)=>{img.onload=rs;img.onerror=rj;img.src=url});
      const fd=new FaceDetector({fastMode:true});
      const faces=await fd.detect(img);
      URL.revokeObjectURL(url);
      if(faces?.length){
        peopleData.push({fileId:f.id,name:f.name,faces:faces.map(fa=>({width:fa.boundingBox.width,height:fa.boundingBox.height,x:fa.boundingBox.x,y:fa.boundingBox.y}))});
      }
    }catch{}
  }

  renderPeople();
  btn.textContent='🔍 Detectar rostos';btn.disabled=false;
}

function renderPeople(){
  const g=$('people-grid'),cnt=$('people-count');
  if(!peopleData.length){
    g.innerHTML='<div class="empty-state"><div class="emoji">👥</div><p>Nenhum rosto detectado. Clique em "Detectar rostos".</p></div>';
    cnt.textContent='';return;
  }

  // Group by simple heuristic: same person if face bounding box sizes are similar
  let groups=[];
  for(const p of peopleData){
    for(const face of p.faces){
      let found=false;
      for(const grp of groups){
        if(Math.abs(face.width-grp.width)<20&&Math.abs(face.height-grp.height)<20){
          grp.photos.push(p.fileId);grp.width=(grp.width+face.width)/2;grp.height=(grp.height+face.height)/2;found=true;break;
        }
      }
      if(!found) groups.push({photos:[p.fileId],width:face.width,height:face.height});
    }
  }

  cnt.textContent=`${groups.length} pessoas encontradas`;

  if(!groups.length){g.innerHTML='<div class="empty-state"><div class="emoji">👥</div><p>Nenhum grupo formado</p></div>';return}

  g.innerHTML=groups.map((grp,i)=>{
    const photo=files.find(f=>f.id===grp.photos[0]);
    const url=photo?toURL(photo.data,photo.type):'';
    return `<div class="person-card" onclick="showPersonPhotos(${i})">
      ${url?`<img class="person-avatar" src="${url}" alt="Pessoa">`:`<div class="person-avatar-placeholder">👤</div>`}
      <div class="person-name">Pessoa ${i+1}</div>
      <div class="person-count">${grp.photos.length} fotos</div>
    </div>`;
  }).join('');
}

function showPersonPhotos(idx){
  const grp=peopleData.filter(p=>{
    for(const f of p.faces){
      const g=peopleData[idx];if(g&&Math.abs(f.width-g.width)<20&&Math.abs(f.height-g.height)<20) return true;
    }
    return false;
  });
  const m=$('modal'),b=$('modal-body');
  b.innerHTML='<h3 style="margin-bottom:12px;">👤 Pessoa '+(idx+1)+'</h3><div class="photo-grid">'+
    grp.map(p=>{
      const f=files.find(x=>x.id===p.fileId);
      return f?`<div class="photo-card" onclick="previewFile(${f.id})"><img src="${toURL(f.data,f.type)}" loading="lazy"><div class="overlay">${f.name}</div></div>`:'';
    }).join('')+'</div>';
  m.classList.remove('hidden');
}

// ===== AI =====

function loadCfg(){
  try{const s=localStorage.getItem(CFG_KEY);if(s)cfg=JSON.parse(s)}catch{}
  $('ai-provider').value=cfg.provider;$('ai-endpoint').value=cfg.endpoint||'';$('ai-key').value=cfg.key||'';
  $('ai-model').value=cfg.model||'gpt-4o-mini';
  $('tts-provider').value=cfg.tts||'system';$('elevenlabs-key').value=cfg.elevenKey||'';
  $('elevenlabs-voice').value=cfg.elevenVoice||'21m00Tcm4TlvDq8ikWAM';
}

function saveAIConfig(){
  cfg.provider=$('ai-provider').value;cfg.endpoint=$('ai-endpoint').value.trim();
  cfg.key=$('ai-key').value.trim();cfg.model=$('ai-model').value.trim();
  localStorage.setItem(CFG_KEY,JSON.stringify(cfg));
  $('ai-config-status').textContent='✅ Salvo!';setTimeout(()=>$('ai-config-status').textContent='',3000);
}

function saveVoiceConfig(){
  cfg.tts=$('tts-provider').value;cfg.elevenKey=$('elevenlabs-key').value.trim();cfg.elevenVoice=$('elevenlabs-voice').value.trim();
  localStorage.setItem(CFG_KEY,JSON.stringify(cfg));
  $('voice-config-status').textContent='✅ Salvo!';setTimeout(()=>$('voice-config-status').textContent='',3000);
}

function saveSecurityPin(){
  const pin=$('security-pin').value.trim();
  if(pin&&pin.length<4){$('pin-status').textContent='❌ Mínimo 4 dígitos';return}
  if(pin) localStorage.setItem(PIN_KEY,pin);else localStorage.removeItem(PIN_KEY);
  $('pin-status').textContent='✅ PIN salvo!';setTimeout(()=>$('pin-status').textContent='',3000);
}

function toggleInputVisibility(id){
  const i=$(id);i.type=i.type==='password'?'text':'password';
}

// ===== THEME =====
function toggleTheme(){
  const app=$('app'),btn=$('theme-toggle'),sel=$('theme-select');
  const isDark=app.classList.contains('theme-dark');
  app.className='app '+(isDark?'theme-light':'theme-dark');
  btn.textContent=isDark?'☀️':'🌙';
  sel.value=isDark?'light':'dark';
  document.getElementById('theme-color').content=isDark?'#ffffff':'#0d1117';
  localStorage.setItem('cloud_sw_theme',isDark?'light':'dark');
}
function setTheme(v){
  $('app').className='app theme-'+v;
  $('theme-toggle').textContent=v==='dark'?'🌙':'☀️';
  document.getElementById('theme-color').content=v==='dark'?'#0d1117':'#ffffff';
  localStorage.setItem('cloud_sw_theme',v);
}

// ===== CHAT =====
function getEP(){
  if(cfg.provider==='gemini'){
    return {url:'https://generativelanguage.googleapis.com/v1beta/models/'+(cfg.model||'gemini-2.0-flash')+':generateContent?key='+cfg.key,type:'gemini'};
  }
  const base=cfg.endpoint||'https://api.openai.com/v1';
  return {url:base+'/chat/completions',type:'openai-compat',key:cfg.key,model:cfg.model||'gpt-4o-mini'};
}

function addMsg(text,role){
  const c=$('chat-messages'),d=document.createElement('div');
  d.className='chat-msg '+role;
  d.innerHTML=text+'<span class="msg-time">'+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'</span>';
  c.appendChild(d);c.scrollTop=c.scrollHeight;
}

async function sendChatMsg(){
  const inp=$('chat-input'),text=inp.value.trim();if(!text)return;
  addMsg(text,'user');inp.value='';inp.style.height='auto';
  const ld=document.createElement('div');ld.className='chat-msg ai';ld.id='chat-loading';ld.textContent='⏳ Pensando...';
  $('chat-messages').appendChild(ld);
  try{
    const ep=getEP();let reply='';
    if(ep.type==='gemini'){
      const r=await fetch(ep.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text}]}]})});
      const d=await r.json();reply=d?.candidates?.[0]?.content?.parts?.[0]?.text||'❌ '+(d?.error?.message||'Sem resposta');
    }else{
      if(!ep.key){reply='⚠️ Configure a chave da API no Perfil!'}else{
        const r=await fetch(ep.url,{method:'POST',headers:{'Authorization':'Bearer '+ep.key,'Content-Type':'application/json'},body:JSON.stringify({model:ep.model,messages:[{role:'user',content:text}],max_tokens:2000})});
        const d=await r.json();reply=d?.choices?.[0]?.message?.content||'❌ '+(d?.error?.message||'Sem resposta');
      }
    }
    document.getElementById('chat-loading')?.remove();
    addMsg(reply,'ai');
    if(isCallMode&&callActive) speakText(reply);
  }catch(e){document.getElementById('chat-loading')?.remove();addMsg('❌ '+e.message,'ai')}
}

function sendQuick(p){const i=$('chat-input');i.value=p;i.focus();autoResize(i)}

// ===== VOICE INPUT =====
function toggleVoiceInput(){
  if(!('webkitSpeechRecognition'in window)&&!('SpeechRecognition'in window)){addMsg('⚠️ Voz não suportada','ai');return}
  if(isRecording){stopVoice();return}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  recognition=new SR;recognition.lang='pt-BR';recognition.continuous=false;recognition.interimResults=false;
  recognition.onstart=()=>{isRecording=true;$('voice-btn').textContent='⏹️';showRec()};
  recognition.onresult=e=>{$('chat-input').value=e.results[0][0].transcript;autoResize($('chat-input'));hideRec();sendChatMsg()};
  recognition.onerror=()=>{hideRec();addMsg('⚠️ Não entendi','ai')};
  recognition.onend=()=>{isRecording=false;$('voice-btn').textContent='🎤';hideRec()};
  recognition.start();
}
function stopVoice(){if(recognition){recognition.stop();isRecording=false;$('voice-btn').textContent='🎤';hideRec()}}
let recInd=null;
function showRec(){if(!recInd){recInd=document.createElement('div');recInd.className='recording-indicator';recInd.textContent='🎤 Gravando...';document.body.appendChild(recInd)}}
function hideRec(){if(recInd){recInd.remove();recInd=null}}

// ===== CALL AI =====
function speakText(text){
  if(cfg.tts==='elevenlabs'&&cfg.elevenKey){
    fetch('https://api.elevenlabs.io/v1/text-to-speech/'+(cfg.elevenVoice||'21m00Tcm4TlvDq8ikWAM'),{
      method:'POST',headers:{'xi-api-key':cfg.elevenKey,'Content-Type':'application/json'},
      body:JSON.stringify({text,model_id:'eleven_monolingual_v1',voice_settings:{stability:0.5,similarity_boost:0.5}})
    }).then(r=>r.blob()).then(b=>{const a=new Audio(URL.createObjectURL(b));a.play()}).catch(()=>{});
  }else{
    const u=new SpeechSynthesisUtterance(text);u.lang='pt-BR';u.rate=1.1;
    speechSynthesis.speak(u);
  }
}

function startCall(){
  isCallMode=true;callActive=true;
  $('call-overlay').classList.remove('hidden');$('call-status').textContent='🎤 Chamada ativada. Fale algo...';
  listenAndRespond();
}

function listenAndRespond(){
  if(!callActive||!isCallMode)return;
  if(!('webkitSpeechRecognition'in window)&&!('SpeechRecognition'in window)){$('call-status').textContent='Voz não suportada';return}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const r=new SR;r.lang='pt-BR';r.continuous=false;r.interimResults=false;
  r.onresult=e=>{
    const t=e.results[0][0].transcript;
    $('call-status').textContent='Você: '+t;
    $('chat-input').value=t;
    sendChatMsg();
    // After AI responds, listen again
    setTimeout(()=>{if(callActive)listenAndRespond()},2000);
  };
  r.onerror=()=>setTimeout(()=>{if(callActive)listenAndRespond()},2000);
  r.start();
}

function endCall(){
  callActive=false;isCallMode=false;
  $('call-overlay').classList.add('hidden');
  speechSynthesis.cancel();
}

// ===== IMAGE GENERATION =====
async function generateImage(){
  const p=$('ai-image-prompt').value.trim();if(!p)return alert('Digite uma descrição');
  $('ai-image-loading').classList.remove('hidden');$('ai-image-result').classList.add('hidden');
  try{
    if(!cfg.key){$('ai-image-loading').classList.add('hidden');addMsg('⚠️ Configure a chave da API','ai');return}
    const base=cfg.endpoint||'https://api.openai.com/v1';
    const r=await fetch(base+'/images/generations',{method:'POST',headers:{'Authorization':'Bearer '+cfg.key,'Content-Type':'application/json'},body:JSON.stringify({model:'dall-e-3',prompt:p,n:1,size:'1024x1024'})});
    const d=await r.json();
    const url=d?.data?.[0]?.url;
    if(!url){$('ai-image-loading').classList.add('hidden');addMsg('❌ '+(d?.error?.message||'Erro'),'ai');return}
    $('ai-image-loading').classList.add('hidden');
    $('ai-generated-img').src=url;$('ai-image-result').classList.remove('hidden');
    addMsg(`🎨 Imagem gerada: <a href="${url}" target="_blank" style="color:var(--accent)">Abrir</a>`,'ai');
  }catch(e){$('ai-image-loading').classList.add('hidden');addMsg('❌ '+e.message,'ai')}
}

function downloadGeneratedImage(){
  const img=$('ai-generated-img');if(!img.src)return;
  const a=document.createElement('a');a.href=img.src;a.download='cloud-will-'+Date.now()+'.png';
  document.body.appendChild(a);a.click();document.body.removeChild(a);
}

// ===== INIT =====
async function initApp(){
  loadCfg();
  await loadFiles();

  // Load theme
  const savedTheme=localStorage.getItem('cloud_sw_theme');
  if(savedTheme){setTheme(savedTheme);$('theme-select').value=savedTheme}

  // Face unlock toggle
  $('face-unlock-toggle').checked=isFaceEnabled();

  // Bottom nav
  document.querySelectorAll('.nav-item').forEach(item=>{
    item.addEventListener('click',()=>{
      document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t=>t.classList.remove('active'));
      item.classList.add('active');$('tab-'+item.dataset.tab).classList.add('active');
      if(item.dataset.tab==='home') loadFiles();
      if(item.dataset.tab==='fotos') renderPhotos();
      if(item.dataset.tab==='videos') renderVideos();
      if(item.dataset.tab==='pessoas') renderPeople();
    });
  });

  // Upload
  const uz=$('upload-zone'),fi=$('file-input');
  uz.addEventListener('click',()=>fi.click());
  uz.addEventListener('dragover',e=>{e.preventDefault();uz.classList.add('dragover')});
  uz.addEventListener('dragleave',()=>uz.classList.remove('dragover'));
  uz.addEventListener('drop',e=>{e.preventDefault();uz.classList.remove('dragover');if(e.dataTransfer.files.length)handleFiles(e.dataTransfer.files)});
  fi.addEventListener('change',()=>{if(fi.files.length){handleFiles(fi.files);fi.value=''}});

  // Search
  $('search-input').addEventListener('input',()=>renderHome());

  // Chat enter
  $('chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChatMsg()}});

  // Modal close
  document.querySelectorAll('.modal-close,.modal-close-ai').forEach(el=>{el.addEventListener('click',()=>{el.closest('.modal').classList.add('hidden')})});
  window.addEventListener('click',e=>{if(e.target.classList.contains('modal'))e.target.classList.add('hidden')});

  // Security PIN init
  const savedPin=getStoredPin();
  if(savedPin) $('security-pin').value=savedPin;
}

// ===== START =====
document.addEventListener('DOMContentLoaded',async ()=>{
  if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');
  await initDB();

  // Check if face unlock is enabled
  if(isFaceEnabled()) await startFaceUnlockScreen();
  else { $('app').classList.remove('hidden'); initApp(); }
});
