// Voz: reconhecimento (pt-BR), fala e interpretação em linguagem natural (regras locais, sem IA externa).
// O reconhecimento depende do navegador; no Android/Chrome costuma exigir internet.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const ok = !!SR;

export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

export function listen(timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (!SR) return reject(new Error('sem reconhecimento de voz'));
    const r = new SR();
    r.lang = 'pt-BR';
    r.interimResults = false;
    r.maxAlternatives = 3;
    let fim = false;
    const done = (v, err) => {
      if (fim) return;
      fim = true;
      try { r.stop(); } catch {}
      err ? reject(err) : resolve(v);
    };
    r.onresult = (ev) => done(Array.from(ev.results[0]).map((a) => a.transcript));
    r.onerror = (ev) => (ev.error === 'no-speech' || ev.error === 'aborted' ? done([]) : done(null, new Error(ev.error)));
    r.onend = () => done([]);
    try { r.start(); } catch (e) { return done(null, e); }
    setTimeout(() => done([]), timeout);
  });
}

/* ---------- fala (síntese) ---------- */
// Celulares só liberam o áudio depois de um toque (iOS exige dentro do próprio toque) e muitas vezes
// só carregam as vozes depois do primeiro uso. Por isso: escolhe voz pt-BR explicitamente, expõe desbloquear() e relata falhas.
export const falaOk = 'speechSynthesis' in window;
let voz = null;
export const estadoFala = { ultimoErro: '', ultimaOk: false, temVozPt: false, nome: '' };

// A qualidade da voz depende do aparelho. Escolhe a melhor voz em português disponível (neurais/online/premium primeiro)
// e permite trocar em ⚙ (cfg.voz) e ajustar a velocidade (cfg.velFala).
const cfgLer = () => { try { return JSON.parse(localStorage.getItem('ql-cfg')) || {}; } catch { return {}; } };
const ehPt = (v) => /^pt/i.test((v.lang || '').replace('_', '-'));
function nota(v) {
  const n = `${v.name} ${v.voiceURI}`.toLowerCase();
  let s = 0;
  if (/neural|natural|online|premium|enhanced|aprimorad|wavenet|studio|hd/.test(n)) s += 60;
  if (/google/.test(n)) s += 35;
  if (/luciana|felipe|francisca|antonio|thalita|camila|fernanda|vitoria|ricardo|maria/.test(n)) s += 15;
  if (/compact|compacta|espeak|robot|novelty/.test(n)) s -= 40;
  if (!v.localService) s += 10;
  if ((v.lang || '').replace('_', '-').toLowerCase() === 'pt-br') s += 25;
  return s;
}
export function listarVozes() {
  if (!falaOk) return [];
  return speechSynthesis.getVoices().filter(ehPt).sort((a, b) => nota(b) - nota(a));
}
function carregarVozes() {
  if (!falaOk) return 0;
  const todas = speechSynthesis.getVoices(), pt = listarVozes(), pref = cfgLer().voz;
  voz = (pref && pt.find((v) => v.voiceURI === pref)) || pt[0] || null;
  estadoFala.temVozPt = !!voz; estadoFala.nome = voz ? voz.name : '';
  return todas.length;
}
if (falaOk) {
  carregarVozes();
  try { speechSynthesis.addEventListener('voiceschanged', carregarVozes); } catch {}
}

export function desbloquear() {
  if (!falaOk) return;
  try {
    carregarVozes();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    if (voz) u.voice = voz;
    u.lang = 'pt-BR';
    speechSynthesis.speak(u);
  } catch {}
}

export function speak(texto) {
  return new Promise((resolve) => {
    if (!falaOk) return resolve(false);
    try { carregarVozes(); speechSynthesis.cancel(); } catch {}
    const u = new SpeechSynthesisUtterance(texto);
    u.lang = 'pt-BR';
    if (voz) u.voice = voz;
    u.rate = Math.min(1.4, Math.max(0.8, Number(cfgLer().velFala) || 1.05));
    u.pitch = 1;
    u.volume = 1;
    let fim = false;
    const t = setTimeout(() => done(false, 'sem resposta do aparelho'), 20000);
    const done = (ok, erro = '') => {
      if (fim) return;
      fim = true; clearTimeout(t);
      estadoFala.ultimaOk = ok; estadoFala.ultimoErro = erro;
      resolve(ok);
    };
    u.onend = () => done(true);
    u.onerror = (e) => done(false, e.error || 'erro');
    try { speechSynthesis.speak(u); if (speechSynthesis.paused) speechSynthesis.resume(); } catch (e) { done(false, e.message); }
  });
}
export const testarVoz = () => speak('Fotografe a vista geral da sala. Depois informe a condição do piso.');
export function cancelar() { try { speechSynthesis.cancel(); } catch {} }

/* ---------- números ---------- */
const UN = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11,
  doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
const DZ = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };

export function numero(txt) {
  const s = norm(txt);
  const d = s.match(/\d+/);
  if (d) return parseInt(d[0], 10);
  const toks = s.split(' ');
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] in DZ) {
      let n = DZ[toks[i]];
      if (toks[i + 1] === 'e' && toks[i + 2] in UN) n += UN[toks[i + 2]];
      return n;
    }
    if (toks[i] in UN) return UN[toks[i]];
  }
  return null;
}

