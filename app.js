const VALID_EMAIL = 'roberiaaraujo123@gmail.com';
const VALID_PASSWORD = 'roberia123';
const STORAGE_KEY = 'cloud_super_will_files';
const DB_NAME = 'CloudSuperWillDB';
const DB_VERSION = 1;

let db = null;
let currentFiles = [];

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

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

function getCategory(mime) {
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
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
  return size.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

document.addEventListener('DOMContentLoaded', async () => {
  await initDB();

  $('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('email').value.trim();
    const password = $('password').value;
    if (email === VALID_EMAIL && password === VALID_PASSWORD) {
      $('login-screen').classList.add('hidden');
      $('app-screen').classList.remove('hidden');
      $('login-error').textContent = '';
      loadFiles();
    } else {
      $('login-error').textContent = 'Email ou senha incorretos!';
    }
  });

  $('logout-btn').addEventListener('click', () => {
    $('app-screen').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
  });

  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      $(`tab-${tab.dataset.tab}`).classList.add('active');
      loadFiles();
    });
  });

  const uploadZone = $('upload-zone');
  const fileInput = $('file-input');

  uploadZone.addEventListener('click', () => fileInput.click());

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length) handleFiles(files);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) {
      handleFiles(fileInput.files);
      fileInput.value = '';
    }
  });

  $('search-input').addEventListener('input', () => renderFiles());
});

async function handleFiles(files) {
  const progress = $('upload-progress');
  const fill = $('progress-fill');
  const text = $('progress-text');
  progress.classList.remove('hidden');

  const fileArray = Array.from(files);
  let completed = 0;

  for (const file of fileArray) {
    const data = await readFileAsArrayBuffer(file);
    const record = {
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      category: getCategory(file.type || file.name),
      data: data,
      timestamp: Date.now()
    };

    await saveFileToDB(record);
    completed++;
    const pct = Math.round((completed / fileArray.length) * 100);
    fill.style.width = pct + '%';
    text.textContent = `${file.name} - ${pct}%`;
  }

  setTimeout(() => {
    progress.classList.add('hidden');
    fill.style.width = '0%';
    text.textContent = '0%';
    loadFiles();
  }, 1000);
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
  renderFiles();
}

function renderFiles() {
  const activeTab = document.querySelector('.tab.active');
  if (!activeTab) return;
  const tab = activeTab.dataset.tab;
  const search = ($('search-input')?.value || '').toLowerCase();

  let filtered = currentFiles;
  if (search) {
    filtered = filtered.filter(f => f.name.toLowerCase().includes(search));
  }

  if (tab === 'upload') return;

  if (tab === 'files') {
    const grid = $('file-grid');
    if (!filtered.length) {
      grid.innerHTML = '<div class="empty-state"><div class="emoji">📁</div><p>Nenhum arquivo ainda. Faça upload!</p></div>';
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
    return;
  }

  if (tab === 'photos') {
    const grid = $('photo-grid');
    const photos = filtered.filter(f => f.category === 'photo');
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
    return;
  }

  if (tab === 'videos') {
    const grid = $('video-grid');
    const videos = filtered.filter(f => f.category === 'video');
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
}

function dataToBlobURL(data, type) {
  const blob = new Blob([data], { type: type || 'application/octet-stream' });
  return URL.createObjectURL(blob);
}

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
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function deleteFile(id) {
  if (!confirm('Tem certeza que deseja excluir este arquivo?')) return;
  await deleteFileFromDB(id);
  loadFiles();
}

$('modal-close')?.addEventListener('click', () => {
  $('modal').classList.add('hidden');
  $('modal-body').innerHTML = '';
});

window.addEventListener('click', (e) => {
  const modal = $('modal');
  if (e.target === modal) {
    modal.classList.add('hidden');
    $('modal-body').innerHTML = '';
  }
});
