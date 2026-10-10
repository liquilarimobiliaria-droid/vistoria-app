// Fluxo do laudo: ficha de abertura, revisão final, validação (substitui o checkpoint), pedidos de vistoria e etapas.
import { S, esc, fmtData, toast, labelCond, labelVerif, midiaDoItem, lista, itemFeito, faltaVerif, salvarV, gere, nMidiaAmb, achaAmb, achaItem } from './core.js';
import * as Nuvem from './nuvem.js';

/* ================= etapas (painel de andamento) ================= */
export const ETAPAS = {
  rascunho: ['Rascunho', 'muted'], campo: ['Em campo', 'warn'], enviando: ['Enviando ao Drive', 'warn'], analise: ['Em análise', 'warn'],
  validacao: ['Aguardando validação', 'bad'], laudo: ['Elaborando o laudo', 'warn'], pronto: ['Laudo pronto', 'okc'],
  assinatura: ['Em assinatura', 'warn'], assinado: ['Assinado', 'okc'], concluido: ['Concluída', 'okc'], erro: ['Erro na elaboração', 'bad'],
};
export function etapaHTML(p) {
  if (!p) return '';
  const [t, cls] = ETAPAS[p.etapa] || [p.etapa, 'muted'];
  const ate = p.contestar_ate && new Date(p.contestar_ate) > new Date() ? ` · contestação até ${new Date(new Date(p.contestar_ate).getTime() - 1).toLocaleDateString('pt-BR')}` : '';
  const ab = p.contestacoes_abertas ? ` · <b>${p.contestacoes_abertas} contestação(ões) em análise</b>` : '';
  return `<small class="${cls}">● ${t}${ate}${ab}</small>`;
}

