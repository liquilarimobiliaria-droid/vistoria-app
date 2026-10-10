// Nuvem (Supabase): login, vistorias compartilhadas entre computador e celulares, divisão de ambientes entre vistoriadores,
// sincronização em segundo plano e tempo real. O aparelho continua sendo a cópia de trabalho (funciona sem sinal);
// a nuvem é a réplica. Cada ambiente tem UM dono, então ninguém sobrescreve o trabalho do outro.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import * as DB from './db.js';
import { S, toast, midiaDoItem } from './core.js';
import { plano } from './export.js';

export const N = { user: null, perfil: null, equipe: [], estado: 'off', erro: '', pronto: false };
const LS_PERFIL = 'ql-perfil';
let sb = null;

export function cliente() {
  if (!sb && window.supabase) {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ql-auth', detectSessionInUrl: false },
    });
  }
  return sb;
}

export function _usarCliente(c) { sb = c; } // só para testes automatizados

/* ---------- indicador de sincronização ---------- */
const ROTULO = { off: ['☁ entrar', ''], ok: ['☁ sincronizado', 'ok'], sync: ['⟳ sincronizando', ''], offline: ['☁ sem conexão', 'bad'], erro: ['⚠ erro de sincronização', 'bad'] };
export function chip() {
  const el = document.getElementById('syncchip');
  if (!el) return;
  let [t, c] = ROTULO[N.estado] || ROTULO.off;
  if (N.subindo) { t = `⟳ enviando fotos ${N.subindo.feitas}/${N.subindo.total}`; c = ''; }
  else if (N.estado === 'ok' && N.fotosPend) { t = `☁ ${N.fotosPend} foto${N.fotosPend > 1 ? 's' : ''} por enviar`; c = ''; }
  el.textContent = t;
  el.className = 'chip ' + c;
}

/* ---------- sessão ---------- */
export const logado = () => !!N.user;
export const papel = () => N.perfil?.papel || null;
export const podeCriar = () => ['admin', 'corretor'].includes(papel());
export const eAdmin = () => papel() === 'admin';
export const nomeDe = (id) => N.equipe.find((p) => p.id === id)?.nome || N.equipe.find((p) => p.id === id)?.email || '—';
// quem gerencia a vistoria: admin, quem criou ou o responsável
export const gereVistoria = (V) => !!N.user && (eAdmin() || V.criadaPor === N.user.id || V.responsavel === N.user.id);

async function aplicarSessao(sessao) {
  N.user = sessao?.user || null;
  S.euId = N.user?.id || null;
  S.gereFn = gereVistoria;
  if (!N.user) { N.perfil = null; N.estado = 'off'; try { localStorage.removeItem(LS_PERFIL); } catch {} chip(); return; }
  try {
    const { data, error } = await cliente().from('perfis').select('*').eq('id', N.user.id).single();
    if (error) throw error;
    N.perfil = data;
    try { localStorage.setItem(LS_PERFIL, JSON.stringify(data)); } catch {}
    N.estado = 'ok';
    carregarEquipe().catch(() => {});
  } catch {
    try { N.perfil = JSON.parse(localStorage.getItem(LS_PERFIL)); } catch { N.perfil = null; } // sem sinal: usa o último perfil conhecido
    N.estado = navigator.onLine ? 'erro' : 'offline';
  }
  chip();
}

export async function iniciar() {
  const c = cliente();
  if (!c) return;
  try { const { data } = await c.auth.getSession(); await aplicarSessao(data.session); } catch { /* sem sinal */ }
  N.pronto = true;
  c.auth.onAuthStateChange((ev, sessao) => { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'TOKEN_REFRESHED') aplicarSessao(sessao); });
  window.addEventListener('online', () => { if (N.user) { N.estado = 'sync'; chip(); retomar(); } });
  window.addEventListener('offline', () => { if (N.user) { N.estado = 'offline'; chip(); } });
  S.aoSalvar = () => agendarPush();
}

export async function entrar(email, senha) {
  const c = cliente();
  if (!c) throw new Error('Biblioteca da nuvem não carregou.');
  const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password: senha });
  if (error) {
    const m = error.message || '';
    throw new Error(/invalid login/i.test(m) ? 'E-mail ou senha incorretos.' : /network|fetch/i.test(m) ? 'Sem conexão com a internet.' : m);
  }
  await aplicarSessao(data.session);
}
export async function sair() {
  desassinar();
  try { await cliente().auth.signOut(); } catch {}
  await aplicarSessao(null);
}

