// Assistente de pré-cadastro: dados → tipo de imóvel → perguntas (quartos, suítes...) → revisão dos ambientes → cria a vistoria.
// Na saída, a estrutura vem da vistoria de entrada e o assistente pula direto para a criação.
import * as DB from './db.js';
import { TIPOS, variaveisPadrao, ambientesDoTipo, montarAmbiente, catalogo, uid } from './templates.js';
import { S, esc, hoje, p3, cfg, salvarCfg, toast, geo, startGeo, abreOverlay, fechaOverlay } from './core.js';
import * as Nuvem from './nuvem.js';

let W = null;
let baseFile = null;

export const codigoPadrao = (tipo) => `LIQ-VIST-${tipo === 'Saída' ? 'SAI' : 'ENT'}-${hoje()}`;

export async function iniciar(pedidoId) {
  const entradas = (await DB.allV()).filter((x) => x.tipoVistoria === 'Entrada').sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  baseFile = null;
  const nuvem = Nuvem.logado() && Nuvem.podeCriar();
  if (nuvem && navigator.onLine) { try { await Nuvem.carregarEquipe(); } catch { /* usa o que já houver */ } }
  W = {
    passo: 1, entradas, tipoKey: null, vars: {}, ambientes: [], nuvem, eqSel: [], pedido: null,
    d: { tipoVistoria: 'Entrada', codigo: codigoPadrao('Entrada'), finalidade: 'Locação', endereco: '', codImovel: '', metragem: '', solicitante: '', vistoriador: cfg.vistoriador || '', baseSel: '' },
  };
  // pedido de vistoria (criado pelo Claude, corretor ou administrador): tudo já vem preenchido, só falta revisar e criar
  if (pedidoId) {
    let p = (Nuvem.N.pedidos || []).find((x) => x.id === pedidoId);
    if (!p && navigator.onLine) p = (await Nuvem.listarPedidos().catch(() => [])).find((x) => x.id === pedidoId);
    if (p) {
      const dd = p.dados || {}, tipo = dd.tipoVistoria === 'Saída' ? 'Saída' : 'Entrada';
      W.pedido = p;
      W.nuvem = Nuvem.logado();
      Object.assign(W.d, {
        tipoVistoria: tipo, codigo: dd.codigo || codigoPadrao(tipo), finalidade: dd.finalidade || W.d.finalidade, endereco: dd.endereco || '', codImovel: dd.codImovel || '',
        metragem: dd.metragem || '', solicitante: dd.solicitante || '', vistoriador: dd.vistoriador || Nuvem.N.perfil?.nome || W.d.vistoriador,
      });
      W.tipoKey = TIPOS[dd.tipoKey] ? dd.tipoKey : 'outro';
      W.vars = { ...variaveisPadrao(W.tipoKey), ...(dd.vars || {}) };
      W.ambientes = ambientesDoTipo(W.tipoKey, W.vars);
      const quem = p.atribuido_a || Nuvem.N.user?.id;
      if (W.nuvem && quem) W.ambientes.forEach((a) => { a.dono = quem; });
      W.passo = 4;
    }
  }
}
export const ativo = () => !!W;