/* ================= painel de acompanhamento (todas as vistorias, por etapa) ================= */
const GRUPOS = [
  ['acao', 'Precisa de você', ['validacao', 'pronto', 'erro']],
  ['proc', 'Em processamento', ['enviando', 'analise', 'laudo', 'assinatura']],
  ['campo', 'Em campo', ['rascunho', 'campo']],
  ['fim', 'Concluídas', ['assinado', 'concluido']],
];
const PROXIMO = {
  validacao: 'Abra a vistoria e confirme a validação para o laudo ser gerado.',
  pronto: 'Revise o laudo e, se estiver certo, aprove para assinatura.',
  erro: 'A elaboração falhou; veja o detalhe abaixo.',
  enviando: 'Aguardando as fotos chegarem ao Drive.',
  analise: 'O Claude está analisando as fotos e o roteiro.',
  laudo: 'O laudo está sendo gerado.',
  assinatura: 'Aguardando as assinaturas no ZapSign.',
  assinado: 'Assinado; pós-assinatura e prazo de contestação em andamento.',
};
let P = { rows: [], filtro: '', erro: '', em: 0, timer: null };
export const estadoPainel = P; // exposto para testes
export async function carregarPainel() {
  try { P.rows = await Nuvem.painelLista(); P.erro = ''; } catch (e) { P.erro = e.message; }
  P.em = Date.now();
}
export function pararPainel() { if (P.timer) { clearInterval(P.timer); P.timer = null; } }
export function iniciarPainel(redesenhar) {
  pararPainel();
  P.timer = setInterval(async () => { if (!location.hash.startsWith('#/painel')) return pararPainel(); await carregarPainel(); redesenhar(); }, 60000);
}
const desde = (t) => {
  if (!t) return '';
  const m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));
  return m < 1 ? 'agora' : m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} dias`;
};
const paradaH = (r) => {
  if (!['enviando', 'analise', 'laudo'].includes(r.etapa)) return 0;
  const t = r.fila_atualizado_em || r.fim_em;
  return t ? (Date.now() - new Date(t).getTime()) / 3600000 : 0;
};
export function htmlPainel() {
  const rows = P.rows.slice();
  const grupoDe = (r) => GRUPOS.find((g) => g[2].includes(r.etapa)) || GRUPOS[3];
  const cont = Object.fromEntries(GRUPOS.map((g) => [g[0], 0]));
  rows.forEach((r) => { cont[grupoDe(r)[0]]++; });
  const ordem = (r) => GRUPOS.indexOf(grupoDe(r));
  const vis = rows.filter((r) => !P.filtro || grupoDe(r)[0] === P.filtro)
    .sort((a, b) => ordem(a) - ordem(b) || new Date(b.fila_atualizado_em || b.vistoria_atualizado_em || 0) - new Date(a.fila_atualizado_em || a.vistoria_atualizado_em || 0));
  const card = (r) => {
    const [t, cls] = ETAPAS[r.etapa] || [r.etapa, 'muted'], h = paradaH(r);
    const quando = r.fila_atualizado_em || r.vistoria_atualizado_em;
    return `<div class="card pnl">
      <b>${esc(r.codigo)}</b><span>${esc(r.endereco)}</span>
      <small>${esc(r.tipo_vistoria)}${quando ? ' · atualizado há ' + desde(quando) : ''}</small>
      <small class="${cls}">● ${t}${r.contestacoes_abertas ? ` · <b>${r.contestacoes_abertas} contestação(ões) em análise</b>` : ''}</small>
      ${PROXIMO[r.etapa] ? `<small class="muted">${PROXIMO[r.etapa]}</small>` : ''}
      ${h > 3 ? `<small class="warn">⚠ parada há ${Math.round(h)} h. A tarefa do laudo roda das 7h às 20h; se persistir, avise o suporte.</small>` : ''}
      ${r.fila_detalhe && ['erro', 'validacao', 'pronto'].includes(r.etapa) ? `<small class="muted">${esc(r.fila_detalhe)}</small>` : ''}
      ${r.contestar_ate && new Date(r.contestar_ate) > new Date() ? `<small class="muted">Contestação até ${new Date(new Date(r.contestar_ate).getTime() - 1).toLocaleDateString('pt-BR')}</small>` : ''}
      <div class="tools"><button class="btn" data-act="abrirNuvem" data-id="${r.id}">Abrir</button>
        ${r.laudo_url ? `<a class="btn" href="${esc(r.laudo_url)}" target="_blank" rel="noopener">Laudo</a>` : ''}
        ${r.publica_url ? `<a class="btn" href="${esc(r.publica_url)}" target="_blank" rel="noopener">Pasta pública</a>` : ''}</div></div>`;
  };
  return `<header class="top"><button class="ico" data-act="go" data-go="#/">‹</button><h1>Acompanhamento</h1><button class="ico" data-act="painelAtualizar" aria-label="Atualizar">⟳</button></header>
    <main>
      ${P.erro ? `<p class="warn">Não consegui ler a nuvem: ${esc(P.erro)}</p>` : ''}
      <div class="chips pnl-cnt">
        <button data-act="painelFiltro" data-f="" class="${P.filtro === '' ? 'on V' : ''}">Todas · ${rows.length}</button>
        ${GRUPOS.map((g) => `<button data-act="painelFiltro" data-f="${g[0]}" class="${P.filtro === g[0] ? 'on V' : ''}">${g[1]} · ${cont[g[0]]}</button>`).join('')}</div>
      <p class="muted">Atualiza sozinho a cada minuto${P.em ? ' · última leitura ' + new Date(P.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}.</p>
      ${vis.length ? vis.map(card).join('') : '<p class="muted">Nenhuma vistoria nesta etapa.</p>'}
    </main>`;
}

/* ================= ficha de abertura (antes do passeio) ================= */
const OPC = { ocupacao: ['Desocupado', 'Mobiliado', 'Parcialmente mobiliado'], energia: ['Ligada', 'Desligada'], agua: ['Ligada', 'Desligada'], medidores: ['Sim', 'Não'] };
const ROT = { ocupacao: 'Ocupação do imóvel', energia: 'Energia elétrica', agua: 'Água', medidores: 'Há medidores para registrar?' };
export const aberturaFeita = (V) => !!V.geral?.abertura;
const valorAb = (V, k) => (k === 'medidores' ? V.geral?.medidores : V.condicoes?.[k]) || '';

export function htmlAbertura(V, daqui) {
  const grupo = (k) => `<div class="card"><b>${ROT[k]}</b><div class="chips">${OPC[k].map((o) => `<button data-act="abSet" data-k="${k}" data-v="${o}" class="${valorAb(V, k) === o ? 'on V' : ''}">${o}</button>`).join('')}</div></div>`;
  return `
    <header class="top"><button class="ico" data-act="go" data-go="#/v/${V.id}">‹</button><h1>Ficha de abertura</h1></header>
    <main>
      <p class="muted">Antes de começar, registre as condições do imóvel neste momento. Isso vai direto para a metodologia do laudo, e ninguém precisa perguntar depois.</p>
      ${grupo('ocupacao')}${grupo('energia')}${grupo('agua')}
      <div class="card"><b>Chaves, controles e tags recebidos</b>
        <label>Chaves<input data-chg="g:chaves" value="${esc(V.geral?.chaves || '')}" placeholder="Ex.: 5 chaves, sendo 4 comuns e 1 tetra"></label>
        <label>Controles / tags (opcional)<input data-chg="g:controles" value="${esc(V.geral?.controles || '')}"></label></div>
      ${grupo('medidores')}
      <button class="btn primary big" data-act="abOk" data-passeio="${daqui ? 1 : ''}">${daqui ? 'Salvar e iniciar o passeio ▶' : 'Salvar'}</button>
    </main>`;
}

/* ================= revisão final (antes de finalizar) ================= */
export function analisar(V) {
  const R = { semCond: [], avaria: [], medidor: [], extra: [], semFoto: [], verticais: 0, fracas: 0, abertura: !aberturaFeita(V), outros: [], semDetalhe: [] };
  V.ambientes.forEach((a, ai) => {
    const link = `#/v/${V.id}/a/${a.id}`, nome = `A${String(ai + 1).padStart(3, '0')} ${a.nome}`;
    const falta = [];
    for (const { it } of lista(a)) {
      if (it.na) continue;
      const fotos = midiaDoItem(it.id).length || it.nf || 0, tem = (t) => !!t && t.trim().length >= 3;
      if (!itemFeito(it) || faltaVerif(it)) falta.push(it.nome);
      if ((it.cond === 'AVARIA' && (fotos < 2 || !tem(it.obs))) || (it.cond === 'REGULAR' && !tem(it.obs))) R.avaria.push({ nome, link, item: it.nome });
      if (it.m && (!fotos || !it.leitura)) R.medidor.push({ nome, link, item: it.nome });
      if (it.nomePend) R.extra.push({ nome, link, item: it.nome });
      if (it.semDetalhe) R.semDetalhe.push({ nome, link, item: it.nome });
    }
    if (falta.length) R.semCond.push({ nome, link, n: falta.length, itens: falta.slice(0, 4) });
    if (!nMidiaAmb(a.id) && !a.itens.every((i) => i.na)) R.semFoto.push({ nome, link });
    if (V.nuvem && a.dono && a.dono !== S.euId && !a.concluido) R.outros.push({ nome, link, quem: Nuvem.nomeDe(a.dono) });
  });
  R.verticais = S.FOTOS.filter((f) => f.vertical).length;
  R.fracas = S.FOTOS.filter((f) => f.q?.flags?.length).length;
  return R;
}
export function htmlRevisao(V) {
  const R = analisar(V);
  const sec = (titulo, itens, linha, ok) => (itens.length || ok === false
    ? `<div class="card"><b>${titulo} <span class="warn">(${itens.length})</span></b>${itens.map(linha).join('')}</div>` : '');
  const lk = (x, extra = '') => `<a class="lnk" href="${x.link}">${esc(x.nome)}${extra}</a><br>`;
  const total = R.semCond.reduce((s, x) => s + x.n, 0) + R.avaria.length + R.medidor.length + R.extra.length + R.semFoto.length + R.verticais + R.outros.length + (R.abertura ? 1 : 0);
  return `
    <header class="top"><button class="ico" data-act="go" data-go="#/v/${V.id}">‹</button><h1>Revisão final</h1></header>
    <main>
      <div class="card ${total ? 'aviso-l' : ''}"><b>${total ? `${total} ponto(s) para conferir antes de finalizar` : '✔ Tudo certo para finalizar'}</b>
        <p class="muted">Toque no ambiente para corrigir. Você pode finalizar mesmo com pendências, mas o laudo sai mais rápido quando elas são resolvidas agora.</p></div>
      ${R.abertura ? `<div class="card"><b>Ficha de abertura <span class="warn">(pendente)</span></b><a class="lnk" href="#/v/${V.id}/abertura">Preencher agora</a></div>` : ''}
      ${sec('Itens sem condição ou verificação', R.semCond, (x) => lk(x, ` — ${x.n} item(ns): ${esc(x.itens.join(', '))}${x.n > 4 ? '…' : ''}`))}
      ${sec('Avarias/regulares sem foto de detalhe ou descrição', R.avaria, (x) => lk(x, ` — ${esc(x.item)}`))}
      ${sec('Medidores sem foto ou leitura', R.medidor, (x) => lk(x, ` — ${esc(x.item)}`))}
      ${sec('Registros extras sem nome', R.extra, (x) => lk(x, ` — ${esc(x.item)}`))}
      ${sec('Ambientes sem nenhuma foto', R.semFoto, (x) => lk(x))}
      ${R.verticais ? `<div class="card"><b>Fotos na vertical <span class="warn">(${R.verticais})</span></b><p class="muted">Abra a foto no ambiente e toque em “↻ Girar”, ou refaça na horizontal.</p></div>` : ''}
      ${R.fracas ? `<div class="card"><b>Fotos possivelmente tremidas ou escuras <span class="warn">(${R.fracas})</span></b><p class="muted">Procure o selo ≈ (tremida), ☾ (escura) ou ☀ (estourada) nas miniaturas e refaça as que precisarem.</p></div>` : ''}
      ${sec('Ambientes de outros vistoriadores ainda não concluídos', R.outros, (x) => lk(x, ` — ${esc(x.quem)}`))}
      ${R.semDetalhe.length ? `<div class="card"><b>Seguiu sem o detalhe pedido <span class="warn">(${R.semDetalhe.length})</span></b>${R.semDetalhe.map((x) => lk(x, ` — ${esc(x.item)}`)).join('')}</div>` : ''}
      ${gere() && V.inicioEm && !V.fimEm ? '<button class="btn dark big" data-act="finalizarOk">Finalizar vistoria</button>' : ''}
      <button class="btn" data-act="go" data-go="#/v/${V.id}">Voltar à vistoria</button>
    </main>`;
}

