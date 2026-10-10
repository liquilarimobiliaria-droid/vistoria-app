import * as DB from './db.js';
import { catalogo, montarAmbiente, uid, CONDICOES, VERIFICACOES, CATS, specDeAmbiente, salvarModelo } from './templates.js';
import {
  $app, $ov, S, esc, p3, hoje, fmtData, fmtMB, fmtDur, labelCond, labelVerif, RANK_COND, cfg, salvarCfg, toast,
  salvarV, achaAmb, achaItem, midiaDoItem, nMidiaAmb, thumbURL, limparURLs, lista, itemFeito, faltaVerif,
  geo, startGeo, chipGeo, escolher, addMidia, apagarMidia, girarFoto, abreOverlay, fechaOverlay, souDono, podeEditar, gere,
} from './core.js';
import * as Nuvem from './nuvem.js';
import * as Voice from './voice.js';
import { gerarZip, plano } from './export.js';
import { relatorioHTML } from './report.js';
import * as Mod from './modelos.js';
import * as Wiz from './wizard.js';
import * as Passeio from './passeio.js';
import * as Cont from './contestar.js';
import * as Fluxo from './fluxo.js';
import * as Push from './push.js';

const VERSAO = '3.6';
S.versao = VERSAO;

/* ---------- roteador ---------- */
window.addEventListener('hashchange', route);

async function carregar(id) {
  if (S.V && S.V.id === id) return;
  limparURLs();
  S.lastZip = null;
  S.V = (await DB.getV(id)) || null;
  S.FOTOS = S.V ? await DB.fotosDe(id) : [];
}

