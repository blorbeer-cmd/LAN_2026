// Web Push opt-in: registers the service worker, asks for notification
// permission, and subscribes/unsubscribes with the backend. Kept separate
// from whoami.js since it's a device-level capability (permission, SW
// registration) layered on top of "who am I", not part of identity itself.

import { api } from './api.js';

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// urlBase64 -> Uint8Array, as required by pushManager.subscribe()'s
// applicationServerKey option. Standard snippet for VAPID keys.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function getPushSubscriptionState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.getRegistration();
  const sub = registration ? await registration.pushManager.getSubscription() : null;
  return sub ? 'subscribed' : 'unsubscribed';
}

// pushManager.subscribe() talks to the browser vendor's push service (e.g.
// Google FCM) over the internet — unlike the rest of this app, that's not
// something the local LAN-party server can provide, so a restrictive network
// can leave it hanging indefinitely. Time it out rather than leaving the
// toggle stuck on "wird aktiviert…" forever.
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

export async function enablePush(playerId) {
  const registration = await navigator.serviceWorker.register('/sw.js');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Berechtigung für Benachrichtigungen wurde nicht erteilt.');

  const { publicKey } = await api.push.vapidPublicKey();
  const subscription = await withTimeout(
    registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }),
    15000,
    'Keine Verbindung zum Push-Dienst (braucht Internet, nicht nur das LAN). Bitte später erneut versuchen.'
  );
  await api.push.subscribe(playerId, subscription.toJSON());
}

export async function disablePush() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (!subscription) return;
  await api.push.unsubscribe(subscription.endpoint);
  await subscription.unsubscribe();
}

// A browser push endpoint belongs to the signed-in account, not to the
// device forever. Logout detaches it server-side without deleting the
// browser subscription; the next login can then rebind the same endpoint.
export async function detachPushSubscription() {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (subscription) await api.push.unsubscribe(subscription.endpoint);
}

export async function rebindExistingPushSubscription(playerId) {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = registration ? await registration.pushManager.getSubscription() : null;
  if (subscription) await api.push.subscribe(playerId, subscription.toJSON());
}
