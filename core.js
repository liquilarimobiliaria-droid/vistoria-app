// Núcleo compartilhado: estado, utilidades, ordenação do roteiro, GPS, mídia (fotos/vídeos), overlay.
import * as DB from './db.js';
import { uid, CONDICOES, VERIFICACOES } from './templates.js';

export const $app = document.getElementById('app');
export const $toast = document.getElementById('toast');
export const $ov = document.getElementById('overlay');

/* ---------- utilidades ---------- */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const p3 = (n) => String(n).padStart(3, '0');
export const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
export const nomeArq = (s) => semAcento(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim();
export const hoje = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
export const fmtData = (t) => (t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
export const fmtMB = (b) => (b / 1048576).toFixed(1) + ' MB';
export const fmtDur = (ms) => { if (!ms || ms < 0) return '—'; const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
export const labelCond = (v, up) => { const c = CONDICOES.find((x) => x[0] === v); return c ? c[up ? 2 : 1] : ''; };
export const labelVerif = (v, up) => { const c = VERIFICACOES.find((x) => x[0] === v); return c ? c[up ? 2 : 1] : ''; };
export const RANK_COND = { PINTURA_NOVA: 0, BOM: 0, REGULAR: 1, AVARIA: 2 };

export const cfg = (() => { try { return JSON.parse(localStorage.getItem('ql-cfg')) || {}; } catch { return {}; } })();
if (cfg.maxPx === undefined) cfg.maxPx = 2400;
if (cfg.maxVideos === undefined) cfg.maxVideos = 5;
if (cfg.falar === undefined) cfg.falar = true;
if (cfg.auto === undefined) cfg.auto = true;
if (cfg.comandos === undefined) cfg.comandos = false;
if (cfg.camRes === undefined) cfg.camRes = 1080; // prévia da câmera do app: 720 (leve), 1080 (padrão) ou 0 (máxima; pesada)
export const salvarCfg = () => { try { localStorage.setItem('ql-cfg', JSON.stringify(cfg)); } catch {} };

let toastT;
export function toast(msg, ms = 2200) {
  $toast.textContent = msg;
  $toast.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => $toast.classList.remove('on'), ms);
}

/* ---------- estado ---------- */
export const S = { V: null, FOTOS: [], URLS: new Map(), curAmbId: null, tab: 'item', redraw: () => {}, lastZip: null, ovURL: null,
  euId: null, gereFn: null, aoSalvar: null, pausarSync: false };

// ---- vistoria na nuvem: quem é dono de cada ambiente ----
// Fora da nuvem (ou ambiente sem dono) tudo é do próprio usuário. Na nuvem, cada ambiente tem um vistoriador responsável.
export const souDono = (a) => !S.V?.nuvem || !a.dono || a.dono === S.euId;
export const gere = () => !S.V?.nuvem || !!(S.gereFn && S.gereFn(S.V));
export const podeEditar = (a) => !S.V?.nuvem || a.dono === S.euId || gere();

export async function salvarV() {
  S.V.atualizadoEm = Date.now();
  S.V.nFotos = S.FOTOS.filter((f) => f.tipo !== 'video').length;
  S.V.nVideos = S.FOTOS.filter((f) => f.tipo === 'video').length;
  await DB.putV(S.V);
  S.aoSalvar?.(); // agenda a sincronização com a nuvem (se a vistoria estiver nela)
}
export const achaAmb = (id) => S.V.ambientes.find((a) => a.id === id);
export const achaItem = (a, id) => a.itens.find((i) => i.id === id);
export const midiaDoItem = (itemId) => S.FOTOS.filter((f) => f.itemId === itemId).sort((a, b) => a.seq - b.seq);
export const nMidiaAmb = (ambId) => S.FOTOS.filter((f) => f.ambId === ambId).length;

export const thumbURL = (f) => {
  if (!S.URLS.has(f.id)) S.URLS.set(f.id, URL.createObjectURL(f.thumb || f.blob));
  return S.URLS.get(f.id);
};
export const limparURLs = () => { S.URLS.forEach((u) => URL.revokeObjectURL(u)); S.URLS.clear(); };

/* ---------- ordenação e numeração do roteiro (igual no app, no ZIP e no relatório) ---------- */
const RANK = { item: 0, acessorio: 1, mobilia: 2 };
export function lista(amb) {
  const tops = amb.itens.filter((i) => !i.paiId).map((it, idx) => ({ it, idx }))
    .sort((a, b) => (RANK[a.it.cat || 'item'] - RANK[b.it.cat || 'item']) || a.idx - b.idx);
  const out = [];
  let n = 0;
  for (const { it } of tops) {
    n++;
    out.push({ it, num: String(n), sub: false, cat: it.cat || 'item' });
    let k = 0;
    for (const s of amb.itens.filter((x) => x.paiId === it.id)) { k++; out.push({ it: s, num: `${n}.${k}`, sub: true, cat: it.cat || 'item' }); }
  }
  return out;
}

export function itemFeito(i) {
  if (i.na) return true;
  const fotos = midiaDoItem(i.id).length || i.nf || 0; // nf = fotos do item vindas de outro aparelho
  if (i.g) return fotos > 0;
  if (i.m) return !!(i.ident || i.leitura || fotos);
  return !!i.cond;
}
export const faltaVerif = (i) => !i.na && i.t && !i.verif;

/* ---------- geolocalização ---------- */
export const geo = { watch: null, last: null, erro: null };
export function chipGeo() {
  const el = document.getElementById('geochip');
  if (!el) return;
  if (geo.last && Date.now() - geo.last.ts < 180000) { el.textContent = `📍 ±${geo.last.acc} m`; el.className = 'chip ok'; }
  else if (geo.erro === 1) { el.textContent = '📍 sem permissão'; el.className = 'chip bad'; }
  else { el.textContent = '📍 buscando…'; el.className = 'chip'; }
}
export function startGeo() {
  if (!navigator.geolocation || geo.watch != null) return;
  geo.watch = navigator.geolocation.watchPosition(
    (p) => {
      geo.last = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), ts: p.timestamp }; geo.erro = null; chipGeo();
      // a vistoria já iniciada sem GPS recebe a localização assim que o primeiro sinal chega
      if (S.V && S.V.inicioEm && !S.V.geo) { S.V.geo = { ...geo.last }; DB.putV(S.V).catch(() => {}); }
    },
    (e) => { geo.erro = e.code; chipGeo(); },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 },
  );
}
export async function posAgora() {
  if (geo.last && Date.now() - geo.last.ts < 120000) return { ...geo.last };
  if (!navigator.geolocation) return null;
  return new Promise((res) => navigator.geolocation.getCurrentPosition(
    (p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy), ts: p.timestamp }),
    () => res(geo.last ? { ...geo.last, antigo: true } : null),
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 60000 },
  ));
}