async function route() {
  stopVoice();
  fechaOverlay();
  const h = location.hash.replace(/^#\/?/, '').split('/');
  if (!(h[0] === 'v' && h[2] === 'passeio')) Passeio.fechar(true);
  if (h[0] !== 'v') Nuvem.desassinar();
  if (h[0] !== 'painel') Fluxo.pararPainel();
  try {
    if (h[0] === 'painel') {
      if (!Nuvem.logado()) { location.hash = '#/conta'; return; }
      render('<header class="top"><button class="ico" data-act="go" data-go="#/">‹</button><h1>Acompanhamento</h1></header><main><p class="muted">Carregando…</p></main>', null);
      await Fluxo.carregarPainel();
      const pn = () => render(Fluxo.htmlPainel(), pn);
      Fluxo.iniciarPainel(() => { if (location.hash.startsWith('#/painel')) pn(); });
      return pn();
    }
    if (h[0] === 'contestar' && h[1]) return await Cont.publico(h[1]);
    if (h[0] === 'conta') return viewConta();
    if (h[0] === 'equipe') return await viewEquipe();
    if (h[0] === 'nova') {
      await Wiz.iniciar(h[1]);
      const w = () => render(Wiz.html(), w);
      return w();
    }
    if (h[0] === 'cfg') return viewCfg();
    if (h[0] === 'modelos') {
      if (h[1]) {
        if (!Mod.abrirEditor(h[1])) { location.hash = '#/modelos'; return; }
        const ed = () => render(Mod.htmlEditor(), ed);
        return ed();
      }
      const lst = () => render(Mod.htmlLista(), lst);
      return lst();
    }
    if (h[0] === 'v' && h[1]) {
      await carregar(h[1]);
      if (!S.V) { location.hash = '#/'; return; }
      startGeo();
      if (S.V.nuvem && Nuvem.logado()) { Nuvem.assinar(S.V); Nuvem.puxar(S.V).catch(() => {}).then(() => Nuvem.agendarPush(800)); }
      if (h[2] === 'equipe') return viewEquipeVistoria();
      if (h[2] === 'abertura') { const ab = () => render(Fluxo.htmlAbertura(S.V, h[3] === 'passeio'), ab); return ab(); }
      if (h[2] === 'revisao') { const rv = () => render(Fluxo.htmlRevisao(S.V), rv); return rv(); }
      if (h[2] === 'validacao') {
        if (!S.V.nuvem || !Nuvem.logado()) { location.hash = '#/v/' + S.V.id; return; }
        render('<main><p class="muted">Carregando…</p></main>', null);
        await Fluxo.carregarValidacao(S.V);
        const vl = () => render(Fluxo.htmlValidacao(S.V), vl);
        return vl();
      }
      if (h[2] === 'contestacoes') {
        if (!S.V.nuvem || !Nuvem.logado() || !gere()) { location.hash = '#/v/' + S.V.id; return; }
        render('<main><p class="muted">Carregando…</p></main>', null);
        await Cont.carregar(S.V);
        const c = () => render(Cont.htmlGestor(S.V), c);
        return c();
      }
      if (h[2] === 'passeio') {
        if (!Fluxo.aberturaFeita(S.V)) {
          if (gere()) { location.hash = '#/v/' + S.V.id + '/abertura/passeio'; return; }
          toast('A ficha de abertura (água, energia, chaves) ainda não foi preenchida. Peça a quem criou a vistoria.', 5000);
        }
        if (!S.V.ambientes.some(souDono)) { toast('Nenhum ambiente seu nesta vistoria.', 3500); location.hash = '#/v/' + S.V.id; return; } if (!S.V.inicioEm) { S.V.inicioEm = Date.now(); S.V.geo = geo.last || S.V.geo; await salvarV(); } viewVistoria(); return Passeio.abrir(); }
      if (h[2] === 'editar') return viewForm(S.V);
      if (h[2] === 'geral') return viewGeral();
      if (h[2] === 'relatorio') return await viewRelatorio();
      if (h[2] === 'a' && h[3] && achaAmb(h[3])) return viewAmb(h[3]);
      return viewVistoria();
    }
    return await viewHome();
  } catch (e) {
    console.error(e);
    $app.innerHTML = `<main><div class="card">Erro: ${esc(e.message)}</div></main>`;
  }
}

function render(html, fn) {
  const y = window.scrollY;
  $app.innerHTML = html;
  S.redraw = fn;
  window.scrollTo(0, y);
  chipGeo();
}

const statusV = (v) => (v.fimEm ? ['Finalizada', 'okc'] : v.inicioEm ? ['Em andamento', 'warn'] : ['Não iniciada', 'muted']);

/* ---------- telas: início e formulário ---------- */
async function viewHome() {
  S.V = null; S.FOTOS = []; limparURLs();
  const todas = (await DB.allV()).sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  render(`
    <header class="top"><img class="logo" src="img/logo-horizontal.png" alt="LiquiLar"><span class="sp"></span><button id="syncchip" class="chip" data-act="go" data-go="#/conta"></button><button class="ico" data-act="go" data-go="#/cfg" aria-label="Configurações">⚙</button></header>
    <main>
      <div><div class="hero">Vistorias <em>em campo</em></div><p class="hero-sub">Seu patrimônio, nosso compromisso.</p></div>
      ${Nuvem.logado() && !Nuvem.podeCriar() ? '' : '<button class="btn primary big" data-act="go" data-go="#/nova">＋ Nova vistoria</button>'}
      <div id="pedidos"></div>
      ${Nuvem.logado() ? '<button class="btn big" data-act="go" data-go="#/painel">📊 Acompanhamento dos laudos</button>' : ''}
      <div id="nuvemlista"></div>
      ${todas.length ? '<h2>Neste aparelho</h2>' : ''}
      ${todas.map((v) => {
        const [st, cls] = statusV(v);
        const exp = !v.exportadoEm ? '<small class="warn">⚠ ainda não exportada</small>' : v.atualizadoEm > v.exportadoEm + 1000 ? '<small class="warn">⚠ alterada após a última exportação</small>' : '<small class="okc">✔ exportada</small>';
        return `<button class="card vcard" data-act="go" data-go="#/v/${v.id}">
          <b>${v.nuvem ? '☁ ' : ''}${esc(v.codigo)}</b><span>${esc(v.endereco)}</span>
          <small>${esc(v.tipoVistoria)} · ${esc(v.tipoImovel)} · ${v.nFotos || 0} fotos · ${fmtData(v.atualizadoEm)}</small>
          <small class="${cls}">${st}</small>${exp}</button>`;
      }).join('')}
      ${todas.length || Nuvem.logado() ? '' : '<p class="muted">Nenhuma vistoria ainda. Toque em “Nova vistoria” para começar, ou entre na sua conta (☁) para ver as vistorias da equipe.</p>'}
    </main>`, viewHome);
  Nuvem.chip();
  carregarListaNuvem(todas);
  Fluxo.carregarPedidos();
}

// cartão do Drive (só para quem gerencia a vistoria)
function driveHTML() {
  const V = S.V, laudo = Fluxo.laudoCard(V);
  if (!gere()) return laudo;
  const nd = Nuvem.noDrive(S.FOTOS).length;
  return `${laudo}<div class="card"><b>📁 Google Drive</b>
    <p class="muted">Depois de finalizar, as fotos e vídeos vão para a pasta <i>Vistorias LiquiLar › ${esc(V.codigo)}</i>, organizados por ambiente com os nomes A###-F###. Em seguida saem do armazenamento da nuvem (ficam só as miniaturas).</p>
    ${nd ? `<p class="okc">✔ ${nd} mídia(s) já estão no Drive${V.driveEm ? ' (' + fmtData(V.driveEm) + ')' : ''}.</p>` : ''}
    <div class="tools"><button class="btn primary" data-act="enviarDrive">📁 Enviar ao Drive</button>${V.driveUrl ? `<a class="btn" href="${esc(V.driveUrl)}" target="_blank" rel="noopener">Abrir pasta</a>` : ''}<button class="btn" data-act="testarDrive">Testar conexão</button></div></div>`;
}

// cartão do hub: estado das fotos na nuvem
function fotosNuvemHTML() {
  const mini = Nuvem.soMiniaturas(S.FOTOS).length, pend = Nuvem.N.fotosPend || 0;
  Nuvem.contarPendentes(S.V).then(() => Nuvem.chip()).catch(() => {});
  return `<h2>Fotos na nuvem</h2><div class="card">
    <p>${pend ? `<span class="warn">${pend} foto(s) deste aparelho ainda não foram enviadas.</span>` : '<span class="okc">✔ Todas as fotos deste aparelho estão na nuvem.</span>'}</p>
    ${mini ? `<p class="muted">${mini} foto(s) de outros aparelhos estão só em miniatura aqui. Baixe os originais para gerar o ZIP.</p>` : ''}
    <div class="tools"><button class="btn" data-act="enviarFotos">⟳ Enviar fotos agora</button>${mini ? `<button class="btn primary" data-act="baixarOrig">⬇ Baixar originais (${mini})</button>` : ''}</div></div>${driveHTML()}`;
}

// vistorias da equipe na nuvem (aparece quando há login e conexão)
async function carregarListaNuvem(locais) {
  const box = document.getElementById('nuvemlista');
  if (!box || !Nuvem.logado() || !navigator.onLine) return;
  box.innerHTML = '<p class="muted">Buscando vistorias na nuvem…</p>';
  try {
    const [rows, pn] = await Promise.all([Nuvem.listarNuvem(), Nuvem.painel().catch(() => new Map())]);
    if (!document.getElementById('nuvemlista')) return;
    const eu = S.euId;
    box.innerHTML = rows.length ? `<h2>Na nuvem</h2>` + rows.map((r) => {
      const meus = r.ambientes.filter((a) => a.dono === eu), feitos = meus.filter((a) => a.concluido).length;
      const baixada = locais.some((l) => l.id === r.id);
      return `<button class="card vcard" data-act="abrirNuvem" data-id="${r.id}">
        <b>☁ ${esc(r.codigo)}</b><span>${esc(r.endereco)}</span>
        <small>${esc(r.tipo_vistoria)} · ${esc(r.tipo_imovel || '')} · ${r.ambientes.length} ambientes${meus.length ? ` · seus: ${feitos}/${meus.length} concluídos` : ''}</small>
        ${pn.get(r.id) ? Fluxo.etapaHTML(pn.get(r.id)) : `<small class="${r.status === 'finalizada' ? 'okc' : 'warn'}">${r.status === 'finalizada' ? 'Finalizada' : r.status === 'em_andamento' ? 'Em andamento' : 'Não iniciada'}</small>`}
        <small class="muted">${baixada ? 'já está neste aparelho' : 'toque para baixar e abrir'}</small></button>`;
    }).join('') : '<h2>Na nuvem</h2><p class="muted">Nenhuma vistoria na nuvem para você ainda.</p>';
  } catch (e) { box.innerHTML = `<p class="warn">Não consegui ler a nuvem: ${esc(e.message)}</p>`; }
}

const codigoPadrao = Wiz.codigoPadrao;

// edição dos dados de uma vistoria existente (a criação é feita pelo assistente em wizard.js)
function viewForm(v) {
  const d = v;
  render(`
    <header class="top"><button class="ico" data-act="go" data-go="#/v/${v.id}">‹</button><h1>Dados da vistoria</h1></header>
    <main>
      <label>Tipo de vistoria<input value="${esc(d.tipoVistoria)}" disabled></label>
      <label>Código da vistoria<input id="f-codigo" value="${esc(d.codigo)}" autocapitalize="characters"></label>
      <label>Finalidade<input id="f-fin" list="dl-fin" value="${esc(d.finalidade || '')}"><datalist id="dl-fin"><option>Locação residencial</option><option>Locação comercial</option><option>Locação</option><option>Venda</option><option>Administração</option></datalist></label>
      <label>Endereço do imóvel<input id="f-end" value="${esc(d.endereco)}" placeholder="Rua, número, bairro, cidade - UF"></label>
      <label>Código do imóvel<input id="f-cod" value="${esc(d.codImovel || '')}"></label>
      <label>Metragem (m²)<input id="f-m2" value="${esc(d.metragem || '')}" inputmode="decimal"></label>
      <label>Solicitante / contato<input id="f-sol" value="${esc(d.solicitante || '')}"></label>
      <label>Vistoriador<input id="f-vist" value="${esc(d.vistoriador || '')}"></label>
      <button class="btn primary big" data-act="salvarForm">Salvar</button>
    </main>`, () => viewForm(v));
}

/* ---------- hub da vistoria ---------- */
function pendencias() {
  let n = 0;
  S.V.ambientes.forEach((a) => a.itens.forEach((i) => { if (!itemFeito(i) || faltaVerif(i) || (i.nomePend && !i.na)) n++; }));
  return n;
}

function viewVistoria() {
  S.curAmbId = null;
  const V = S.V;
  const dirty = !V.exportadoEm || V.atualizadoEm > V.exportadoEm + 1000;
  const [st] = statusV(V);
  const pend = pendencias();
  render(`
    <header class="top"><button class="ico" data-act="go" data-go="#/">‹</button><h1>${esc(V.codigo)}</h1><span id="syncchip" class="chip" data-act="go" data-go="#/conta"></span><span id="geochip" class="chip"></span></header>
    <main>
      <div class="card info">
        <div>${esc(V.endereco)}</div>
        <small>${esc(V.tipoVistoria)} · ${esc(V.tipoImovel)}${V.metragem ? ' · ' + esc(V.metragem) + ' m²' : ''}${V.finalidade ? ' · ' + esc(V.finalidade) : ''}</small>
        ${V.baseEntrada ? `<small>Comparando com a entrada <b>${esc(V.baseEntrada.codigo)}</b></small>` : ''}
        <small>${st}${V.inicioEm ? ' · iniciada ' + fmtData(V.inicioEm) : ''}${V.fimEm ? ' · duração ' + fmtDur(V.fimEm - V.inicioEm) : ''}</small>
        <button class="lnk" data-act="go" data-go="#/v/${V.id}/editar">Editar dados</button>
      </div>
      ${!V.fimEm && V.ambientes.some(souDono) ? `<button class="btn primary big" data-act="go" data-go="#/v/${V.id}/passeio">${V.inicioEm ? '▶ Continuar passeio guiado' : '▶ Iniciar vistoria — passeio guiado'}</button>` : ''}
      ${V.nuvem && !V.ambientes.some(souDono) ? '<div class="aviso-l">Nenhum ambiente desta vistoria foi atribuído a você. Peça a quem criou a vistoria para dividir os ambientes.</div>' : ''}
      <div class="tiles">
        <button class="tile ${Fluxo.aberturaFeita(V) ? '' : 'pend'}" data-act="go" data-go="#/v/${V.id}/abertura"><span>📝</span>Ficha de abertura<small>${Fluxo.aberturaFeita(V) ? 'água, energia, chaves ✔' : 'preencha antes de começar'}</small></button>
        <button class="tile" data-act="go" data-go="#/v/${V.id}/geral"><span>🗂</span>Dados gerais<small>condições, chaves, observações</small></button>
        ${V.inicioEm ? `<button class="tile" data-act="go" data-go="#/v/${V.id}/revisao"><span>✅</span>Revisão final<small>pendências antes de finalizar</small></button>` : ''}
        <button class="tile" data-act="go" data-go="#/v/${V.id}/relatorio"><span>📄</span>Relatório<small>backup em PDF</small></button>
        ${V.nuvem ? `<button class="tile" data-act="go" data-go="#/v/${V.id}/equipe"><span>👥</span>Equipe e divisão<small>quem faz cada ambiente</small></button>` : ''}
        ${V.nuvem && V.fimEm && Nuvem.logado() && gere() ? `<button class="tile" data-act="go" data-go="#/v/${V.id}/contestacoes"><span>⚖</span>Contestações<small>link do locatário e respostas</small></button>` : ''}
        ${!V.nuvem && Nuvem.logado() && Nuvem.podeCriar() ? '<button class="tile" data-act="publicarNuvem"><span>☁</span>Enviar à nuvem<small>continuar em outro aparelho</small></button>' : ''}
      </div>
      <h2>Caminhamento</h2>
      ${V.ambientes.map((a, i) => {
        const itens = a.itens.filter((x) => !x.na), feitos = itens.filter((x) => itemFeito(x) && !faltaVerif(x)).length, nf = nMidiaAmb(a.id);
        const pct = itens.length ? Math.round((feitos / itens.length) * 100) : 0;
        const dono = V.nuvem && a.dono ? `<small class="dono ${a.dono === S.euId ? 'eu' : ''}">👤 ${a.dono === S.euId ? 'você' : esc(Nuvem.nomeDe(a.dono))}${a.concluido ? ' · ✔ concluído' : ''}</small>` : '';
        return `<div class="amb" data-amb="${a.id}">
          <button class="ambmain" data-act="go" data-go="#/v/${V.id}/a/${a.id}">
            <span class="cod">A${p3(i + 1)}</span><span class="nm"><b>${esc(a.nome)}</b>${dono}<small>${feitos}/${itens.length} itens${nf ? ` · ${nf} mídias` : ''}</small><i class="bar"><u style="width:${pct}%"></u></i></span>
          </button>
          ${gere() ? `<span class="mv"><button data-act="ambMove" data-d="-1" ${i === 0 ? 'disabled' : ''} aria-label="Subir">▲</button><button data-act="ambMove" data-d="1" ${i === V.ambientes.length - 1 ? 'disabled' : ''} aria-label="Descer">▼</button></span>` : ''}
        </div>`;
      }).join('')}
      ${gere() ? '<button class="btn" data-act="addAmb">＋ Adicionar ambiente</button>' : ''}
      ${V.inicioEm && !V.fimEm && gere() ? `<button class="btn dark big" data-act="finalizar">Revisar e finalizar${pend ? ` (${pend} pendências)` : ''}</button>` : ''}
      ${V.fimEm && gere() ? '<button class="btn" data-act="reabrir">Reabrir vistoria</button>' : ''}
      ${V.nuvem ? fotosNuvemHTML() : ''}
      <h2>Exportar</h2>
      <div class="card">
        <p><b>${S.FOTOS.filter((f) => f.tipo !== 'video').length}</b> fotos e <b>${S.FOTOS.filter((f) => f.tipo === 'video').length}</b> vídeos em <b>${V.ambientes.length}</b> ambientes.${pend ? ` <span class="warn">${pend} itens sem condição/verificação.</span>` : ''}</p>
        <p class="muted">Última exportação: ${fmtData(V.exportadoEm)}${dirty && V.exportadoEm ? ' (há alterações depois dela)' : ''}</p>
        <button class="btn primary big" data-act="zip">Gerar ZIP</button>
        <div id="zipbox"></div>
      </div>
      <button class="btn danger" data-act="delV">Excluir esta vistoria do aparelho</button>
    </main>`, viewVistoria);
  Nuvem.chip();
}

/* ---------- dados gerais ---------- */
const OPCOES = {
  ocupacao: ['Desocupado', 'Mobiliado', 'Parcialmente mobiliado'], energia: ['Ligada', 'Desligada'], agua: ['Ligada', 'Desligada'],
  iluminacao: ['Natural e artificial', 'Natural', 'Artificial', 'Insuficiente'], clima: ['Ensolarado', 'Nublado', 'Chuvoso'], acesso: ['Sem restrições'],
};
function viewGeral() {
  const V = S.V, c = V.condicoes || {}, g = V.geral || {};
  const camp = (k, rot) => `<label>${rot}<input list="dl-${k}" data-chg="c:${k}" value="${esc(c[k] || '')}"><datalist id="dl-${k}">${OPCOES[k].map((o) => `<option>${o}</option>`).join('')}</datalist></label>`;
  render(`
    <header class="top"><button class="ico" data-act="go" data-go="#/v/${V.id}">‹</button><h1>Dados gerais</h1></header>
    <main>
      <h2>Condições da inspeção</h2>
      ${camp('ocupacao', 'Ocupação')}${camp('energia', 'Energia')}${camp('agua', 'Água')}${camp('iluminacao', 'Iluminação')}${camp('clima', 'Clima')}${camp('acesso', 'Acesso / restrições')}
      <h2>Entrega de acessos</h2>
      <label>Chaves<input data-chg="g:chaves" value="${esc(g.chaves || '')}" placeholder="Ex.: 5 chaves, sendo 4 comuns e 1 tetra"></label>
      <label>Controles<input data-chg="g:controles" value="${esc(g.controles || '')}" placeholder="Quantidade / tipo"></label>
      <label>Tags / cartões<input data-chg="g:tags" value="${esc(g.tags || '')}" placeholder="Quantidade / tipo"></label>
      <h2>Observações</h2>
      <label>Observação (vai para o laudo)<textarea data-chg="g:obs" rows="3">${esc(g.obs || '')}</textarea></label>
      <label>Observação interna (não vai para o laudo)<textarea data-chg="g:obsInterna" rows="3">${esc(g.obsInterna || '')}</textarea></label>
      <label>Imóvel faxinado?<select data-chg="g:faxinado"><option value=""></option><option ${g.faxinado === 'Sim' ? 'selected' : ''}>Sim</option><option ${g.faxinado === 'Não' ? 'selected' : ''}>Não</option></select></label>
      <button class="btn primary big" data-act="go" data-go="#/v/${V.id}">Concluir</button>
    </main>`, viewGeral);
}

/* ---------- relatório de backup (impressão) ---------- */
async function viewRelatorio() {
  render(await relatorioHTML(), viewRelatorio);
}

/* ---------- ambiente ---------- */
const piorou = (it) => it.ref && it.cond && it.ref.cond && (RANK_COND[it.cond] ?? 0) > (RANK_COND[it.ref.cond] ?? 0);
const tabsDe = (a) => {
  const L = lista(a);
  const base = CATS.map(([k, n]) => {
    const xs = L.filter((x) => x.cat === k);
    const feitos = xs.filter((x) => itemFeito(x.it) && !faltaVerif(x.it)).length;
    return `<button class="tab ${S.tab === k ? 'on' : ''}" data-act="tab" data-t="${k}">${n} <small>${feitos}/${xs.length}</small></button>`;
  }).join('');
  const nm = nMidiaAmb(a.id);
  const dv = S.V.tipoVistoria === 'Saída' ? `<button class="tab ${S.tab === 'diverg' ? 'on' : ''}" data-act="tab" data-t="diverg">Divergências <small>${L.filter((x) => x.it.diverg || piorou(x.it)).length}</small></button>` : '';
  return `<div class="tabs">${base}<button class="tab ${S.tab === 'fotos' ? 'on' : ''}" data-act="tab" data-t="fotos">Mídias <small>${nm}</small></button>${dv}</div>`;
};

function viewAmb(id) {
  S.curAmbId = id;
  const a = achaAmb(id), V = S.V;
  const i = V.ambientes.indexOf(a), prox = V.ambientes[i + 1];
  if (S.tab === 'diverg' && V.tipoVistoria !== 'Saída') S.tab = 'item';
  let corpo;
  if (S.tab === 'fotos') corpo = fotosTab(a, i);
  else if (S.tab === 'diverg') corpo = divergTab(a);
  else corpo = lista(a).filter((x) => x.cat === S.tab).map((x) => itemHTML(x)).join('') || '<p class="muted">Nenhum item nesta categoria.</p>';
  const rotAdd = S.tab === 'fotos' || S.tab === 'diverg' ? '' : `<button class="btn" data-act="addItem" data-cat="${S.tab}">＋ Novo item em ${CATS.find((c) => c[0] === S.tab)?.[1] || 'Itens'}</button>`;
  render(`
    <header class="top"><button class="ico" data-act="go" data-go="#/v/${V.id}">‹</button><h1>A${p3(i + 1)} · ${esc(a.nome)}</h1><span id="geochip" class="chip"></span></header>
    <main>
      <div class="tools ${podeEditar(a) ? '' : 'ro'}">
        ${Voice.ok ? '<button class="btn" data-act="voz">🎙 Modo voz</button>' : ''}
        <button class="btn" data-act="todosBom">Pendentes → ${V.tipoVistoria === 'Entrada' ? 'Pintura nova/Bom' : 'Bom'}</button>
      </div>
      <details class="more ${podeEditar(a) && gere() ? '' : 'ro'}"><summary>Mais ações do ambiente</summary>
        <div class="tools">
          <button class="btn" data-act="ambRep">Replicar</button><button class="btn" data-act="ambRen">Renomear</button>
          <button class="btn" data-act="ambModelo">Salvar como modelo</button><button class="btn danger" data-act="ambDel">Remover</button>
        </div>
      </details>
      <div id="vbar" class="vbar" hidden></div>
      ${a.itens.filter((x) => x.nomePend && !x.na).length ? `<div class="aviso-l">⚠ ${a.itens.filter((x) => x.nomePend && !x.na).length} registro(s) extra(s) sem nome. Toque em “nomear” no item.</div>` : ''}
      ${V.nuvem && !podeEditar(a) ? `<div class="aviso-l">👤 Este ambiente é de <b>${esc(a.dono ? Nuvem.nomeDe(a.dono) : 'ninguém ainda')}</b>${a.concluido ? ' (concluído)' : ''}. Você só pode consultar; as alterações dele aparecem aqui em tempo real.</div>` : ''}
      ${tabsDe(a)}
      <div class="${podeEditar(a) ? '' : 'ro'}">${corpo}</div>
      ${podeEditar(a) ? rotAdd : ''}
      ${V.nuvem && podeEditar(a) && a.dono ? `<button class="btn ${a.concluido ? '' : 'dark'}" data-act="ambConcluir">${a.concluido ? '↺ Reabrir este ambiente' : '✔ Marcar ambiente como concluído'}</button>` : ''}
      ${prox ? `<button class="btn primary big" data-act="go" data-go="#/v/${V.id}/a/${prox.id}">Próximo: ${esc(prox.nome)} ›</button>`
        : `<button class="btn primary big" data-act="go" data-go="#/v/${V.id}">Concluir ambientes ›</button>`}
    </main>`, () => viewAmb(id));
}

const mic = (act) => (Voice.ok ? `<button class="mic" data-act="${act}" aria-label="Ditar">🎙</button>` : '');

function refBox(it) {
  const r = it.ref;
  if (!r) return '';
  const partes = [labelCond(r.cond, true) || '—'];
  if (it.q && r.qtd != null) partes.push(`${r.qtd} un.`);
  if (r.verif) partes.push(labelVerif(r.verif, true));
  const med = it.m ? [r.ident && `Nº ${r.ident}`, r.leitura && `Leitura ${r.leitura}`, r.sit].filter(Boolean).join(' · ') : '';
  return `<div class="refbox"><b>ENTRADA</b> ${esc(partes.join(' · '))}${med ? `<br>${esc(med)}` : ''}${r.obs ? `<br>${esc(r.obs)}` : ''}${piorou(it) ? '<br><span class="bad">▲ Condição pior que na entrada</span>' : ''}</div>`;
}

function itemHTML({ it, num, sub }) {
  const ms = midiaDoItem(it.id);
  if (it.na) return `<div class="item na ${sub ? 'subi' : ''}" data-item="${it.id}"><span class="num">${num}</span><b>${esc(it.nome)}</b><span class="tag">Não existe</span><button class="lnk" data-act="na">desfazer</button></div>`;
  const cond = !it.g && !it.m
    ? `<div class="chips">${CONDICOES.filter((c) => c[0] !== 'PINTURA_NOVA' || it.p).map(([v, l]) => `<button data-act="cond" data-v="${v}" class="${it.cond === v ? 'on ' + v : ''}">${l}</button>`).join('')}</div>` : '';
  const sug = !it.cond && it.obs && !it.g && !it.m ? Voice.sugerirCond(it.obs) : null;
  const sugHTML = sug ? `<button class="lnk" data-act="aplicarSug" data-v="${sug}">Sugestão pela descrição: ${labelCond(sug)} — aplicar</button>` : '';
  const ver = it.t ? `<div class="chips">${VERIFICACOES.map(([v, l]) => `<button data-act="verif" data-v="${v}" class="${it.verif === v ? 'on V' : ''}">${l}</button>`).join('')}</div>` : '';
  const qtd = it.q ? `<div class="qty"><span class="ql">Qtd.</span><button data-act="qtd" data-d="-1" aria-label="Menos">−</button><input type="number" inputmode="numeric" min="0" data-chg="qtd" value="${it.qtd ?? ''}" placeholder="0"><button data-act="qtd" data-d="1" aria-label="Mais">＋</button>${mic('ditarQtd')}</div>` : '';
  const med = it.m ? `<div class="qty"><input type="text" data-chg="ident" value="${esc(it.ident || '')}" placeholder="Nº do medidor">${mic('ditarIdent')}</div>
    <div class="qty"><input type="text" data-chg="leitura" value="${esc(it.leitura || '')}" placeholder="Leitura">${mic('ditarLeitura')}</div>
    <div class="chips">${['Ligado', 'Desligado'].map((s) => `<button data-act="sit" data-v="${s}" class="${it.sit === s ? 'on V' : ''}">${s}</button>`).join('')}</div>` : '';
  const obsOn = it.obs || it.cond === 'AVARIA' || it.cond === 'REGULAR' || it.obsOpen;
  const obs = obsOn
    ? `<div class="qty"><textarea data-chg="obs" rows="2" placeholder="${it.cond === 'AVARIA' ? 'Descreva a avaria' : 'Descrição objetiva (material, cor, marcas...)'}">${esc(it.obs || '')}</textarea>${mic('ditarObs')}</div>` : '';
  const dv = S.V.tipoVistoria === 'Saída' && it.ref
    ? `<button class="lnk ${it.diverg ? 'bad' : ''}" data-act="divTog">${it.diverg ? '⚑ Divergência registrada (remover)' : '⚑ Registrar divergência'}</button>
       ${it.diverg ? `<div class="qty"><textarea data-chg="divtxt" rows="2" placeholder="Descreva a divergência em relação à entrada">${esc(it.diverg.texto || '')}</textarea></div>` : ''}` : '';
  return `<div class="item ${itemFeito(it) && !faltaVerif(it) ? 'done' : ''} ${sub ? 'subi' : ''}" data-item="${it.id}">
    <div class="ih"><span class="num">${num}</span><b>${esc(it.nome)}</b>${it.nomePend ? '<button class="lnk bad" data-act="nomear">⚠ nomear</button>' : ''}<button class="ed" data-act="editItem" aria-label="Editar item">✎</button><button class="lnk" data-act="na">não existe</button></div>
    ${refBox(it)}
    ${qtd}${med}${cond}${sugHTML}${ver}${obs}${dv}
    <div class="shots">
      <button class="btn cam" data-act="foto">📷 Foto</button>
      <button class="btn" data-act="video" aria-label="Gravar vídeo">🎥</button>
      <button class="btn" data-act="galeria" aria-label="Galeria">🖼</button>
      ${ms.map((f, k) => `<span class="thw"><img class="th" data-act="ver" data-foto="${f.id}" src="${thumbURL(f)}" alt="Mídia ${k + 1}">${f.tipo === 'video' ? '<i class="play">▶</i>' : ''}${f.vertical ? '<i class="vert" title="Foto na vertical">⚠</i>' : ''}</span>`).join('')}
    </div>
    <div class="foot">${obsOn || it.g ? '' : '<button class="lnk" data-act="obsOpen">＋ descrição</button>'}${sub ? '' : '<button class="lnk" data-act="addSub">＋ subitem</button>'}<button class="lnk" data-act="addItem">＋ item abaixo</button><button class="lnk bad" data-act="delItem">remover</button></div>
  </div>`;
}

function fotosTab(a, ai) {
  const p = plano(S.FOTOS)[ai];
  if (!p.todas.length) return '<p class="muted">Nenhuma foto ou vídeo neste ambiente. Registre pelas abas de itens.</p>';
  return `<div class="grid">${p.todas.map((m) => `<figure><span class="thw big"><img src="${thumbURL(m.f)}" data-act="ver" data-foto="${m.f.id}" alt="">${m.f.tipo === 'video' ? '<i class="play">▶</i>' : ''}${m.f.vertical ? '<i class="vert" title="Foto na vertical">⚠</i>' : ''}</span><figcaption><b>${m.cod}</b><br>${esc(m.caminho)}</figcaption></figure>`).join('')}</div>`;
}

function divergTab(a) {
  const xs = lista(a).filter((x) => !x.it.na && x.it.ref && (x.it.diverg || piorou(x.it)));
  if (!xs.length) return '<p class="muted">Nenhuma divergência até agora. Itens com condição pior que a da entrada aparecem aqui automaticamente.</p>';
  return xs.map(({ it, num }) => `<div class="item ${it.diverg ? 'done' : ''}" data-item="${it.id}">
    <div class="ih"><span class="num">${num}</span><b>${esc(it.nome)}</b></div>
    ${refBox(it)}<div class="refbox now"><b>SAÍDA</b> ${esc(labelCond(it.cond, true) || '—')}${it.obs ? '<br>' + esc(it.obs) : ''}</div>
    <button class="lnk ${it.diverg ? 'bad' : ''}" data-act="divTog">${it.diverg ? '⚑ Divergência registrada (remover)' : '⚑ Registrar divergência'}</button>
    ${it.diverg ? `<div class="qty"><textarea data-chg="divtxt" rows="2" placeholder="Descreva a divergência">${esc(it.diverg.texto || '')}</textarea></div>` : ''}
    <div class="shots"><button class="btn cam" data-act="foto">📷 Foto</button><button class="btn" data-act="video">🎥</button>
      ${midiaDoItem(it.id).map((f) => `<span class="thw"><img class="th" data-act="ver" data-foto="${f.id}" src="${thumbURL(f)}" alt=""></span>`).join('')}</div></div>`).join('');
}

/* ---------- configurações ---------- */
/* ---------- conta, equipe e divisão de ambientes (nuvem) ---------- */
const ROT_PAPEL = { admin: 'Administrador', corretor: 'Corretor', vistoriador: 'Vistoriador' };

function viewConta() {
  const n = Nuvem.N;
  render(`
    <header class="top"><button class="ico" data-act="go" data-go="#/">‹</button><h1>Minha conta</h1><span id="syncchip" class="chip"></span></header>
    <main>
      ${Nuvem.logado() ? `
        <div class="card"><b>${esc(n.perfil?.nome || n.user.email)}</b><small>${esc(n.user.email)}</small>
          <small>Papel: <b>${ROT_PAPEL[n.perfil?.papel] || '—'}</b></small>
          ${n.erro ? `<small class="warn">Último erro de sincronização: ${esc(n.erro)}</small>` : ''}</div>
        <label>Meu nome (aparece para a equipe)<input data-chg="meuNome" value="${esc(n.perfil?.nome || '')}"></label>
        <button class="btn" data-act="sincronizarAgora">⟳ Sincronizar agora</button>
        ${Nuvem.eAdmin() ? '<button class="btn" data-act="go" data-go="#/equipe">👥 Equipe e permissões</button>' : ''}
        <button class="btn danger" data-act="sair">Sair da conta</button>`
        : `<p class="muted">Entre para ver as vistorias da equipe, criar vistorias no computador e continuar no celular. Sem login o app continua funcionando, só neste aparelho.</p>
        <label>E-mail<input id="l-email" type="email" autocomplete="username" inputmode="email"></label>
        <label>Senha<input id="l-senha" type="password" autocomplete="current-password"></label>
        <button class="btn primary big" data-act="entrar">Entrar</button>
        <p id="l-msg" class="warn"></p>`}
    </main>`, viewConta);
  Nuvem.chip();
}

async function viewEquipe() {
  if (!Nuvem.logado() || !Nuvem.eAdmin()) { location.hash = '#/conta'; return; }
  let erro = '';
  try { await Nuvem.carregarEquipe(); } catch (e) { erro = e.message; }
  render(`
    <header class="top"><button class="ico" data-act="go" data-go="#/conta">‹</button><h1>Equipe</h1></header>
    <main>
      ${erro ? `<p class="warn">${esc(erro)}</p>` : ''}
      ${Nuvem.N.equipe.map((p) => `<div class="card pessoa" data-pid="${p.id}">
        <label>Nome<input data-chg="pnome:${p.id}" value="${esc(p.nome)}" placeholder="${esc(p.email || '')}"></label>
        <small>${esc(p.email || '')}</small>
        <label>Papel<select data-chg="ppapel:${p.id}">${Object.entries(ROT_PAPEL).map(([k, v]) => `<option value="${k}" ${p.papel === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" data-chg="pativo:${p.id}" ${p.ativo ? 'checked' : ''}> Acesso ativo</label>
      </div>`).join('')}
      <div class="card"><b>Como adicionar uma pessoa</b>
        <p class="muted">No painel do Supabase: <b>Authentication › Users › Add user</b>, com e-mail e senha. Ela aparece aqui como <i>Vistoriador</i>; ajuste o papel acima. Ninguém consegue se cadastrar sozinho.</p></div>
    </main>`, viewEquipe);
}

function viewEquipeVistoria() {
  const V = S.V, eq = Nuvem.N.equipe.filter((p) => p.ativo), pode = gere();
  const donos = new Set(V.ambientes.map((a) => a.dono).filter(Boolean));
  render(`
    <header class="top"><button class="ico" data-act="go" data-go="#/v/${V.id}">‹</button><h1>Equipe e divisão</h1><span id="syncchip" class="chip"></span></header>
    <main>
      ${pode ? `<div class="card"><b>Dividir automaticamente</b>
          <small>Marque quem vai a campo. Os ambientes são divididos em sequência, na ordem do passeio; os medidores ficam com você.</small>
          ${eq.map((p) => `<label class="chk"><input type="checkbox" data-eqsel="${p.id}" ${donos.has(p.id) ? 'checked' : ''}> ${esc(p.nome || p.email)} <small>(${ROT_PAPEL[p.papel]})</small></label>`).join('')}
          <button class="btn primary" data-act="dividir">Dividir ambientes</button></div>` : '<p class="muted">Somente quem criou a vistoria (ou o administrador) altera a divisão.</p>'}
      <h2>Ambientes</h2>
      ${V.ambientes.map((a, i) => {
        const its = a.itens.filter((x) => !x.na), ok = its.filter((x) => itemFeito(x) && !faltaVerif(x)).length;
        return `<div class="item"><div class="ih"><span class="num">A${p3(i + 1)}</span><b>${esc(a.nome)}</b><small>${ok}/${its.length}${a.concluido ? ' ✔' : ''}</small></div>
          ${pode ? `<select data-chg="dono:${a.id}"><option value="">Sem responsável</option>${eq.map((p) => `<option value="${p.id}" ${a.dono === p.id ? 'selected' : ''}>${esc(p.nome || p.email)}</option>`).join('')}</select>`
            : `<small>👤 ${a.dono ? esc(a.dono === S.euId ? 'você' : Nuvem.nomeDe(a.dono)) : 'sem responsável'}</small>`}</div>`;
      }).join('')}
    </main>`, viewEquipeVistoria);
  Nuvem.chip();
}

function viewCfg() {
  render(`
    <header class="top"><button class="ico" data-act="go" data-go="#/">‹</button><h1>Configurações</h1></header>
    <main>
      <label>Nome do vistoriador (preenche novas vistorias)<input data-chg="cfgVist" value="${esc(cfg.vistoriador || '')}"></label>
      <label>Tamanho das fotos salvas
        <select data-chg="cfgPx">
          <option value="1600" ${cfg.maxPx === 1600 ? 'selected' : ''}>Leve (1600 px)</option>
          <option value="2400" ${cfg.maxPx === 2400 ? 'selected' : ''}>Padrão (2400 px) — recomendado</option>
          <option value="0" ${cfg.maxPx === 0 ? 'selected' : ''}>Original da câmera (ocupa mais espaço)</option>
        </select></label>
      <label>Modo do passeio
        <select data-chg="cfgRapido">
          <option value="1" ${cfg.rapido ? 'selected' : ''}>Rápido — só a câmera; padrão Bom/Testado aplicado no fim (recomendado)</option>
          <option value="0" ${!cfg.rapido ? 'selected' : ''}>Completo — marcar condição de cada item na hora</option>
        </select></label>
      <label>Limite de vídeos por ambiente<input type="number" min="0" max="30" data-chg="cfgVid" value="${cfg.maxVideos}"></label>
      <label>Qualidade da prévia da câmera do app
        <select data-chg="cfgRes">
          <option value="720" ${cfg.camRes === 720 ? 'selected' : ''}>Leve (720p) — mais fluida, para aparelhos simples</option>
          <option value="1080" ${cfg.camRes === 1080 ? 'selected' : ''}>Automática (recomendada): prévia leve e foto em resolução total</option>
          <option value="0" ${cfg.camRes === 0 ? 'selected' : ''}>Máxima (pesada, pode travar)</option>
        </select></label>
      <div class="card"><b>🔬 Diagnóstico da câmera</b>
        <p class="muted">Mostra a resolução que este aparelho entrega à câmera do app. Toque e envie a captura da tela para o suporte.</p>
        <button class="btn" data-act="camTeste">Testar câmera</button>
        <p class="muted">Teste de captura: segure o aparelho <b>deitado</b> (como ao fotografar) e aponte para algo. Tira fotos de teste em várias resoluções e mostra tempo, tamanho e a imagem.</p>
        <button class="btn" data-act="camTeste2">Teste de captura (fotos)</button>
        <pre id="camrel" class="muted" style="white-space:pre-wrap;font-size:12px"></pre>
        <div id="camfotos" style="display:flex;flex-wrap:wrap;gap:8px"></div></div>
      <h2>Passeio guiado</h2>
      <label class="chk"><input type="checkbox" data-chg="cfgFalar" ${cfg.falar ? 'checked' : ''}> Ler o roteiro em voz alta</label>
      <div class="card"><b>🔊 Voz do roteiro</b>
        <label>Voz<select data-chg="cfgVoz"><option value="">Melhor disponível (automático)${Voice.estadoFala.nome ? ' — ' + esc(Voice.estadoFala.nome) : ''}</option>
          ${Voice.listarVozes().map((v) => `<option value="${esc(v.voiceURI)}" ${cfg.voz === v.voiceURI ? 'selected' : ''}>${esc(v.name)}${v.localService ? '' : ' (online)'}</option>`).join('')}</select></label>
        <label>Velocidade<select data-chg="cfgVel">${[[0.9, 'Calma'], [1, 'Normal'], [1.05, 'Natural (padrão)'], [1.2, 'Rápida'], [1.35, 'Muito rápida']].map(([v, t]) => `<option value="${v}" ${(cfg.velFala || 1.05) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <button class="btn" data-act="testarVoz">▶ Testar a voz</button>
        <p class="muted">A qualidade depende do aparelho. No Android, instale/atualize o app <b>“Serviços de fala do Google”</b> e baixe a voz em português (Configurações › Saída de texto para fala). No iPhone: Ajustes › Acessibilidade › Conteúdo Falado › Vozes › Português, e baixe uma versão “Aprimorada”.</p></div>
      <label class="chk"><input type="checkbox" data-chg="cfgAuto" ${cfg.auto ? 'checked' : ''}> Avançar sozinho quando o item estiver completo</label>
      <label class="chk"><input type="checkbox" data-chg="cfgCmd" ${cfg.comandos ? 'checked' : ''}> Comandos por voz (“foto”, “próximo”, “bom”, “avaria”…)</label>
      <div class="card" id="pushcard"><b>🔔 Avisos no celular</b><p class="muted">Verificando…</p></div>
      <button class="btn" data-act="go" data-go="#/conta">☁ Minha conta e sincronização</button>
      <button class="btn" data-act="go" data-go="#/modelos">Modelos de ambiente</button>
      <div class="card" id="storage">Verificando armazenamento…</div>
      <div class="card"><b>Instalar no celular</b>
        <p class="muted"><b>Android (Chrome):</b> menu ⋮ › “Instalar app”.<br><b>iPhone (Safari):</b> botão Compartilhar › “Adicionar à Tela de Início”.<br>Abra o app uma vez com internet para ele funcionar depois sem sinal.</p></div>
      <p class="muted">Versão ${VERSAO}</p>
    </main>`, viewCfg);
  pushCard();
  (async () => {
    const el = document.getElementById('storage');
    if (!el) return;
    try {
      const e = await navigator.storage.estimate();
      const per = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      el.innerHTML = `<b>Armazenamento</b><p class="muted">Usado: ${fmtMB(e.usage || 0)} de ~${fmtMB(e.quota || 0)}.<br>Proteção contra limpeza automática: ${per ? '<span class="okc">ativa</span>' : '<span class="warn">não garantida — exporte o ZIP ao fim de cada vistoria</span>'}.</p>`;
    } catch { el.textContent = 'Armazenamento: informação indisponível.'; }
  })();
}

/* ---------- visualizador de mídia ---------- */
function verFoto(id) {
  const f = S.FOTOS.find((x) => x.id === id);
  if (!f) return;
  S.ovURL = URL.createObjectURL(f.blob);
  const a = achaAmb(f.ambId), it = a && achaItem(a, f.itemId);
  const irm = midiaDoItem(f.itemId), pos = irm.findIndex((x) => x.id === id);
  abreOverlay(`<div class="viewer" data-foto="${f.id}">
    ${f.tipo === 'video' ? `<video src="${S.ovURL}" controls playsinline></video>` : `<img src="${S.ovURL}" alt="">`}
    <div class="vinfo"><b>${esc(a?.nome || '')} · ${esc(it?.nome || '')}</b> (${pos + 1} de ${irm.length} neste item)<br>${fmtData(f.ts)}${f.pos ? ` · 📍 ${f.pos.lat.toFixed(5)}, ${f.pos.lng.toFixed(5)} (±${f.pos.acc} m)` : f.origem === 'galeria' ? ' · da galeria (sem GPS)' : ' · sem GPS'}${f.nota ? `<br>Legenda: ${esc(f.nota)}` : ''}${f.soThumb ? '<br>⚠ Miniatura (foto de outro aparelho). O original está na nuvem: use “Baixar originais” no menu da vistoria.' : ''}</div>
    <div class="vbtns"><button class="btn" data-act="movFoto" data-d="-1" ${pos === 0 ? 'disabled' : ''}>◀</button><button class="btn" data-act="movFoto" data-d="1" ${pos === irm.length - 1 ? 'disabled' : ''}>▶</button><button class="btn" data-act="legenda">Legenda</button>${f.soThumb || f.tipo === 'video' ? '' : '<button class="btn" data-act="girar">↻ Girar</button>'}</div>
    <div class="vbtns"><button class="btn" data-act="moverPara">Mover p/ outro item</button><button class="btn danger" data-act="delFoto">Excluir</button><button class="btn primary" data-act="fechar">Fechar</button></div>
  </div>`);
}

/* ---------- ações ---------- */
const ctxItem = (el) => {
  const card = el.closest('[data-item]');
  const a = achaAmb(S.curAmbId);
  return { a, it: card && a ? achaItem(a, card.dataset.item) : null };
};
const reler = async () => { await salvarV(); S.redraw(); };
const fotoAtual = () => S.FOTOS.find((x) => x.id === document.querySelector('.viewer')?.dataset.foto);

const ACTS = {
  go: (el) => { location.hash = el.dataset.go; },
  fechar: () => fechaOverlay(),
  tab(el) { S.tab = el.dataset.t; S.redraw(); window.scrollTo(0, 0); },

  async salvarForm() {
    const g = (id) => document.getElementById(id).value.trim();
    const endereco = g('f-end');
    if (!endereco) return toast('Informe o endereço do imóvel');
    const dados = { codigo: g('f-codigo') || S.V.codigo, finalidade: g('f-fin'), endereco, codImovel: g('f-cod'), metragem: g('f-m2'), solicitante: g('f-sol'), vistoriador: g('f-vist') };
    cfg.vistoriador = dados.vistoriador; salvarCfg();
    Object.assign(S.V, dados);
    await salvarV();
    location.hash = '#/v/' + S.V.id;
  },
  async iniciar() { S.V.inicioEm = Date.now(); S.V.geo = geo.last || S.V.geo; await reler(); toast('Vistoria iniciada'); },
  finalizar() { location.hash = '#/v/' + S.V.id + '/revisao'; },
  async abrirPedido(el) { location.hash = '#/nova/' + el.dataset.id; },
  async finalizarOk() {
    const n = pendencias();
    if (!confirm(`Finalizar a vistoria?${n ? `\n\nAtenção: ${n} itens ainda sem condição/verificação.` : ''}\nVocê poderá reabri-la se precisar.`)) return;
    S.V.fimEm = Date.now();
    await salvarV();
    location.hash = '#/v/' + S.V.id;
    if (S.V.nuvem && Nuvem.logado() && gere()) await ACTS.enviarDrive(); // oferece enviar as fotos ao Drive
  },
  async reabrir() { S.V.fimEm = null; await reler(); },

  async ambMove(el) {
    const id = el.closest('[data-amb]').dataset.amb, i = S.V.ambientes.findIndex((a) => a.id === id), j = i + Number(el.dataset.d);
    if (j < 0 || j >= S.V.ambientes.length) return;
    [S.V.ambientes[i], S.V.ambientes[j]] = [S.V.ambientes[j], S.V.ambientes[i]];
    await reler();
  },
  addAmb() {
    abreOverlay(`<div class="sheet"><h2>Adicionar ambiente</h2>
      ${Object.entries(catalogo()).map(([k, c]) => `<button class="btn" data-act="addAmbOk" data-k="${k}">${esc(c.nome)}</button>`).join('')}
      <button class="btn primary" data-act="fechar">Cancelar</button></div>`);
  },
  async addAmbOk(el) {
    const nome = prompt('Nome do ambiente:', '');
    if (nome === null) return;
    const a = montarAmbiente(el.dataset.k, S.V.ambientes.map((x) => x.nome), { mobiliado: S.V.variaveis?.mobiliado ?? true });
    if (nome.trim()) a.nome = nome.trim();
    const m = S.V.ambientes.findIndex((x) => x.modelo === 'medidores');
    if (m >= 0 && a.modelo !== 'medidores') S.V.ambientes.splice(m, 0, a); else S.V.ambientes.push(a);
    fechaOverlay();
    await reler();
  },
  async ambRen() { const a = achaAmb(S.curAmbId), n = prompt('Novo nome do ambiente:', a.nome); if (n && n.trim()) { a.nome = n.trim(); await reler(); } },
  async ambDel() {
    const a = achaAmb(S.curAmbId), n = nMidiaAmb(a.id);
    if (!confirm(`Remover "${a.nome}"${n ? ` e apagar ${n} foto(s)/vídeo(s) deste aparelho` : ''}?`)) return;
    for (const f of S.FOTOS.filter((x) => x.ambId === a.id)) await apagarMidia(f.id);
    S.V.ambientes = S.V.ambientes.filter((x) => x !== a);
    await salvarV();
    location.hash = '#/v/' + S.V.id;
  },
  ambRep() {
    abreOverlay(`<div class="sheet"><h2>Replicar ambiente</h2><p class="muted">Cria uma cópia logo abaixo, sem as fotos.</p>
      <button class="btn" data-act="ambRepOk" data-d="0">Só a estrutura (itens)</button>
      <button class="btn" data-act="ambRepOk" data-d="1">Com condições e descrições</button>
      <button class="btn primary" data-act="fechar">Cancelar</button></div>`);
  },
  async ambRepOk(el) {
    const a = achaAmb(S.curAmbId), comDados = el.dataset.d === '1';
    const m = a.nome.match(/^(.*?)(\d+)$/);
    const sugestao = m ? `${m[1]}${Number(m[2]) + 1}` : `${a.nome} 2`;
    const nome = prompt('Nome do novo ambiente:', sugestao);
    if (!nome) return;
    const idMap = new Map();
    const itens = a.itens.map((i) => {
      const n = { ...JSON.parse(JSON.stringify(i)), id: uid() };
      idMap.set(i.id, n.id);
      if (!comDados) { for (const k of ['cond', 'verif', 'qtd', 'obs', 'ident', 'leitura', 'sit', 'diverg', 'obsOpen', 'na']) delete n[k]; }
      return n;
    });
    itens.forEach((n) => { if (n.paiId) n.paiId = idMap.get(n.paiId); });
    S.V.ambientes.splice(S.V.ambientes.indexOf(a) + 1, 0, { id: uid(), nome: nome.trim(), modelo: a.modelo, itens });
    fechaOverlay();
    await reler();
    toast('Ambiente replicado');
  },
  async ambModelo() {
    const a = achaAmb(S.curAmbId);
    const nome = prompt('Nome do modelo a salvar (a partir deste ambiente):', a.nome);
    if (!nome || !nome.trim()) return;
    salvarModelo(nome.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now().toString(36).slice(-3), { nome: nome.trim(), itens: specDeAmbiente(a) });
    toast('Modelo salvo — disponível em “Adicionar ambiente”');
  },
  async todosBom() {
    const a = achaAmb(S.curAmbId);
    const alvo = a.itens.filter((i) => !i.na && !i.g && !i.m && !i.cond);
    if (!alvo.length) return toast('Nenhum item pendente');
    if (!confirm(`Marcar ${alvo.length} itens pendentes como ${S.V.tipoVistoria === 'Entrada' ? 'PINTURA NOVA (superfícies pintadas) ou BOM' : 'BOM'}?\nConfira os itens com avaria depois.`)) return;
    alvo.forEach((i) => { i.cond = i.p && S.V.tipoVistoria === 'Entrada' ? 'PINTURA_NOVA' : 'BOM'; });
    await reler();
  },

  /* itens */
  async cond(el) {
    const { it } = ctxItem(el);
    it.cond = it.cond === el.dataset.v ? null : el.dataset.v;
    if ((it.cond === 'AVARIA' || it.cond === 'REGULAR') && !it.obs) it.obsOpen = true;
    if (piorou(it) && !it.diverg && S.V.tipoVistoria === 'Saída') toast('Pior que na entrada — veja a aba Divergências', 3000);
    await reler();
  },
  async aplicarSug(el) { ctxItem(el).it.cond = el.dataset.v; await reler(); },
  async verif(el) { const { it } = ctxItem(el); it.verif = it.verif === el.dataset.v ? null : el.dataset.v; await reler(); },
  async sit(el) { const { it } = ctxItem(el); it.sit = it.sit === el.dataset.v ? '' : el.dataset.v; await reler(); },
  async qtd(el) { const { it } = ctxItem(el); it.qtd = Math.max(0, (Number(it.qtd) || 0) + Number(el.dataset.d)); await reler(); },
  async na(el) {
    const { a, it } = ctxItem(el);
    if (!it.na) {
      const filhos = a.itens.filter((x) => x.paiId === it.id).length;
      if ((midiaDoItem(it.id).length || filhos) && !confirm('Este item tem fotos ou subitens. Marcar como "não existe" mesmo assim? (as fotos continuam sendo exportadas)')) return;
    }
    it.na = !it.na;
    await reler();
  },
  obsOpen(el) { ctxItem(el).it.obsOpen = true; S.redraw(); },
  async divTog(el) {
    const { it } = ctxItem(el);
    it.diverg = it.diverg ? null : { texto: '', em: Date.now() };
    await reler();
  },

  editItem(el) { const { a, it } = ctxItem(el); S.edit = { id: it.id }; sheetItem(it, a); },
  addSub(el) { const { it } = ctxItem(el); S.edit = { novo: true, paiId: it.id, cat: it.cat }; sheetItem({ nome: '', cat: it.cat, q: false, t: false, p: false, g: false }, null); },
  addItem(el) {
    const { it } = ctxItem(el);
    S.edit = { novo: true, depois: it?.id, paiId: it?.paiId, cat: it ? (it.cat || 'item') : (el.dataset.cat || 'item') };
    sheetItem({ nome: '', cat: S.edit.cat, q: false, t: false, p: false, g: false }, null);
  },
  async salvarItem() {
    const nome = document.getElementById('e-nome').value.trim();
    if (!nome) return toast('Informe o nome do item');
    const campos = { nome, cat: document.getElementById('e-cat')?.value || 'item', q: document.getElementById('e-q').checked, t: document.getElementById('e-t').checked, p: document.getElementById('e-p').checked, g: document.getElementById('e-g').checked };
    const a = achaAmb(S.curAmbId);
    if (S.edit.novo) {
      const novo = { id: uid(), ...campos, custom: true };
      if (S.edit.paiId) { novo.paiId = S.edit.paiId; novo.cat = S.edit.cat; }
      const idx = S.edit.depois ? a.itens.findIndex((i) => i.id === S.edit.depois) : a.itens.length - 1;
      // depois do item de referência e dos subitens dele
      let pos = idx + 1;
      if (S.edit.depois && !S.edit.paiId) while (pos < a.itens.length && a.itens[pos].paiId === S.edit.depois) pos++;
      if (S.edit.paiId && !S.edit.depois) { pos = a.itens.length; }
      a.itens.splice(pos, 0, novo);
    } else {
      const it = achaItem(a, S.edit.id);
      Object.assign(it, campos);
      if (it.nomePend && campos.nome && !/^Registro extra \d+$/.test(campos.nome)) it.nomePend = false;
      if (!it.paiId) a.itens.filter((s) => s.paiId === it.id).forEach((s) => { s.cat = it.cat; });
    }
    fechaOverlay();
    await reler();
  },
  async delItem(el) {
    const { a, it } = ctxItem(el);
    const filhos = a.itens.filter((x) => x.paiId === it.id), n = [it, ...filhos].reduce((s, x) => s + midiaDoItem(x.id).length, 0);
    if (!confirm(`Remover o item "${it.nome}"${filhos.length ? ` e ${filhos.length} subitem(ns)` : ''}${n ? ` — ${n} foto(s)/vídeo(s) serão apagados` : ''}?`)) return;
    for (const x of [it, ...filhos]) for (const f of midiaDoItem(x.id)) await apagarMidia(f.id);
    a.itens = a.itens.filter((x) => x !== it && x.paiId !== it.id);
    await reler();
  },

  /* mídia */
  async foto(el) {
    const { a, it } = ctxItem(el);
    const files = await escolher({ camera: true });
    if (!files.length) return;
    toast('Salvando foto…');
    await addMidia(a.id, it.id, files, 'camera');
    toast(`Foto salva (${midiaDoItem(it.id).length} neste item)`);
    S.redraw();
  },
  async video(el) {
    const { a, it } = ctxItem(el);
    const files = await escolher({ camera: true, video: true });
    if (!files.length) return;
    toast('Salvando vídeo…', 4000);
    await addMidia(a.id, it.id, files, 'camera');
    S.redraw();
  },
  async galeria(el) {
    const { a, it } = ctxItem(el);
    const files = await escolher({ camera: false, multiplo: true });
    if (!files.length) return;
    toast('Importando…');
    await addMidia(a.id, it.id, files, 'galeria');
    S.redraw();
  },
  ver: (el) => verFoto(el.dataset.foto),
  async girar() {
    const f = fotoAtual();
    toast('Girando…');
    await girarFoto(f);
    await salvarV();
    verFoto(f.id);
    S.redraw();
  },
  async nomear(el) {
    const { it } = ctxItem(el);
    const n = prompt('Nome deste registro (ex.: Ar-condicionado do fundo):', it.nomePend ? '' : it.nome);
    if (!n || !n.trim()) return;
    it.nome = n.trim(); it.nomePend = false;
    await reler();
  },
  async legenda() {
    const f = fotoAtual();
    const n = prompt('Legenda / detalhe (vai no nome do arquivo):', f.nota || '');
    if (n === null) return;
    f.nota = n.trim();
    await DB.putF(f); await salvarV();
    fechaOverlay(); S.redraw();
  },
  async movFoto(el) {
    const f = fotoAtual(), irm = midiaDoItem(f.itemId), i = irm.findIndex((x) => x.id === f.id), j = i + Number(el.dataset.d);
    if (j < 0 || j >= irm.length) return;
    [f.seq, irm[j].seq] = [irm[j].seq, f.seq];
    await DB.putF(f); await DB.putF(irm[j]);
    verFoto(f.id); S.redraw();
  },
  moverPara() {
    const f = fotoAtual(), a = achaAmb(f.ambId);
    abreOverlay(`<div class="sheet" data-foto="${f.id}"><h2>Mover para qual item?</h2>
      ${lista(a).map(({ it, num }) => `<button class="btn ${it.id === f.itemId ? 'primary' : ''}" data-act="moverOk" data-i="${it.id}">${num} ${esc(it.nome)}</button>`).join('')}
      <button class="btn" data-act="fechar">Cancelar</button></div>`);
  },
  async moverOk(el) {
    const f = S.FOTOS.find((x) => x.id === document.querySelector('.sheet')?.dataset.foto);
    f.itemId = el.dataset.i; f.seq = Date.now() + Math.random();
    await DB.putF(f); fechaOverlay(); await reler();
  },
  async delFoto() {
    const f = fotoAtual();
    if (!confirm('Excluir esta mídia do aparelho?')) return;
    await apagarMidia(f.id);
    fechaOverlay();
    await reler();
  },

  /* voz */
  async ditarObs(el) { const { it } = ctxItem(el); const t = await ditar(); if (t) { it.obs = (it.obs ? it.obs + ' ' : '') + Voice.limpar(t); it.obsOpen = true; await reler(); } },
  async ditarIdent(el) { const { it } = ctxItem(el); const t = await ditar(); if (t) { it.ident = t.replace(/\s+/g, ''); await reler(); } },
  async ditarLeitura(el) { const { it } = ctxItem(el); const t = await ditar(); if (t) { it.leitura = t.replace(/\s+/g, ''); await reler(); } },
  async ditarQtd(el) {
    const { it } = ctxItem(el);
    const alts = await listenSafe();
    const n = Voice.numero(alts[0] || '');
    if (n != null) { it.qtd = n; await reler(); } else toast('Não entendi o número');
  },
  voz() { runVoice(achaAmb(S.curAmbId)); },
  pararVoz: () => stopVoice(),

  /* exportação */
  async zip() {
    const box = document.getElementById('zipbox'), btn = document.querySelector('[data-act="zip"]');
    btn.disabled = true;
    try {
      S.lastZip = await gerarZip((t) => { box.innerHTML = `<p class="muted">${esc(t)}</p>`; });
      box.innerHTML = `<p class="okc">✔ ZIP pronto: ${S.lastZip.total} arquivos · ${fmtMB(S.lastZip.blob.size)}</p>
        <button class="btn primary big" data-act="compartilhar">Compartilhar / salvar</button>
        <button class="btn" data-act="baixar">Baixar arquivo</button>
        <p class="muted">Confira o arquivo no Drive antes de excluir a vistoria deste aparelho.</p>`;
    } catch (e) { console.error(e); box.innerHTML = `<p class="warn">Falha ao gerar o ZIP: ${esc(e.message)}</p>`; }
    finally { btn.disabled = false; }
  },
  async compartilhar() {
    if (!S.lastZip) return;
    const file = new File([S.lastZip.blob], S.lastZip.nome, { type: 'application/zip' });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: S.lastZip.nome });
      else baixar();
    } catch (e) { if (e.name !== 'AbortError') toast('Não consegui compartilhar: ' + e.message, 4000); }
  },
  baixar: () => baixar(),
  imprimir: () => window.print(),
  async delV() {
    if (S.V.atualizadoEm > (S.V.exportadoEm || 0) + 1000 && !confirm('Esta vistoria tem dados NÃO exportados. Excluir mesmo assim?')) return;
    if (!confirm(`Excluir "${S.V.codigo}" e todas as fotos deste aparelho? Isso não pode ser desfeito.`)) return;
    await DB.delVistoria(S.V.id);
    S.V = null;
    location.hash = '#/';
  },
  /* nuvem */
  async entrar() {
    const msg = document.getElementById('l-msg');
    try {
      msg.textContent = 'Entrando…';
      await Nuvem.entrar(document.getElementById('l-email').value, document.getElementById('l-senha').value);
      toast('Conectado');
      location.hash = '#/';
    } catch (e) { msg.textContent = e.message; }
  },
  async sair() { if (confirm('Sair da conta? As vistorias já baixadas continuam neste aparelho.')) { await Nuvem.sair(); location.hash = '#/'; } },
  async sincronizarAgora() {
    toast('Sincronizando…');
    try { if (S.V?.nuvem) { await Nuvem.puxar(S.V); await Nuvem.empurrar(); } else await Nuvem.carregarEquipe(); toast('Sincronizado'); }
    catch (e) { toast('Falha: ' + e.message, 4000); }
    S.redraw();
  },
  async abrirNuvem(el) {
    toast('Baixando vistoria…', 4000);
    await Nuvem.baixar(el.dataset.id);
    location.hash = '#/v/' + el.dataset.id;
  },
  async camTeste() { // mede o que o aparelho entrega à câmera do navegador (por resolução pedida)
    const box = document.getElementById('camrel'); if (!box) return;
    box.textContent = 'Testando… (permita a câmera, se pedir)';
    const L = [`Aparelho: ${navigator.userAgent}`, `ImageCapture (foto em resolução total): ${typeof ImageCapture !== 'undefined' ? 'sim' : 'não'}`, `Tela: ${screen.orientation?.type || window.orientation} · ${screen.width}x${screen.height}`];
    for (const [w, h] of [[4096, 3072], [3840, 2160], [1920, 1080], [1280, 720]]) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: w }, height: { ideal: h } } });
        const st = s.getVideoTracks()[0].getSettings(), v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.srcObject = s; await v.play().catch(() => {}); await new Promise((r) => setTimeout(r, 800));
        L.push(`pedido ${w}x${h} → fluxo ${st.width}x${st.height}, vídeo ${v.videoWidth}x${v.videoHeight}, ${Math.round(st.frameRate || 0)} fps`);
        s.getTracks().forEach((t) => t.stop());
      } catch (e) { L.push(`pedido ${w}x${h} → erro ${e.name}`); }
    }
    box.textContent = L.join('\n');
  },
  async camTeste2() { // tira fotos de teste em resoluções diferentes: tempo, tamanho, dimensões e a imagem (orientação visível)
    const box = document.getElementById('camrel'), gal = document.getElementById('camfotos'); if (!box || !gal) return;
    gal.innerHTML = ''; const L = [`Tela: ${screen.orientation?.type} · ${screen.width}x${screen.height} · janela ${innerWidth}x${innerHeight}`];
    box.textContent = 'Testando… (mantenha o aparelho deitado e parado)';
    const miniatura = (blob, legenda) => { const f = document.createElement('figure'); f.style.cssText = 'margin:0;width:46%'; const i = document.createElement('img'); i.src = URL.createObjectURL(blob); i.style.cssText = 'width:100%;border:1px solid #888'; const c = document.createElement('figcaption'); c.style.fontSize = '11px'; c.textContent = legenda; f.append(i, c); gal.append(f); };
    for (const [w, h] of [[1920, 1080], [3840, 2160], [4032, 3024]]) {
      let s;
      try { s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: w }, height: { ideal: h } } }); } catch (e) { L.push(`${w}x${h}: erro ${e.name}`); continue; }
      try {
        const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = s; await v.play().catch(() => {}); await new Promise((r) => setTimeout(r, 1200));
        const tempos = []; let blob;
        for (let i = 0; i < 3; i++) {
          const t0 = performance.now(), c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
          c.getContext('2d').drawImage(v, 0, 0); blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9)); tempos.push(performance.now() - t0);
        }
        L.push(`${w}x${h}: quadro ${v.videoWidth}x${v.videoHeight}, ${Math.round(tempos.reduce((a, b) => a + b) / 3)} ms por foto, ${Math.round(blob.size / 1024)} KB`);
        miniatura(blob, `quadro ${v.videoWidth}x${v.videoHeight}`);
        if (typeof ImageCapture !== 'undefined') {
          try {
            const t0 = performance.now(), pb = await new ImageCapture(s.getVideoTracks()[0]).takePhoto(), dt = performance.now() - t0;
            const bm = await createImageBitmap(pb, { imageOrientation: 'from-image' });
            L.push(`   takePhoto: ${bm.width}x${bm.height}, ${Math.round(dt)} ms, ${Math.round(pb.size / 1024)} KB`); miniatura(pb, `takePhoto ${bm.width}x${bm.height}`);
          } catch (e) { L.push(`   takePhoto: erro ${e.name}`); }
        }
      } finally { s.getTracks().forEach((t) => t.stop()); }
    }
    box.textContent = L.join('\n');
  },
  async publicarNuvem() {
    toast('Enviando…', 4000);
    await Nuvem.publicar(S.V);
    toast('Vistoria na nuvem. Agora ela aparece nos outros aparelhos.', 4000);
    S.redraw();
  },
  async dividir() {
    const ids = [...document.querySelectorAll('[data-eqsel]:checked')].map((x) => x.dataset.eqsel);
    if (!ids.length) return toast('Marque pelo menos uma pessoa');
    Nuvem.dividirAmbientes(S.V.ambientes, ids, S.V.responsavel || S.euId);
    await Nuvem.membrosDe(S.V, S.V.ambientes.map((a) => a.dono));
    await reler();
    toast('Ambientes divididos');
  },
  async enviarDrive() {
    if (!confirm('Enviar as fotos e vídeos desta vistoria ao Google Drive?\n\nDepois do envio eles saem do armazenamento da nuvem (ficam só as miniaturas). Os outros aparelhos precisam ter terminado de sincronizar.')) return;
    toast('Enviando ao Drive…', 4000);
    try {
      const r = await Nuvem.enviarAoDrive(S.V, (p) => toast(`Drive: ${p.enviados} enviadas, faltam ${p.restantes}…`, 4000));
      const parcial = r.restantes || r.semNome;
      toast(parcial
        ? `Parcial: ${r.total} enviadas.${r.semNome ? ' ' + r.semNome + ' mídia(s) ainda em outro aparelho.' : ''} Toque de novo quando todos terminarem de sincronizar.`
        : `✔ ${r.total} mídia(s) no Drive`, 7000);
    } catch (e) { toast('Drive: ' + e.message, 8000); }
    S.redraw();
  },
  async testarDrive() {
    try { const r = await Nuvem.testarDrive(); toast(`Conectado ao Drive de ${r.drive?.user?.emailAddress || ''}`, 5000); }
    catch (e) { toast('Drive: ' + e.message, 8000); }
  },
  async enviarFotos() {
    toast('Enviando fotos…', 3000);
    try { await Nuvem.empurrar(); await Nuvem.empurrarMidias(S.V); toast('Fotos sincronizadas'); } catch (e) { toast('Falha: ' + e.message, 4000); }
    S.redraw();
  },
  async baixarOrig() {
    try {
      const n = await Nuvem.baixarOriginais(S.V, (i, t) => toast(`Baixando originais ${i}/${t}…`, 4000));
      toast(`${n} original(is) baixado(s). Agora o ZIP está liberado.`, 4000);
    } catch (e) { toast('Falha ao baixar: ' + e.message, 5000); }
    S.redraw();
  },
  async ambConcluir() { const a = achaAmb(S.curAmbId); a.concluido = !a.concluido; await reler(); },
  modeloNovo() { const n = prompt('Nome do novo modelo de ambiente:', ''); if (n && n.trim()) location.hash = '#/modelos/' + Mod.novoModelo(n.trim()); },
};

