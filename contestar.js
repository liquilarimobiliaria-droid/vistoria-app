// Contestação do laudo pelo locatário: página pública (#/contestar/<token>) e painel do gerente (#/v/<id>/contestacoes).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { $app, S, esc, fmtData, labelCond, labelVerif, toast } from './core.js';
import * as Nuvem from './nuvem.js';

const ROT_STATUS = { aberta: 'Em análise', aceita: 'Aceita', rejeitada: 'Rejeitada', nova_vistoria: 'Nova vistoria' };
const fmtDia = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const fmtDH = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

/* ================= página pública do locatário ================= */
let P = null;

async function api(corpo) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/contestar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY }, body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || 'Sem conexão. Tente de novo.');
  return j;
}

export async function publico(token) {
  P = { token, d: null, aberto: null };
  document.title = 'Laudo de vistoria · LiquiLar';
  $app.innerHTML = '<main><p class="muted">Carregando o laudo…</p></main>';
  try { P.d = await api({ acao: 'ver', token }); } catch (e) {
    $app.innerHTML = `<header class="top"><img class="logo" src="img/logo-horizontal.png" alt="LiquiLar"></header><main><div class="card"><b>Não foi possível abrir este link.</b><p class="muted">${esc(e.message)} Confira o endereço que você recebeu ou peça um novo link à LiquiLar.</p></div></main>`;
    return;
  }
  desenhar();
}