/* ---------- base de entrada (vistoria de saída) ---------- */
async function normalizarLocal(id) {
  const v0 = await DB.getV(id), fs = await DB.fotosDe(id);
  return {
    codigo: v0.codigo, endereco: v0.endereco, tipoImovel: v0.tipoImovel, tipoImovelKey: v0.tipoImovelKey, metragem: v0.metragem, variaveis: v0.variaveis,
    ambientes: v0.ambientes.map((a) => ({ nome: a.nome, modelo: a.modelo, itens: a.itens.map((i) => ({ ...i, nFotos: fs.filter((f) => f.itemId === i.id).length })) })),
  };
}
function normalizarJSON(j) {
  if (j.formato !== 'vistoria-liquilar/2') throw new Error('Arquivo não é um vistoria.json do app (formato 2).');
  return {
    codigo: j.codigo, endereco: j.endereco, tipoImovel: j.tipoImovel, metragem: j.metragemM2,
    ambientes: j.ambientes.map((a) => ({ nome: a.nome, modelo: a.modelo, itens: a.itens.map((i) => ({
      id: i.id, paiId: i.paiId, nome: i.nome, cat: i.cat, q: i.q, t: i.t, p: i.p, g: i.g, m: i.m, na: i.naoExiste, qtd: i.quantidade, cond: i.condicao,
      verif: i.verificacao, obs: i.observacao, ident: i.identificacao, leitura: i.leitura, sit: i.situacao, nFotos: (i.fotos || []).length })) })),
  };
}
/* ---------- importação da entrada: vistoria.json, ZIP exportado pelo app ou itens_e_condicoes.csv ---------- */
async function jsonDoZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('ZIP inválido.');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    if (!/(^|[\\/])vistoria\.json$/.test(nome)) continue;
    const ini = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    let bytes = buf.subarray(ini, ini + csize);
    if (metodo === 8) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    else if (metodo !== 0) throw new Error('Compressão do ZIP não suportada.');
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  throw new Error('O ZIP não contém o vistoria.json.');
}

function parseCsv(txt) {
  const linhas = [];
  let cur = [], campo = '', asp = false;
  txt = txt.replace(/^﻿/, '');
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (asp) { if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else asp = false; } else campo += c; }
    else if (c === '"') asp = true;
    else if (c === ',') { cur.push(campo); campo = ''; }
    else if (c === '\n') { cur.push(campo.replace(/\r$/, '')); linhas.push(cur); cur = []; campo = ''; }
    else campo += c;
  }
  if (campo || cur.length) { cur.push(campo); linhas.push(cur); }
  return linhas;
}
const COND_CSV = { 'PINTURA NOVA': 'PINTURA_NOVA', BOM: 'BOM', REGULAR: 'REGULAR', AVARIA: 'AVARIA', 'NÃO ACESSÍVEL': 'NAO_ACESSIVEL' };
const VERIF_CSV = { TESTADO: 'TESTADO', 'PARCIALMENTE TESTADO': 'PARCIAL', 'OBSERVADO EM USO': 'OBSERVADO', 'NÃO TESTADO': 'NAO_TESTADO' };
function baseDoCsv(txt, nomeArq) {
  const [cab, ...rows] = parseCsv(txt).filter((r) => r.length > 3);
  if (!cab || cab[3] !== 'elemento') throw new Error('CSV não reconhecido (esperado itens_e_condicoes.csv do app).');
  const amb = new Map(), paiPorNum = new Map();
  for (const r of rows) {
    const [aCod, aNome, num, elem, qtd, cond, verif, desc, fotos] = r;
    if (!amb.has(aCod)) amb.set(aCod, { nome: aNome, modelo: null, itens: [] });
    const sub = num.includes('.'), pai = sub ? paiPorNum.get(num.split('.')[0] + '@' + aCod) : null;
    const id = uid();
    if (!sub) paiPorNum.set(num + '@' + aCod, id);
    const na = cond === 'NÃO EXISTE';
    amb.get(aCod).itens.push({
      id, paiId: pai || undefined, nome: sub ? elem.replace(/^.*? - /, '') : elem, cat: 'item', q: qtd !== '', t: verif !== '', p: cond === 'PINTURA NOVA',
      g: !na && cond === '' && verif === '' && qtd === '', m: /^(Identificação|Leitura|Situação):/.test(desc), na,
      qtd: qtd === '' ? null : Number(qtd), cond: COND_CSV[cond] || null, verif: VERIF_CSV[verif] || null, obs: desc, nFotos: fotos ? fotos.split(' ').length : 0 });
  }
  return { codigo: nomeArq.replace(/\.csv$/i, ''), endereco: '', tipoImovel: '', ambientes: [...amb.values()] };
}

