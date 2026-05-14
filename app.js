const DB_NAME = 'CloudSuperWillDB';
const DB_VERSION = 2;
const AI_CONFIG_KEY = 'cloud_super_will_ai_config';

let db = null;
let currentFiles = [];
let aiConfig = { provider: 'openai', endpoint: '', key: '', model: 'gpt-4o-mini' };
let recognition = null;
let isRecording = false;

const $ = (id) => document.getElementById(id);

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('files')) {
        const store = d.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('name', 'name', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function getCategory(mime, name) {
  if (mime.startsWith('image/')) return 'photo';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

function getIcon(file) {
  if (file.category === 'photo') return '🖼️';
  if (file.category === 'video') return '🎬';
  const ext = file.name.split('.').pop().toLowerCase();
  const icons = { pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', zip: '📦', rar: '📦', mp3: '🎵', wav: '🎵', txt: '📃', json: '📋', js: '📜', html: '🌐', css: '🎨', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️' };
  return icons[ext] || '📁';
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return size.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function dataToBlobURL(data, type) {
  return URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' }));
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 80) + 'px';
}

document.addEventListener('DOMContentLoaded', async () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }

  await initDB();

  loadAIConfig();
  loadFiles();

  // Bottom nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      item.classList.add('active');
      $(`tab-${item.dataset.tab}`).classList.add('active');
      if (item.dataset.tab === 'home') loadFiles();
      if (item.dataset.tab === 'fotos') renderPhotos();
      if (item.dataset.tab === 'videos') renderVideos();
    });
  });

  // Upload
  const uploadZone = $('upload-zone');
  const fileInput = $('file-input');
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) { handleFiles(fileInput.files); fileInput.value = ''; }
  });

  // Search
  $('search-input').addEventListener('input', () => renderHome());

  // Chat: Enter to send
  $('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });
});

// ===== FILE MANAGEMENT =====