function itemHTML(i, aberto) {
  const cond = i.na ? 'Não existe' : i.cond ? labelCond(i.cond, true) : '—';
  const ver = !i.na && i.verif ? ` · ${esc(labelVerif(i.verif, true))}` : '';
  return `<div class="item pc-item" data-pc-item="${esc(i.id)}">
    <div class="ih"><b>${i.paiId ? '↳ ' : ''}${esc(i.nome)}</b><small>${esc(cond)}${ver}</small></div>
    ${i.obs ? `<small>${esc(i.obs)}</small>` : ''}
    ${i.fotos.length ? `<div class="pc-fotos">${i.fotos.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" loading="lazy"></a>`).join('')}</div>` : ''}
    ${aberto ? `<button class="btn" data-pc="abrir" data-amb="__AMB__" data-item="${esc(i.id)}">Contestar este item</button>` : ''}
  </div>`;
}

function desenhar() {
  const { d } = P, v = d.vistoria, y = window.scrollY;
  const lembrado = (() => { try { return JSON.parse(localStorage.getItem('ql-loc') || '{}'); } catch { return {}; } })();
  $app.innerHTML = `
    <header class="top"><img class="logo" src="img/logo-horizontal.png" alt="LiquiLar"></header>
    <main>
      <div><div class="hero">Laudo de <em>vistoria</em></div>
        <p class="hero-sub">${esc(v.codigo)} · ${esc(v.endereco)}</p></div>
      <div class="card ${d.aberto ? '' : 'aviso-l'}">
        ${d.aberto
          ? `<b>Você pode contestar até ${fmtDia(new Date(new Date(d.expira_em).getTime() - 1))}.</b>
             <p class="muted">Confira o laudo abaixo. Se discordar de algum item, toque em “Contestar este item”, explique o motivo e, se quiser, anexe fotos. A LiquiLar analisa cada contestação e responde. O laudo original não é alterado.</p>`
          : `<b>${d.revogado ? 'Este link foi cancelado.' : 'O prazo para contestar terminou.'}</b><p class="muted">Você ainda pode consultar o laudo e as respostas abaixo.</p>`}
      </div>
      ${d.aberto ? `<div class="card"><b>Seus dados</b>
        <label class="fld">Nome completo<input id="pc-nome" autocomplete="name" value="${esc(lembrado.nome || '')}"></label>
        <label class="fld">E-mail (opcional)<input id="pc-email" type="email" autocomplete="email" value="${esc(lembrado.email || '')}"></label>
        <button class="btn" data-pc="abrir" data-amb="" data-item="">Contestação geral (não é sobre um item)</button></div>` : ''}
      ${d.contestacoes.length ? `<h2>Contestações enviadas</h2>${d.contestacoes.map((c) => `<div class="card"><b>${esc(c.ambiente_nome || 'Geral')}${c.item_nome ? ' › ' + esc(c.item_nome) : ''}</b>
        <small>${fmtDH(c.criado_em)} · <b>${ROT_STATUS[c.status] || c.status}</b></small><p>${esc(c.motivo)}</p>
        ${c.resposta ? `<p class="okc"><b>Resposta da LiquiLar:</b> ${esc(c.resposta)}</p>` : ''}</div>`).join('')}` : ''}
      <h2>Ambientes</h2>
      ${d.ambientes.map((a, n) => `<details class="card pc-amb" ${n === 0 ? 'open' : ''}><summary><b>${esc(a.nome)}</b></summary>
        ${a.itens.map((i) => itemHTML(i, d.aberto).replace('__AMB__', esc(a.id))).join('')}</details>`).join('')}
    </main>`;
  window.scrollTo(0, y);
}

// reduz a foto antes de enviar (máx. 1600 px, JPEG)
function reduzir(file) {
  return new Promise((ok, falha) => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(u);
      let q = 0.8, s = c.toDataURL('image/jpeg', q);
      while (s.length > 1_900_000 && q > 0.4) { q -= 0.1; s = c.toDataURL('image/jpeg', q); }
      ok(s);
    };
    img.onerror = () => { URL.revokeObjectURL(u); falha(new Error('Não consegui ler a foto.')); };
    img.src = u;
  });
}

function abrirForm(btn) {
  document.querySelectorAll('.pc-form').forEach((f) => f.remove());
  const f = document.createElement('div');
  f.className = 'pc-form card';
  f.dataset.amb = btn.dataset.amb; f.dataset.item = btn.dataset.item;
  f.innerHTML = `<b>${btn.dataset.item ? 'Contestar este item' : 'Contestação geral'}</b>
    <label class="fld">O que você discorda e por quê?<textarea id="pc-motivo" rows="4" maxlength="2000"></textarea></label>
    <label class="fld">Fotos (opcional, até 4)<input id="pc-fotos" type="file" accept="image/*" multiple></label>
    <div class="tools"><button class="btn primary" data-pc="enviar">Enviar contestação</button><button class="btn" data-pc="cancelar">Cancelar</button></div>
    <small id="pc-msg" class="muted"></small>`;
  btn.insertAdjacentElement('afterend', f);
  f.querySelector('textarea').focus();
}

async function enviar(btn) {
  const f = btn.closest('.pc-form'), msg = f.querySelector('#pc-msg');
  const nome = document.getElementById('pc-nome').value.trim(), email = document.getElementById('pc-email').value.trim();
  const motivo = f.querySelector('#pc-motivo').value.trim();
  if (nome.length < 2) { msg.textContent = 'Informe seu nome em “Seus dados”, no topo da página.'; return; }
  if (motivo.length < 5) { msg.textContent = 'Descreva o motivo da contestação.'; return; }
  btn.disabled = true; msg.textContent = 'Enviando…';
  try {
    const files = [...f.querySelector('#pc-fotos').files].slice(0, 4);
    const fotos = [];
    for (const x of files) fotos.push(await reduzir(x));
    await api({ acao: 'enviar', token: P.token, ambiente_id: f.dataset.amb || null, item_id: f.dataset.item || null, motivo, nome, email, fotos });
    try { localStorage.setItem('ql-loc', JSON.stringify({ nome, email })); } catch { /* sem armazenamento: tudo bem */ }
    P.d = await api({ acao: 'ver', token: P.token });
    desenhar();
    toast('Contestação enviada. Obrigado!', 4000);
  } catch (e) { msg.textContent = e.message; btn.disabled = false; }
}

$app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pc]');
  if (!b || !P) return;
  if (b.dataset.pc === 'abrir') abrirForm(b);
  else if (b.dataset.pc === 'cancelar') b.closest('.pc-form').remove();
  else if (b.dataset.pc === 'enviar') enviar(b);
});

/* ================= painel do gerente ================= */
let E = { link: null, lista: [], fotos: new Map(), carregando: false, erro: '' };

export async function carregar(V) {
  E = { link: null, lista: [], fotos: new Map(), carregando: false, erro: '' };
  try {
    [E.link, E.lista] = await Promise.all([Nuvem.linkContestacao(V), Nuvem.listarContestacoes(V)]);
    const caminhos = E.lista.flatMap((c) => c.fotos || []);
    E.fotos = await Nuvem.urlsContestacao(caminhos);
  } catch (e) { E.erro = e.message; }
}

const urlDoLink = (t) => `${location.origin}${location.pathname.replace(/index\.html$/, '')}#/contestar/${t}`;

export function htmlGestor(V) {
  const l = E.link, ativo = l && !l.revogado && Date.now() < new Date(l.expira_em).getTime();
  const abertas = E.lista.filter((c) => c.status === 'aberta').length;
  return `
    <header class="top"><button class="ico" data-act="go" data-go="#/v/${V.id}">‹</button><h1>Contestações</h1><span id="syncchip" class="chip"></span></header>
    <main>
      ${E.erro ? `<div class="aviso-l">${esc(E.erro)}</div>` : ''}
      <div class="card"><b>Link para o locatário</b>
        ${!V.fimEm ? '<p class="warn">Finalize a vistoria antes de gerar o link.</p>'
          : l ? `<p class="${ativo ? 'okc' : 'warn'}">${ativo ? '✔ Ativo' : l.revogado ? 'Cancelado' : 'Prazo encerrado'} · contestações até ${fmtDia(new Date(new Date(l.expira_em).getTime() - 1))}</p>
            <code class="pc-link">${esc(urlDoLink(l.token))}</code>
            <div class="tools"><button class="btn primary" data-act="contCopiar">Copiar link</button><button class="btn" data-act="contZap">WhatsApp</button>${ativo ? '<button class="btn" data-act="contRevogar">Cancelar link</button>' : ''}</div>`
          : '<p class="muted">Ainda não há link. O locatário terá 5 dias úteis, a partir da geração, para contestar.</p>'}
        ${V.fimEm ? `<button class="btn ${l ? '' : 'primary'}" data-act="contGerar">${l ? 'Gerar novo link (cancela o anterior)' : 'Gerar link de contestação'}</button>` : ''}
      </div>
      <h2>Contestações recebidas${abertas ? ` · ${abertas} em análise` : ''}</h2>
      ${E.lista.length ? E.lista.map((c) => `<div class="card cont" data-cid="${c.id}">
        <b>${esc(c.ambiente_nome || 'Geral')}${c.item_nome ? ' › ' + esc(c.item_nome) : ''}</b>
        <small>${esc(c.nome)}${c.email ? ' · ' + esc(c.email) : ''} · ${fmtDH(c.criado_em)}${c.ip ? ' · IP ' + esc(c.ip) : ''}</small>
        <p>${esc(c.motivo)}</p>
        ${(c.fotos || []).length ? `<div class="pc-fotos">${c.fotos.map((p) => E.fotos.get(p) ? `<a href="${esc(E.fotos.get(p))}" target="_blank" rel="noopener"><img src="${esc(E.fotos.get(p))}" alt=""></a>` : '').join('')}</div>` : ''}
        <label class="fld">Situação<select data-cf="status">${Object.entries(ROT_STATUS).map(([k, t]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="fld">Resposta ao locatário<textarea data-cf="resposta" rows="3" maxlength="2000">${esc(c.resposta || '')}</textarea></label>
        <button class="btn primary" data-act="contSalvar" data-id="${c.id}">Salvar resposta</button>
      </div>`).join('') : '<p class="muted">Nenhuma contestação recebida.</p>'}
    </main>`;
}

export const ACTS = {
  async contGerar() {
    const V = S.V;
    if (E.link && !E.link.revogado && !confirm('Gerar um novo link cancela o anterior. Continuar?')) return;
    await Nuvem.gerarLinkContestacao(V);
    await carregar(V);
    toast('Link gerado');
  },
  async contCopiar() {
    const u = urlDoLink(E.link.token);
    try { await navigator.clipboard.writeText(u); toast('Link copiado'); } catch { prompt('Copie o link:', u); }
  },
  contZap() {
    const V = S.V;
    const t = `Olá! Segue o laudo da vistoria do imóvel ${V.endereco}. Você pode conferir e contestar até ${fmtDia(new Date(new Date(E.link.expira_em).getTime() - 1))}: ${urlDoLink(E.link.token)}`;
    window.open('https://wa.me/?text=' + encodeURIComponent(t), '_blank', 'noopener');
  },
  async contRevogar() {
    if (!confirm('Cancelar o link? O locatário não poderá mais contestar.')) return;
    await Nuvem.revogarLinkContestacao(E.link.id);
    await carregar(S.V);
  },
  async contSalvar(el) {
    const card = el.closest('.cont');
    const status = card.querySelector('[data-cf=status]').value, resposta = card.querySelector('[data-cf=resposta]').value.trim();
    await Nuvem.responderContestacao(el.dataset.id, status, resposta);
    await carregar(S.V);
    toast('Resposta salva');
  },
};
