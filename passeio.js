// Passeio guiado: câmera do próprio app + roteiro falado, item a item, na ordem do passeio.
// Fluxo por item: fotografar → condição (roda de seleção) → (quantidade, verificação) → próximo.
// Ao fechar um ambiente o app pergunta se há algo mais a incluir (registros extras, para nomear depois) e mostra uma transição.
// Se a câmera do app não abrir (permissão/navegador), o obturador vira "abrir a câmera do celular".
import { S, geo, esc, toast, cfg, salvarCfg, lista, achaAmb, achaItem, midiaDoItem, itemFeito, faltaVerif, salvarV, addMidia, labelCond, p3, thumbURL, escolher, souDono, aplicarPadrao } from './core.js';
import { CONDICOES, VERIFICACOES, uid } from './templates.js';
import * as Voice from './voice.js';

const $cam = document.getElementById('cam');
// iPhone/iPad: o takePhoto do Safari é lento (~1 s) e devolve a foto de lado; o quadro do vídeo sai certo e rápido (medido)
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const P = {
  aberto: false, steps: [], i: 0, stream: null, track: null, ic: null, caps: {}, camOk: false, camErro: '', modoVideo: false, rec: null, chunks: [], recT: null,
  token: 0, busy: false, autoT: null, ultimaAmb: null, ditando: false, torch: false, lista: false, cv: null, escutando: 0, mostrarCampos: false,
  gate: true, fila: [], proc: false, pend: {}, avisoVoz: false,
  perg: null, extra: null, perguntado: {}, trans: null, aiAtual: -1,
  zoomSel: 0.5, digital: 1, lente: 'main', lentes: { uw: null, tele: null, n: 0 }, mainId: null, travado: false, tocando: false, progScroll: false,
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- passos ---------- */
function montarSteps() {
  P.steps = [];
  // só os ambientes do próprio vistoriador entram no roteiro do passeio
  S.V.ambientes.forEach((a, ai) => { if (souDono(a)) lista(a).forEach((x) => { if (!x.it.na) P.steps.push({ ai, ambId: a.id, itemId: x.it.id, num: x.num }); }); });
}
const feito = (it) => itemFeito(it) && !faltaVerif(it);
function feitoStep(s) { const a = achaAmb(s.ambId), it = a && achaItem(a, s.itemId); return !it || feito(it); }
function primeiroPendente(de = 0) {
  for (let k = de; k < P.steps.length; k++) if (!feitoStep(P.steps[k])) return k;
  return P.steps.length;
}
const idxDoAmbiente = (ai) => (ai == null ? P.steps.length : (() => { const k = P.steps.findIndex((s) => s.ai === ai); return k < 0 ? P.steps.length : k; })());
function ctx() {
  const s = P.steps[P.i];
  if (!s) return null;
  const a = achaAmb(s.ambId), it = a && achaItem(a, s.itemId);
  return a && it ? { s, a, it } : null;
}
const nomeCompleto = (a, it) => { const pai = it.paiId ? achaItem(a, it.paiId) : null; return pai ? `${it.nome} — ${pai.nome}` : it.nome; };
function frase(a, it) {
  if (it.fala) return it.fala;
  if (it.g) return `Fotografe a vista geral — ${a.nome}`;
  if (it.m) return `Fotografe o ${it.nome.toLowerCase()}`;
  return `Fotografe: ${nomeCompleto(a, it)}`;
}
function fraseFalada(a, it) {
  let t = frase(a, it).replace(/^Fotografe: /, 'Fotografe ').replace(/—/g, ',').replace(/ \/ /g, ' ou ');
  if (it.q) t += '. Depois informe a quantidade.';
  return t;
}

/* ---------- câmera ---------- */
async function iniciarCamera(comAudio = false, deviceId = null, manterZoom = false) {
  pararStream();
  if (!navigator.mediaDevices?.getUserMedia) { P.camOk = false; P.camErro = 'Câmera indisponível neste navegador.'; renderPanel(); return false; }
  try {
    // Com ImageCapture (Android/Chrome) a prévia pode ser leve (720p, fluida) porque a foto sai em resolução total do sensor.
    // Sem ele (iPhone/Safari) a foto é um quadro da prévia, então a prévia precisa de 1080p.
    const temStill = typeof ImageCapture !== 'undefined' && !!ImageCapture.prototype?.takePhoto;
    // iPhone: 4:3 (sensor inteiro, campo de visão maior) em ~2560x1920; as fotos são guardadas em até 2400 px (Configurações)
    const alt = cfg.camRes === 720 ? [1280, 720] : cfg.camRes === 0 ? [4032, 3024] : IOS ? [2560, 1920] : [1920, 1080];
    const video = { width: { ideal: alt[0] }, height: { ideal: alt[1] }, frameRate: { ideal: 30, max: 30 } };
    if (deviceId) video.deviceId = { exact: deviceId }; else video.facingMode = { ideal: 'environment' };
    P.stream = await navigator.mediaDevices.getUserMedia({ video, audio: comAudio });
    P.cv.srcObject = P.stream;
    await P.cv.play().catch(() => {});
    P.track = P.stream.getVideoTracks()[0];
    P.caps = P.track.getCapabilities ? P.track.getCapabilities() : {};
    P.ic = !IOS && 'ImageCapture' in window ? new ImageCapture(P.track) : null;
    P.camOk = true; P.camErro = ''; P.torch = false; P.digital = 1; P.cv.style.transform = '';
    if (!deviceId && !P.mainId) P.mainId = P.track.getSettings?.().deviceId || null;
    await descobrirLentes();
    if (!manterZoom) await setarZoom(P.zoomSel, true);
  } catch (e) {
    P.camOk = false;
    P.camErro = e.name === 'NotAllowedError' ? 'Permissão da câmera negada. Libere nas configurações do navegador ou use a câmera do celular.' : `Não foi possível abrir a câmera (${e.message}).`;
  }
  renderPanel();
  return P.camOk;
}
function pararStream() {
  if (P.rec) { try { P.rec.stop(); } catch {} }
  P.stream?.getTracks().forEach((t) => t.stop());
  P.stream = null; P.track = null; P.ic = null; P.camOk = false;
  if (P.cv) P.cv.srcObject = null;
}
function flash() { const f = $cam.querySelector('.flash'); if (!f) return; f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 140); }