/* ---------- mídia ---------- */
let inputRef = null;
export function escolher({ camera, video, multiplo }) {
  return new Promise((res) => {
    const i = document.createElement('input');
    inputRef = i;
    i.type = 'file';
    i.accept = video ? 'video/*' : camera ? 'image/*' : 'image/*,video/*';
    if (camera) i.capture = 'environment';
    if (multiplo) i.multiple = true;
    i.style.display = 'none';
    document.body.appendChild(i);
    const fim = (files) => { i.remove(); res(files); };
    i.onchange = () => fim(Array.from(i.files || []));
    i.oncancel = () => fim([]);
    i.click();
  });
}

const canvasBlob = (c, q) => new Promise((r) => c.toBlob(r, 'image/jpeg', q));

// Redução, miniatura e análise de nitidez rodam num worker (a câmera e a tela não travam). Sem worker, cai no processamento antigo.
let wImg, wId = 0;
const wPend = new Map();
function workerImg() {
  if (wImg === undefined) {
    try {
      if (typeof OffscreenCanvas === 'undefined' || !window.Worker || !OffscreenCanvas.prototype.convertToBlob) throw new Error('sem suporte');
      wImg = new Worker('imgworker.js');
      wImg.onmessage = (e) => { const f = wPend.get(e.data.id); if (f) { wPend.delete(e.data.id); f(e.data); } };
      wImg.onerror = () => { wImg = null; wPend.forEach((f) => f({ ok: false })); wPend.clear(); };
    } catch { wImg = null; }
  }
  return wImg;
}
async function processarImagem(file) {
  const w = workerImg();
  if (w) {
    const r = await new Promise((res) => {
      const id = ++wId;
      const t = setTimeout(() => { wPend.delete(id); res({ ok: false }); }, 25000);
      wPend.set(id, (m) => { clearTimeout(t); res(m); });
      w.postMessage({ id, file, maxPx: cfg.maxPx, thumbPx: 360 });
    });
    if (r.ok) return { blob: r.blob, thumb: r.thumb, w: r.w, h: r.h, q: r.q };
  }
  return processarImagemMain(file);
}
async function processarImagemMain(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const redim = (max) => {
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return c;
    };
    const thumb = await canvasBlob(redim(360), 0.7);
    let blob = file, w = bmp.width, h = bmp.height;
    if (cfg.maxPx > 0) { const c = redim(cfg.maxPx); blob = await canvasBlob(c, 0.86); w = c.width; h = c.height; }
    bmp.close?.();
    return { blob, thumb, w, h };
  } catch (e) {
    console.warn('processar falhou, mantendo original', e);
    return { blob: file, thumb: null, w: 0, h: 0 };
  }
}
function processarVideo(file) {
  return new Promise((res) => {
    const v = document.createElement('video');
    const u = URL.createObjectURL(file);
    let fim = false;
    const done = (thumb) => { if (fim) return; fim = true; const dur = v.duration || 0; URL.revokeObjectURL(u); res({ blob: file, thumb, w: v.videoWidth, h: v.videoHeight, dur }); };
    v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = u;
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch { done(null); } };
    v.onseeked = () => {
      try {
        const s = 360 / Math.max(v.videoWidth, v.videoHeight);
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => done(b), 'image/jpeg', 0.7);
      } catch { done(null); }
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 6000);
  });
}