/* ================= validação do laudo (substitui o checkpoint) ================= */
let E = { laudo: null, sug: [], erro: '' };
export async function carregarValidacao(V) {
  E = { laudo: null, sug: [], erro: '' };
  try { [E.laudo, E.sug] = await Promise.all([Nuvem.estadoLaudo(V), Nuvem.listarSugestoes(V)]); } catch (e) { E.erro = e.message; }
}
const TXT_ESTADO = {
  aguardando: 'O Claude vai começar a analisar as fotos em instantes. Volte em alguns minutos.',
  em_elaboracao: 'O Claude está analisando as fotos e o roteiro. Volte em alguns minutos.',
  validado: 'Validação registrada. O laudo está sendo elaborado.', gerando: 'O laudo está sendo gerado.',
  pronto: 'O laudo está pronto.', aprovado: 'Laudo aprovado, indo para assinatura.', em_assinatura: 'Aguardando as assinaturas.',
  assinado: 'Laudo assinado.', concluido: 'Vistoria concluída.', erro: 'Houve um erro na elaboração.',
};
const alvo = (s) => { const a = s.ambiente_id && achaAmb(s.ambiente_id), it = a && s.item_id ? achaItem(a, s.item_id) : null; return { a, it }; };
const ROT_SUG = { qtd: 'Quantidade', ident: 'Nº do medidor', leitura: 'Leitura', obs: 'Descrição', pergunta: 'Pergunta' };