// lentes: no iPhone o navegador informa "Ultra Wide"/"Telephoto"; no Android depende do aparelho
async function descobrirLentes() {
  try {
    const ds = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    const costas = ds.filter((d) => /back|rear|traseira|environment/i.test(d.label) || !d.label);
    P.lentes = {
      uw: costas.find((d) => /ultra/i.test(d.label))?.deviceId || null,
      tele: costas.find((d) => /tele/i.test(d.label))?.deviceId || null,
      n: costas.length,
    };
  } catch { /* sem lista de dispositivos */ }
}

async function trocarLente(qual) {
  const id = qual === 'uw' ? P.lentes.uw : P.mainId;
  if (!id) return false;
  P.lente = qual;
  await iniciarCamera(P.modoVideo, id, true);
  return P.camOk;
}

// 0,5× / 1× / 2× / 3×. Quando o aparelho não oferece a lente/zoom, cai para o mais próximo disponível.
async function setarZoom(z, silencioso = false) {
  const zc = P.caps.zoom;
  try {
    if (z < 1) {
      if (zc && zc.min <= z + 0.05) {                       // zoom óptico < 1 exposto pelo navegador
        if (P.lente !== 'main') await trocarLente('main');
        await P.track.applyConstraints({ advanced: [{ zoom: Math.max(z, zc.min) }] });
        P.zoomSel = z; P.digital = 1;
      } else if (P.lentes.uw) {                             // lente ultra-angular separada
        if (P.lente !== 'uw') await trocarLente('uw');
        P.zoomSel = 0.5; P.digital = 1;
      } else {
        P.zoomSel = 1;
        if (!silencioso) toast('0,5× não está disponível neste aparelho pelo navegador. Para a ultra-angular, use "Câmera do celular".', 5000);
      }
    } else {
      if (P.lente !== 'main' && P.mainId) await trocarLente('main');
      if (P.caps.zoom) {                                    // zoom do próprio sensor/câmera
        const zz = Math.min(Math.max(z, P.caps.zoom.min || 1), P.caps.zoom.max || 1);
        await P.track.applyConstraints({ advanced: [{ zoom: zz }] });
        P.digital = z > zz ? z / zz : 1;                    // o que faltar vira zoom digital
      } else P.digital = z;                                 // sem zoom nativo: digital
      P.zoomSel = z;
    }
    if (P.cv) P.cv.style.transform = P.digital > 1 ? `scale(${P.digital})` : '';
  } catch (e) { if (!silencioso) toast('Zoom não suportado neste aparelho'); }
  renderZoom();
}

// Giro necessário para a foto sair horizontal: com o aparelho deitado, alguns celulares entregam o quadro "em pé"
// (sensor na orientação natural). Ângulo 90 (deitado para a esquerda): gira 90° anti-horário; ângulo 270: 90° horário.
function giroParaPaisagem(w, h) {
  const tipo = screen.orientation?.type || '', ang = screen.orientation?.angle ?? window.orientation ?? 0;
  const deitado = tipo ? tipo.startsWith('landscape') : Math.abs(ang) === 90;
  if (!deitado || h <= w) return 0;
  return ang === 270 || ang === -90 ? 90 : -90;
}
async function giraBlob(blob, graus) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const c = document.createElement('canvas'); c.width = bmp.height; c.height = bmp.width;
  const x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2); x.rotate((graus * Math.PI) / 180); x.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  bmp.close?.();
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}

async function pegarFrame() {
  let blob = null;
  if (P.ic && P.digital === 1) { try { blob = await P.ic.takePhoto(); } catch { blob = null; } }
  if (blob) {
    // a foto do sensor pode vir em pé mesmo com a tela deitada: confere as dimensões já com a orientação do arquivo
    try {
      const b = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      const g = giroParaPaisagem(b.width, b.height); b.close?.();
      if (g) blob = await giraBlob(blob, g);
    } catch { /* mantém a foto como veio */ }
  } else {
    const v = P.cv;
    if (!v.videoWidth) throw new Error('câmera ainda não está pronta');
    const z = P.digital || 1, sw = v.videoWidth / z, sh = v.videoHeight / z;
    const g = giroParaPaisagem(v.videoWidth, v.videoHeight);
    const cv = document.createElement('canvas');
    cv.width = Math.round(g ? sh : sw); cv.height = Math.round(g ? sw : sh);
    const x = cv.getContext('2d');
    if (g) { x.translate(cv.width / 2, cv.height / 2); x.rotate((g * Math.PI) / 180); x.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, -sw / 2, -sh / 2, sw, sh); }
    else x.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, cv.width, cv.height);
    blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92));
  }
  return blob;
}

// Disparo imediato: o flash e a próxima foto não esperam o sensor nem o processamento.
// A captura (takePhoto) é serializada numa cadeia e a imagem entra na fila de salvamento quando fica pronta.
function dispararFoto(ambId, itemId) {
  flash(); navigator.vibrate?.(25);
  P.pend[itemId] = (P.pend[itemId] || 0) + 1;
  const meta = { ts: Date.now(), pos: geo.last && Date.now() - geo.last.ts < 180000 ? { ...geo.last } : null };
  const prom = (P.capCad || Promise.resolve()).catch(() => 0).then(() => pegarFrame());
  prom.catch(() => {});
  P.capCad = prom;
  P.fila.push({ ambId, itemId, n: 1, origem: 'camera', meta, files: prom.then((b) => [new File([b], 'camera.jpg', { type: b.type || 'image/jpeg' })]) });
  processarFila();
}

async function capturar() {
  if (P.extra) return capturarExtra();
  const c = ctx();
  if (!c || P.perg) return;
  if (Date.now() - (P.ultClique || 0) < 160) return; // evita duplo toque sem travar a sequência
  P.ultClique = Date.now();
  clearTimeout(P.autoT);
  if (!P.camOk) return nativa();
  if (P.modoVideo) return gravar();
  dispararFoto(c.a.id, c.it.id);
  renderLeve();
}

