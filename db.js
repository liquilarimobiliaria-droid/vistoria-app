// IndexedDB: vistorias (metadados + roteiro) e fotos/vídeos (blobs). Tudo local no aparelho.
// v2: esquema de itens do MASTER (condição/verificação). Versões de teste anteriores são descartadas.
let dbp;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('vistoria-liquilar', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const n of Array.from(d.objectStoreNames)) d.deleteObjectStore(n);
        d.createObjectStore('vistorias', { keyPath: 'id' });
        d.createObjectStore('fotos', { keyPath: 'id' }).createIndex('vistoria', 'vistoriaId');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

function tx(store, mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    let out;
    const rq = fn(t.objectStore(store));
    if (rq) rq.onsuccess = () => { out = rq.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const putV = (v) => tx('vistorias', 'readwrite', (s) => s.put(v));
export const getV = (id) => tx('vistorias', 'readonly', (s) => s.get(id));
export const allV = () => tx('vistorias', 'readonly', (s) => s.getAll());
export const putF = (f) => tx('fotos', 'readwrite', (s) => s.put(f));
export const delF = (id) => tx('fotos', 'readwrite', (s) => s.delete(id));
export const fotosDe = (vid) => tx('fotos', 'readonly', (s) => s.index('vistoria').getAll(vid));

export function delVistoria(id) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(['vistorias', 'fotos'], 'readwrite');
    t.objectStore('vistorias').delete(id);
    const fs = t.objectStore('fotos');
    const rq = fs.index('vistoria').openKeyCursor(IDBKeyRange.only(id));
    rq.onsuccess = () => {
      const c = rq.result;
      if (c) { fs.delete(c.primaryKey); c.continue(); }
    };
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  }));
}