function cartaoSugestao(s) {
  const { a, it } = alvo(s);
  const onde = a ? `${esc(a.nome)}${it ? ' › ' + esc(it.nome) : ''}` : 'Geral';
  const resp = s.estado !== 'pendente';
  const sel = s.estado === 'aceita' ? 'Aceita' : s.estado === 'editada' ? 'Corrigida' : s.estado === 'recusada' ? 'Recusada' : '';
  const p = s.proposta || {};
  let corpo;
  if (s.tipo === 'pergunta') {
    corpo = `<p>${esc(s.pergunta)}</p><label class="fld"><textarea id="sg-${s.id}" rows="2" placeholder="Sua resposta">${esc(s.resposta?.texto || '')}</textarea></label>
      <div class="tools"><button class="btn primary" data-act="sugResponder" data-id="${s.id}">Responder</button></div>`;
  } else {
    const val = p.valor ?? p.texto ?? '';
    corpo = `<p>${ROT_SUG[s.tipo]} sugerida: <b>${esc(val)}</b>${s.tipo === 'qtd' && it?.qtd != null ? ` <small>(atual: ${esc(it.qtd)})</small>` : ''}</p>
      ${s.motivo ? `<small class="muted">${esc(s.motivo)}</small>` : ''}
      <label class="fld"><input id="sg-${s.id}" value="${esc(s.resposta?.valor ?? s.resposta?.texto ?? val)}" ${s.tipo === 'qtd' ? 'type="number" inputmode="numeric" min="0"' : ''}></label>
      <div class="tools"><button class="btn primary" data-act="sugAceitar" data-id="${s.id}">Aceitar</button><button class="btn" data-act="sugCorrigir" data-id="${s.id}">Corrigir e aceitar</button><button class="btn" data-act="sugRecusar" data-id="${s.id}">Recusar</button></div>`;
  }
  return `<div class="card" data-sid="${s.id}"><b>${onde}</b>${resp ? `<small class="okc"> · ${sel || 'Respondida'}</small>` : ''}${corpo}</div>`;
}