/* ---------- classificação do estado de conservação (sugestão por palavras) ---------- */
const RX_AVARIA = /\b(quebrad|rachad|trincad|trinca|fissura|rachadura|riscad|risco|mancha|manchad|amassad|furad|furo|infiltra|mofo|mofad|bolor|oxidad|ferrugem|enferrujad|falt(a|ando)|solt|danificad|estragad|queimad|vazamento|vazando|descascad|descolad|empenad|emperrad|lascad|rasgad|sujo|suja|nao funciona|nao acende|nao liga|nao abre|nao fecha|sem funcionar|defeito|defeituos)/;
const RX_REGULAR = /\b(desgast|marca|marcas|arranh|sinais de uso|uso normal|riscos leves|leve|leves|pequen|desbotad|amarelad|opac|folga|envelhecid|ressecad)/;
const RX_BOM = /\b(bom|boa|otimo|otima|excelente|perfeito|perfeita|novo|nova|bem conservad|tudo certo|sem (avarias?|marcas?|danos?|defeitos?|problemas?|manchas?|riscos?|trincas?|rachaduras?|furos?|desgastes?))/;

// remove trechos negados ("sem mancha", "sem riscos") antes de procurar avarias
const semNegados = (s) => s.replace(/\bsem\s+(?:\w+\s+)?\w+/g, ' ');

export function sugerirCond(texto) {
  const s = norm(texto);
  if (!s) return null;
  if (/pintura nova/.test(s)) return 'PINTURA_NOVA';
  if (/nao acessivel|inacessivel|sem acesso/.test(s)) return 'NAO_ACESSIVEL';
  const limpo = semNegados(s);
  if (RX_AVARIA.test(limpo) || /nao (funciona|acende|liga|abre|fecha)/.test(s)) return 'AVARIA';
  if (RX_REGULAR.test(limpo)) return 'REGULAR';
  if (RX_BOM.test(s)) return 'BOM';
  return null;
}

/* ---------- limpeza leve do texto ditado (autocorreção local) ---------- */
const PALAVRAS = { pra: 'para', ta: 'está', tá: 'está', num: 'em um', vc: 'você', obs: 'observação', otimo: 'ótimo', otima: 'ótima', ate: 'até' };
export function limpar(texto) {
  let t = String(texto || '').trim();
  if (!t) return '';
  t = t.replace(/\s+(vírgula|virgula)(?=\s|$)/gi, ',').replace(/\s+(ponto final|ponto)(?=\s|$)/gi, '.').replace(/\s+(dois pontos)(?=\s|$)/gi, ':');
  t = t.split(/(\s+)/).map((w) => PALAVRAS[w.toLowerCase()] || w).join('').replace(/\bcor branco\b/gi, 'cor branca');
  t = t.replace(/\s+([,.:;])/g, '$1').replace(/\s{2,}/g, ' ');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

/* ---------- interpretação de uma fala sobre um item ---------- */
// item = {q, t, g, m}; retorna {cmd, na, cond, verif, qtd, desc}
export function analisar(alts, item = {}) {
  const r = { cmd: null, na: false, cond: null, verif: null, qtd: null, desc: '' };
  let achou = false;
  for (const a of alts || []) {
    const s = norm(a);
    if (!s) continue;
    if (/\b(parar|encerrar|terminar|chega)\b/.test(s)) { r.cmd = 'PARAR'; return r; }
    if (/\b(pular|proximo|depois)\b/.test(s)) { r.cmd = 'PULAR'; return r; }
    if (/nao (existe|tem|ha|se aplica)|inexistente/.test(s)) { r.na = true; return r; }

    const cond = sugerirCond(a);
    let verif = null;
    if (/nao (foi )?testad|nao testei/.test(s)) verif = 'NAO_TESTADO';
    else if (/parcialmente testad/.test(s)) verif = 'PARCIAL';
    else if (/observad\w* em uso|em uso/.test(s)) verif = 'OBSERVADO';
    else if (/\b(testad|funcionando|funciona|abre e fecha|acende|liga|ligando|abrindo)\b/.test(s)) verif = 'TESTADO';
    if (/nao (funciona|acende|liga|abre|fecha)|emperrad/.test(s)) verif = verif || 'TESTADO';

    let qtd = null;
    if (item.q) { const n = numero(s); if (n != null) qtd = n; }

    if (cond || verif || qtd != null) {
      r.cond = cond; r.verif = verif; r.qtd = qtd;
      // descrição: o que foi dito, exceto falas que são só palavra-chave
      const so = /^(bom|boa|otimo|otima|regular|avaria|testado|nao testado|pintura nova|\d+|[a-z]+)$/.test(s) && s.split(' ').length <= 2;
      r.desc = so ? '' : limpar(a);
      achou = true;
      break;
    }
    if (!achou && !r.desc) r.desc = limpar(a); // fala livre vira descrição
  }
  return r;
}
