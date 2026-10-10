// Gerador de ZIP "store" (sem compressão; JPEG já é comprimido). Sem dependências.
// Os blobs das fotos entram por referência no Blob final, então não duplicam memória.
const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

function dos(d) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export class ZipBuilder {
  constructor() { this.parts = []; this.central = []; this.offset = 0; this.count = 0; }

  add(nome, blob, tamanho, crc, data = new Date()) {
    if (tamanho > 0xfffffffe || this.offset > 0xfffffffe || this.count >= 0xfffe) {
      throw new Error('ZIP excede o limite (4 GB / 65 mil arquivos). Exporte em partes.');
    }
    const n = enc.encode(nome);
    const { time, date } = dos(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // nomes em UTF-8
    lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, tamanho, true);
    lh.setUint32(22, tamanho, true);
    lh.setUint16(26, n.length, true);
    lh.setUint16(28, 0, true);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, tamanho, true);
    ch.setUint32(24, tamanho, true);
    ch.setUint16(28, n.length, true);
    ch.setUint32(42, this.offset, true);
    this.central.push(new Uint8Array(ch.buffer), n);

    this.parts.push(new Uint8Array(lh.buffer), n, blob);
    this.offset += 30 + n.length + tamanho;
    this.count++;
  }

  addTexto(nome, texto) {
    const bytes = enc.encode(texto);
    this.add(nome, new Blob([bytes]), bytes.length, crc32(bytes));
  }

  finish() {
    const cdSize = this.central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, this.count, true);
    e.setUint16(10, this.count, true);
    e.setUint32(12, cdSize, true);
    e.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...this.central, new Uint8Array(e.buffer)], { type: 'application/zip' });
  }
}