// processa (redimensiona, gera miniatura, grava) em segundo plano para a câmera não travar
function enfileirar(ambId, itemId, files, origem) {
  P.pend[itemId] = (P.pend[itemId] || 0) + files.length;
  // hora e GPS do instante do clique (o processamento em segundo plano pode terminar segundos depois)
  const meta = { ts: Date.now(), pos: geo.last && Date.now() - geo.last.ts < 180000 ? { ...geo.last } : null };
  P.fila.push({ ambId, itemId, files, n: files.length, origem, meta });
  processarFila();
}
async function processarFila() {
  if (P.proc) return;
  P.proc = true;
  while (P.fila.length) {
    const j = P.fila.shift();
    try { await addMidia(j.ambId, j.itemId, await j.files, j.origem, j.meta); }
    catch (e) { console.error(e); toast('Falha ao salvar a foto: ' + e.message, 4000); }
    P.pend[j.itemId] = Math.max(0, (P.pend[j.itemId] || 0) - j.n);
    if (P.aberto) { renderLeve(); tentarAvancar(); }
  }
  P.proc = false;
}
// redesenho no máximo a cada ~150 ms (várias fotos em sequência não refazem a tela a cada uma)
function renderLeve() {
  if (P.rl) return;
  P.rl = setTimeout(() => { P.rl = null; renderPanel(); }, 150);
}
const esvaziarFila = async () => { while (P.proc || P.fila.length) await wait(100); };

async function gravar() {
  const c = P.extra ? { a: achaAmb(P.extra.ambId), it: { id: P.extra.itemId } } : ctx();
  if (P.rec) { P.rec.stop(); return; }
  if (!window.MediaRecorder) return toast('Gravação de vídeo não suportada aqui — use a câmera do celular');
  const mime = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  P.chunks = [];
  const rec = new MediaRecorder(P.stream, mime ? { mimeType: mime } : undefined);
  P.rec = rec;
  rec.ondataavailable = (e) => { if (e.data.size) P.chunks.push(e.data); };
  rec.onstop = async () => {
    clearInterval(P.recT);
    const type = rec.mimeType || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    P.rec = null;
    if (P.chunks.length && c.it.id) enfileirar(c.a.id, c.it.id, [new File([new Blob(P.chunks, { type })], `video.${ext}`, { type })], 'camera');
    renderPanel();
  };
  rec.start();
  const t0 = Date.now();
  P.recT = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    const el = $cam.querySelector('.rectime');
    if (el) el.textContent = `● ${s}s`;
    if (s >= 60) rec.stop();
  }, 500);
  renderPanel();
}

async function nativa() {
  const files = await escolher({ camera: true, video: P.modoVideo });
  if (!files.length) return;
  toast('Salvando…');
  if (P.extra) {
    const it = await itemExtra();
    enfileirar(P.extra.ambId, it.id, files, 'camera');
  } else {
    const c = ctx();
    if (!c) return;
    enfileirar(c.a.id, c.it.id, files, 'camera');
  }
  renderPanel();
}

async function aplicarConstraint(adv) {
  try { await P.track.applyConstraints({ advanced: [adv] }); } catch { toast('Não suportado neste aparelho'); }
}

/* ---------- registros extras ("há algo mais a incluir?") ---------- */
async function itemExtra() {
  const e = P.extra, a = achaAmb(e.ambId);
  if (e.itemId) return achaItem(a, e.itemId);
  const n = a.itens.filter((i) => i.extra).length + 1;
  const it = { id: uid(), nome: `Registro extra ${n}`, cat: 'item', q: false, t: false, p: false, g: false, m: false, extra: true, nomePend: true, custom: true };
  a.itens.push(it);
  e.itemId = it.id;
  await salvarV();
  return it;
}
async function capturarExtra() {
  if (Date.now() - (P.ultClique || 0) < 160) return;
  P.ultClique = Date.now();
  if (!P.camOk) return nativa();
  if (P.modoVideo) { await itemExtra(); return gravar(); }
  try {
    const it = await itemExtra();
    dispararFoto(P.extra.ambId, it.id);
  } catch (e) { toast('Falha na captura: ' + e.message, 3500); }
  renderLeve();
}

function perguntarMais(a, destAi) {
  P.perg = { ambId: a.id, nome: a.nome, destAi };
  P.token++;
  Voice.cancelar();
  renderPanel();
  if (cfg.falar) Voice.speak(`Há algo mais a incluir em ${a.nome}?`);
}
function seguirDepoisDaPergunta() {
  const d = P.perg || P.extra;
  P.perguntado[d.ambId] = true;
  const destAi = d.destAi;
  // vistoria na nuvem: ao seguir adiante com tudo feito, o ambiente é marcado como concluído para os outros verem
  const amb = achaAmb(d.ambId);
  if (S.V.nuvem && amb && !amb.concluido && amb.itens.filter((i) => !i.na).every(feito)) { amb.concluido = true; salvarV(); }
  P.perg = null; P.extra = null;
  montarSteps();
  irPara(idxDoAmbiente(destAi));
}

/* ---------- avanço ---------- */
function mostrarTransicao(ai) {
  P.trans = { ai };
  renderTrans();
  clearTimeout(P.transT);
  P.transT = setTimeout(() => { P.trans = null; renderTrans(); }, 1700);
}
function irPara(k) {
  clearTimeout(P.autoT);
  P.i = Math.max(0, Math.min(P.steps.length, k));
  P.token++;
  P.mostrarCampos = false;
  const s = P.steps[P.i];
  const c0 = ctx();
  if (c0 && !P.gate) presetar(c0);
  if (s && s.ai !== P.aiAtual && !P.gate) { P.aiAtual = s.ai; mostrarTransicao(s.ai); }
  else if (!s) P.aiAtual = -1;
  renderPanel();
  if (cfg.falar || cfg.comandos) anunciar();
  else { const c = ctx(); if (c) P.ultimaAmb = c.s.ambId; }
}
// regras de qualidade: o que o laudo exige de cada item (avaria com detalhe e descrição, medidor com leitura)
function falhaQualidade(it) {
  const fotos = midiaDoItem(it.id).length + (P.pend[it.id] || 0), tem = (t) => !!t && t.trim().length >= 3;
  if (it.m) {
    if (!fotos) return 'Medidor: fotografe o mostrador.';
    if (!it.leitura) return 'Medidor: informe a leitura.';
  } else if (it.cond === 'AVARIA') {
    if (fotos < 2) return 'Avaria: fotografe a vista geral e o detalhe (mínimo de 2 fotos).';
    if (!tem(it.obs)) return 'Avaria: descreva o que foi encontrado.';
  } else if (it.cond === 'REGULAR' && !tem(it.obs)) return 'Condição regular: descreva o que merece registro.';
  return '';
}
// entrada: superfície pintada já começa como PINTURA NOVA; o vistoriador só muda as exceções
function presetar(c) {
  const it = c.it;
  if (S.V.tipoVistoria === 'Entrada' && it.p && !it.cond && !it.na && !it.g && !it.m) { it.cond = 'PINTURA_NOVA'; it.condAuto = true; salvarV(); }
}
function proximo() {
  const c = ctx(), k = P.i + 1;
  if (c && !c.it.na && !P.gate && !cfg.rapido) { // modo rápido: sem exigências no meio do passeio; o padrão e as exceções vêm no fim
    const m = falhaQualidade(c.it);
    if (m) {
      if (P.qAviso?.id === c.it.id && Date.now() - P.qAviso.t < 7000) { c.it.semDetalhe = true; salvarV(); }   // segunda tentativa: segue mesmo assim e fica marcado
      else { P.qAviso = { id: c.it.id, t: Date.now() }; toast(`${m} Toque em Próximo de novo para seguir assim mesmo.`, 4500); navigator.vibrate?.(60); return; }
    }
  }
  const saindo = !P.gate && (k >= P.steps.length || (c && P.steps[k].ai !== c.s.ai));
  if (c && saindo && !P.perguntado[c.s.ai]) return perguntarMais(c.a, k < P.steps.length ? P.steps[k].ai : null);
  irPara(k);
}
const voltar = () => irPara(P.i - 1);

