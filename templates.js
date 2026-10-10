// Modelos de ambiente e tipos de imóvel. Cada item segue a tabela do MASTER: Elemento | Qtd | Condição | Verificação | Descrição.
// REGRA: o modelo cria a ESTRUTURA do roteiro, nunca o fato. Quantidades e condições nascem em branco e só entram quando alguém conta/verifica.
// Flags: q = tem quantidade | t = exige verificação de funcionamento | p = superfície pintada (aceita PINTURA NOVA)
//        g = só fotos (vista geral, sem condição) | m = medidor (identificação + leitura + situação)
// cat: item (construção/instalações fixas) | acessorio (equipamentos e acessórios) | mobilia (só entra se o imóvel for mobiliado)
// Ordem dos itens = leitura técnica da skill: vistas gerais > estrutura > aberturas > instalações > incorporados > equipamentos > mobília.

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export const CONDICOES = [
  ['PINTURA_NOVA', 'Pintura nova', 'PINTURA NOVA'],
  ['BOM', 'Bom', 'BOM'],
  ['REGULAR', 'Regular', 'REGULAR'],
  ['AVARIA', 'Avaria', 'AVARIA'],
  ['NAO_ACESSIVEL', 'Não acessível', 'NÃO ACESSÍVEL'],
];
export const VERIFICACOES = [
  ['TESTADO', 'Testado', 'TESTADO'],
  ['PARCIAL', 'Parcialmente', 'PARCIALMENTE TESTADO'],
  ['OBSERVADO', 'Observado em uso', 'OBSERVADO EM USO'],
  ['NAO_TESTADO', 'Não testado', 'NÃO TESTADO'],
];
export const CATS = [['item', 'Itens'], ['acessorio', 'Acessórios'], ['mobilia', 'Mobília']];

// mk(cat)(nome, flags, subs, un) — un = unidade da quantidade (ex.: 'km', 'm'); fala = frase opcional para o passeio guiado
const mk = (cat) => (nome, flags = '', subs = [], extra = {}) => ({
  nome, cat, subs,
  q: flags.includes('q'), t: flags.includes('t'), p: flags.includes('p'), g: flags.includes('g'), m: flags.includes('m'), ...extra,
});
const I = mk('item'), A = mk('acessorio'), M = mk('mobilia');

/* ---------- blocos reutilizáveis (enxutos: só o genérico; o vistoriador acrescenta o que for específico) ---------- */
const estrutura = () => [I('Vista geral', 'g'), I('Piso'), I('Paredes', 'p'), I('Teto', 'p')];
const aberturas = () => [I('Portas', 'qpt'), I('Janelas', 'qt')];
const eletrica = () => [I('Interruptores', 'qt'), I('Tomadas', 'qt'), I('Luminárias', 'qt')];
const interior = () => [...estrutura(), ...aberturas(), ...eletrica()];
const clima = () => [A('Ar-condicionado', 'qt')];
const pia = () => [I('Pia / bancada'), I('Torneira', 't')];