async function lerBase(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith('.json')) return normalizarJSON(JSON.parse(await file.text()));
  if (n.endsWith('.zip')) return normalizarJSON(await jsonDoZip(file));
  if (n.endsWith('.csv')) return baseDoCsv(await file.text(), file.name);
  throw new Error('Formato não suportado. Use o vistoria.json (ou o ZIP) gerado pelo app. Para laudos em PDF/Word, peça ao Claude para convertê-los em vistoria.json.');
}

function ambientesDeBase(base) {
  return base.ambientes.map((a) => {
    const vivos = a.itens.filter((i) => !i.na && !(i.paiId && a.itens.find((x) => x.id === i.paiId)?.na));
    const idMap = new Map();
    const itens = vivos.map((i) => {
      const nid = uid();
      idMap.set(i.id, nid);
      return { id: nid, refId: i.id, nome: i.nome, cat: i.cat || 'item', q: !!i.q, t: !!i.t, p: !!i.p, g: !!i.g, m: !!i.m, ...(i.un ? { un: i.un } : {}),
        ref: { cond: i.cond || null, qtd: i.q ? (i.qtd ?? null) : null, verif: i.verif || null, obs: i.obs || '', ident: i.ident || '', leitura: i.leitura || '', sit: i.sit || '', nFotos: i.nFotos || 0 } };
    });
    itens.forEach((ni, k) => { const pid = vivos[k].paiId; if (pid && idMap.has(pid)) ni.paiId = idMap.get(pid); });
    return { id: uid(), nome: a.nome, modelo: a.modelo, itens };
  });
}

/* ---------- criação ---------- */
async function criar(ambientes, base) {
  const d = W.d;
  startGeo();
  const v = {
    id: uid(), fmt: 2, codigo: d.codigo, tipoVistoria: d.tipoVistoria, finalidade: d.finalidade, endereco: d.endereco, codImovel: d.codImovel,
    metragem: d.metragem || base?.metragem || '', solicitante: d.solicitante, vistoriador: d.vistoriador,
    tipoImovelKey: base?.tipoImovelKey || W.tipoKey, tipoImovel: base?.tipoImovel || TIPOS[W.tipoKey]?.nome || '', variaveis: base?.variaveis || W.vars,
    baseEntrada: base ? { codigo: base.codigo, endereco: base.endereco } : null,
    criadoEm: Date.now(), atualizadoEm: Date.now(), inicioEm: null, fimEm: null, exportadoEm: null, nFotos: 0, geo: geo.last,
    condicoes: {}, geral: W.pedido?.dados?.locacao ? { locacao: W.pedido.dados.locacao } : {}, ambientes,
  };
  await DB.putV(v);
  const querNuvem = W.nuvem, ped = W.pedido;
  W = null;
  if (querNuvem) {
    try { await Nuvem.publicar(v); toast('Vistoria criada na nuvem', 3000); if (ped) Nuvem.marcarPedido(ped.id, v.id).catch(() => {}); }
    catch (e) { toast('Criada só neste aparelho (' + e.message + '). Envie à nuvem depois, no menu da vistoria.', 6000); }
  }
  location.hash = '#/v/' + v.id;
}

/* ---------- telas ---------- */
const cab = (titulo, voltar) => `<header class="top"><button class="ico" data-act="${voltar}">‹</button><h1>${esc(titulo)}</h1><span class="chip">Passo ${W.passo} de ${W.d.tipoVistoria === 'Saída' && W.d.baseSel ? 1 : 4}</span></header>`;