function tentarAvancar() {
  clearTimeout(P.autoT);
  if (!cfg.auto || P.perg || P.extra) return;
  const c = ctx();
  if (!c) return;
  const { it } = c, fotos = midiaDoItem(it.id).length + (P.pend[it.id] || 0);
  if (it.g) return;
  const ok = it.m ? fotos > 0 && it.leitura && it.sit
    : it.cond && fotos > 0 && (!it.q || it.qtd != null) && (!it.t || it.verif) && !falhaQualidade(it);
  if (!ok) return;
  const k = P.i;
  P.autoT = setTimeout(() => { if (P.aberto && P.i === k && !P.perg && !P.extra) proximo(); }, 1000);
}

/* ---------- voz ---------- */
async function anunciar() {
  const tok = ++P.token;
  const c = ctx();
  if (!c) { if (cfg.falar) Voice.speak('Fim do roteiro. Revise as pendências.'); return; }
  if (cfg.falar) {
    const intro = P.ultimaAmb !== c.s.ambId ? `${c.a.nome}. ` : '';
    P.ultimaAmb = c.s.ambId;
    const ok = await Voice.speak(intro + fraseFalada(c.a, c.it));
    if (!ok) avisoVoz();
  } else P.ultimaAmb = c.s.ambId;
  if (tok === P.token && cfg.comandos && Voice.ok) escutar(tok);
}
function avisoVoz() {
  if (P.avisoVoz) return;
  P.avisoVoz = true;
  const e = Voice.estadoFala;
  toast(!Voice.falaOk ? 'Este navegador não tem voz. Leia o roteiro na tela.'
    : `Sem voz agora${e.ultimoErro ? ' (' + e.ultimoErro + ')' : ''}. Toque no texto do roteiro para ouvir. No Android, confira Configurações › Saída de texto para fala › Português.`, 7000);
}
async function repetir() {
  const c = ctx();
  if (!c) return;
  Voice.desbloquear();
  const ok = await Voice.speak(fraseFalada(c.a, c.it));
  if (!ok) { P.avisoVoz = false; avisoVoz(); }
}

async function escutar(tok) {
  if (P.escutando === tok) return;
  P.escutando = tok;
  let erros = 0;
  while (tok === P.token && P.aberto && cfg.comandos) {
    if (P.ditando || P.busy) { await wait(400); continue; }
    let alts;
    try { alts = await Voice.listen(6000); }
    catch (e) {
      erros++;
      if (erros > 2 || /not-allowed|service/.test(e.message)) { cfg.comandos = false; salvarCfg(); toast('Comandos por voz indisponíveis — use os botões'); renderPanel(); return; }
      await wait(800);
      continue;
    }
    if (tok !== P.token || !alts.length) continue;
    await comandoVoz(alts);
  }
}

async function comandoVoz(alts) {
  const c = ctx();
  if (!c || P.perg || P.extra) return;
  const s = Voice.norm(alts[0]);
  if (/\b(foto|fotografar|tirar|capturar|clique)\b/.test(s)) return capturar();
  if (/\b(proximo|avancar|seguir|continuar)\b/.test(s)) return proximo();
  if (/\bvoltar\b/.test(s)) return voltar();
  if (/\bpular\b/.test(s)) return proximo();
  const r = Voice.analisar(alts, c.it);
  if (r.na) { c.it.na = true; await salvarV(); montarSteps(); return irPara(P.i); }
  if (!r.cond && r.qtd == null && !r.verif) return;
  if (r.cond && !c.it.g && !c.it.m) c.it.cond = r.cond;
  if (r.qtd != null && c.it.q) c.it.qtd = r.qtd;
  if (r.verif && c.it.t) c.it.verif = r.verif;
  if (r.desc && r.cond) c.it.obs = (c.it.obs ? c.it.obs + ' ' : '') + r.desc;
  await salvarV();
  renderPanel();
  tentarAvancar();
}

async function ditarObs() {
  const c = ctx();
  if (!c || !Voice.ok) return;
  P.ditando = true;
  toast('Fale agora…', 8000);
  try {
    const alts = await Voice.listen(10000);
    if (alts[0]) { c.it.obs = (c.it.obs ? c.it.obs + ' ' : '') + Voice.limpar(alts[0]); await salvarV(); }
  } catch (e) { toast('Microfone indisponível: ' + e.message, 3500); }
  P.ditando = false;
  renderPanel();
  tentarAvancar();
}