const BUILTIN = {
  /* ----- exterior / acessos ----- */
  fachada: { nome: 'Fachada e acesso', itens: () => [I('Fachada - vista geral', 'g', [], { fala: 'Fotografe a fachada, de frente, mostrando todo o imóvel' }), I('Portão / acesso', 't'), I('Muro / gradil'), I('Calçada')] },
  jardim_frente: { nome: 'Jardim / área frontal', itens: () => [I('Vista geral', 'g'), I('Piso e calçamento'), I('Vegetação')] },
  garagem: { nome: 'Garagem', itens: () => [I('Vista geral', 'g'), I('Piso'), I('Paredes', 'p'), I('Cobertura / teto'), I('Portão da garagem', 't'), I('Luminárias', 'qt'), I('Tomadas', 'qt')] },
  varanda: { nome: 'Varanda', itens: () => [...interior(), I('Guarda-corpo / grade')] },
  hall: { nome: 'Hall de entrada', itens: () => [...interior()] },
  /* ----- social ----- */
  sala: { nome: 'Sala', itens: () => [...interior(), ...clima(), M('Mobiliário', 'q')] },
  escritorio: { nome: 'Escritório / sala de reunião', itens: () => [...interior(), ...clima(), M('Mobiliário', 'q')] },
  /* ----- serviço ----- */
  cozinha: { nome: 'Cozinha', itens: () => [...interior(), ...pia(), I('Armários', 'q'), A('Fogão / cooktop', 't'), M('Geladeira', 't')] },
  copa: { nome: 'Copa', itens: () => [...interior(), ...pia(), I('Armários', 'q')] },
  despensa: { nome: 'Despensa', itens: () => [...estrutura(), I('Portas', 'qpt'), ...eletrica()] },
  area_servico: { nome: 'Área de serviço', itens: () => [...interior(), I('Tanque'), I('Ralo')] },
  corredor: { nome: 'Corredor', itens: () => [...estrutura(), I('Portas', 'qp'), ...eletrica()] },
  escada: { nome: 'Escada', itens: () => [I('Vista geral', 'g'), I('Degraus / piso'), I('Corrimão / guarda-corpo'), I('Paredes', 'p'), I('Luminárias', 'qt')] },
  /* ----- íntimo ----- */
  quarto: { nome: 'Quarto', itens: () => [...interior(), I('Armários embutidos', 'q'), ...clima(), M('Cama', 'q'), M('Guarda-roupa', 'q')] },
  suite: { nome: 'Suíte', itens: () => [...interior(), I('Armários embutidos', 'q'), ...clima(), M('Cama', 'q'), M('Guarda-roupa', 'q')] },
  banheiro: { nome: 'Banheiro', itens: () => [...interior(), I('Vaso sanitário', 't'), I('Lavatório / pia'), I('Torneira', 't'), I('Box / chuveiro', 't')] },
  lavabo: { nome: 'Lavabo', itens: () => [...estrutura(), I('Portas', 'qpt'), ...eletrica(), I('Vaso sanitário', 't'), I('Lavatório / pia'), I('Torneira', 't')] },
  /* ----- lazer / externo de fundos ----- */
  area_gourmet: { nome: 'Área gourmet', itens: () => [...interior(), I('Pia / bancada'), A('Churrasqueira')] },
  piscina: { nome: 'Piscina', itens: () => [I('Vista geral', 'g'), I('Borda e revestimento'), A('Casa de máquinas (bomba e filtro)', 't'), A('Iluminação da piscina', 'qt')] },
  edicula: { nome: 'Edícula', itens: () => [...interior()] },
  quintal: { nome: 'Quintal / área externa', itens: () => [I('Vista geral', 'g'), I('Piso e calçamento'), I('Muros e cercas'), I('Vegetação'), I('Iluminação externa', 'qt')] },
  /* ----- apartamento ----- */
  vaga: { nome: 'Vaga de garagem', itens: () => [I('Vista geral', 'g'), I('Piso'), I('Numeração / demarcação')] },
  deposito: { nome: 'Depósito / box', itens: () => [...estrutura(), I('Porta', 'qpt')] },
  /* ----- comercial ----- */
  recepcao: { nome: 'Recepção', itens: () => [...interior(), ...clima(), M('Balcão e mobiliário', 'q')] },
  vitrine: { nome: 'Fachada comercial e vitrine', itens: () => [I('Fachada - vista geral', 'g'), I('Cortina de aço / porta de enrolar', 't'), I('Vitrine e vidros'), I('Calçada')] },
  salao_loja: { nome: 'Salão de vendas', itens: () => [...interior(), ...clima(), M('Balcões e prateleiras', 'q')] },
  /* ----- galpão ----- */
  patio: { nome: 'Pátio / área externa do galpão', itens: () => [I('Vista geral', 'g'), I('Piso do pátio'), I('Portões', 'qt'), I('Muros e cercas')] },
  galpao: { nome: 'Galpão (área principal)', itens: () => [I('Vista geral', 'g'), I('Piso industrial'), I('Estrutura e cobertura'), I('Paredes / fechamentos'), I('Portões', 'qt'), I('Iluminação', 'qt'), I('Tomadas', 'qt'), I('Quadro elétrico')] },
  mezanino: { nome: 'Mezanino', itens: () => [I('Vista geral', 'g'), I('Piso'), I('Guarda-corpo'), I('Escada de acesso')] },
  doca: { nome: 'Doca de carga', itens: () => [I('Vista geral', 'g'), I('Plataforma'), I('Portas de doca', 'qt')] },
  vestiario: { nome: 'Vestiário', itens: () => [...estrutura(), I('Armários', 'q'), I('Chuveiros', 'qt'), I('Vasos sanitários', 'qt'), I('Lavatórios', 'qt')] },
  /* ----- rural ----- */
  rural_acesso: { nome: 'Acesso e porteira', itens: () => [I('Vista geral do acesso', 'g'), I('Porteira / portão', 'qt'), I('Mata-burro', 'q'), I('Estrada de acesso')] },
  sede: { nome: 'Sede / casa', itens: () => [I('Vista geral externa', 'g'), I('Cobertura / telhado'), I('Paredes externas', 'p'), I('Portas', 'qpt'), I('Janelas', 'qt'), I('Tomadas', 'qt'), I('Luminárias', 'qt'), I('Instalações hidráulicas'), M('Mobília', 'q')] },
  galpao_rural: { nome: 'Barracão / galpão rural', itens: () => [I('Vista geral', 'g'), I('Cobertura e estrutura'), I('Piso'), I('Portões', 'qt'), I('Energia e iluminação', 'qt')] },
  curral: { nome: 'Curral e instalações de manejo', itens: () => [I('Vista geral', 'g'), I('Cercas / currais'), I('Brete / tronco'), I('Embarcadouro'), A('Balança', 't'), I('Cochos e bebedouros', 'qt'), I('Porteiras', 'q')] },
  pastagem: { nome: 'Pastagem / piquete', itens: () => [I('Vista geral', 'g', [], { fala: 'Fotografe a pastagem, mostrando a condição geral' }), I('Cobertura vegetal'), I('Erosões / áreas degradadas'), I('Cercas do piquete', 'q', [], { un: 'm' }), I('Cochos e bebedouros', 'qt')] },
  cercas: { nome: 'Cercas e divisas', itens: () => [I('Vista geral', 'g'), I('Cerca de arame / mourões', 'q', [], { un: 'km' }), I('Esticadores e porteiras', 'q'), I('Marcos de divisa')] },
  estradas: { nome: 'Estradas internas', itens: () => [I('Vista geral', 'g'), I('Estradas / carreadores', 'q', [], { un: 'km' }), I('Pontes, bueiros e mata-burros', 'q')] },
  represa: { nome: 'Represa / açude', itens: () => [I('Vista geral', 'g'), I('Barragem / aterro'), I('Sangradouro'), I('Cercas de proteção')] },
  poco: { nome: 'Poço / captação de água', itens: () => [I('Vista geral', 'g'), I('Proteção e tampa'), A('Bomba', 't'), I('Reservatório / caixa d\'água', 'q')] },
  energia_rural: { nome: 'Energia (rede e transformador)', itens: () => [I('Vista geral', 'g'), I('Poste / transformador'), I('Padrão de entrada')] },
  pomar: { nome: 'Pomar / horta', itens: () => [I('Vista geral', 'g'), I('Plantio'), I('Irrigação', 't')] },
  /* ----- terreno ----- */
  frente_terreno: { nome: 'Frente do terreno', itens: () => [I('Vista geral', 'g'), I('Muro / cerca frontal'), I('Portão', 't')] },
  divisas: { nome: 'Divisas', itens: () => [I('Vista geral', 'g'), I('Divisa lateral direita'), I('Divisa lateral esquerda'), I('Divisa dos fundos')] },
  terreno_interno: { nome: 'Interior do terreno', itens: () => [I('Vista geral', 'g'), I('Vegetação / árvores'), I('Edificações existentes')] },
  /* ----- comuns ----- */
  medidores: { nome: 'Medidores e disjuntores', itens: () => [I('Medidor de energia', 'm'), I('Quadro de disjuntores', 'q'), I('Hidrômetro', 'm'), I('Medidor de gás', 'm')] },
  area_externa: { nome: 'Área externa', itens: () => [I('Vista geral', 'g'), I('Piso'), I('Muros e cercas'), ...eletrica()] },
  outro: { nome: 'Outro ambiente', itens: () => [...interior()] },
};
/* ---------- catálogo = modelos de fábrica + modelos editados/criados pelo usuário (salvos neste aparelho) ---------- */
const LS = 'ql-modelos';
const lerCustom = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } };
const gravarCustom = (c) => { try { localStorage.setItem(LS, JSON.stringify(c)); } catch {} };