function passo1() {
  const d = W.d;
  return `${cab('Nova vistoria', 'wSair')}
    <main>
      <label>Tipo de vistoria
        <select data-w="tipoVistoria"><option ${d.tipoVistoria === 'Entrada' ? 'selected' : ''}>Entrada</option><option ${d.tipoVistoria === 'Saída' ? 'selected' : ''}>Saída</option></select></label>
      ${d.tipoVistoria === 'Saída' ? `<label>Partir de uma vistoria de entrada (compara item a item)
          <select data-w="baseSel"><option value="">Roteiro novo (sem comparação)</option>
            ${W.entradas.map((x) => `<option value="${x.id}" ${d.baseSel === x.id ? 'selected' : ''}>${esc(x.codigo)} — ${esc(x.endereco)}</option>`).join('')}
            <option value="__arquivo" ${d.baseSel === '__arquivo' ? 'selected' : ''}>Importar arquivo da entrada…</option></select></label>
        <p class="muted">${d.baseSel === '__arquivo' ? (baseFile ? `Arquivo: <b>${esc(baseFile.name)}</b>` : 'Aceita o <b>vistoria.json</b> ou o <b>ZIP</b> exportado pelo app (também o <b>itens_e_condicoes.csv</b>). Laudos antigos em PDF ou Word: peça ao Claude para convertê-los em vistoria.json.') : 'A saída seguirá exatamente os ambientes, itens e a ordem da entrada, mostrando a condição de cada item para comparar.'}</p>
        <input type="file" id="w-file" accept=".json,.zip,.csv,application/json,application/zip,text/csv" hidden>` : ''}
      <label>Código da vistoria<input data-w="codigo" value="${esc(d.codigo)}" autocapitalize="characters"></label>
      <label>Finalidade<input data-w="finalidade" list="dl-fin" value="${esc(d.finalidade)}"><datalist id="dl-fin"><option>Locação residencial</option><option>Locação comercial</option><option>Locação</option><option>Venda</option><option>Administração</option></datalist></label>
      <label>Endereço do imóvel<input data-w="endereco" value="${esc(d.endereco)}" placeholder="Rua, número, bairro, cidade - UF"></label>
      <label>Código do imóvel<input data-w="codImovel" value="${esc(d.codImovel)}"></label>
      <label>Metragem (m²)<input data-w="metragem" value="${esc(d.metragem)}" inputmode="decimal"></label>
      <label>Solicitante / contato<input data-w="solicitante" value="${esc(d.solicitante)}"></label>
      <label>Vistoriador<input data-w="vistoriador" value="${esc(d.vistoriador)}"></label>
      <button class="btn primary big" data-act="wContinuar">${d.tipoVistoria === 'Saída' && d.baseSel ? 'Criar vistoria de saída' : 'Continuar'}</button>
    </main>`;
}

function passo2() {
  return `${cab('Tipo de imóvel', 'wVoltar')}
    <main>
      <p class="muted">O app monta os ambientes e o roteiro do passeio de acordo com o tipo. Você ajusta tudo antes de começar.</p>
      <div class="tipos">${Object.entries(TIPOS).map(([k, t]) => `<button class="tipo" data-act="wTipo" data-k="${k}"><span>${t.icone}</span><b>${esc(t.nome)}</b><small>${esc(t.desc)}</small></button>`).join('')}</div>
    </main>`;
}

function passo3() {
  const t = TIPOS[W.tipoKey];
  const n = ambientesDoTipo(W.tipoKey, W.vars).length;
  return `${cab(t.nome, 'wVoltar')}
    <main>
      <p class="muted">Responda o que varia neste imóvel. Quantidades de itens (tomadas, interruptores…) são contadas na vistoria — aqui só definimos os ambientes.</p>
      ${t.vars.map((x) => x.t === 'n'
        ? `<div class="var"><span>${esc(x.rot)}</span><div class="qty"><button data-act="wNum" data-k="${x.k}" data-d="-1" aria-label="Menos">−</button><input readonly value="${W.vars[x.k]}"><button data-act="wNum" data-k="${x.k}" data-d="1" aria-label="Mais">＋</button></div></div>`
        : `<label class="chk var"><input type="checkbox" data-w="var:${x.k}" ${W.vars[x.k] ? 'checked' : ''}> ${esc(x.rot)}</label>`).join('')}
      <div class="card"><b>${n}</b> ambientes serão criados. Você poderá incluir, excluir e reordenar na próxima tela.</div>
      <button class="btn primary big" data-act="wRevisar">Ver ambientes ›</button>
    </main>`;
}