/* ---------- roda de seleção ---------- */
// Rolagem com "encaixe": o item no centro é o escolhido. Tocar num item também escolhe.
function roda(kind, opcoes, atual) {
  return `<div class="wheel" data-kind="${kind}"><div class="wh-band"></div>
    <div class="wh-list" data-wheel="${kind}"><i class="sp"></i>${opcoes.map(([v, l]) => `<button class="wi ${atual === v ? 'on' : ''}" data-p="wi" data-k="${kind}" data-v="${v}">${l}</button>`).join('')}<i class="sp"></i></div></div>`;
}
function posicionarRodas() {
  $cam.querySelectorAll('.wh-list').forEach((l) => {
    const itens = [...l.querySelectorAll('.wi')], i = itens.findIndex((b) => b.classList.contains('on'));
    P.progScroll = true;
    l.scrollTop = Math.max(0, i) * (itens[0]?.offsetHeight || 44);
    setTimeout(() => { P.progScroll = false; }, 300);
  });
}
function aplicarRoda(kind, valor) {
  const c = ctx();
  if (!c) return;
  const it = c.it;
  if (kind === 'cond') { if (it.cond === valor) return; it.cond = valor; if ((valor === 'AVARIA' || valor === 'REGULAR') && !it.obs) it.obsOpen = true; }
  else if (kind === 'verif') { if (it.verif === valor) return; it.verif = valor; }
  else return;
  salvarV().then(() => { renderPanel(); tentarAvancar(); });
}
function commitRoda(l) {
  if (P.tocando) { l._t = setTimeout(() => commitRoda(l), 120); return; }
  const itens = [...l.querySelectorAll('.wi')];
  if (!itens.length) return;
  const h = itens[0].offsetHeight || 44;
  const i = Math.min(itens.length - 1, Math.max(0, Math.round(l.scrollTop / h)));
  aplicarRoda(l.dataset.wheel, itens[i].dataset.v);
}

/* ---------- interface ---------- */
const qf = (f) => (f.q?.flags?.length ? `<i class="vert q" title="${esc(f.q.flags.join(', '))}">${f.q.flags.includes('tremida') ? '≈' : f.q.flags.includes('escura') ? '☾' : '☀'}</i>` : '');
function refBox(it) {
  const r = it.ref;
  if (!r) return '';
  const p = [labelCond(r.cond, true) || '—'];
  if (it.q && r.qtd != null) p.push(`${r.qtd} un.`);
  return `<div class="refbox"><b>ENTRADA</b> ${esc(p.join(' · '))}${r.obs ? ' — ' + esc(r.obs) : ''}</div>`;
}

function opcoesCond(it) {
  let l = CONDICOES.filter((c) => c[0] !== 'PINTURA_NOVA' || it.p).map(([v, n]) => [v, n]);
  if (it.p && S.V.tipoVistoria === 'Entrada') { const pn = l.find((x) => x[0] === 'PINTURA_NOVA'); l = [pn, ...l.filter((x) => x !== pn)]; } // entrada: pintura nova primeiro
  return l;
}

function camposHTML(it) {
  const fotos = midiaDoItem(it.id).length + (P.pend[it.id] || 0);
  const mostrar = fotos > 0 || it.cond || it.g || it.m || P.mostrarCampos;
  if (!mostrar) return '<button class="lnk lt" data-p="campos">Preencher sem fotografar</button>';
  const parts = [];
  if (it.m) {
    parts.push(`<div class="cf"><input data-pc="ident" value="${esc(it.ident || '')}" placeholder="Nº do medidor"><input data-pc="leitura" value="${esc(it.leitura || '')}" placeholder="Leitura"></div>`);
    parts.push(`<div class="chips">${['Ligado', 'Desligado'].map((s) => `<button data-p="sit" data-v="${s}" class="${it.sit === s ? 'on V' : ''}">${s}</button>`).join('')}</div>`);
  } else if (!it.g) {
    const rodas = [`<div class="wcol"><small>Condição</small>${roda('cond', opcoesCond(it), it.cond)}</div>`];
    if (it.t) rodas.push(`<div class="wcol"><small>Verificação</small>${roda('verif', VERIFICACOES.map(([v, l]) => [v, l]), it.verif)}</div>`);
    parts.push(`<div class="wheels">${rodas.join('')}</div>`);
  }
  if (it.q) parts.push(`<div class="qty"><span class="ql">${esc(it.un || 'Qtd.')}</span><button data-p="qtd" data-d="-1" aria-label="Menos">−</button><input type="number" inputmode="numeric" min="0" data-pc="qtd" value="${it.qtd ?? ''}" placeholder="0"><button data-p="qtd" data-d="1" aria-label="Mais">＋</button></div>`);
  if (it.cond === 'AVARIA' || it.cond === 'REGULAR') {
    parts.push(`<div class="aviso">${it.cond === 'AVARIA' ? 'Fotografe também o detalhe da avaria e descreva abaixo.' : 'Descreva o que merece registro.'}</div>
      <div class="qty"><textarea data-pc="obs" rows="2" placeholder="Descrição objetiva">${esc(it.obs || '')}</textarea>${Voice.ok ? '<button class="mic" data-p="ditar" aria-label="Ditar">🎙</button>' : ''}</div>`);
  }
  return parts.join('');
}

function renderTop() {
  const c = ctx();
  const total = P.steps.length;
  const top = $cam.querySelector('.ctop');
  const pct = total ? Math.round((Math.min(P.i, total) / total) * 100) : 0;
  const titulo = P.extra ? `Registros extras · ${esc(achaAmb(P.extra.ambId)?.nome || '')}` : P.perg ? esc(P.perg.nome) : c ? `A${p3(c.s.ai + 1)} · ${esc(c.a.nome)}` : 'Fim do roteiro';
  top.innerHTML = `<div class="ctrow">
      <button class="cb" data-p="fechar" aria-label="Sair do passeio">✕</button>
      <div class="ctinfo"><b>${titulo}</b><small>${c && !P.perg && !P.extra ? esc(nomeCompleto(c.a, c.it)) + ' · ' : ''}${Math.min(P.i + 1, total)} de ${total}</small></div>
      <button class="cb" data-p="lista" aria-label="Roteiro">☰</button>
      <button class="cb ${cfg.falar ? 'on' : ''}" data-p="falar" aria-label="Voz do roteiro">🔊</button>
      ${Voice.ok ? `<button class="cb ${cfg.comandos ? 'on' : ''}" data-p="comandos" aria-label="Comandos por voz">🎙</button>` : ''}
      ${P.caps.torch ? `<button class="cb ${P.torch ? 'on' : ''}" data-p="torch" aria-label="Lanterna">🔦</button>` : ''}
    </div><i class="cbar"><u style="width:${pct}%"></u></i>`;
}