/* ---------- equipe ---------- */
export async function carregarEquipe() {
  const { data, error } = await cliente().from('perfis').select('id,nome,email,papel,ativo').order('nome');
  if (error) throw error;
  N.equipe = data || [];
  return N.equipe;
}
export async function atualizarPerfil(id, campos) {
  const { error } = await cliente().from('perfis').update(campos).eq('id', id);
  if (error) throw error;
  await carregarEquipe();
}

/* ---------- conversão local ⇄ nuvem ---------- */
const iso = (t) => (t ? new Date(t).toISOString() : null);
const ms = (s) => (s ? new Date(s).getTime() : null);
function hash(o) { // hash rápido do conteúdo (para saber se algo mudou desde a última sincronização)
  const s = typeof o === 'string' ? o : JSON.stringify(o);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const statusDe = (V) => (V.fimEm ? 'finalizada' : V.inicioEm ? 'em_andamento' : 'rascunho');

function linhaVistoria(V) {
  return {
    codigo: V.codigo, tipo_vistoria: V.tipoVistoria, finalidade: V.finalidade || null, endereco: V.endereco, cod_imovel: V.codImovel || null,
    metragem: V.metragem || null, solicitante: V.solicitante || null, tipo_imovel_key: V.tipoImovelKey || null, tipo_imovel: V.tipoImovel || null,
    variaveis: V.variaveis || null, base_entrada: V.baseEntrada || null, status: statusDe(V), responsavel: V.responsavel || null,
    inicio_em: iso(V.inicioEm), fim_em: iso(V.fimEm), geo: V.geo || null, condicoes: V.condicoes || {}, geral: V.geral || {},
  };
}
function itensParaNuvem(a) {
  return a.itens.map((i) => { const { obsOpen, ...r } = i; return { ...r, nf: midiaDoItem(i.id).length || i.nf || 0 }; }); // nf: nº de fotos (para o progresso nos outros aparelhos)
}
function linhaAmbiente(V, a, i) {
  return { id: a.id, vistoria_id: V.id, ordem: i, nome: a.nome, modelo: a.modelo || null, dono: a.dono || null, itens: itensParaNuvem(a), concluido: !!a.concluido };
}
function vistoriaDeLinha(r) {
  return {
    id: r.id, fmt: 2, nuvem: true, codigo: r.codigo, tipoVistoria: r.tipo_vistoria, finalidade: r.finalidade || '', endereco: r.endereco, codImovel: r.cod_imovel || '',
    metragem: r.metragem || '', solicitante: r.solicitante || '', tipoImovelKey: r.tipo_imovel_key, tipoImovel: r.tipo_imovel || '', variaveis: r.variaveis,
    baseEntrada: r.base_entrada, criadaPor: r.criada_por, responsavel: r.responsavel, inicioEm: ms(r.inicio_em), fimEm: ms(r.fim_em), geo: r.geo,
    condicoes: r.condicoes || {}, geral: r.geral || {}, criadoEm: ms(r.criado_em), atualizadoEm: Date.now(), exportadoEm: null, nFotos: 0,
  };
}

/* ---------- aplicar o que veio da nuvem sobre a cópia local (sem atropelar edição local) ---------- */
function aplicarVistoriaRemota(V, r) {
  V.criadaPor = r.criada_por; V.responsavel = r.responsavel;
  const localMudou = V._hv && V._hv !== hash(linhaVistoria(V));
  if (gereVistoria(V) && localMudou) { V._vv = r.versao; return; } // quem gerencia e editou aqui mantém o seu (será enviado)
  const nova = vistoriaDeLinha(r);
  for (const k of ['codigo', 'tipoVistoria', 'finalidade', 'endereco', 'codImovel', 'metragem', 'solicitante', 'tipoImovelKey', 'tipoImovel', 'variaveis', 'baseEntrada', 'inicioEm', 'fimEm', 'condicoes', 'geral']) V[k] = nova[k];
  V.geo = r.geo || V.geo;
  V._hv = hash(linhaVistoria(V)); V._vv = r.versao;
}
function ambienteDeLinha(r) {
  return { id: r.id, nome: r.nome, modelo: r.modelo, dono: r.dono, concluido: r.concluido, itens: r.itens || [], _rv: r.versao };
}
function aplicarAmbienteRemoto(V, r) {
  const i = V.ambientes.findIndex((x) => x.id === r.id);
  if (i < 0) { const a = ambienteDeLinha(r); a._h = hash(linhaAmbiente(V, a, r.ordem)); V.ambientes.push(a); return true; }
  const a = V.ambientes[i];
  if (r.versao <= (a._rv || 0)) return false;
  const intacto = a._h && a._h === hash(linhaAmbiente(V, a, i));          // nada editado aqui desde a última sincronização
  const meu = a.dono === S.euId;
  if (meu && !intacto) return false;                                     // meu ambiente com edição local pendente: vale o meu
  Object.assign(a, { nome: r.nome, modelo: r.modelo, dono: r.dono, concluido: r.concluido, itens: r.itens || [] });
  a._rv = r.versao; a._h = hash(linhaAmbiente(V, a, i));
  return true;
}
function aplicarAmbientesRemotos(V, linhas) {
  let mudou = false;
  const ids = new Set(linhas.map((r) => r.id));
  for (const r of linhas) mudou = aplicarAmbienteRemoto(V, r) || mudou;
  // já sincronizado antes (tem _rv) e sumiu da nuvem: foi apagado lá, então sai daqui; ambiente novo ainda não enviado (sem _rv) fica
  const antes = V.ambientes.length;
  V.ambientes = V.ambientes.filter((a) => ids.has(a.id) || !a._rv);
  mudou = mudou || V.ambientes.length !== antes;
  const ordem = new Map(linhas.map((r) => [r.id, r.ordem]));
  V.ambientes.sort((a, b) => (ordem.has(a.id) ? ordem.get(a.id) : 1e9) - (ordem.has(b.id) ? ordem.get(b.id) : 1e9));
  return mudou;
}

/* ---------- publicar / baixar / listar ---------- */
export async function publicar(V) {
  const c = cliente();
  if (!N.user) throw new Error('Entre na sua conta para enviar à nuvem.');
  if (!podeCriar()) throw new Error('Só administrador ou corretor cria vistorias na nuvem.');
  V.nuvem = true; V.criadaPor = V.criadaPor || N.user.id; V.responsavel = V.responsavel || N.user.id;
  const { error } = await c.from('vistorias').upsert({ id: V.id, ...linhaVistoria(V) });
  if (error) throw error;
  const donos = [...new Set([V.responsavel, ...V.ambientes.map((a) => a.dono)].filter((x) => x && x !== N.user.id))];
  if (donos.length) {
    const { error: e2 } = await c.from('vistoria_membros').upsert(donos.map((u) => ({ vistoria_id: V.id, user_id: u })), { onConflict: 'vistoria_id,user_id' });
    if (e2) throw e2;
  }
  const linhas = V.ambientes.map((a, i) => linhaAmbiente(V, a, i));
  if (linhas.length) {
    const { data, error: e3 } = await c.from('ambientes').upsert(linhas).select('id,versao');
    if (e3) throw e3;
    V.ambientes.forEach((a, i) => { a._h = hash(linhas[i]); a._rv = data.find((d) => d.id === a.id)?.versao || 1; });
  }
  V._hv = hash(linhaVistoria(V));
  await DB.putV(V);
}

export async function listarNuvem() {
  const { data, error } = await cliente().from('vistorias').select('id,codigo,tipo_vistoria,endereco,status,tipo_imovel,atualizado_em,criada_por,ambientes(id,dono,concluido)').order('atualizado_em', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function baixar(id) {
  const c = cliente();
  const { data: r, error } = await c.from('vistorias').select('*').eq('id', id).single();
  if (error) throw error;
  const { data: ars, error: e2 } = await c.from('ambientes').select('*').eq('vistoria_id', id).order('ordem');
  if (e2) throw e2;
  let V = await DB.getV(id);
  if (!V) { V = vistoriaDeLinha(r); V.ambientes = []; }
  V.nuvem = true;
  aplicarVistoriaRemota(V, r);
  aplicarAmbientesRemotos(V, ars || []);
  await DB.putV(V);
  await carregarEquipe().catch(() => {});
  return V;
}

// atualiza a cópia aberta com o que há na nuvem (ao abrir, ao voltar a conexão e a cada 30 s)
export async function puxar(V) {
  const c = cliente();
  const [{ data: r, error }, { data: ars, error: e2 }] = await Promise.all([
    c.from('vistorias').select('*').eq('id', V.id).single(),
    c.from('ambientes').select('*').eq('vistoria_id', V.id).order('ordem'),
  ]);
  if (error) throw error;
  if (e2) throw e2;
  aplicarVistoriaRemota(V, r);
  let mudou = aplicarAmbientesRemotos(V, ars || []);
  await DB.putV(V);
  mudou = (await puxarMidias(V).catch((e) => { console.warn('midias', e); return false; })) || mudou;
  if (mudou) S.redraw?.();
  return mudou;
}

/* ---------- fotos e vídeos ---------- */
// Cada aparelho envia as suas mídias (arquivo + miniatura) ao armazenamento privado; os demais recebem a miniatura.
// O original só desce para o computador quando se pede ("baixar originais"), para o ZIP.
const caminhoMidia = (V, f) => `${V.id}/${f.ambId}/${f.id}.${(f.mime || '').includes('png') ? 'png' : f.tipo === 'video' ? (f.mime || '').includes('webm') ? 'webm' : 'mp4' : 'jpg'}`;
const caminhoThumb = (p) => p.replace(/\.[^./]+$/, '') + '_t.jpg';
function metaMidia(V, f) {
  return { id: f.id, vistoria_id: V.id, ambiente_id: f.ambId, item_id: f.itemId, tipo: f.tipo || 'foto', seq: f.seq, ts: iso(f.ts), pos: f.pos || null, origem: f.origem || null,
    nota: f.nota || null, w: f.w || null, h: f.h || null, dur: f.dur || null, vertical: !!f.vertical, bytes: f.blob?.size || null };
}
export async function contarPendentes(V) {
  const fs = !V ? [] : S.V?.id === V.id ? S.FOTOS : await DB.fotosDe(V.id);
  N.fotosPend = fs.filter((f) => !f.remoto && f.sync !== 'enviada').length;
  return N.fotosPend;
}

let enviandoMidias = false;
export async function empurrarMidias(V) {
  // durante o passeio o envio de fotos espera (a câmera tem prioridade); recomeça sozinho ao sair
  if (!V?.nuvem || !N.user || !navigator.onLine || enviandoMidias || S.pausarSync) return;
  enviandoMidias = true;
  const c = cliente();
  try {
    // 1) baixas: foto apagada aqui sai também da nuvem (arquivo, miniatura e registro)
    for (const t of [...(V.apagadas || [])]) {
      if (t.path) await c.storage.from('midias').remove([t.path, caminhoThumb(t.path)]);
      const { error } = await c.from('midias').delete().eq('id', t.id);
      if (error) throw error;
      V.apagadas = V.apagadas.filter((x) => x !== t);
    }
    // 2) envios e atualizações de legenda/ordem/item
    // usa as mesmas cópias que o app mantém em memória (senão as marcas de "enviada" se perderiam)
    const todas = (S.V?.id === V.id ? S.FOTOS : await DB.fotosDe(V.id)).filter((f) => !f.remoto).sort((a, b) => a.seq - b.seq);
    const pend = todas.filter((f) => f.sync !== 'enviada' || f._mh !== hash(metaMidia(V, f)));
    N.fotosPend = todas.filter((f) => f.sync !== 'enviada').length;
    N.subindo = pend.length ? { feitas: 0, total: pend.length } : null; chip();
    for (const f of pend) {
      const meta = metaMidia(V, f);
      if (f.sync !== 'enviada') {
        const p = caminhoMidia(V, f);
        const { error } = await c.storage.from('midias').upload(p, f.blob, { contentType: f.mime || 'image/jpeg', upsert: true });
        if (error) throw error;
        if (f.thumb) await c.storage.from('midias').upload(caminhoThumb(p), f.thumb, { contentType: 'image/jpeg', upsert: true });
        f.storagePath = p;
      }
      // arquivo novo: grava o registro completo; só legenda/ordem/item mudou: atualiza os dados SEM mexer em status/Drive
      if (f.sync !== 'enviada') {
        const { error } = await c.from('midias').upsert({ ...meta, storage_path: f.storagePath, status: 'enviada' });
        if (error) throw error;
      } else {
        const { id, vistoria_id, ...resto } = meta;
        const { error } = await c.from('midias').update(resto).eq('id', id);
        if (error) throw error;
      }
      f.sync = 'enviada'; f._mh = hash(meta);
      await DB.putF(f);
      N.subindo = { feitas: (N.subindo?.feitas || 0) + 1, total: pend.length };
      N.fotosPend = Math.max(0, N.fotosPend - 1); chip();
    }
    await DB.putV(V);
  } finally {
    enviandoMidias = false; N.subindo = null;
    await contarPendentes(V).catch(() => {});
    chip();
  }
}

// traz as mídias de outros aparelhos/colegas (só a miniatura) e aplica legendas, ordem e remoções
export async function puxarMidias(V) {
  const c = cliente();
  const { data, error } = await c.from('midias').select('*').eq('vistoria_id', V.id);
  if (error) throw error;
  const locais = new Map((S.V?.id === V.id ? S.FOTOS : await DB.fotosDe(V.id)).map((f) => [f.id, f]));
  const remotos = new Map((data || []).map((r) => [r.id, r]));
  let mudou = false;
  for (const r of data || []) {
    const l = locais.get(r.id);
    if (l) {
      const noDrive = r.status === 'no_drive';
      if (!l.remoto) {                                           // é minha: vale o que tenho aqui; só aprendo que já está no Drive
        if (noDrive && !l.noDrive) { l.noDrive = true; l.driveId = r.drive_id; await DB.putF(l); mudou = true; }
        continue;
      }
      const novo = { ambId: r.ambiente_id, itemId: r.item_id, seq: r.seq, nota: r.nota || '', vertical: r.vertical, noDrive, driveId: r.drive_id || null };
      if (Object.entries(novo).some(([k, v]) => l[k] !== v)) { Object.assign(l, novo); await DB.putF(l); mudou = true; }
      continue;
    }
    if (!r.storage_path || r.status === 'pendente') continue;    // ainda subindo
    let thumb = null;
    try { const { data: b } = await c.storage.from('midias').download(caminhoThumb(r.storage_path)); thumb = b; } catch { /* sem miniatura */ }
    if (!thumb) continue;
    const rec = { id: r.id, vistoriaId: V.id, ambId: r.ambiente_id, itemId: r.item_id, seq: r.seq, tipo: r.tipo, blob: thumb, thumb, mime: 'image/jpeg', w: r.w, h: r.h, dur: r.dur || 0,
      ts: ms(r.ts), pos: r.pos, origem: r.origem, nota: r.nota || '', vertical: r.vertical, remoto: true, soThumb: true, storagePath: r.storage_path, sync: 'enviada',
      noDrive: r.status === 'no_drive', driveId: r.drive_id || null };
    await DB.putF(rec);
    if (S.V?.id === V.id) S.FOTOS.push(rec);
    mudou = true;
  }
  // removidas na nuvem
  for (const l of locais.values()) {
    if (l.remoto && !remotos.has(l.id)) { await DB.delF(l.id); if (S.V?.id === V.id) S.FOTOS = S.FOTOS.filter((x) => x.id !== l.id); mudou = true; }
  }
  if (mudou && S.V?.id === V.id) S.FOTOS = await DB.fotosDe(V.id);
  return mudou;
}

export const soMiniaturas = (fotos) => fotos.filter((f) => f.remoto && f.soThumb && !f.noDrive);
export const noDrive = (fotos) => fotos.filter((f) => f.noDrive);
// baixa os arquivos originais das mídias que só estão em miniatura (necessário para gerar o ZIP)
export async function baixarOriginais(V, onProg = () => {}) {
  const c = cliente();
  const alvo = soMiniaturas(await DB.fotosDe(V.id));
  let i = 0;
  for (const f of alvo) {
    const { data, error } = await c.storage.from('midias').download(f.storagePath);
    if (error) throw error;
    f.blob = data; f.soThumb = false; f.mime = data.type || f.mime;
    await DB.putF(f);
    onProg(++i, alvo.length);
  }
  if (S.V?.id === V.id) S.FOTOS = await DB.fotosDe(V.id);
  return alvo.length;
}

/* ---------- enviar (empurrar) em segundo plano ---------- */
let pushT = null, pushando = false, pushDeNovo = false;
export function agendarPush(atraso = 2500) {
  if (!S.V?.nuvem || !N.user) return;
  clearTimeout(pushT);
  pushT = setTimeout(empurrar, atraso);
}
export async function empurrar() {
  const V = S.V;
  if (!V?.nuvem || !N.user) return;
  if (!navigator.onLine) { N.estado = 'offline'; chip(); return; }
  if (pushando) { pushDeNovo = true; return; }
  pushando = true; N.estado = 'sync'; chip();
  try {
    const c = cliente(), sou = gereVistoria(V);
    if (sou) {
      const linha = linhaVistoria(V), h = hash(linha);
      if (h !== V._hv) {
        const { data, error } = await c.from('vistorias').update(linha).eq('id', V.id).select('versao');
        if (error) throw error;
        V._hv = h; V._vv = data?.[0]?.versao ?? V._vv;
      }
    } else if (V.inicioEm && !V._iniciado) {
      const { error } = await c.rpc('iniciar_vistoria', { p_id: V.id, p_geo: V.geo || null });
      if (error) throw error;
      V._iniciado = true;
    }
    for (let i = 0; i < V.ambientes.length; i++) {
      const a = V.ambientes[i];
      if (!(a.dono === N.user.id || sou)) continue;
      const linha = linhaAmbiente(V, a, i), h = hash(linha);
      if (h === a._h) continue;
      const { data, error } = await c.from('ambientes').upsert(linha).select('id,versao');
      if (error) throw error;
      a._h = h; a._rv = data?.[0]?.versao ?? a._rv;
    }
    await DB.putV(V);
    N.estado = 'ok'; N.erro = '';
    await empurrarMidias(V); // fotos e vídeos: depois dos dados, para o resto nunca esperar por upload
  } catch (e) {
    N.estado = navigator.onLine ? 'erro' : 'offline'; N.erro = e.message || String(e);
    console.warn('sync', e);
    setTimeout(() => agendarPush(0), 15000);
  } finally {
    pushando = false; chip();
    if (pushDeNovo) { pushDeNovo = false; agendarPush(500); }
  }
}
async function retomar() {
  if (S.V?.nuvem) { try { await puxar(S.V); } catch (e) { console.warn(e); } await empurrar(); }
  else { N.estado = 'ok'; chip(); }
}

/* ---------- tempo real ---------- */
let canal = null, poll = null, canalId = null;
export function desassinar() {
  clearInterval(poll); poll = null;
  if (canal) { try { cliente().removeChannel(canal); } catch {} canal = null; }
  canalId = null;
}
export function assinar(V) {
  if (canal && canalId === V.id) return; // já assinada
  desassinar();
  const c = cliente();
  if (!c || !V?.nuvem || !N.user) return;
  canalId = V.id;
  const aoAmb = async (p) => {
    if (S.V?.id !== V.id) return;
    const r = p.new && Object.keys(p.new).length ? p.new : null;
    if (p.eventType === 'DELETE') { V.ambientes = V.ambientes.filter((a) => a.id !== p.old.id); }
    else if (r && r.atualizado_por !== N.user.id) { if (!aplicarAmbienteRemoto(V, r)) return; }
    else return;
    await DB.putV(V); S.redraw?.();
  };
  const aoVis = async (p) => {
    if (S.V?.id !== V.id || !p.new) return;
    aplicarVistoriaRemota(V, p.new); await DB.putV(V); S.redraw?.();
  };
  let tm = null;
  const aoMidia = (p) => {
    if (S.V?.id !== V.id || p.new?.criado_por === N.user.id && p.eventType !== 'DELETE') return; // eco do meu próprio envio
    clearTimeout(tm);
    tm = setTimeout(() => puxarMidias(V).then((m) => { if (m) S.redraw?.(); }).catch(() => {}), 800);
  };
  canal = c.channel('v-' + V.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ambientes', filter: `vistoria_id=eq.${V.id}` }, aoAmb)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vistorias', filter: `id=eq.${V.id}` }, aoVis)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'midias', filter: `vistoria_id=eq.${V.id}` }, aoMidia)
    .subscribe();
  poll = setInterval(() => { if (navigator.onLine && S.V?.id === V.id) puxar(V).catch(() => {}); }, 30000); // reforço caso o tempo real caia
}