const nomeP = (p) => esc(p.nome || p.email || '—');
function equipeHTML() {
  if (!W.nuvem) return Nuvem.logado() ? '' : '<p class="muted">Dica: entre na sua conta (☁ no início) para criar a vistoria na nuvem e dividir os ambientes entre vistoriadores.</p>';
  const eq = Nuvem.N.equipe.filter((p) => p.ativo);
  return `<div class="card"><b>☁ Equipe e divisão</b>
    <label class="chk"><input type="checkbox" data-w="nuvem" checked> Salvar na nuvem (continuar em outro aparelho)</label>
    <small>Quem vai a campo nesta vistoria? Se marcar mais de uma pessoa, os ambientes são divididos em sequência.</small>
    ${eq.map((p) => `<label class="chk"><input type="checkbox" data-w="eq:${p.id}" ${W.eqSel.includes(p.id) ? 'checked' : ''}> ${nomeP(p)} <small>(${p.papel})</small></label>`).join('')}
    <button class="btn" data-act="wDividir" ${W.eqSel.length ? '' : 'disabled'}>Dividir ambientes entre os marcados</button></div>`;
}
const opcoesDono = (a) => `<option value="">Eu / sem divisão</option>${Nuvem.N.equipe.filter((p) => p.ativo).map((p) => `<option value="${p.id}" ${a.dono === p.id ? 'selected' : ''}>${nomeP(p)}</option>`).join('')}`;

function passo4() {
  const a = W.ambientes;
  return `${cab('Revise os ambientes', 'wVoltar')}
    <main>
      ${equipeHTML()}
      <p class="muted">Esta é a ordem do passeio. Reordene, remova ou acrescente o que for preciso.</p>
      ${a.map((x, i) => `<div class="amb" data-i="${i}">
        <div class="ambmain static"><span class="cod">A${p3(i + 1)}</span><span class="nm"><b>${esc(x.nome)}</b><small>${x.itens.filter((y) => !y.paiId).length} itens no roteiro</small>${W.nuvem ? `<select data-w="dono:${i}">${opcoesDono(x)}</select>` : ''}</span></div>
        <span class="mv"><button data-act="wAmbUp" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button><button data-act="wAmbDown" ${i === a.length - 1 ? 'disabled' : ''} aria-label="Descer">▼</button></span>
        <button class="mv-b bad" data-act="wAmbDel" aria-label="Remover">✕</button></div>`).join('')}
      <button class="btn" data-act="wAmbAdd">＋ Adicionar ambiente</button>
      <button class="btn primary big" data-act="wCriar" ${a.length ? '' : 'disabled'}>Criar vistoria com ${a.length} ambientes</button>
    </main>`;
}

export function html() {
  return [null, passo1, passo2, passo3, passo4][W.passo]();
}

