// Plano de numeração (A###-F###/V###) e exportação em ZIP no padrão da skill vistoria-liquilar.
import * as DB from './db.js';
import { ZipBuilder, crc32 } from './zip.js';
import { S, p3, nomeArq, lista, labelCond, labelVerif, fmtDur } from './core.js';

const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
export const csv = (linhas) => '﻿' + linhas.map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
const extMime = (m) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp' }[m] || (m?.startsWith('video/') ? 'mp4' : 'jpg'));

// Numeração única usada no app, no ZIP e no relatório: A### = caminhamento; F###/V### = ordem técnica do roteiro.
export function plano(fotos) {
  return S.V.ambientes.map((a, ai) => {
    const aCod = 'A' + p3(ai + 1);
    let nF = 0, nV = 0;
    const itens = [], todas = [];
    for (const { it, num, sub } of lista(a)) {
      const paiNome = sub ? (a.itens.find((x) => x.id === it.paiId)?.nome || '') : '';
      const caminho = sub ? `${paiNome} - ${it.nome}` : it.nome;
      const midias = fotos.filter((f) => f.itemId === it.id).sort((x, y) => x.seq - y.seq).map((f, k) => {
        const cod = f.tipo === 'video' ? `${aCod}-V${p3(++nV)}` : `${aCod}-F${p3(++nF)}`;
        const det = f.nota ? ` - ${nomeArq(f.nota)}` : k > 0 ? ` - Detalhe ${k + 1}` : '';
        const m = { f, cod, caminho, arq: `${cod} - ${nomeArq(a.nome)} - ${nomeArq(caminho)}${det}.${extMime(f.mime)}` };
        todas.push(m);
        return m;
      });
      itens.push({ it, num, sub, caminho, midias });
    }
    return { a, aCod, pasta: `${aCod} - ${nomeArq(a.nome)}`, itens, todas };
  });
}

export function descricaoItem(it) {
  const partes = [];
  if (it.m) {
    if (it.ident) partes.push(`Identificação: ${it.ident}`);
    if (it.leitura) partes.push(`Leitura: ${it.leitura}`);
    if (it.sit) partes.push(`Situação: ${it.sit}`);
  }
  if (it.obs) partes.push(it.obs);
  return partes.join('. ');
}

// Ocorrências (seção 07 do MASTER): itens com AVARIA, REGULAR ou divergência apontada.
export function ocorrencias(pl) {
  const out = [];
  for (const p of pl) for (const x of p.itens) {
    const it = x.it;
    if (it.na) continue;
    if (it.cond === 'AVARIA' || it.cond === 'REGULAR' || it.diverg) {
      out.push({
        id: 'R' + p3(out.length + 1).slice(1), ambiente: p.a.nome, aCod: p.aCod, item: x.caminho,
        tipo: it.diverg ? 'DIVERGÊNCIA' : labelCond(it.cond, true), descricao: it.diverg?.texto || it.obs || '',
        fotos: x.midias.map((m) => m.cod),
      });
    }
  }
  return out;
}