export function htmlValidacao(V) {
  const e = E.laudo, est = e?.estado;
  if (E.erro) return cab(V) + `<main><div class="aviso-l">${esc(E.erro)}</div></main>`;
  if (est !== 'aguardando_validacao') {
    return cab(V) + `<main><div class="card"><b>${est ? esc(TXT_ESTADO[est] || est) : 'Esta vistoria ainda não entrou na fila do laudo.'}</b>
      ${est ? '' : '<p class="muted">Ela entra sozinha quando estiver finalizada e com todas as fotos no Drive.</p>'}
      ${e?.validado_em ? `<p class="muted">Validado em ${fmtData(new Date(e.validado_em).getTime())}.</p>` : ''}
      ${e?.publica_url ? `<p><a class="lnk" href="${esc(e.publica_url)}" target="_blank" rel="noopener">Abrir a pasta pública de autenticidade e fotos</a></p>` : ''}
      ${est === 'validado' && !e?.publica_url ? '<button class="btn primary" data-act="pubPasta">Criar a pasta pública agora</button>' : ''}
      </div><button class="btn" data-act="go" data-go="#/v/${V.id}">Voltar</button></main>`;
  }
  const c = V.condicoes || {}, g = V.geral || {};
  const pend = E.sug.filter((s) => s.estado === 'pendente').length;
  const naoTest = [];
  V.ambientes.forEach((a) => lista(a).forEach(({ it }) => { if (!it.na && it.t && (it.verif === 'NAO_TESTADO' || it.verif === 'NAO_ACESSIVEL')) naoTest.push(`${a.nome} › ${it.nome} (${labelVerif(it.verif)})`); }));
  return cab(V) + `<main>
    <div class="card"><b>O Claude analisou as fotos e o roteiro.</b>
      <p class="muted">Confira as sugestões abaixo, complemente o que faltar e confirme. Depois da sua confirmação o laudo é elaborado.</p></div>
    <div class="card"><b>Condições registradas na abertura</b>
      <small>Ocupação: ${esc(c.ocupacao || '—')} · Energia: ${esc(c.energia || '—')} · Água: ${esc(c.agua || '—')}${g.chaves ? ' · Chaves: ' + esc(g.chaves) : ''}</small>
      <a class="lnk" href="#/v/${V.id}/abertura">Editar</a></div>
    <h2>Sugestões e perguntas${pend ? ` · ${pend} sem resposta` : ''}</h2>
    ${E.sug.length ? E.sug.map(cartaoSugestao).join('') : '<p class="muted">O Claude não teve dúvidas nem sugestões nesta vistoria.</p>'}
    ${naoTest.length ? `<div class="card"><b>Itens não testados / sem acesso</b><small>${naoTest.map(esc).join('<br>')}</small>
      <p class="muted">No laudo ficam como “não testado”/“não acessível”. Se algum foi testado, corrija a verificação no ambiente.</p></div>` : ''}
    <div class="card"><b>Antes de gerar o laudo, há algo que você quer alterar, acrescentar ou retirar?</b>
      <label class="fld"><textarea id="v-obs" rows="3" placeholder="Opcional"></textarea></label></div>
    <button class="btn primary big" data-act="valConfirmar">Confirmo, gerar o laudo</button>
    <button class="btn" data-act="go" data-go="#/v/${V.id}">Voltar</button>
  </main>`;
}
const cab = (V) => `<header class="top"><button class="ico" data-act="go" data-go="#/v/${V.id}">‹</button><h1>Validação do laudo</h1></header>`;

