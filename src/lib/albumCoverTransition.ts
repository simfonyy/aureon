import { shallowRef } from 'vue';
import { useUiStore } from '@/stores/ui';

export interface CoverBounds { left: number; top: number; width: number; height: number; radius: number }
export interface CoverTransfer {
  token: number;
  albumId: string;
  destination: 'album' | 'home';
  src: string;
  from: CoverBounds;
  to: CoverBounds | null;
}

export const albumCoverTransfer = shallowRef<CoverTransfer | null>(null);
let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let probeFrame = 0;
let hidden = new Set<HTMLElement>();
let homeOrigin: { albumId: string; scrollTop: number; scrollLeft: number } | null = null;

export function albumCoverMotionAllowed(): boolean {
  return useUiStore().settings.animations && !window.matchMedia('(prefers-reduced-motion: reduce)').matches && !document.hidden;
}

function shelfReady(element: HTMLElement): boolean {
  const shelf = element.closest<HTMLElement>('.home-shelf-viewport');
  return !shelf || shelf.hasAttribute('data-home-shelf-ready');
}

function bounds(element: HTMLElement, arriving = false): CoverBounds | null {
  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8 || rect.left < -1 || rect.top < -1 || rect.right > window.innerWidth + 1 || rect.bottom > window.innerHeight + 1) return null;
  // A shelf can expose part of its next card. Flying its full image would make
  // that clipped part suddenly appear outside the shelf.
  for (const selector of ['.home-shelf-viewport', '.q-scrollarea__container']) {
    const clip = element.closest<HTMLElement>(selector);
    if (!clip?.getBoundingClientRect) continue;
    const edge = clip.getBoundingClientRect();
    if (rect.left < edge.left - 1 || rect.right > edge.right + 1 || rect.top < edge.top - 1 || rect.bottom > edge.bottom + 1) return null;
  }
  let top = rect.top, left = rect.left;
  // Incoming pages move down by 10 px in the existing route transition. Aim for
  // their resting position, rather than chasing that transform with the cover.
  const page = arriving ? element.closest<HTMLElement>('.page-enter-active') : null;
  if (page) {
    try { const matrix = new DOMMatrixReadOnly(getComputedStyle(page).transform); left -= matrix.m41; top -= matrix.m42; } catch { /* no transform */ }
  }
  return { left, top, width: rect.width, height: rect.height, radius: parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0 };
}

function image(element: HTMLElement): HTMLImageElement | null {
  const img = element instanceof HTMLImageElement ? element : element.querySelector('img');
  return img?.complete && img.naturalWidth > 0 ? img : null;
}

function conceal(element: HTMLElement) {
  hidden.add(element);
  element.setAttribute('data-cover-flight-hidden', '');
}

export function cancelAlbumCoverTransition(token?: number) {
  if (token !== undefined && albumCoverTransfer.value?.token !== token) return;
  clearTimeout(timer); timer = undefined;
  cancelAnimationFrame(probeFrame); probeFrame = 0;
  for (const element of hidden) element.removeAttribute('data-cover-flight-hidden');
  hidden.clear();
  albumCoverTransfer.value = null;
}

/** Capture before changing route. Only successfully loaded covers take part. */
export function beginAlbumCoverTransition(albumId: string, element: HTMLElement | null, destination: 'album' | 'home'): boolean {
  cancelAlbumCoverTransition();
  if (destination === 'album') homeOrigin = null;
  if (!element || !albumCoverMotionAllowed() || !shelfReady(element)) return false;
  const source = image(element), from = bounds(element);
  if (!source || !from) return false;
  if (destination === 'album') {
    const scroll = element.closest<HTMLElement>('.q-scrollarea__container');
    homeOrigin = { albumId, scrollTop: scroll?.scrollTop ?? 0, scrollLeft: scroll?.scrollLeft ?? 0 };
  } else if (homeOrigin?.albumId !== albumId) return false;
  const token = ++sequence;
  albumCoverTransfer.value = { token, albumId, destination, src: source.currentSrc || source.src, from, to: null };
  conceal(element);
  // Slow/failed routes always fall back to their normal cover; no image is held
  // over a loading screen indefinitely.
  timer = setTimeout(() => cancelAlbumCoverTransition(token), 1800);
  return true;
}

/** Called by the destination page after rendering, including async SWR content. */
export function finishAlbumCoverTransition(albumId: string, element: HTMLElement | null) {
  const transfer = albumCoverTransfer.value;
  if (!transfer || transfer.albumId !== albumId || transfer.to || !element) return;
  const token = transfer.token;
  cancelAnimationFrame(probeFrame);
  const probe = () => {
    probeFrame = 0;
    if (albumCoverTransfer.value?.token !== token) return;
    if (!albumCoverMotionAllowed() || !element.isConnected) { cancelAlbumCoverTransition(token); return; }
    if (!shelfReady(element)) { probeFrame = requestAnimationFrame(probe); return; }
    const targetImage = image(element), to = bounds(element, true);
    if (!targetImage || !to) { probeFrame = requestAnimationFrame(probe); return; }
    conceal(element);
    clearTimeout(timer);
    albumCoverTransfer.value = { ...transfer, to };
    timer = setTimeout(() => cancelAlbumCoverTransition(token), 900);
  };
  probe();
}

/** Home may first render cached data, then receive its album cards through SWR. */
export function arriveHomeAlbumCoverTransition() {
  const transfer = albumCoverTransfer.value;
  if (!transfer || transfer.destination !== 'home') return;
  const token = transfer.token;
  cancelAnimationFrame(probeFrame);
  const probe = () => {
    probeFrame = 0;
    if (albumCoverTransfer.value?.token !== token) return;
    if (!albumCoverMotionAllowed()) { cancelAlbumCoverTransition(token); return; }
    const element = [...document.querySelectorAll<HTMLElement>('[data-home-album-cover]')]
      .find(candidate => candidate.dataset.homeAlbumCover === transfer.albumId);
    if (!element) { probeFrame = requestAnimationFrame(probe); return; }
    if (!shelfReady(element)) { probeFrame = requestAnimationFrame(probe); return; }
    const scroll = element.closest<HTMLElement>('.q-scrollarea__container');
    if (scroll && homeOrigin?.albumId === transfer.albumId) {
      scroll.scrollTop = homeOrigin.scrollTop;
      scroll.scrollLeft = homeOrigin.scrollLeft;
    }
    finishAlbumCoverTransition(transfer.albumId, element);
  };
  probe();
}

/** A route change that bypasses the expected destination must release the scene. */
export function guardAlbumCoverRoute(path: string) {
  const transfer = albumCoverTransfer.value;
  if (!transfer) return;
  const expected = transfer.destination === 'home' ? '/' : `/album/${transfer.albumId}`;
  if (path !== expected) cancelAlbumCoverTransition(transfer.token);
}

export function reconcileAlbumCoverScroll() {
  const transfer = albumCoverTransfer.value;
  if (!transfer) return;
  if (!transfer.to) { cancelAlbumCoverTransition(transfer.token); return; }
  const target = [...hidden].find(element => element.isConnected && !element.closest('.page-leave-active'));
  const current = target ? bounds(target, true) : null;
  // Restoring Home's saved scroll position does not move the measured target.
  // User scrolling does, so end at the real DOM cover instead of flying to stale coordinates.
  if (!current || Math.abs(current.left - transfer.to.left) > 1 || Math.abs(current.top - transfer.to.top) > 1) cancelAlbumCoverTransition(transfer.token);
}
