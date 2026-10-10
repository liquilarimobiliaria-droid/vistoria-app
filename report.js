// Relatório de backup (versão simplificada do MASTER básico). Abre numa visualização de impressão: "Salvar como PDF".
import * as DB from './db.js';
import { S, esc, p3, fmtData, fmtDur, labelCond, labelVerif, thumbURL } from './core.js';
import { plano, ocorrencias, descricaoItem } from './export.js';

const fmtGps = (g) => (g ? `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)} (±${g.acc} m)` : '');
// resumo de geolocalização de um ambiente a partir das fotos georreferenciadas
function resumoGps(todas) {
  const pts = todas.map((m) => m.f.pos).filter(Boolean);
  if (!pts.length) return todas.length ? `Sem coordenadas nos ${todas.length} registro(s)` : '';
  const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length, lng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
  return `${pts.length} de ${todas.length} registros georreferenciados · centro aproximado ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}
const rows = (pares) => pares.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v || '—')}</td></tr>`).join('');

export async function relatorioHTML() {
  const V = S.V;
  const fotos = await DB.fotosDe(V.id);
  S.FOTOS = fotos; // garante blobs/thumbs atualizados
  const pl = plano(fotos);
  const oc = ocorrencias(pl);
  const nFotos = fotos.filter((f) => f.tipo !== 'video').length;
  const c = V.condicoes || {}, g = V.geral || {};
  const data = fmtData(V.inicioEm || V.criadoEm).split(',')[0];
  const medidores = pl.flatMap((p) => p.itens.filter((x) => x.it.m && !x.it.na));

  const sec = (n, t) => `<h2 class="rh"><span>${n}</span> ${t}</h2>`;

  const ambHTML = pl.map((p) => {
    const linhas = p.itens.map((x) => {
      const it = x.it;
      const refs = x.midias.map((m) => m.cod).join(', ');
      if (it.na) return `<tr class="na"><td>${x.num}</td><td>${esc(it.nome)}</td><td></td><td colspan="3">Não aplicável a este ambiente.</td></tr>`;
      return `<tr class="${x.sub ? 'sub' : ''}"><td>${x.num}</td><td>${esc(it.nome)}</td><td>${it.q ? (it.qtd ?? '—') : ''}</td>
        <td>${it.g ? '' : esc(labelCond(it.cond, true) || '—')}</td><td>${it.t ? esc(labelVerif(it.verif, true) || '—') : ''}</td>
        <td>${esc(descricaoItem(it))}${refs ? `<br><em>${esc(refs)}</em>` : ''}</td></tr>`;
    }).join('');
    const ocs = oc.filter((o) => o.aCod === p.aCod).map((o) => `<div class="oc"><b>OCORRÊNCIA RELEVANTE — ${esc(o.item)}</b><br>${esc(o.descricao || o.tipo)} <em>| Evidência: ${esc(o.fotos.join(', ') || '—')}</em></div>`).join('');
    // fotos em páginas de 18 (3 colunas x 6 linhas)
    let grade = '';
    for (let i = 0; i < p.todas.length; i += 18) {
      const lote = p.todas.slice(i, i + 18);
      grade += `<div class="grade ${i ? 'pg' : ''}">` + lote.map((m) => `<figure>${m.f.tipo === 'video'
        ? `<div class="vid">▶ vídeo ${m.f.dur ? Math.round(m.f.dur) + ' s' : ''}</div>` : `<img src="${thumbURL(m.f)}" alt="">`}<figcaption><b>${m.cod}</b> | ${esc(m.caminho)}${m.f.nota ? ' — ' + esc(m.f.nota) : ''}</figcaption></figure>`).join('') + '</div>';
    }
    return `<section class="ramb pg"><div class="ambh">${p.aCod} | ${esc(p.a.nome)}</div>
      ${resumoGps(p.todas) ? `<div class="gpsl">📍 ${esc(resumoGps(p.todas))}</div>` : ''}
      <table class="tb inv"><thead><tr><th>#</th><th>ELEMENTO</th><th>QTD.</th><th>CONDIÇÃO</th><th>VERIFICAÇÃO</th><th>DESCRIÇÃO OBJETIVA / EVIDÊNCIA</th></tr></thead><tbody>${linhas}</tbody></table>
      ${ocs}
      <div class="sub-h">REGISTRO FOTOGRÁFICO INTEGRAL | ${p.aCod}</div>${grade || '<p class="mut">Sem registros fotográficos neste ambiente.</p>'}</section>`;
  }).join('');

  const testes = pl.flatMap((p) => p.itens.filter((x) => x.it.t && x.it.verif && !x.it.na).map((x) => ({ p, x })));

  return `<div class="rep">
    <div class="noprint toolbar"><button class="btn primary" data-act="imprimir">Imprimir / Salvar como PDF</button><button class="btn" data-act="go" data-go="#/v/${V.id}">Voltar</button></div>
    <header class="rcover"><img src="img/logo-horizontal.png" alt="LiquiLar"><div class="rt">LAUDO DE VISTORIA IMOBILIÁRIA</div><div class="rs">VISTORIA DE ${esc((V.tipoVistoria || 'Entrada').toUpperCase())}</div><div class="rc">${esc(V.codigo)}</div></header>

    ${sec('00', 'RESUMO EXECUTIVO')}
    <table class="tb kv4"><tr><th>CÓDIGO</th><th>DATA</th><th>AMBIENTES</th><th>FOTOS</th><th>FINALIDADE</th></tr>
      <tr><td>${esc(V.codigo)}</td><td>${esc(data)}</td><td>${pl.length}</td><td>${nFotos}</td><td>${esc(V.finalidade || '—')}</td></tr></table>

    ${sec('01', 'IDENTIFICAÇÃO DA VISTORIA')}
    <table class="tb kv">${rows([
      ['IMOBILIÁRIA RESPONSÁVEL', 'LIQUILAR - LIQUIDEZ IMOBILIÁRIA LTDA. - CNPJ nº 62.222.640/0001-01 - CRECI Jurídico nº 16.939-J'],
      ['VISTORIADOR RESPONSÁVEL', V.vistoriador], ['SOLICITANTE', V.solicitante],
      ['INÍCIO', fmtData(V.inicioEm)], ['TÉRMINO', fmtData(V.fimEm)], ['DURAÇÃO REGISTRADA', V.inicioEm && V.fimEm ? fmtDur(V.fimEm - V.inicioEm) : ''],
      ['GEOLOCALIZAÇÃO NO INÍCIO DA VISTORIA', fmtGps(V.geo) || 'Não registrada (sem sinal de GPS)'],
    ])}</table>

    ${sec('02', 'IDENTIFICAÇÃO DO IMÓVEL')}
    <table class="tb kv">${rows([['TIPO / FINALIDADE', `${V.tipoImovel || ''}${V.finalidade ? ' - ' + V.finalidade : ''}`], ['ENDEREÇO', V.endereco], ['CÓDIGO DO IMÓVEL', V.codImovel], ['METRAGEM', V.metragem ? V.metragem + ' m²' : '']])}</table>

    ${sec('03', 'CONDIÇÕES DA INSPEÇÃO')}
    <table class="tb kv">${rows([['OCUPAÇÃO', c.ocupacao], ['ENERGIA', c.energia], ['ÁGUA', c.agua], ['ILUMINAÇÃO', c.iluminacao], ['CLIMA', c.clima], ['ACESSO', c.acesso]])}</table>

    ${sec('04', 'MEDIDORES E ENTREGA DE ACESSOS')}
    <table class="tb"><thead><tr><th>CATEGORIA</th><th>IDENTIFICAÇÃO / QUANTIDADE</th><th>LEITURA / SITUAÇÃO</th><th>EVIDÊNCIA</th></tr></thead><tbody>
      ${medidores.map((x) => `<tr><td>${esc(x.it.nome)}</td><td>${esc(x.it.ident || '—')}</td><td>${esc([x.it.leitura, x.it.sit].filter(Boolean).join(' · ') || '—')}</td><td>${esc(x.midias.map((m) => m.cod).join(', ') || '—')}</td></tr>`).join('')}
      <tr><td>Chaves</td><td>${esc(g.chaves || '—')}</td><td></td><td></td></tr>
      <tr><td>Controles</td><td>${esc(g.controles || '—')}</td><td></td><td></td></tr>
      <tr><td>Tags / cartões</td><td>${esc(g.tags || '—')}</td><td></td><td></td></tr></tbody></table>

    ${sec('06', 'CRITÉRIOS DE CLASSIFICAÇÃO E VERIFICAÇÃO')}
    <table class="tb"><thead><tr><th>CLASSIFICAÇÃO</th><th>USO NO LAUDO</th></tr></thead><tbody>
      <tr><td>PINTURA NOVA</td><td>Condição-base das superfícies pintadas na vistoria de entrada; marcas, manchas, perfurações e avarias preexistentes são descritas separadamente.</td></tr>
      <tr><td>BOM</td><td>Bom estado aparente, admitidos sinais mínimos de uso.</td></tr>
      <tr><td>REGULAR</td><td>Sinais de uso, desgaste ou acabamento que merecem registro.</td></tr>
      <tr><td>AVARIA</td><td>Quebra, falta, fissura, infiltração aparente, mancha relevante, oxidação acentuada ou dano visível.</td></tr>
      <tr><td>NÃO ACESSÍVEL</td><td>Item cuja condição não pôde ser verificada por limitação objetiva de acesso.</td></tr>
      <tr><td>TESTADO · PARCIALMENTE TESTADO · OBSERVADO EM USO · NÃO TESTADO</td><td>Verificação presencial efetivamente realizada, parcial, observada em uso, ou não realizada, conforme registrado em cada item.</td></tr></tbody></table>

    ${sec('07', 'RESUMO DE OCORRÊNCIAS E CONDIÇÕES RELEVANTES')}
    ${oc.length ? `<table class="tb"><thead><tr><th>ID</th><th>AMBIENTE</th><th>ITEM / TIPO</th><th>REGISTRO OBJETIVO</th><th>REF. FOTO(S)</th></tr></thead><tbody>${oc.map((o) => `<tr><td>${o.id}</td><td>${esc(o.ambiente)}</td><td>${esc(o.item)} · ${esc(o.tipo)}</td><td>${esc(o.descricao)}</td><td>${esc(o.fotos.join(', '))}</td></tr>`).join('')}</tbody></table>` : '<p class="mut">Nenhuma ocorrência registrada.</p>'}

    ${sec('08', 'ÍNDICE TÉCNICO DE AMBIENTES')}
    <table class="tb"><thead><tr><th>Nº</th><th>AMBIENTE</th><th>ITENS</th><th>FOTOS</th><th>OCORRÊNCIAS</th></tr></thead><tbody>
      ${pl.map((p) => `<tr><td>${p.aCod.slice(1)}</td><td>${esc(p.a.nome)}</td><td>${p.itens.filter((x) => !x.it.na).length}</td><td>${p.todas.length}</td><td>${oc.filter((o) => o.aCod === p.aCod).length}</td></tr>`).join('')}</tbody></table>

    ${sec('09', 'AMBIENTES E INVENTÁRIO DETALHADO')}
    ${ambHTML}

    ${sec('10', 'CONSOLIDAÇÃO DE TESTES E VERIFICAÇÕES')}
    ${testes.length ? `<table class="tb"><thead><tr><th>AMBIENTE</th><th>ITEM</th><th>VERIFICAÇÃO</th><th>OBSERVAÇÃO</th><th>EVIDÊNCIA</th></tr></thead><tbody>${testes.map(({ p, x }) => `<tr><td>${esc(p.a.nome)}</td><td>${esc(x.caminho)}</td><td>${esc(labelVerif(x.it.verif, true))}</td><td>${esc(x.it.obs || '')}</td><td>${esc(x.midias.map((m) => m.cod).join(', '))}</td></tr>`).join('')}</tbody></table>` : '<p class="mut">Nenhuma verificação registrada.</p>'}
    <footer class="rfoot">LiquiLar · Registro de campo · ${esc(V.codigo)}</footer>
  </div>`;
}