/* ================= cartão do laudo no menu da vistoria ================= */
// pontos de atenção que o gerador/Claude registram no detalhe do laudo: "... ATENÇÃO: ponto 1 | ponto 2"
const pendenciasDe = (d) => (String(d || '').includes('ATENÇÃO:') ? String(d).split('ATENÇÃO:')[1].split(' | ').map((x) => x.trim()).filter(Boolean) : []);
export function laudoCard(V) {
  Nuvem.estadoLaudo(V).then((e) => {
    const el = document.getElementById('laudocard');
    if (!el) return;
    const est = e?.estado, pode = gere();
    const link = (u, t) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">${t}</a>`;
    const partes = [];
    if (!est) partes.push('<p class="muted">📝 O laudo entra na fila quando a vistoria estiver finalizada e com todas as fotos no Drive.</p>');
    else {
      partes.push(`<p>📝 <b>Laudo:</b> ${esc(TXT_ESTADO[est] || est)}${est === 'erro' ? ' ' + esc(e.detalhe || '') : ''}</p>`);
      if (est === 'aguardando_validacao') partes.push(`<div class="tools"><button class="btn primary" data-act="go" data-go="#/v/${V.id}/validacao">Validar o laudo</button></div>`);
      if (est === 'validado' && !e.publica_url) partes.push('<div class="tools"><button class="btn" data-act="pubPasta">Criar a pasta pública</button></div>');
      if (est === 'pronto') {
        const pend = pendenciasDe(e.detalhe);
        if (pend.length) partes.push(`<div class="card pend"><b class="warn">⚠ Pontos de atenção antes de aprovar</b><ul>${pend.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><small class="muted">Confira o laudo e, se estiver de acordo, aprove. O Claude seguiu a regra definida para esses casos.</small></div>`);
        partes.push(`<div class="tools">${e.laudo_url ? link(e.laudo_url, 'Abrir o laudo') : ''}${pode ? '<button class="btn primary" data-act="aprovarAssinatura">Aprovar e enviar para assinatura</button>' : ''}</div>`);
      }
      if (e.publica_url) partes.push(`<div class="tools">${link(e.publica_url, 'Pasta pública (QR)')}</div>`);
      if (est === 'assinado' || est === 'concluido') partes.push(`<div class="tools"><button class="btn" data-act="go" data-go="#/v/${V.id}/contestacoes">Contestações</button></div>`);
    }
    el.innerHTML = partes.join('');
  }).catch(() => {});
  return '<div class="card" id="laudocard"><p class="muted">Carregando o estado do laudo…</p></div>';
}