async function pushCard() {
  const el = document.getElementById('pushcard');
  if (!el) return;
  const e = await Push.estado();
  const txt = {
    ativo: ['Ativados neste aparelho: você recebe aviso de validação pendente, laudo pronto, assinatura concluída, contestação e novos pedidos.', 'Desativar os avisos'],
    inativo: ['Receba no celular o aviso de validação pendente, laudo pronto, assinatura concluída, contestação e novos pedidos.', 'Ativar os avisos'],
    negado: ['As notificações estão bloqueadas neste navegador. Libere em Configurações do navegador › Notificações e volte aqui.', null],
    instalar: ['No iPhone, os avisos só funcionam com o app instalado: Compartilhar › “Adicionar à Tela de Início”. Abra pelo ícone e volte aqui.', null],
    indisponivel: ['Este navegador não oferece avisos no celular.', null],
  }[e];
  el.innerHTML = `<b>🔔 Avisos no celular</b><p class="muted">${txt[0]}</p>${txt[1] ? `<button class="btn ${e === 'ativo' ? '' : 'primary'}" data-act="pushToggle">${txt[1]}</button>` : ''}`;
}
const ACTS_VOZ = {
  testarVoz() { Voice.desbloquear(); setTimeout(() => Voice.testarVoz(), 120); return 'sair'; },
  async pushToggle() {
    try {
      if ((await Push.estado()) === 'ativo') { await Push.desativar(); toast('Avisos desativados'); } else { await Push.ativar(); toast('✔ Avisos ativados neste aparelho', 4000); }
    } catch (e) { toast(e.message, 6000); }
    pushCard();
    return 'sair';
  },
};