/* ---------- ações ---------- */
export const ACTS = {
  wSair() { W = null; location.hash = '#/'; return 'sair'; },
  wVoltar() { W.passo = W.passo === 4 ? 3 : W.passo - 1; if (W.passo === 1) W.ambientes = []; },
  async wContinuar() {
    const d = W.d;
    if (!d.endereco.trim()) return toast('Informe o endereço do imóvel');
    cfg.vistoriador = d.vistoriador; salvarCfg();
    if (d.tipoVistoria === 'Saída' && d.baseSel) {
      let base;
      try {
        if (d.baseSel === '__arquivo') {
          if (!baseFile) throw new Error('Escolha o arquivo da vistoria de entrada.');
          base = await lerBase(baseFile);
        } else base = await normalizarLocal(d.baseSel);
      } catch (e) { return toast(e.message, 4000); }
      await criar(ambientesDeBase(base), base);
      return 'sair';
    }
    W.passo = 2;
  },
  wTipo(el) { W.tipoKey = el.dataset.k; W.vars = variaveisPadrao(W.tipoKey); W.passo = 3; },
  wNum(el) { const x = TIPOS[W.tipoKey].vars.find((v) => v.k === el.dataset.k); W.vars[x.k] = Math.max(0, Math.min(x.max, W.vars[x.k] + Number(el.dataset.d))); },
  wRevisar() { W.ambientes = ambientesDoTipo(W.tipoKey, W.vars); W.passo = 4; },
  wAmbUp(el) { const i = Number(el.closest('[data-i]').dataset.i); [W.ambientes[i - 1], W.ambientes[i]] = [W.ambientes[i], W.ambientes[i - 1]]; },
  wAmbDown(el) { const i = Number(el.closest('[data-i]').dataset.i); [W.ambientes[i + 1], W.ambientes[i]] = [W.ambientes[i], W.ambientes[i + 1]]; },
  wAmbDel(el) { const i = Number(el.closest('[data-i]').dataset.i); if (confirm(`Remover "${W.ambientes[i].nome}"?`)) W.ambientes.splice(i, 1); },
  wAmbAdd() {
    abreOverlay(`<div class="sheet"><h2>Adicionar ambiente</h2>
      ${Object.entries(catalogo()).map(([k, c]) => `<button class="btn" data-act="wAmbAddOk" data-k="${k}">${esc(c.nome)}</button>`).join('')}
      <button class="btn primary" data-act="fechar">Cancelar</button></div>`);
  },
  wAmbAddOk(el) {
    const nome = prompt('Nome do ambiente:', '');
    if (nome === null) return;
    const a = montarAmbiente(el.dataset.k, W.ambientes.map((x) => x.nome), { mobiliado: !!W.vars.mobiliado });
    if (nome.trim()) a.nome = nome.trim();
    // medidores sempre por último
    const m = W.ambientes.findIndex((x) => x.modelo === 'medidores');
    if (m >= 0 && a.modelo !== 'medidores') W.ambientes.splice(m, 0, a); else W.ambientes.push(a);
    fechaOverlay();
  },
  wDividir() {
    if (!W.eqSel.length) return toast('Marque pelo menos uma pessoa');
    Nuvem.dividirAmbientes(W.ambientes, W.eqSel, Nuvem.N.user.id);
  },
  async wCriar() { await criar(W.ambientes, null); return 'sair'; },
};

export function onChange(el) {
  const k = el.dataset.w;
  if (!k) return false;
  if (k.startsWith('var:')) { W.vars[k.slice(4)] = el.checked; S.redraw(); return true; }
  if (k === 'nuvem') { W.nuvem = el.checked; S.redraw(); return true; }
  if (k.startsWith('eq:')) { const id = k.slice(3); W.eqSel = el.checked ? [...new Set([...W.eqSel, id])] : W.eqSel.filter((x) => x !== id); S.redraw(); return true; }
  if (k.startsWith('dono:')) { W.ambientes[Number(k.slice(5))].dono = el.value || null; return true; }
  W.d[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
  if (k === 'tipoVistoria') {
    if (/^LIQ-VIST-(ENT|SAI)-\d{8}$/.test(W.d.codigo)) W.d.codigo = codigoPadrao(el.value);
    W.d.baseSel = '';
    S.redraw();
  }
  if (k === 'baseSel') {
    S.redraw();
    if (el.value === '__arquivo') setTimeout(() => {
      const f = document.getElementById('w-file');
      f.onchange = () => { baseFile = f.files[0] || null; if (baseFile) { toast('Arquivo: ' + baseFile.name); S.redraw(); } };
      f.click();
    }, 50);
  }
  return true;
}