export function catalogo() {
  const out = {};
  for (const [k, v] of Object.entries(BUILTIN)) out[k] = { nome: v.nome, itens: v.itens(), custom: false };
  const c = lerCustom();
  for (const [k, v] of Object.entries(c)) out[k] = { ...v, custom: true, base: k in BUILTIN };
  return out;
}
export function salvarModelo(key, modelo) { const c = lerCustom(); c[key] = { nome: modelo.nome, itens: modelo.itens }; gravarCustom(c); }
export function restaurarModelo(key) { const c = lerCustom(); delete c[key]; gravarCustom(c); }
export const modeloDeFabrica = (key) => key in BUILTIN;

/* ---------- tipos de imóvel: perguntas (variáveis) + roteiro na ordem do passeio ---------- */
// var: {k, rot, t:'n'|'b', def, max}
const N = (k, rot, def = 0, max = 20) => ({ k, rot, t: 'n', def, max });
const B = (k, rot, def = false) => ({ k, rot, t: 'b', def });
// repete um ambiente n vezes: rep('quarto', 3, 'Quarto') => ['quarto:Quarto 1', ...]
const rep = (key, n, base) => Array.from({ length: n }, (_, i) => `${key}:${n > 1 ? `${base} ${i + 1}` : base}`);
const se = (c, ...x) => (c ? x : []);
// suítes: cada suíte vem acompanhada do banheiro da suíte
const suites = (n) => Array.from({ length: n }, (_, i) => [`suite:Suíte${n > 1 ? ' ' + (i + 1) : ''}`, `banheiro:Banheiro da Suíte${n > 1 ? ' ' + (i + 1) : ''}`]).flat();