function sheetItem(it, a) {
  const novo = !!S.edit.novo;
  abreOverlay(`<div class="sheet"><h2>${novo ? 'Novo item' : 'Editar item'}</h2>
    <label>Nome do elemento<input id="e-nome" value="${esc(it.nome)}" placeholder="Ex.: Ar-condicionado split"></label>
    ${S.edit.paiId ? '' : `<label>Categoria<select id="e-cat">${CATS.map(([c, n]) => `<option value="${c}" ${(it.cat || 'item') === c ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`}
    <label class="chk"><input type="checkbox" id="e-q" ${it.q ? 'checked' : ''}> Tem quantidade (contável)</label>
    <label class="chk"><input type="checkbox" id="e-t" ${it.t ? 'checked' : ''}> Exige verificação de funcionamento</label>
    <label class="chk"><input type="checkbox" id="e-p" ${it.p ? 'checked' : ''}> Superfície pintada (aceita Pintura nova)</label>
    <label class="chk"><input type="checkbox" id="e-g" ${it.g ? 'checked' : ''}> Só registro fotográfico (sem condição)</label>
    <button class="btn primary big" data-act="salvarItem">Salvar</button><button class="btn" data-act="fechar">Cancelar</button></div>`);
}

function baixar() {
  if (!S.lastZip) return;
  const u = URL.createObjectURL(S.lastZip.blob);
  const a = document.createElement('a');
  a.href = u; a.download = S.lastZip.nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}

async function despachar(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return false;
  const act = el.dataset.act;
  const fn = ACTS[act] || Mod.ACTS[act] || Wiz.ACTS[act] || Cont.ACTS[act] || Fluxo.ACTS[act] || ACTS_VOZ[act];
  if (!fn) return false;
  try {
    const r = await fn(el, e);
    if (!ACTS[act] && r !== 'sair') S.redraw();
  } catch (err) { console.error(err); toast('Erro: ' + err.message, 4000); }
  return true;
}
$app.addEventListener('click', despachar);
$ov.addEventListener('click', async (e) => { if (!(await despachar(e)) && e.target === $ov) fechaOverlay(); });

$app.addEventListener('change', async (e) => {
  const el = e.target;
  try {
    if (el.dataset.w) { Wiz.onChange(el); return; }
    if (el.dataset.ed) { Mod.editarCampo(el); return; }
    const k = el.dataset.chg;
    if (!k) return;
    if (k.startsWith('dono:')) { await Nuvem.atribuir(S.V, k.slice(5), el.value); S.redraw(); return; }
    if (k === 'meuNome') { await Nuvem.atualizarPerfil(S.euId, { nome: el.value.trim() }); Nuvem.N.perfil.nome = el.value.trim(); toast('Nome salvo'); return; }
    if (k.startsWith('pnome:')) { await Nuvem.atualizarPerfil(k.slice(6), { nome: el.value.trim() }); toast('Salvo'); return; }
    if (k.startsWith('ppapel:')) { await Nuvem.atualizarPerfil(k.slice(7), { papel: el.value }); toast('Papel atualizado'); return; }
    if (k.startsWith('pativo:')) { await Nuvem.atualizarPerfil(k.slice(7), { ativo: el.checked }); toast(el.checked ? 'Acesso ativado' : 'Acesso desativado'); return; }
    if (k === 'cfgVist') { cfg.vistoriador = el.value.trim(); salvarCfg(); return; }
    if (k === 'cfgRapido') { cfg.rapido = el.value === '1'; salvarCfg(); toast(cfg.rapido ? 'Passeio rápido ligado' : 'Passeio completo'); return; }
    if (k === 'cfgPx') { cfg.maxPx = Number(el.value); salvarCfg(); toast('Vale para as próximas fotos'); return; }
    if (k === 'cfgFalar') { cfg.falar = el.checked; salvarCfg(); return; }
    if (k === 'cfgVoz') { cfg.voz = el.value || ''; salvarCfg(); return; }
    if (k === 'cfgVel') { cfg.velFala = Number(el.value); salvarCfg(); return; }
    if (k === 'cfgAuto') { cfg.auto = el.checked; salvarCfg(); return; }
    if (k === 'cfgCmd') { cfg.comandos = el.checked; salvarCfg(); return; }
    if (k === 'cfgRes') { cfg.camRes = Number(el.value); salvarCfg(); toast('Vale na próxima vez que abrir o passeio'); return; }
    if (k === 'cfgVid') { cfg.maxVideos = Math.max(0, Number(el.value) || 0); salvarCfg(); return; }
    if (k.startsWith('c:')) { (S.V.condicoes ||= {})[k.slice(2)] = el.value.trim(); await salvarV(); return; }
    if (k.startsWith('g:')) { (S.V.geral ||= {})[k.slice(2)] = el.value.trim(); await salvarV(); return; }
    const { it } = ctxItem(el);
    if (!it) return;
    if (k === 'qtd') it.qtd = el.value === '' ? null : Math.max(0, parseInt(el.value, 10) || 0);
    if (k === 'obs') { it.obs = el.value.trim(); await salvarV(); S.redraw(); return; }
    if (k === 'ident') it.ident = el.value.trim();
    if (k === 'leitura') it.leitura = el.value.trim();
    if (k === 'divtxt') { (it.diverg ||= {}).texto = el.value.trim(); }
    await salvarV();
  } catch (err) { toast('Erro: ' + err.message, 4000); }
});

/* ---------- voz ---------- */
async function listenSafe() {
  try { return await Voice.listen(); } catch (e) { toast('Microfone indisponível: ' + e.message, 4000); return []; }
}
async function ditar() {
  toast('Fale agora…', 8000);
  const alts = await listenSafe();
  document.getElementById('toast').classList.remove('on');
  if (!alts[0]) toast('Não ouvi nada');
  return alts[0] || '';
}
const vbar = (t) => { const b = document.getElementById('vbar'); if (b) { b.hidden = !t; b.innerHTML = t ? `<span>${esc(t)}</span><button class="btn" data-act="pararVoz">Parar</button>` : ''; } };
function stopVoice() { if (S.voz) { S.voz.stop = true; Voice.cancelar(); } }

async function runVoice(a) {
  if (S.voz) return;
  const run = (S.voz = { stop: false });
  const pend = lista(a).map((x) => x.it).filter((i) => !i.na && !i.g && ((i.m && !i.ident && !i.leitura) || (!i.m && !i.cond)));
  if (!pend.length) { S.voz = null; return toast('Nada pendente neste ambiente'); }
  for (const it of pend) {
    if (run.stop) break;
    const cat = CATS.find((c) => c[0] === (it.cat || 'item'))[0];
    if (S.tab !== cat) { S.tab = cat; S.redraw(); }
    document.querySelector(`[data-item="${it.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (it.m) {
      vbar(`🎙 ${it.nome}: número e leitura`);
      await Voice.speak(`${it.nome}. Diga o número do medidor.`);
      let alts = await Voice.listen().catch(() => []);
      if (run.stop) break;
      if (alts[0]) it.ident = alts[0].replace(/\s+/g, '');
      await Voice.speak('Diga a leitura.');
      alts = await Voice.listen().catch(() => []);
      if (alts[0]) it.leitura = alts[0].replace(/\s+/g, '');
      await salvarV(); S.redraw(); vbar(`🎙 ${it.nome}`);
      continue;
    }
    const pergunta = it.q ? `${it.nome}. Quantidade e condição?` : `${it.nome}. Condição?`;
    for (let t = 0; t < 2 && !run.stop; t++) {
      vbar(`🎙 ${pergunta}`);
      await Voice.speak(t ? 'Não entendi. Repita, por favor.' : pergunta);
      if (run.stop) break;
      let alts;
      try { alts = await Voice.listen(); } catch (e) { toast('Microfone indisponível: ' + e.message, 4000); run.stop = true; break; }
      const r = Voice.analisar(alts, it);
      if (r.cmd === 'PARAR') { run.stop = true; break; }
      if (r.cmd === 'PULAR') break;
      if (!r.na && !r.cond && r.qtd == null && !r.verif) continue;
      if (r.na) it.na = true;
      if (r.cond) it.cond = r.cond;
      if (r.qtd != null) it.qtd = r.qtd;
      if (r.verif) it.verif = r.verif;
      if (r.desc) it.obs = (it.obs ? it.obs + ' ' : '') + r.desc;
      await salvarV(); S.redraw(); vbar(`🎙 ${pergunta}`);
      if (it.cond === 'AVARIA' && !it.obs) {
        await Voice.speak('Descreva a avaria.');
        const d = await Voice.listen().catch(() => []);
        if (d[0]) { it.obs = Voice.limpar(d[0]); await salvarV(); S.redraw(); vbar(`🎙 ${pergunta}`); }
      }
      break;
    }
  }
  S.voz = null;
  vbar('');
  Voice.cancelar();
  toast(run.stop ? 'Modo voz encerrado' : 'Modo voz concluído');
}

/* ---------- inicialização ---------- */
navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator) {
  const tinhaControle = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('sw', e));
  // nova versão instalada: recarrega sozinho só na tela inicial (nunca no meio de uma vistoria)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinhaControle) return;
    if (/^#?\/?$/.test(location.hash)) location.reload();
    else toast('Nova versão instalada. Volte ao início para atualizar.', 5000);
  });
}
window.__ql = { S, addMidia, gerarZip, plano, lista, Voice, ACTS, route, Nuvem };
route();
// a nuvem inicia depois da primeira tela: o app nunca espera a internet para abrir
Nuvem.iniciar().then(() => { Nuvem.chip(); if (/^#?\/?$/.test(location.hash)) route(); }).catch((e) => console.warn('nuvem', e));
