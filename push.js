// Avisos no celular (push): ativar/desativar neste aparelho. O envio é feito pelo servidor (função "avisar").
import { VAPID_PUBLIC } from './config.js';
import * as Nuvem from './nuvem.js';

export const suportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const chave = () => {
  const p = '='.repeat((4 - (VAPID_PUBLIC.length % 4)) % 4), b = (VAPID_PUBLIC + p).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
};
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const instalado = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// 'indisponivel' | 'instalar' (iPhone fora da tela inicial) | 'negado' | 'inativo' | 'ativo'
export async function estado() {
  if (!suportado()) return ios() && !instalado() ? 'instalar' : 'indisponivel';
  if (ios() && !instalado()) return 'instalar';
  if (Notification.permission === 'denied') return 'negado';
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) ? 'ativo' : 'inativo';
  } catch { return 'indisponivel'; }
}

export async function ativar() {
  if (!Nuvem.logado()) throw new Error('Entre na sua conta (☁) primeiro.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão negada. Libere as notificações nas configurações do navegador.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave() });
  await Nuvem.salvarPush(sub.toJSON());
}

export async function desativar() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await Nuvem.apagarPush(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}