function renderZoom() {
  const z = $cam.querySelector('.zbar');
  if (!z) return;
  if (P.gate || !P.camOk) { z.innerHTML = ''; return; }
  z.innerHTML = [0.5, 1, 2, 3].map((v) => `<button class="zb ${P.zoomSel === v ? 'on' : ''}" data-p="z" data-z="${v}">${v === 0.5 ? '0,5' : v}×</button>`).join('');
}

function renderTrans() {
  const el = $cam.querySelector('.ctrans');
  if (!el) return;
  if (!P.trans) { el.hidden = true; el.innerHTML = ''; return; }
  const a = S.V.ambientes[P.trans.ai];
  if (!a) { el.hidden = true; return; }
  const itens = a.itens.filter((i) => !i.na).length;
  el.hidden = false;
  el.innerHTML = `<div class="tcard"><small>AMBIENTE ${P.trans.ai + 1} DE ${S.V.ambientes.length}</small><div class="tn">${esc(a.nome)}</div><i class="tl"></i><small>${itens} itens no roteiro</small></div>`;
}

function gateHTML() {
  return `<div class="gate">
      <div class="rot">📱<span>↔</span></div>
      <h2 class="gt">Segure o celular na horizontal</h2>
      <p>As fotos devem ser <b>sempre horizontais</b>. Gire o aparelho antes de fotografar; fotos na vertical serão sinalizadas.</p>
      <p class="muted">No iPhone, desative o bloqueio de rotação. Ao iniciar, o app pede a câmera e libera a voz do roteiro.</p>
      <button class="btn primary big" data-p="iniciar">Iniciar passeio</button>
      <button class="lnk lt" data-p="fechar">Voltar</button></div>`;
}

function pergHTML() {
  const p = P.perg;
  return `<div class="cprompt">Há algo mais a incluir em ${esc(p.nome)}?</div>
    <p class="muted-l">Se sim, fotografe agora e dê o nome depois.</p>
    <div class="cctl3 dois">
      <button class="cbig" data-p="pergNao">Não, seguir</button>
      <button class="cbig sim" data-p="pergSim">Sim, fotografar</button>
    </div>
    <div class="csub"><button class="lnk lt" data-p="pergVolta">‹ Voltar ao último item</button></div>`;
}

function extraHTML() {
  const e = P.extra, a = achaAmb(e.ambId), it = e.itemId ? achaItem(a, e.itemId) : null;
  const ms = it ? midiaDoItem(it.id) : [];
  const gravando = !!P.rec;
  return `<div class="hhint">↔ Fotos sempre na horizontal</div>
    <div class="cprompt">Fotografe o que falta em ${esc(a.nome)}</div>
    ${P.camErro ? `<div class="aviso">${esc(P.camErro)}</div>` : ''}
    ${it ? `<div class="cf"><input data-pc="extraNome" value="${it.nomePend ? '' : esc(it.nome)}" placeholder="Nome deste registro (pode deixar para depois)"></div>` : ''}
    <div class="cthumbs">${ms.map((f) => `<span class="thw"><img class="th" src="${thumbURL(f)}" alt="">${f.vertical ? '<i class="vert">⚠</i>' : ''}${qf(f)}</span>`).join('')}${ms.length ? `<small>${ms.length} nesta peça</small>` : ''}${it && P.pend[it.id] ? '<small class="aviso-s">salvando…</small>' : ''}</div>
    <div class="cshut"><button class="shutter ${P.modoVideo ? 'vid' : ''} ${gravando ? 'rec' : ''}" data-p="shutter">${gravando ? '■' : ''}</button></div>
    <div class="cctl3 dois">
      <button class="cbig" data-p="extraNovo" ${it ? '' : 'disabled'}>Novo registro</button>
      <button class="cbig sim" data-p="extraFim">Concluir ambiente ›</button>
    </div>
    <div class="csub">
      <button class="lnk lt" data-p="modo">${P.modoVideo ? '📷 Foto' : '🎥 Vídeo'}</button>
      ${gravando ? '<span class="rectime">● 0s</span>' : ''}
      <button class="lnk lt" data-p="nativa">Câmera do celular</button>
    </div>`;
}

function renderBottom() {
  const bot = $cam.querySelector('.cbot');
  if (P.gate) { bot.innerHTML = gateHTML(); return; }
  if (P.perg) { bot.innerHTML = pergHTML(); return; }
  if (P.extra) { bot.innerHTML = extraHTML(); return; }
  const c = ctx();
  if (!c) { bot.innerHTML = fimHTML(); return; }
  const { a, it } = c;
  const ms = midiaDoItem(it.id);
  const gravando = !!P.rec;
  if (cfg.rapido) { // modo rápido: só a câmera. Nome do item no topo; aqui só o disparo e a navegação
    bot.innerHTML = `
      ${P.camErro ? `<div class="aviso">${esc(P.camErro)}</div>` : ''}
      <div class="cthumbs">${ms.slice(-4).map((f) => `<span class="thw"><img class="th" src="${thumbURL(f)}" alt="">${f.vertical ? '<i class="vert">⚠</i>' : ''}</span>`).join('')}${ms.length ? `<small>${ms.length}</small>` : ''}${P.pend[it.id] ? '<small class="aviso-s">…</small>' : ''}</div>
      <div class="cshut"><button class="shutter ${P.modoVideo ? 'vid' : ''} ${gravando ? 'rec' : ''}" data-p="shutter" aria-label="Fotografar">${gravando ? '■' : ''}</button></div>
      <div class="cctl3">
        <button class="cbig" data-p="voltar" ${P.i === 0 ? 'disabled' : ''}>‹</button>
        <button class="cbig na" data-p="na">Não tem</button>
        <button class="cbig" data-p="proximo">Próximo ›</button>
      </div>`;
    return;
  }
  bot.innerHTML = `
    <div class="hhint">↔ Fotos sempre na horizontal</div>
    <div class="cprompt" data-p="repetir" title="Toque para ouvir de novo">${esc(frase(a, it))} <span class="ear">🔊</span></div>
    ${P.camErro ? `<div class="aviso">${esc(P.camErro)}</div>` : ''}
    ${refBox(it)}
    <div class="cfields">${camposHTML(it)}</div>
    <div class="cthumbs">${ms.map((f) => `<span class="thw"><img class="th" src="${thumbURL(f)}" alt="">${f.tipo === 'video' ? '<i class="play">▶</i>' : ''}${f.vertical ? '<i class="vert">⚠</i>' : ''}${qf(f)}</span>`).join('')}${ms.length ? `<small>${ms.length} ${ms.length > 1 ? 'registros' : 'registro'}</small>` : ''}${P.pend[it.id] ? '<small class="aviso-s">salvando…</small>' : ''}</div>
    <div class="cshut">
      <button class="shutter ${P.modoVideo ? 'vid' : ''} ${gravando ? 'rec' : ''}" data-p="shutter" aria-label="${P.modoVideo ? 'Gravar vídeo' : 'Fotografar'}">${gravando ? '■' : ''}</button>
    </div>
    <div class="cctl3">
      <button class="cbig" data-p="voltar" ${P.i === 0 ? 'disabled' : ''}>‹ Voltar</button>
      <button class="cbig na" data-p="na">Não se aplica</button>
      <button class="cbig" data-p="proximo">Próximo ›</button>
    </div>
    <div class="csub">
      <button class="lnk lt" data-p="pularAmb">Pular ambiente</button>
      <button class="lnk lt" data-p="modo">${P.modoVideo ? '📷 Foto' : '🎥 Vídeo'}</button>
      ${gravando ? '<span class="rectime">● 0s</span>' : ''}
      <button class="lnk lt" data-p="nativa">Câmera do celular</button>
    </div>`;
  posicionarRodas();
}

