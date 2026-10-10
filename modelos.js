// Editor de modelos de ambiente (B4): o que o Devolus chama de "ambiente modelo", mas editável aqui no app.
import { catalogo, salvarModelo, restaurarModelo, modeloDeFabrica, CATS } from './templates.js';
import { esc, toast } from './core.js';

let ED = null; // { key, nome, itens: [spec com subs], novo }

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'modelo';
const novoItem = () => ({ nome: 'Novo item', cat: 'item', q: false, t: false, p: false, g: false, m: false, subs: [] });

export function htmlLista() {
  const cat = catalogo();
  return `
    <header class="top"><button class="ico" data-act="go" data-go="#/cfg">‹</button><h1>Modelos de ambiente</h1></header>
    <main>
      <p class="muted">São os roteiros que o app carrega ao criar um ambiente. Edite os itens, as categorias e o que cada item exige (quantidade, teste, pintura).</p>
      ${Object.entries(cat).map(([k, m]) => `
        <button class="card vcard" data-act="go" data-go="#/modelos/${k}">
          <b>${esc(m.nome)}</b>
          <small>${m.itens.length} itens${m.custom ? ' · <span class="warn">editado</span>' : ''}</small>
        </button>`).join('')}
      <button class="btn primary" data-act="modeloNovo">＋ Criar modelo novo</button>
    </main>`;
}

export function abrirEditor(key) {
  const m = catalogo()[key];
  if (!m) return false;
  ED = { key, nome: m.nome, itens: JSON.parse(JSON.stringify(m.itens)), novo: false };
  return true;
}
export function novoModelo(nome) {
  ED = { key: slug(nome) + '_' + Date.now().toString(36).slice(-3), nome, itens: [novoItem()], novo: true };
  return ED.key;
}

const flag = (i, j, f, rot, v) => `<label class="chk"><input type="checkbox" data-ed="${f}" data-i="${i}" ${j != null ? `data-j="${j}"` : ''} ${v ? 'checked' : ''}> ${rot}</label>`;

function linha(it, i, j) {
  return `<div class="mrow ${j != null ? 'subi' : ''}">
    <div class="mtop">
      <input data-ed="nome" data-i="${i}" ${j != null ? `data-j="${j}"` : ''} value="${esc(it.nome)}">
      <button class="mv-b" data-act="mUp" data-i="${i}" ${j != null ? `data-j="${j}"` : ''} aria-label="Subir">▲</button>
      <button class="mv-b" data-act="mDown" data-i="${i}" ${j != null ? `data-j="${j}"` : ''} aria-label="Descer">▼</button>
      <button class="mv-b bad" data-act="mDel" data-i="${i}" ${j != null ? `data-j="${j}"` : ''} aria-label="Remover">✕</button>
    </div>
    <div class="mflags">
      ${j == null ? `<select data-ed="cat" data-i="${i}">${CATS.map(([c, n]) => `<option value="${c}" ${it.cat === c ? 'selected' : ''}>${n}</option>`).join('')}</select>` : ''}
      ${flag(i, j, 'q', 'Qtd', it.q)}${flag(i, j, 't', 'Teste', it.t)}${flag(i, j, 'p', 'Pintura', it.p)}${flag(i, j, 'g', 'Só foto', it.g)}${j == null ? flag(i, j, 'm', 'Medidor', it.m) : ''}
      ${j == null ? `<button class="lnk" data-act="mSub" data-i="${i}">＋ subitem</button>` : ''}
    </div>
  </div>`;
}

export function htmlEditor() {
  const rows = ED.itens.map((it, i) => linha(it, i, null) + (it.subs || []).map((s, j) => linha(s, i, j)).join('')).join('');
  return `
    <header class="top"><button class="ico" data-act="go" data-go="#/modelos">‹</button><h1>${esc(ED.nome)}</h1></header>
    <main>
      <label>Nome do modelo<input data-ed="__nome" value="${esc(ED.nome)}"></label>
      <h2>Itens (na ordem de leitura técnica)</h2>
      ${rows}
      <button class="btn" data-act="mAdd">＋ Adicionar item</button>
      <button class="btn primary big" data-act="mSalvar">Salvar modelo</button>
      ${!ED.novo && modeloDeFabrica(ED.key) ? '<button class="btn" data-act="mRestaurar">Restaurar padrão de fábrica</button>' : ''}
      ${ED.novo || !modeloDeFabrica(ED.key) ? '<button class="btn danger" data-act="mExcluir">Excluir este modelo</button>' : ''}
    </main>`;
}

const alvo = (el) => {
  const i = Number(el.dataset.i), j = el.dataset.j != null ? Number(el.dataset.j) : null;
  return { i, j, lista: j == null ? ED.itens : ED.itens[i].subs, idx: j == null ? i : j };
};

export const ACTS = {
  mAdd() { ED.itens.push(novoItem()); },
  mSub(el) { const it = ED.itens[Number(el.dataset.i)]; (it.subs ||= []).push({ ...novoItem(), cat: it.cat }); },
  mUp(el) { const { lista, idx } = alvo(el); if (idx > 0) [lista[idx - 1], lista[idx]] = [lista[idx], lista[idx - 1]]; },
  mDown(el) { const { lista, idx } = alvo(el); if (idx < lista.length - 1) [lista[idx + 1], lista[idx]] = [lista[idx], lista[idx + 1]]; },
  mDel(el) { const { lista, idx } = alvo(el); if (confirm(`Remover "${lista[idx].nome}"?`)) lista.splice(idx, 1); },
  mSalvar() {
    if (!ED.nome.trim()) return toast('Dê um nome ao modelo');
    salvarModelo(ED.key, { nome: ED.nome.trim(), itens: ED.itens });
    ED.novo = false;
    toast('Modelo salvo neste aparelho');
  },
  mRestaurar() { if (confirm('Voltar ao modelo de fábrica? Suas edições serão perdidas.')) { restaurarModelo(ED.key); abrirEditor(ED.key); } },
  mExcluir() {
    if (!confirm('Excluir este modelo?')) return;
    restaurarModelo(ED.key);
    location.hash = '#/modelos';
    return 'sair';
  },
};

export function editarCampo(el) {
  const f = el.dataset.ed;
  if (f === '__nome') { ED.nome = el.value; return; }
  const { lista, idx } = alvo(el);
  const it = lista[idx];
  if (['q', 't', 'p', 'g', 'm'].includes(f)) it[f] = el.checked;
  else if (f === 'cat') { it.cat = el.value; (it.subs || []).forEach((s) => { s.cat = el.value; }); }
  else it[f] = el.value;
}