/* ================= pedidos de vistoria (home) ================= */
export async function carregarPedidos() {
  const box = document.getElementById('pedidos');
  if (!box || !Nuvem.logado() || !navigator.onLine) return;
  try {
    const ps = await Nuvem.listarPedidos();
    if (!document.getElementById('pedidos')) return;
    box.innerHTML = ps.length ? '<h2>Pedidos de vistoria</h2>' + ps.map((p) => {
      const d = p.dados || {};
      return `<button class="card vcard" data-act="abrirPedido" data-id="${p.id}"><b>📋 ${esc(d.endereco || 'Pedido')}</b>
        <small>${esc(d.tipoVistoria || 'Entrada')} · ${esc(d.tipoNome || d.tipoKey || '')}${p.agendada_para ? ' · ' + fmtData(new Date(p.agendada_para).getTime()) : ''}</small>
        ${d.observacoes ? `<small>${esc(d.observacoes)}</small>` : ''}<small class="warn">Toque para criar a vistoria já preenchida</small></button>`;
    }).join('') : '';
  } catch { /* sem pedidos ou sem conexão */ }
}

/* ================= ações ================= */
const aplicar = async (s, valor) => {
  const { a, it } = alvo(s);
  if (!a || !it) return;
  if (s.tipo === 'qtd') { it.q = true; it.qtd = Math.max(0, parseInt(valor, 10) || 0); }
  else if (s.tipo === 'ident') it.ident = String(valor);
  else if (s.tipo === 'leitura') it.leitura = String(valor);
  else if (s.tipo === 'obs') { const t = String(valor).trim(); if (t && !(it.obs || '').includes(t)) it.obs = it.obs ? `${it.obs}. ${t}` : t; }
  await salvarV();
};
const achar = (id) => E.sug.find((x) => x.id === id);
const campo = (id) => document.getElementById('sg-' + id)?.value ?? '';