function fimHTML() {
  let pend = 0;
  const por = S.V.ambientes.map((a, ai) => ({ a, ai })).filter((x) => souDono(x.a)).map(({ a, ai }) => {
    const n = a.itens.filter((i) => !i.na && !feito(i)).length;
    pend += n;
    return { a, ai, n };
  });
  return `<div class="cprompt">${pend ? `Faltam ${pend} itens` : 'Roteiro concluído'}</div>
    ${pend ? `<div class="cfields">${por.filter((x) => x.n).map((x) => `<button class="lnk lt" data-p="ir" data-ai="${x.ai}">A${p3(x.ai + 1)} ${esc(x.a.nome)} — ${x.n} pendente(s)</button>`).join('<br>')}</div>` : ''}
    <div class="cctl fim"><button class="cside" data-p="voltar">‹ Voltar</button>
      ${pend ? '<button class="btn primary" data-p="pend">Ir ao primeiro pendente</button>' : ''}
      <button class="btn dark" data-p="fechar">Concluir passeio</button></div>`;
}

function renderLista() {
  const sh = $cam.querySelector('.csheet');
  if (!sh) return;
  if (!P.lista) { sh.hidden = true; sh.innerHTML = ''; return; }
  sh.hidden = false;
  sh.innerHTML = `<div class="sheet"><h2>Roteiro do passeio</h2>
    ${S.V.ambientes.map((a, ai) => {
      if (!souDono(a)) return '';
      const its = a.itens.filter((i) => !i.na), ok = its.filter(feito).length;
      return `<button class="btn" data-p="ir" data-ai="${ai}">A${p3(ai + 1)} · ${esc(a.nome)} <small>${ok}/${its.length}</small></button>`;
    }).join('')}<button class="btn primary" data-p="lista">Fechar</button></div>`;
}

function renderPanel() {
  if (!P.aberto) return;
  renderTop(); renderBottom(); renderLista(); renderZoom(); renderTrans();
}

/* ---------- eventos ---------- */
async function onClick(e) {
  if (P.trans && e.target.closest('.ctrans')) { clearTimeout(P.transT); P.trans = null; renderTrans(); return; } // toque encerra a transição
  const el = e.target.closest('[data-p]');
  if (!el) return;
  const act = el.dataset.p, c = ctx();
  clearTimeout(P.autoT);
  try {
    switch (act) {
      case 'fechar': return fechar();
      case 'iniciar': return iniciarPasseio();
      case 'repetir': return repetir();
      case 'shutter': if (P.rajOn) return; return capturar();
      case 'proximo': return proximo();
      case 'pularAmb': {
        const ai = c ? c.s.ai : -1;
        const k = P.steps.findIndex((s, idx) => idx > P.i && s.ai > ai);
        return irPara(k >= 0 ? k : P.steps.length);
      }
      case 'voltar': return voltar();
      case 'nativa': return nativa();
      case 'campos': P.mostrarCampos = true; return renderPanel();
      case 'modo':
        P.modoVideo = !P.modoVideo;
        await iniciarCamera(P.modoVideo, P.lente === 'uw' ? P.lentes.uw : null, true);
        return;
      case 'falar': cfg.falar = !cfg.falar; salvarCfg(); if (!cfg.falar) Voice.cancelar(); return renderPanel();
      case 'comandos': cfg.comandos = !cfg.comandos; salvarCfg(); renderPanel(); if (cfg.comandos) escutar(++P.token); return;
      case 'torch': P.torch = !P.torch; await aplicarConstraint({ torch: P.torch }); return renderPanel();
      case 'z': return setarZoom(Number(el.dataset.z));
      case 'lista': P.lista = !P.lista; return renderPanel();
      case 'ir': {
        P.lista = false;
        P.perg = null; P.extra = null;
        const ai = Number(el.dataset.ai);
        const k = P.steps.findIndex((s) => s.ai === ai && !feitoStep(s));
        return irPara(k >= 0 ? k : idxDoAmbiente(ai));
      }
      case 'pend': return irPara(primeiroPendente(0));
      case 'ditar': return ditarObs();
      case 'pergNao': return seguirDepoisDaPergunta();
      case 'pergSim': P.extra = { ambId: P.perg.ambId, destAi: P.perg.destAi, itemId: null }; P.perg = null; renderPanel(); if (cfg.falar) Voice.speak('Fotografe o que falta.'); return;
      case 'pergVolta': P.perg = null; return renderPanel();
      case 'extraNovo': P.extra.itemId = null; return renderPanel();
      case 'extraFim': return seguirDepoisDaPergunta();
      case 'wi': return aplicarRoda(el.dataset.k, el.dataset.v);
      default: break;
    }
    if (!c) return;
    const it = c.it;
    if (act === 'sit') it.sit = it.sit === el.dataset.v ? '' : el.dataset.v;
    else if (act === 'qtd') it.qtd = Math.max(0, (Number(it.qtd) || 0) + Number(el.dataset.d));
    else if (act === 'na') { it.na = true; await salvarV(); montarSteps(); return irPara(P.i); }
    else return;
    await salvarV();
    renderPanel();
    tentarAvancar();
  } catch (err) { console.error(err); toast('Erro: ' + err.message, 4000); }
}