/* ---------- divisão de ambientes ---------- */
export async function atribuir(V, ambId, userId) {
  const a = V.ambientes.find((x) => x.id === ambId);
  a.dono = userId || null;
  if (userId && userId !== N.user.id) {
    const { error } = await cliente().from('vistoria_membros').upsert({ vistoria_id: V.id, user_id: userId }, { onConflict: 'vistoria_id,user_id' });
    if (error) throw error;
  }
  await DB.putV(V);
  agendarPush(0);
}
// blocos contíguos, na ordem do passeio; medidores ficam com o responsável
export function dividirAmbientes(ambientes, ids, responsavel) {
  const alvo = ambientes.filter((a) => a.modelo !== 'medidores');
  const k = ids.length, tam = Math.ceil(alvo.length / k);
  alvo.forEach((a, i) => { a.dono = ids[Math.min(k - 1, Math.floor(i / tam))]; });
  ambientes.filter((a) => a.modelo === 'medidores').forEach((a) => { a.dono = responsavel; });
}
/* ---------- Drive ---------- */
// Dá a cada mídia o nome final (A###-F###, igual ao ZIP) e a pasta do ambiente; a função do servidor então copia para o Drive.
async function nomearParaDrive(V) {
  const fotos = S.V?.id === V.id ? S.FOTOS : await DB.fotosDe(V.id);
  const itens = plano(fotos).flatMap((p) => p.todas.map((m) => ({ id: m.f.id, pasta: p.pasta, nome: m.arq })));
  if (!itens.length) return 0;
  const { data, error } = await cliente().rpc('nomear_midias', { p_vistoria: V.id, p_itens: itens });
  if (error) throw error;
  return data;
}
async function erroDaFuncao(error) {
  let msg = error.message || 'falha na função';
  try { const j = await error.context.json(); msg = j.erro || msg; } catch { /* sem corpo */ }
  return new Error(msg);
}
export async function testarDrive() {
  const { data, error } = await cliente().functions.invoke('drive-sync', { body: { vistoria_id: S.V?.id || '', teste: true } });
  if (error) throw await erroDaFuncao(error);
  return data;
}
export async function enviarAoDrive(V, onProg = () => {}) {
  if (!gereVistoria(V)) throw new Error('Só quem gerencia a vistoria envia ao Drive.');
  if (!navigator.onLine) throw new Error('Sem conexão com a internet.');
  await empurrar();
  await empurrarMidias(V);                       // as fotos deste aparelho precisam estar na nuvem primeiro
  await puxarMidias(V).catch(() => {});
  await nomearParaDrive(V);
  let total = 0, ultima = null;
  for (let volta = 0; volta < 60; volta++) {
    const { data, error } = await cliente().functions.invoke('drive-sync', { body: { vistoria_id: V.id, limite: 20 } });
    if (error) throw await erroDaFuncao(error);
    ultima = data; total += data.enviados || 0;
    onProg({ enviados: total, restantes: data.restantes, semNome: data.semNome });
    if (data.erros?.length) throw new Error(data.erros[0]);
    if (!data.restantes || (!data.enviados && !data.semNome)) break;
    if (!data.enviados) break;
  }
  if (ultima?.pasta_url) V.driveUrl = ultima.pasta_url;
  V.driveEm = Date.now();
  await DB.putV(V);
  await puxarMidias(V).catch(() => {});
  return { total, ...ultima };
}

