// Processamento de foto fora da tela principal (a câmera e a interface não travam):
// reduz para o tamanho configurado, gera a miniatura e avalia nitidez/exposição.
self.onmessage = async (e) => {
  const { id, file, maxPx, thumbPx } = e.data;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const W = bmp.width, H = bmp.height;
    const enc = async (max, q) => {
      const s = Math.min(1, max / Math.max(W, H));
      const w = Math.round(W * s), h = Math.round(H * s);
      const c = new OffscreenCanvas(w, h);
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      return { blob: await c.convertToBlob({ type: 'image/jpeg', quality: q }), w, h };
    };
    const thumb = await enc(thumbPx || 360, 0.7);

    // avaliação rápida em 256 px: bordas fortes (nitidez) e luminosidade
    const s = Math.min(1, 256 / Math.max(W, H)), w = Math.max(2, Math.round(W * s)), h = Math.max(2, Math.round(H * s));
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(bmp, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    let soma = 0, escuros = 0, claros = 0;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      g[p] = l; soma += l;
      if (l < 12) escuros++; else if (l > 245) claros++;
    }
    const n = w * h, luma = soma / n;
    const hist = new Uint32Array(512);
    let total = 0;
    for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) {
      const p = yy * w + xx;
      const m = Math.min(511, Math.round(Math.abs(g[p + 1] - g[p - 1]) + Math.abs(g[p + w] - g[p - w])));
      hist[m]++; total++;
    }
    let acc = 0, p95 = 0;
    for (let k = 0; k < 512; k++) { acc += hist[k]; if (acc >= total * 0.95) { p95 = k; break; } }
    const flags = [];
    const escura = luma < 45 || escuros / n > 0.6, estourada = luma > 215 && claros / n > 0.5;
    if (escura) flags.push('escura');
    if (estourada) flags.push('estourada');
    if (p95 < 8 && !escura && !estourada) flags.push('tremida'); // sem bordas num quadro bem exposto: tremida ou superfície lisa

    let blob = file, ow = W, oh = H;
    if (maxPx > 0) { const r = await enc(maxPx, 0.9); blob = r.blob; ow = r.w; oh = r.h; }
    bmp.close?.();
    postMessage({ id, ok: true, blob, thumb: thumb.blob, w: ow, h: oh, q: { nit: p95, luma: Math.round(luma), flags } });
  } catch (err) {
    postMessage({ id, ok: false, erro: String(err && err.message || err) });
  }
};