export async function gerarZip(prog = () => {}) {
  const V = S.V;
  const fotos = await DB.fotosDe(V.id);
  const jaNoDrive = fotos.filter((f) => f.remoto && f.noDrive).length;
  if (jaNoDrive) throw new Error(`${jaNoDrive} foto(s) de outros aparelhos já foram para o Drive e não estão mais na nuvem. O repositório desta vistoria é a pasta do Drive; o ZIP só serve antes do envio.`);
  const soMini = fotos.filter((f) => f.remoto && f.soThumb).length;
  if (soMini) throw new Error(`${soMini} foto(s) de outros aparelhos estão só em miniatura. Toque em "Baixar originais" no menu da vistoria e gere o ZIP de novo.`);
  const pl = plano(fotos);
  const raiz = 'Vistoria_' + nomeArq(V.codigo);
  const zip = new ZipBuilder();
  const man = [['codigo', 'tipo', 'arquivo', 'ambiente', 'item', 'legenda', 'data_hora', 'latitude', 'longitude', 'precisao_m', 'origem', 'sha256', 'bytes', 'largura', 'altura', 'duracao_s']];
  const itensCsv = [['ambiente_cod', 'ambiente', 'num', 'elemento', 'qtd', 'condicao', 'verificacao', 'descricao', 'fotos', 'divergencia']];
  const jAmb = [], jFotos = [];
  let feito = 0;

  for (const p of pl) {
    const jItens = [];
    for (const x of p.itens) {
      const it = x.it;
      for (const m of x.midias) {
        const f = m.f;
        prog(`Processando mídia ${++feito} de ${fotos.length}…`);
        const buf = new Uint8Array(await f.blob.arrayBuffer());
        const sha = crypto.subtle ? hex(await crypto.subtle.digest('SHA-256', buf)) : '';
        zip.add(`${raiz}/${p.pasta}/${m.arq}`, f.blob, buf.length, crc32(buf), new Date(f.ts));
        const dh = new Date(f.ts).toISOString();
        man.push([m.cod, f.tipo, `${p.pasta}/${m.arq}`, p.a.nome, x.caminho, f.nota || '', dh, f.pos?.lat ?? '', f.pos?.lng ?? '', f.pos?.acc ?? '', f.origem, sha, buf.length, f.w, f.h, f.dur ? Math.round(f.dur) : '']);
        jFotos.push({ codigo: m.cod, tipo: f.tipo, arquivo: `${p.pasta}/${m.arq}`, ambiente: p.a.nome, item: x.caminho, legenda: f.nota || null, dataHora: dh, gps: f.pos ? { lat: f.pos.lat, lng: f.pos.lng, precisaoM: f.pos.acc } : null, origem: f.origem, sha256: sha, bytes: buf.length });
      }
      const cods = x.midias.map((m) => m.cod);
      itensCsv.push([p.aCod, p.a.nome, x.num, x.caminho, it.q ? (it.qtd ?? '') : '', it.na ? 'NÃO EXISTE' : labelCond(it.cond, true), it.na ? '' : labelVerif(it.verif, true),
        descricaoItem(it), cods.join(' '), it.diverg ? (it.diverg.texto || 'SIM') : '']);
      jItens.push({
        id: it.id, paiId: it.paiId || null, num: x.num, nome: it.nome, cat: it.cat || 'item', q: !!it.q, t: !!it.t, p: !!it.p, g: !!it.g, m: !!it.m,
        naoExiste: !!it.na, quantidade: it.q ? (it.qtd ?? null) : undefined, condicao: it.cond || null, verificacao: it.verif || null,
        observacao: it.obs || null, identificacao: it.ident || undefined, leitura: it.leitura || undefined, situacao: it.sit || undefined,
        divergencia: it.diverg || undefined, entrada: it.ref || undefined, fotos: cods,
      });
    }
    jAmb.push({ id: p.a.id, codigo: p.aCod, nome: p.a.nome, modelo: p.a.modelo || null, pasta: p.pasta, itens: jItens });
  }

  const oc = ocorrencias(pl);
  const agora = new Date();
  zip.addTexto(`${raiz}/manifesto_fotos.csv`, csv(man));
  zip.addTexto(`${raiz}/itens_e_condicoes.csv`, csv(itensCsv));
  zip.addTexto(`${raiz}/ocorrencias.csv`, csv([['id', 'ambiente_cod', 'ambiente', 'item', 'tipo', 'descricao', 'fotos'], ...oc.map((o) => [o.id, o.aCod, o.ambiente, o.item, o.tipo, o.descricao, o.fotos.join(' ')])]));
  zip.addTexto(`${raiz}/vistoria.json`, JSON.stringify({
    formato: 'vistoria-liquilar/2', app: S.versao,
    codigo: V.codigo, tipoVistoria: V.tipoVistoria, finalidade: V.finalidade || '', tipoImovel: V.tipoImovel, endereco: V.endereco, codImovel: V.codImovel || '',
    metragemM2: V.metragem, solicitante: V.solicitante || '', vistoriador: V.vistoriador,
    iniciadaEm: V.inicioEm ? new Date(V.inicioEm).toISOString() : null, finalizadaEm: V.fimEm ? new Date(V.fimEm).toISOString() : null,
    duracaoRegistrada: V.inicioEm && V.fimEm ? fmtDur(V.fimEm - V.inicioEm) : null, exportadaEm: agora.toISOString(), gpsInicio: V.geo || null,
    condicoesInspecao: V.condicoes || {}, dadosGerais: V.geral || {}, baseEntrada: V.baseEntrada || null,
    totalAmbientes: jAmb.length, totalFotos: jFotos.filter((f) => f.tipo === 'foto').length, totalVideos: jFotos.filter((f) => f.tipo === 'video').length,
    ocorrencias: oc, contestacoes: V.contestacoes || [], ambientes: jAmb, midias: jFotos,
  }, null, 2));

  prog('Montando o ZIP…');
  const blob = zip.finish();
  V.exportadoEm = Date.now();
  await DB.putV(V);
  return { blob, nome: `${raiz}.zip`, total: fotos.length };
}