async function onChange(e) {
  const el = e.target.closest('[data-pc]');
  if (!el) return;
  const k = el.dataset.pc;
  if (k === 'extraNome') {
    const it = P.extra?.itemId && achaItem(achaAmb(P.extra.ambId), P.extra.itemId);
    if (it && el.value.trim()) { it.nome = el.value.trim(); it.nomePend = false; await salvarV(); }
    return;
  }
  const c = ctx();
  if (!c) return;
  const it = c.it;
  if (k === 'qtd') it.qtd = el.value === '' ? null : Math.max(0, parseInt(el.value, 10) || 0);
  if (k === 'ident') it.ident = el.value.trim();
  if (k === 'leitura') it.leitura = el.value.trim();
  if (k === 'obs') it.obs = el.value.trim();
  await salvarV();
  renderPanel();
  tentarAvancar();
}

// rolagem das rodas (o evento "scroll" não borbulha: usa captura)
function onScroll(e) {
  const l = e.target;
  if (!l.classList?.contains('wh-list') || P.progScroll) return;
  clearTimeout(l._t);
  l._t = setTimeout(() => commitRoda(l), 140);
}
const tocando = (v) => (e) => { if (e.target.closest?.('.wh-list')) P.tocando = v; };

// rajada: segurar o obturador (foto) dispara uma sequência (até 10), ótimo para vistas gerais
function rajadaIni(e) {
  if (!e.target.closest?.('[data-p=shutter]') || P.modoVideo || P.gate || P.perg) return;
  P.rajOn = false; P.rajN = 0;
  clearTimeout(P.rajT); clearInterval(P.rajI);
  P.rajT = setTimeout(() => {
    P.rajOn = true; navigator.vibrate?.(40);
    P.rajI = setInterval(() => { if (!P.aberto || P.perg || ++P.rajN > 10) return clearInterval(P.rajI); capturar(); }, 700);
  }, 550);
}
function rajadaFim() {
  clearTimeout(P.rajT); clearInterval(P.rajI);
  if (P.rajOn) setTimeout(() => { P.rajOn = false; }, 350); // o "click" que vem logo após soltar não pode disparar outra foto
}

/* ---------- abrir / fechar ---------- */
async function iniciarPasseio() {
  P.gate = false;
  Voice.desbloquear();
  // tela cheia + paisagem (Android): faz a câmera entregar fotos horizontais mesmo com a interface "em pé"
  try { if (document.fullscreenEnabled && !document.fullscreenElement) await $cam.requestFullscreen({ navigationUI: 'hide' }); } catch {}
  try { if (screen.orientation?.lock) { await screen.orientation.lock('landscape'); P.travado = true; } } catch { P.travado = false; }
  renderPanel();
  await iniciarCamera(false);
  irPara(P.i);
}

export async function abrir() {
  if (P.aberto) return;
  P.aberto = true;
  S.pausarSync = true; // o envio de fotos à nuvem espera: a câmera tem prioridade
  P.lista = false; P.mostrarCampos = false; P.ultimaAmb = null; P.modoVideo = false; P.gate = true; P.avisoVoz = false;
  P.perg = null; P.extra = null; P.perguntado = {}; P.trans = null; P.aiAtual = -1; P.zoomSel = 0.5; P.lente = 'main'; P.mainId = null;
  document.body.classList.add('cam-aberta');
  $cam.hidden = false;
  $cam.innerHTML = '<video class="cv" playsinline muted autoplay></video><div class="flash"></div><div class="ctop"></div><div class="zbar"></div><div class="cbot"></div><div class="ctrans" hidden></div><div class="csheet" hidden></div>';
  P.cv = $cam.querySelector('video');
  if (!P.ligado) {
    $cam.addEventListener('click', onClick);
    $cam.addEventListener('change', onChange);
    $cam.addEventListener('scroll', onScroll, true);
    $cam.addEventListener('pointerdown', tocando(true), true);
    $cam.addEventListener('pointerup', tocando(false), true);
    $cam.addEventListener('pointercancel', tocando(false), true);
    $cam.addEventListener('touchend', tocando(false), true);
    $cam.addEventListener('pointerdown', rajadaIni, true);
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => $cam.addEventListener(ev, rajadaFim, true));
    P.ligado = true;
  }
  montarSteps();
  P.i = primeiroPendente(0);
  renderPanel(); // a câmera, a tela cheia e a voz só iniciam no toque em "Iniciar passeio" (exigência dos celulares)
}

export function fechar(silencioso = false) {
  if (!P.aberto) return;
  P.aberto = false;
  P.token++;
  clearTimeout(P.autoT); clearTimeout(P.transT); clearTimeout(P.rajT); clearInterval(P.rajI);
  S.pausarSync = false;
  setTimeout(() => S.aoSalvar?.(), 600); // retoma o envio das fotos
  Voice.cancelar();
  pararStream();
  try { screen.orientation?.unlock?.(); } catch {}
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
  document.body.classList.remove('cam-aberta');
  $cam.hidden = true;
  $cam.innerHTML = '';
  if (!silencioso && S.V) {
    const id = S.V.id;
    let destino = '#/v/' + id;
    if (cfg.rapido) { // fim do passeio rápido: aplica o padrão (Bom/Testado; pintura = Pintura nova) e leva à conferência das exceções
      const n = aplicarPadrao(S.V); salvarV();
      if (n) { toast(`Padrão aplicado a ${n} itens. Confira só as exceções.`, 5000); destino = '#/v/' + id + '/revisao'; }
    }
    if (P.proc || P.fila.length) { toast('Salvando as últimas fotos…', 3000); esvaziarFila().then(() => { location.hash = destino; }); }
    else location.hash = destino;
  }
}
export const aberto = () => P.aberto;

document.addEventListener('visibilitychange', () => {
  if (!P.aberto || P.gate) return;
  if (document.hidden) { pararStream(); Voice.cancelar(); }
  else iniciarCamera(P.modoVideo, P.lente === 'uw' ? P.lentes.uw : null, true);
});