async function handleFiles(files) {
  const progress = $('upload-progress');
  const fill = $('progress-fill');
  const text = $('progress-text');
  progress.classList.remove('hidden');

  const arr = Array.from(files);
  let done = 0;

  for (const file of arr) {
    const data = await readFileAsArrayBuffer(file);
    await saveFileToDB({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, category: getCategory(file.type, file.name), data, timestamp: Date.now() });
    done++;
    const pct = Math.round((done / arr.length) * 100);
    fill.style.width = pct + '%';
    text.textContent = `${file.name} - ${pct}%`;
  }

  setTimeout(() => {
    progress.classList.add('hidden');
    fill.style.width = '0%';
    text.textContent = '0%';
    loadFiles();
  }, 800);
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function saveFileToDB(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    const req = store.add(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getAllFiles() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const store = tx.objectStore('files');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteFileFromDB(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function loadFiles() {
  currentFiles = await getAllFiles();
  currentFiles.sort((a, b) => b.timestamp - a.timestamp);
  renderHome();
  updateStorageInfo();
}

// ===== RENDER HOME =====

function renderHome() {
  const search = ($('search-input')?.value || '').toLowerCase();
  let filtered = currentFiles;
  if (search) filtered = filtered.filter(f => f.name.toLowerCase().includes(search));

  // Stats
  const photos = currentFiles.filter(f => f.category === 'photo').length;
  const videos = currentFiles.filter(f => f.category === 'video').length;
  const docs = currentFiles.filter(f => f.category === 'document').length;
  $('quick-stats').innerHTML = `
    <div class="stat-card"><div class="stat-num">${photos}</div><div class="stat-label">Fotos</div></div>
    <div class="stat-card"><div class="stat-num">${videos}</div><div class="stat-label">Vídeos</div></div>
    <div class="stat-card"><div class="stat-num">${docs}</div><div class="stat-label">Documentos</div></div>
  `;

  // File list
  const grid = $('file-grid');
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state"><div class="emoji">☁️</div><p>Nenhum arquivo ainda. Faça upload!</p></div>';
    return;
  }
  grid.innerHTML = filtered.map(f => `
    <div class="file-card">
      <div class="file-icon">${getIcon(f)}</div>
      <div class="file-info">
        <div class="file-name">${f.name}</div>
        <div class="file-meta">${formatSize(f.size)} • ${formatDate(f.timestamp)}</div>
      </div>
      <div class="file-actions">
        <button onclick="previewFile(${f.id})" title="Visualizar">👁️</button>
        <button onclick="downloadFile(${f.id})" title="Baixar">⬇️</button>
        <button onclick="deleteFile(${f.id})" title="Excluir">🗑️</button>
      </div>
    </div>
  `).join('');
}

// ===== RENDER PHOTOS =====

function renderPhotos() {
  const grid = $('photo-grid');
  const photos = currentFiles.filter(f => f.category === 'photo');
  if (!photos.length) {
    grid.innerHTML = '<div class="empty-state"><div class="emoji">🖼️</div><p>Nenhuma foto ainda.</p></div>';
    return;
  }
  grid.innerHTML = photos.map(f => `
    <div class="photo-card" onclick="previewFile(${f.id})">
      <img src="${dataToBlobURL(f.data, f.type)}" alt="${f.name}" loading="lazy">
      <div class="overlay">${f.name}</div>
    </div>
  `).join('');
}

// ===== RENDER VIDEOS =====

function renderVideos() {
  const grid = $('video-grid');
  const videos = currentFiles.filter(f => f.category === 'video');
  if (!videos.length) {
    grid.innerHTML = '<div class="empty-state"><div class="emoji">🎬</div><p>Nenhum vídeo ainda.</p></div>';
    return;
  }
  grid.innerHTML = videos.map(f => `
    <div class="video-card" onclick="previewFile(${f.id})">
      <video src="${dataToBlobURL(f.data, f.type)}" preload="metadata"></video>
      <div class="overlay">${f.name}</div>
    </div>
  `).join('');
}

// ===== FILE ACTIONS =====

function previewFile(id) {
  const file = currentFiles.find(f => f.id === id);
  if (!file) return;
  const modal = $('modal');
  const body = $('modal-body');
  const url = dataToBlobURL(file.data, file.type);

  if (file.category === 'photo') {
    body.innerHTML = `<img src="${url}" alt="${file.name}">`;
  } else if (file.category === 'video') {
    body.innerHTML = `<video src="${url}" controls autoplay></video>`;
  } else {
    body.innerHTML = `
      <div style="text-align:center;padding:40px;color:var(--text-primary);">
        <div style="font-size:64px;margin-bottom:16px;">📄</div>
        <h3>${file.name}</h3>
        <p style="color:var(--text-secondary);margin:8px 0;">${formatSize(file.size)}</p>
        <button class="btn-primary" onclick="downloadFile(${file.id})" style="margin-top:16px;">⬇️ Baixar</button>
      </div>
    `;
  }
  modal.classList.remove('hidden');
}

function downloadFile(id) {
  const file = currentFiles.find(f => f.id === id);
  if (!file) return;
  const url = dataToBlobURL(file.data, file.type);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function deleteFile(id) {
  if (!confirm('Tem certeza que deseja excluir este arquivo?')) return;
  await deleteFileFromDB(id);
  loadFiles();
  if (document.querySelector('.nav-item.active')?.dataset.tab === 'fotos') renderPhotos();
  if (document.querySelector('.nav-item.active')?.dataset.tab === 'videos') renderVideos();
}

async function clearAllData() {
  if (!confirm('Tem certeza? Todos os arquivos serão permanentemente excluídos!')) return;
  const tx = db.transaction('files', 'readwrite');
  const store = tx.objectStore('files');
  await store.clear();
  loadFiles();
  renderPhotos();
  renderVideos();
  updateStorageInfo();
}

// ===== STORAGE INFO =====

function updateStorageInfo() {
  const total = currentFiles.reduce((s, f) => s + (f.size || 0), 0);
  $('storage-info').textContent = formatSize(total);
}

// ===== MODAL CLOSE =====

document.querySelectorAll('.modal-close, .modal-close-ai').forEach(el => {
  el.addEventListener('click', () => {
    el.closest('.modal').classList.add('hidden');
  });
});
window.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal')) {
    e.target.classList.add('hidden');
  }
});

// ===== AI CONFIG =====

function loadAIConfig() {
  try {
    const saved = localStorage.getItem(AI_CONFIG_KEY);
    if (saved) aiConfig = JSON.parse(saved);
  } catch (_) {}
  $('ai-provider').value = aiConfig.provider || 'openai';
  $('ai-endpoint').value = aiConfig.endpoint || '';
  $('ai-key').value = aiConfig.key || '';
  $('ai-model').value = aiConfig.model || 'gpt-4o-mini';
}

function saveAIConfig() {
  aiConfig = {
    provider: $('ai-provider').value,
    endpoint: $('ai-endpoint').value.trim(),
    key: $('ai-key').value.trim(),
    model: $('ai-model').value.trim()
  };
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(aiConfig));
  $('ai-config-status').textContent = '✅ Configuração salva com sucesso!';
  setTimeout(() => $('ai-config-status').textContent = '', 3000);
}

function toggleKeyVisibility() {
  const input = $('ai-key');
  input.type = input.type === 'password' ? 'text' : 'password';
}

// ===== AI CHAT =====

function getAIEndpoint() {
  const cfg = aiConfig;
  if (cfg.provider === 'gemini') {
    return { url: 'https://generativelanguage.googleapis.com/v1beta/models/' + (cfg.model || 'gemini-2.0-flash') + ':generateContent?key=' + cfg.key, type: 'gemini' };
  }
  const base = cfg.endpoint || 'https://api.openai.com/v1';
  return { url: base + '/chat/completions', type: 'openai', key: cfg.key, model: cfg.model || 'gpt-4o-mini' };
}