// meta (opcional): {ts, pos} registrados no instante do clique, quando o processamento roda em segundo plano
export async function addMidia(ambId, itemId, files, origem, meta = null) {
  let rejeitados = 0, verticais = 0;
  const fracas = [];
  for (const file of files) {
    const ehVideo = file.type.startsWith('video/');
    if (ehVideo && S.FOTOS.filter((f) => f.ambId === ambId && f.tipo === 'video').length >= cfg.maxVideos) { rejeitados++; continue; }
    const pos = origem === 'camera' ? (meta?.pos || await posAgora()) : null;
    const p = ehVideo ? await processarVideo(file) : await processarImagem(file);
    const rec = {
      id: uid(), vistoriaId: S.V.id, ambId, itemId, seq: Date.now() + Math.random(), tipo: ehVideo ? 'video' : 'foto',
      blob: p.blob, thumb: p.thumb, mime: p.blob.type || (ehVideo ? 'video/mp4' : 'image/jpeg'), w: p.w, h: p.h, dur: p.dur || 0,
      ts: origem === 'camera' ? (meta?.ts || Date.now()) : (file.lastModified || Date.now()), pos, origem, nota: '',
    };
    rec.vertical = rec.tipo === 'foto' && rec.w > 0 && rec.h > rec.w; // fotos devem ser sempre horizontais
    if (rec.vertical) verticais++;
    if (p.q?.flags?.length) { rec.q = p.q; fracas.push(...p.q.flags); }
    await DB.putF(rec);
    S.FOTOS.push(rec);
  }
  await salvarV();
  if (rejeitados) toast(`Limite de ${cfg.maxVideos} vídeos por ambiente (ajustável em ⚙)`, 3500);
  if (verticais) { toast('⚠ Foto na VERTICAL. Gire o celular e refaça na horizontal.', 5000); navigator.vibrate?.([80, 60, 80]); }
  else if (fracas.length) {
    const f = [...new Set(fracas)];
    toast(`⚠ Foto ${f.map((x) => ({ tremida: 'sem nitidez (tremida?)', escura: 'escura', estourada: 'estourada (muita luz)' }[x])).join(' e ')}. Confira e refaça se precisar.`, 4500);
    navigator.vibrate?.(60);
  }
  return { verticais };
}

// gira uma foto (90° horário por padrão) para corrigir fotos tiradas na vertical
export async function girarFoto(f, graus = 90) {
  const bmp = await createImageBitmap(f.blob);
  const troca = graus % 180 !== 0;
  const c = document.createElement('canvas');
  c.width = troca ? bmp.height : bmp.width; c.height = troca ? bmp.width : bmp.height;
  const x = c.getContext('2d');
  x.translate(c.width / 2, c.height / 2); x.rotate((graus * Math.PI) / 180); x.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close?.();
  const t = document.createElement('canvas'), s = 360 / Math.max(c.width, c.height);
  t.width = Math.round(c.width * s); t.height = Math.round(c.height * s);
  t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
  f.blob = await canvasBlob(c, 0.9); f.thumb = await canvasBlob(t, 0.7);
  f.w = c.width; f.h = c.height; f.mime = 'image/jpeg'; f.vertical = f.h > f.w;
  if (S.V?.nuvem && !f.remoto) f.sync = 'pendente'; // a imagem mudou: reenviar à nuvem
  if (S.URLS.has(f.id)) { URL.revokeObjectURL(S.URLS.get(f.id)); S.URLS.delete(f.id); }
  await DB.putF(f);
}

export async function apagarMidia(id) {
  const f = S.FOTOS.find((x) => x.id === id);
  // vistoria na nuvem: guarda a baixa para apagar também lá (arquivo e registro) na próxima sincronização
  if (f && S.V?.nuvem && (f.sync === 'enviada' || f.storagePath)) (S.V.apagadas ||= []).push({ id, path: f.storagePath || null });
  await DB.delF(id);
  S.FOTOS = S.FOTOS.filter((f) => f.id !== id);
  if (S.URLS.has(id)) { URL.revokeObjectURL(S.URLS.get(id)); S.URLS.delete(id); }
}

/* ---------- overlay ---------- */
export function abreOverlay(html) { $ov.innerHTML = html; $ov.hidden = false; }
export function fechaOverlay() {
  $ov.hidden = true; $ov.innerHTML = '';
  if (S.ovURL) { URL.revokeObjectURL(S.ovURL); S.ovURL = null; }
}