const lazer = (v) => [...se(v.gourmet, 'area_gourmet'), ...se(v.piscina, 'piscina'), ...se(v.edicula, 'edicula'), ...se(v.quintal, 'quintal')];
const intimoCasa = (v) => [...se(v.quartos + v.suites > 1, 'corredor'), ...rep('quarto', v.quartos, 'Quarto'), ...rep('banheiro', v.banheiros, 'Banheiro social'), ...suites(v.suites)];

export const TIPOS = {
  casa_terrea: {
    nome: 'Casa térrea', icone: '🏠', desc: 'Casa de um pavimento',
    vars: [N('quartos', 'Quartos (sem suíte)', 2), N('suites', 'Suítes', 1), N('banheiros', 'Banheiros sociais', 1), N('lavabos', 'Lavabos', 0), N('varandas', 'Varandas / alpendres', 1), N('garagens', 'Garagens', 1),
      B('jardim', 'Jardim frontal', true), B('despensa', 'Despensa'), B('servico', 'Área de serviço', true), B('gourmet', 'Área gourmet'), B('piscina', 'Piscina'), B('edicula', 'Edícula'), B('quintal', 'Quintal / fundos', true), B('mobiliado', 'Imóvel mobiliado')],
    roteiro: (v) => ['fachada', ...se(v.jardim, 'jardim_frente'), ...rep('garagem', v.garagens, 'Garagem'), ...rep('varanda', v.varandas, 'Varanda'), 'sala', ...rep('lavabo', v.lavabos, 'Lavabo'), 'cozinha', ...se(v.despensa, 'despensa'), ...se(v.servico, 'area_servico'), ...intimoCasa(v), ...lazer(v), 'medidores'],
  },
  sobrado: {
    nome: 'Sobrado', icone: '🏘️', desc: 'Casa com dois ou mais pavimentos',
    vars: [N('quartos', 'Quartos no andar superior (sem suíte)', 2), N('suites', 'Suítes', 1), N('banheiros', 'Banheiros sociais (superior)', 1), N('lavabos', 'Lavabos (térreo)', 1), N('varandas', 'Varandas / sacadas', 1), N('garagens', 'Garagens', 1),
      B('jardim', 'Jardim frontal', true), B('despensa', 'Despensa'), B('servico', 'Área de serviço', true), B('gourmet', 'Área gourmet'), B('piscina', 'Piscina'), B('edicula', 'Edícula'), B('quintal', 'Quintal / fundos', true), B('mobiliado', 'Imóvel mobiliado')],
    roteiro: (v) => ['fachada', ...se(v.jardim, 'jardim_frente'), ...rep('garagem', v.garagens, 'Garagem'), 'sala', ...rep('lavabo', v.lavabos, 'Lavabo'), 'cozinha', ...se(v.despensa, 'despensa'), ...se(v.servico, 'area_servico'), 'escada', ...intimoCasa(v), ...rep('varanda', v.varandas, 'Varanda'), ...lazer(v), 'medidores'],
  },
  apartamento: {
    nome: 'Apartamento', icone: '🏢', desc: 'Unidade em edifício',
    vars: [N('quartos', 'Quartos (sem suíte)', 2), N('suites', 'Suítes', 1), N('banheiros', 'Banheiros sociais', 1), N('lavabos', 'Lavabos', 0), N('varandas', 'Varandas / sacadas', 1), N('vagas', 'Vagas de garagem', 1),
      B('servico', 'Área de serviço', true), B('deposito', 'Depósito / box'), B('mobiliado', 'Imóvel mobiliado')],
    roteiro: (v) => ['hall', 'sala', ...rep('varanda', v.varandas, 'Varanda'), ...rep('lavabo', v.lavabos, 'Lavabo'), 'cozinha', ...se(v.servico, 'area_servico'), ...intimoCasa(v), ...se(v.deposito, 'deposito'), ...rep('vaga', v.vagas, 'Vaga'), 'medidores'],
  },
  kitnet: {
    nome: 'Kitnet / studio', icone: '🛏️', desc: 'Ambiente único com banheiro',
    vars: [B('cozinha', 'Cozinha / cantinho de cozinha', true), B('servico', 'Área de serviço'), B('varanda', 'Varanda'), B('mobiliado', 'Imóvel mobiliado')],
    roteiro: (v) => ['sala:Ambiente principal', ...se(v.cozinha, 'cozinha'), ...se(v.varanda, 'varanda'), 'banheiro', ...se(v.servico, 'area_servico'), 'medidores'],
  },
  sala_comercial: {
    nome: 'Sala comercial', icone: '💼', desc: 'Sala ou conjunto em prédio comercial',
    vars: [N('salas', 'Salas / escritórios', 1), N('banheiros', 'Banheiros', 1), B('fachada', 'Fachada / acesso próprio', true), B('recepcao', 'Recepção'), B('copa', 'Copa', true), B('deposito', 'Depósito'), B('mobiliado', 'Imóvel mobiliado')],
    roteiro: (v) => [...se(v.fachada, 'fachada'), ...se(v.recepcao, 'recepcao'), ...rep('escritorio', v.salas, 'Sala'), ...se(v.copa, 'copa'), ...rep('banheiro', v.banheiros, 'Banheiro'), ...se(v.deposito, 'deposito'), 'medidores'],
  },
  loja: {
    nome: 'Loja / ponto comercial', icone: '🏪', desc: 'Loja de rua ou de galeria',
    vars: [N('banheiros', 'Banheiros', 1), B('mezanino', 'Mezanino'), B('deposito', 'Depósito / estoque', true), B('copa', 'Copa'), B('mobiliado', 'Imóvel mobiliado (balcões, prateleiras)')],
    roteiro: (v) => ['vitrine', 'salao_loja', ...se(v.mezanino, 'mezanino'), ...se(v.deposito, 'deposito'), ...se(v.copa, 'copa'), ...rep('banheiro', v.banheiros, 'Banheiro'), 'medidores'],
  },
  galpao: {
    nome: 'Galpão / barracão', icone: '🏭', desc: 'Galpão logístico ou industrial',
    vars: [N('escritorios', 'Escritórios', 1), N('banheiros', 'Banheiros', 2), B('patio', 'Pátio externo', true), B('doca', 'Docas de carga'), B('mezanino', 'Mezanino'), B('vestiario', 'Vestiário'), B('mobiliado', 'Mobiliado')],
    roteiro: (v) => ['fachada', ...se(v.patio, 'patio'), 'galpao', ...se(v.mezanino, 'mezanino'), ...se(v.doca, 'doca'), ...rep('escritorio', v.escritorios, 'Escritório'), ...se(v.vestiario, 'vestiario'), ...rep('banheiro', v.banheiros, 'Banheiro'), 'medidores'],
  },
  chacara: {
    nome: 'Chácara / sítio', icone: '🌳', desc: 'Pequena propriedade com casa',
    vars: [N('quartos', 'Quartos (sem suíte)', 2), N('suites', 'Suítes', 1), N('banheiros', 'Banheiros sociais', 1), N('varandas', 'Varandas', 1),
      B('gourmet', 'Área gourmet'), B('piscina', 'Piscina'), B('edicula', 'Edícula'), B('pomar', 'Pomar / horta'), B('poco', 'Poço / captação'), B('galpao', 'Barracão'), B('mobiliado', 'Imóvel mobiliado')],
    roteiro: (v) => ['rural_acesso', 'fachada', ...rep('varanda', v.varandas, 'Varanda'), 'sala', 'cozinha', ...intimoCasa(v), ...se(v.gourmet, 'area_gourmet'), ...se(v.piscina, 'piscina'), ...se(v.edicula, 'edicula'), ...se(v.pomar, 'pomar'), ...se(v.poco, 'poco'), ...se(v.galpao, 'galpao_rural'), 'cercas', 'medidores'],
  },
  fazenda: {
    nome: 'Fazenda / área rural', icone: '🐂', desc: 'Propriedade rural com benfeitorias',
    vars: [N('sedes', 'Casas-sede', 1), N('colonos', 'Casas de colono / funcionários', 0), N('galpoes', 'Galpões / barracões', 1), N('currais', 'Currais / instalações de manejo', 1), N('pastos', 'Pastagens / piquetes', 1), N('represas', 'Represas / açudes', 0), N('pocos', 'Poços / captações', 0), B('estradas', 'Estradas internas', true), B('energia', 'Rede elétrica própria (transformador)')],
    roteiro: (v) => ['rural_acesso', ...se(v.estradas, 'estradas'), ...rep('sede', v.sedes, 'Sede'), ...rep('sede', v.colonos, 'Casa de colono'), ...rep('galpao_rural', v.galpoes, 'Galpão'), ...rep('curral', v.currais, 'Curral'), ...rep('pastagem', v.pastos, 'Piquete'), ...rep('represa', v.represas, 'Represa'), ...rep('poco', v.pocos, 'Poço'), 'cercas', ...se(v.energia, 'energia_rural'), 'medidores'],
  },
  terreno: {
    nome: 'Terreno / lote', icone: '📐', desc: 'Terreno urbano ou rural sem construção principal',
    vars: [B('frente', 'Frente com muro / calçada', true), B('divisas', 'Divisas', true), B('medidor', 'Medidores / padrão de energia')],
    roteiro: (v) => [...se(v.frente, 'frente_terreno'), ...se(v.divisas, 'divisas'), 'terreno_interno', ...se(v.medidor, 'medidores')],
  },
  outro: {
    nome: 'Outro / em branco', icone: '➕', desc: 'Comece só com a fachada e monte à mão',
    vars: [B('mobiliado', 'Imóvel mobiliado')],
    roteiro: () => ['fachada'],
  },
};