export const ACTS = {
  painelFiltro(el) { P.filtro = el.dataset.f || ''; },
  async painelAtualizar() { await carregarPainel(); toast('Atualizado', 1500); },
  async abSet(el) {
    const k = el.dataset.k, v = el.dataset.v;
    if (k === 'medidores') (S.V.geral ||= {}).medidores = v; else (S.V.condicoes ||= {})[k] = v;
    await salvarV();
  },
  async abOk(el) {
    const V = S.V;
    const falta = ['ocupacao', 'energia', 'agua'].filter((k) => !V.condicoes?.[k]);
    if (falta.length) return toast('Marque: ' + falta.map((k) => ROT[k]).join(', '), 3500);
    (V.geral ||= {}).abertura = Date.now();
    // sem medidores: tira o ambiente de medidores se ninguém fotografou nada nele
    if (V.geral.medidores === 'Não') V.ambientes = V.ambientes.filter((a) => !(a.modelo === 'medidores' && !nMidiaAmb(a.id)));
    await salvarV();
    location.hash = el.dataset.passeio ? `#/v/${V.id}/passeio` : `#/v/${V.id}`;
    return 'sair';
  },
  async sugAceitar(el) { const s = achar(el.dataset.id); const v = s.proposta?.valor ?? s.proposta?.texto ?? ''; await aplicar(s, v); await Nuvem.responderSugestao(s.id, 'aceita', null); s.estado = 'aceita'; s.resposta = null; toast('Aceita'); },
  async sugCorrigir(el) { const s = achar(el.dataset.id); const v = campo(s.id); if (v === '') return toast('Informe o valor'); await aplicar(s, v); const r = s.tipo === 'obs' ? { texto: v } : { valor: v }; await Nuvem.responderSugestao(s.id, 'editada', r); s.estado = 'editada'; s.resposta = r; toast('Corrigida e aplicada'); },
  async sugRecusar(el) { const s = achar(el.dataset.id); await Nuvem.responderSugestao(s.id, 'recusada', null); s.estado = 'recusada'; s.resposta = null; toast('Recusada'); },
  async sugResponder(el) { const s = achar(el.dataset.id); const t = campo(s.id).trim(); if (!t) return toast('Escreva a resposta'); const r = { texto: t }; await Nuvem.responderSugestao(s.id, 'editada', r); s.estado = 'editada'; s.resposta = r; toast('Resposta registrada'); },
  async valConfirmar() {
    const V = S.V, pend = E.sug.filter((s) => s.estado === 'pendente').length;
    if (!confirm(`Confirmar a validação?${pend ? `\n\n${pend} sugestão(ões) sem resposta serão ignoradas.` : ''}\nDepois disso o laudo começa a ser elaborado.`)) return;
    const dados = {
      observacoes: document.getElementById('v-obs')?.value.trim() || '',
      ficha: { condicoes: V.condicoes || {}, chaves: V.geral?.chaves || '', medidores: V.geral?.medidores || '' },
      respostas: E.sug.filter((s) => s.tipo === 'pergunta' && s.resposta).map((s) => ({ pergunta: s.pergunta, resposta: s.resposta.texto })),
    };
    toast('Registrando a validação…', 4000);
    await Nuvem.confirmarValidacao(V, dados);
    toast('Validação registrada. Criando a pasta pública…', 4000);
    try { await Nuvem.publicarPasta(V, (p) => toast(`Pasta pública: ${p.copiados} copiadas, faltam ${p.restantes}…`, 3000)); toast('✔ Validado. Pasta pública pronta.', 5000); }
    catch (e) { toast('Validação ok. A pasta pública ficou pendente: ' + e.message, 9000); }
    location.hash = '#/v/' + V.id;
    return 'sair';
  },
  async pubPasta() {
    toast('Criando a pasta pública…', 4000);
    try { await Nuvem.publicarPasta(S.V, (p) => toast(`Copiadas ${p.copiados}, faltam ${p.restantes}…`, 3000)); toast('✔ Pasta pública pronta', 5000); }
    catch (e) { toast('Falha: ' + e.message, 8000); }
    location.hash = '#/v/' + S.V.id;
    return 'sair';
  },
  async aprovarAssinatura() {
    const est = await Nuvem.estadoLaudo(S.V).catch(() => null), pend = pendenciasDe(est?.detalhe);
    const msg = pend.length
      ? `Antes de aprovar, confirme os pontos de atenção:\n\n• ${pend.join('\n• ')}\n\nAprovar e enviar para assinatura mesmo assim?`
      : 'Aprovar o laudo e enviar para assinatura?\n\nO Claude vai criar o documento no ZapSign e os signatários receberão o convite.';
    if (!confirm(msg)) return;
    await Nuvem.aprovarParaAssinatura(S.V);
    toast('Aprovado. O envio para assinatura começa em instantes.', 5000);
    location.hash = '#/v/' + S.V.id;
    return 'sair';
  },
};