function addChatMessage(content, role) {
  const container = $('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  const time = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  div.innerHTML = content + '<span class="msg-time">' + time + '</span>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;

  addChatMessage(text, 'user');
  input.value = '';
  input.style.height = 'auto';

  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'chat-msg ai';
  loadingDiv.id = 'chat-loading';
  loadingDiv.textContent = '⏳ Pensando...';
  $('chat-messages').appendChild(loadingDiv);

  try {
    const ep = getAIEndpoint();
    let reply = '';

    if (ep.type === 'gemini') {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text }] }] })
      });
      const data = await res.json();
      reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || '❌ Erro: ' + (data?.error?.message || 'Sem resposta');
    } else {
      if (!ep.key) { reply = '⚠️ Configure sua chave da API no Perfil primeiro!'; } else {
        const res = await fetch(ep.url, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + ep.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: ep.model, messages: [{ role: 'user', content: text }], max_tokens: 2000 })
        });
        const data = await res.json();
        reply = data?.choices?.[0]?.message?.content || '❌ Erro: ' + (data?.error?.message || 'Sem resposta');
      }
    }

    document.getElementById('chat-loading')?.remove();
    addChatMessage(reply, 'ai');
  } catch (err) {
    document.getElementById('chat-loading')?.remove();
    addChatMessage('❌ Erro de conexão: ' + err.message, 'ai');
  }
}

function sendQuickPrompt(prefix) {
  const input = $('chat-input');
  input.value = prefix;
  input.focus();
  autoResize(input);
}

// ===== VOICE INPUT =====

function toggleVoiceInput() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    addChatMessage('⚠️ Reconhecimento de voz não suportado neste navegador. Use o Chrome no celular.', 'ai');
    return;
  }

  if (isRecording) {
    stopVoiceInput();
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'pt-BR';
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    $('voice-btn').textContent = '⏹️';
    showRecordingIndicator();
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    $('chat-input').value = transcript;
    autoResize($('chat-input'));
    hideRecordingIndicator();
    sendChatMessage();
  };

  recognition.onerror = () => {
    hideRecordingIndicator();
    addChatMessage('⚠️ Não entendi. Tente digitar.', 'ai');
  };

  recognition.onend = () => {
    isRecording = false;
    $('voice-btn').textContent = '🎤';
    hideRecordingIndicator();
  };

  recognition.start();
}

function stopVoiceInput() {
  if (recognition) {
    recognition.stop();
    isRecording = false;
    $('voice-btn').textContent = '🎤';
    hideRecordingIndicator();
  }
}

let recordingIndicator = null;

function showRecordingIndicator() {
  if (!recordingIndicator) {
    recordingIndicator = document.createElement('div');
    recordingIndicator.className = 'recording-indicator';
    recordingIndicator.textContent = '🎤 Gravando... fale agora';
    document.body.appendChild(recordingIndicator);
  }
}

function hideRecordingIndicator() {
  if (recordingIndicator) {
    recordingIndicator.remove();
    recordingIndicator = null;
  }
}

// ===== IMAGE GENERATION =====

async function generateImage() {
  const prompt = $('ai-image-prompt').value.trim();
  if (!prompt) return alert('Digite uma descrição para a imagem.');

  $('ai-image-loading').classList.remove('hidden');
  $('ai-image-result').classList.add('hidden');

  try {
    const cfg = aiConfig;
    let imageUrl = '';

    if (cfg.provider === 'gemini') {
      // Gemini doesn't support image generation directly, fallback to OpenAI-compatible
      addChatMessage('⚠️ Gemini não suporta geração de imagens. Use OpenAI ou Custom.', 'ai');
      $('ai-image-loading').classList.add('hidden');
      return;
    }

    const ep = cfg.endpoint || 'https://api.openai.com/v1';
    const res = await fetch(ep + '/images/generations', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + (cfg.key || ''), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024' })
    });
    const data = await res.json();
    imageUrl = data?.data?.[0]?.url || data?.data?.[0]?.b64_json;

    if (!imageUrl) {
      $('ai-image-loading').classList.add('hidden');
      addChatMessage('❌ Erro ao gerar imagem: ' + (data?.error?.message || 'Sem resposta'), 'ai');
      return;
    }

    $('ai-image-loading').classList.add('hidden');
    $('ai-generated-img').src = imageUrl;
    $('ai-image-result').classList.remove('hidden');
  } catch (err) {
    $('ai-image-loading').classList.add('hidden');
    addChatMessage('❌ Erro: ' + err.message, 'ai');
  }
}

function downloadGeneratedImage() {
  const img = $('ai-generated-img');
  if (!img.src) return;
  const a = document.createElement('a');
  a.href = img.src;
  a.download = 'cloud-super-will-ia-' + Date.now() + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