/* ---- fila do laudo, validação, assinatura, pedidos e painel ---- */
export async function estadoLaudo(V) {
  const { data } = await cliente().from('laudo_fila').select('estado,detalhe,laudo_url,publica_url,validacao,validado_em,assinado_em,signed_drive_id').eq('vistoria_id', V.id).maybeSingle();
  return data;
}
export async function listarSugestoes(V) {
  const { data, error } = await cliente().from('sugestoes').select('*').eq('vistoria_id', V.id).order('criado_em');
  if (error) throw error;
  return data;
}
export async function responderSugestao(id, estado, resposta) {
  const { error } = await cliente().from('sugestoes').update({ estado, resposta: resposta ?? null, respondido_em: new Date().toISOString(), respondido_por: N.user.id }).eq('id', id);
  if (error) throw error;
}
export async function confirmarValidacao(V, dados) {
  await empurrar();                               // o laudo é gerado a partir do que está na nuvem
  const { error } = await cliente().rpc('confirmar_validacao', { p_vistoria: V.id, p_dados: dados });
  if (error) throw new Error(error.message);
}
// cria (no Drive, pelo servidor) a pasta pública de autenticidade e fotos; repete até copiar tudo
export async function publicarPasta(V, onProg = () => {}) {
  let ult = null;
  for (let volta = 0; volta < 40; volta++) {
    const { data, error } = await cliente().functions.invoke('drive-publicar', { body: { vistoria_id: V.id } });
    if (error) throw await erroDaFuncao(error);
    ult = data; onProg(data);
    if (data.erros?.length) throw new Error(data.erros[0]);
    if (!data.restantes) break;
    if (!data.copiados) break;
  }
  return ult;
}
export async function aprovarParaAssinatura(V) {
  const { error } = await cliente().rpc('aprovar_para_assinatura', { p_vistoria: V.id });
  if (error) throw new Error(error.message);
}
export async function listarPedidos() {
  const { data, error } = await cliente().from('pedidos_vistoria').select('*').eq('estado', 'novo').order('agendada_para', { ascending: true, nullsFirst: false });
  if (error) throw error;
  N.pedidos = data;
  return data;
}
export async function marcarPedido(id, vistoriaId) {
  const { error } = await cliente().from('pedidos_vistoria').update({ estado: 'criada', vistoria_id: vistoriaId }).eq('id', id);
  if (error) throw error;
}
export async function salvarPush(sub) {
  const { error } = await cliente().from('push_subs').upsert({ user_id: N.user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }, { onConflict: 'endpoint' });
  if (error) throw error;
}
export async function apagarPush(endpoint) {
  const { error } = await cliente().from('push_subs').delete().eq('endpoint', endpoint);
  if (error) throw error;
}
export async function painel() {
  const { data, error } = await cliente().from('painel_vistorias').select('id,etapa,laudo_estado,laudo_url,publica_url,contestacoes_abertas,contestar_ate');
  if (error) throw error;
  return new Map(data.map((r) => [r.id, r]));
}