export const variaveisPadrao = (tipoKey) => Object.fromEntries(TIPOS[tipoKey].vars.map((x) => [x.k, x.def]));

/* ---------- montagem ---------- */
// especificação (com subitens aninhados) -> lista plana com ids. opts.mobiliado === false descarta itens de mobília.
export function itensDeSpec(specs, opts = {}) {
  const out = [];
  const semMob = opts.mobiliado === false;
  for (const s of specs) {
    if (semMob && (s.cat || 'item') === 'mobilia') continue;
    const pai = { id: uid(), nome: s.nome, cat: s.cat || 'item', q: !!s.q, t: !!s.t, p: !!s.p, g: !!s.g, m: !!s.m };
    if (s.un) pai.un = s.un;
    if (s.fala) pai.fala = s.fala;
    out.push(pai);
    for (const sub of s.subs || []) {
      const f = { id: uid(), paiId: pai.id, nome: sub.nome, cat: pai.cat, q: !!sub.q, t: !!sub.t, p: !!sub.p, g: !!sub.g, m: !!sub.m };
      if (sub.un) f.un = sub.un;
      out.push(f);
    }
  }
  return out;
}

export function montarAmbiente(spec, existentes = [], opts = {}) {
  const [key, nomeFixo] = spec.split(':');
  const cat = catalogo();
  const mod = cat[key] || cat.outro;
  let nome = nomeFixo || mod.nome;
  if (!nomeFixo && existentes.includes(nome)) {
    let i = 2;
    while (existentes.includes(`${mod.nome} ${i}`)) i++;
    nome = `${mod.nome} ${i}`;
  }
  return { id: uid(), nome, modelo: key, itens: itensDeSpec(mod.itens, opts) };
}

// tipo + respostas -> lista de ambientes prontos, na ordem do passeio
export function ambientesDoTipo(tipoKey, v) {
  const out = [];
  for (const spec of TIPOS[tipoKey].roteiro(v)) out.push(montarAmbiente(spec, out.map((x) => x.nome), { mobiliado: !!v.mobiliado }));
  return out;
}

// ambiente atual -> especificação de modelo (para "salvar como modelo")
export function specDeAmbiente(amb) {
  const tops = amb.itens.filter((i) => !i.paiId);
  const f = (i) => ({ nome: i.nome, cat: i.cat || 'item', q: !!i.q, t: !!i.t, p: !!i.p, g: !!i.g, m: !!i.m, ...(i.un ? { un: i.un } : {}) });
  return tops.map((t) => ({ ...f(t), subs: amb.itens.filter((s) => s.paiId === t.id).map(f) }));
}