export async function painelLista() {
  const { data, error } = await cliente().from('painel_vistorias')
    .select('id,codigo,endereco,tipo_vistoria,etapa,laudo_url,publica_url,contestacoes_abertas,contestar_ate,fila_detalhe,fila_atualizado_em,fila_estado,fim_em,inicio_em,vistoria_atualizado_em,criado_em');
  if (error) throw error;
  return data;
}

/* ---- contestação do locatário ---- */
export async function linkContestacao(V) {
  const { data, error } = await cliente().from('contestacao_links').select('*').eq('vistoria_id', V.id).order('criado_em', { ascending: false }).limit(1);
  if (error) throw error;
  return data[0] || null;
}
export async function gerarLinkContestacao(V) {
  await empurrar();                                // o laudo precisa estar atualizado na nuvem
  const { data, error } = await cliente().rpc('gerar_link_contestacao', { p_vistoria: V.id });
  if (error) throw new Error(error.message);
  return data[0];
}
export async function revogarLinkContestacao(id) {
  const { error } = await cliente().from('contestacao_links').update({ revogado: true }).eq('id', id);
  if (error) throw error;
}
// guarda uma cópia em V.contestacoes para sair no vistoria.json
export async function listarContestacoes(V) {
  const { data, error } = await cliente().from('contestacoes').select('*').eq('vistoria_id', V.id).order('criado_em');
  if (error) throw error;
  V.contestacoes = data.map((c) => ({ id: c.id, ambiente: c.ambiente_nome, itemId: c.item_id, item: c.item_nome, motivo: c.motivo, nome: c.nome, email: c.email,
    fotos: c.fotos, criadaEm: c.criado_em, status: c.status, resposta: c.resposta, respondidaEm: c.respondido_em }));
  await DB.putV(V);
  return data;
}
export async function responderContestacao(id, status, resposta) {
  const { error } = await cliente().from('contestacoes').update({ status, resposta: resposta || null, respondido_por: N.user.id, respondido_em: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
export async function urlsContestacao(caminhos) {
  const m = new Map();
  if (!caminhos.length) return m;
  const { data } = await cliente().storage.from('midias').createSignedUrls(caminhos, 3600);
  for (const s of data || []) if (s.signedUrl && s.path) m.set(s.path, s.signedUrl);
  return m;
}

export async function membrosDe(V, donos) {
  const u = [...new Set(donos.filter((x) => x && x !== N.user.id))];
  if (!u.length) return;
  const { error } = await cliente().from('vistoria_membros').upsert(u.map((x) => ({ vistoria_id: V.id, user_id: x })), { onConflict: 'vistoria_id,user_id' });
  if (error) throw error;
}
