// Motion layer (GSAP). Everything here only moves things that are already on the page: if this file
// fails, the page is simply static. All travel is switched off under "reduce motion"; there the page
// keeps a short fade only. Transform, opacity and clip-path only (no layout properties).
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

gsap.registerPlugin(ScrollTrigger);

const REDUCED = '(prefers-reduced-motion: reduce)';
const FULL = '(prefers-reduced-motion: no-preference)';
export const prefersReduced = (): boolean => typeof window !== 'undefined' && window.matchMedia?.(REDUCED).matches === true;

/** Expo-out for reveals, quint-out for short moves (the design system's curves). */
const EXPO = 'expo.out';
const QUINT = 'power4.out';

// ------------------------------------------------------------------ counting figures ----
const NUM_RE = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/;

/** Counts a displayed figure ("7,570", "28.20", "-3.8") up from zero, then leaves the exact text. */
function countUp(el: Element, delay = 0): void {
  const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) as Text | undefined;
  if (!node) return;
  const text = node.data.trim();
  if (!NUM_RE.test(text)) return;
  const target = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(target) || target === 0) return;
  const decimals = text.includes('.') ? text.split('.')[1].length : 0;
  const grouped = text.includes(',');
  const fmt = (v: number) => grouped
    ? v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : v.toFixed(decimals);
  const state = { v: 0 };
  let written = node.data;
  const tween = gsap.to(state, {
    v: target, duration: 1.1, delay, ease: EXPO,
    onStart: () => { written = fmt(0); node.data = written; },
    onUpdate: () => {
      // React replaced the value meanwhile (new data arrived): stop and keep React's text.
      if (node.data !== written) { tween.kill(); return; }
      written = fmt(state.v); node.data = written;
    },
    onComplete: () => { if (node.data === written) node.data = text; },
  });
}

// --------------------------------------------------------------------- gauge sweep ----
function sweepGauge(root: Element): void {
  const ticks = root.querySelectorAll('.tick.on');
  const band = root.querySelector<SVGPathElement>('path.band');
  if (ticks.length) gsap.from(ticks, { opacity: 0.12, duration: 0.5, stagger: 0.025, ease: 'none', clearProps: 'opacity' });
  if (band && typeof band.getTotalLength === 'function') {
    const len = band.getTotalLength();
    gsap.fromTo(band, { strokeDasharray: len, strokeDashoffset: len }, { strokeDashoffset: 0, duration: 1.2, ease: EXPO, clearProps: 'strokeDasharray,strokeDashoffset' });
  }
}

// ------------------------------------------------------------ section entrances ----
/** One block arrives: rises with opacity; charts draw from left to right; figures count; gauges sweep. */
function enterBlocks(els: Element[], full: boolean): void {
  if (!full) { gsap.from(els, { opacity: 0, duration: 0.35, stagger: 0.03, clearProps: 'opacity' }); return; }
  gsap.from(els, { y: 26, opacity: 0, duration: 0.85, ease: EXPO, stagger: 0.07, clearProps: 'transform,opacity' });
  els.forEach((el, i) => {
    const d = i * 0.07;
    el.querySelectorAll('.chart-box, .ink-chart').forEach((box) =>
      gsap.fromTo(box, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 1.25, delay: d + 0.15, ease: 'power3.inOut', clearProps: 'clipPath' }));
    el.querySelectorAll('.kpi .value, .round-cell .r-value, .ink-value, .g-value, .kv .v, [data-count]').forEach((v) => countUp(v, d + 0.1));
    if (el.matches('.gauge-card, .sensor-card') || el.querySelector('.gauge')) sweepGauge(el);
  });
}

const BLOCKS = '.hero-row > *, .round-cell, .kpis > .kpi, .page > .card, .page > .grid > .card, .page > .grid > .grid > .card, .page > .grid > *:not(.card):not(.grid), .page > .filters, .page > .note';

/**
 * Plays the entrance of the page inside `root`: heading lines first, then each block as it scrolls
 * into view (once). Returns a cleanup function for route changes.
 */
export function animatePage(root: HTMLElement): () => void {
  const mm = gsap.matchMedia(root);
  mm.add({ full: FULL, reduced: REDUCED }, (ctx) => {
    const full = !!ctx.conditions?.full;
    const q = gsap.utils.selector(root);
    if (full) {
      const tl = gsap.timeline({ defaults: { ease: EXPO, duration: 0.9 } });
      tl.from(q('.greet .hello, .greet h1, .page-head h1'), { yPercent: 60, opacity: 0, stagger: 0.09, clearProps: 'transform,opacity' }, 0)
        .from(q('.greet .finding, .page-head p'), { y: 14, opacity: 0, duration: 0.7, clearProps: 'transform,opacity' }, 0.12)
        .from(q('.greet .greet-avatar'), { scale: 0.86, opacity: 0, duration: 0.8, clearProps: 'transform,opacity' }, 0)
        .from(q('.greet .actions > *, .page-head .actions > *'), { y: 10, opacity: 0, duration: 0.6, ease: QUINT, stagger: 0.06, clearProps: 'transform,opacity' }, 0.18);
      // the moving picture: the resort photo settles, then drifts very slowly while it is on screen
      const img = q('.hero-photo .hero-img');
      if (img.length) {
        gsap.fromTo(img, { scale: 1.12 }, { scale: 1, duration: 1.8, ease: 'power2.out' });
        const drift = gsap.to(img, { scale: 1.05, xPercent: -1.5, duration: 18, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.8, paused: true });
        ScrollTrigger.create({ trigger: img[0], start: 'top bottom', end: 'bottom top', onToggle: (s) => (s.isActive ? drift.play() : drift.pause()) });
      }
    } else {
      gsap.from(q('.greet, .page-head'), { opacity: 0, duration: 0.3, clearProps: 'opacity' });
    }
    const blocks = q(BLOCKS);
    ScrollTrigger.batch(blocks, { start: 'top 90%', once: true, interval: 0.08, batchMax: 6, onEnter: (els) => enterBlocks(els, full) });
    ScrollTrigger.refresh();
  });
  return () => mm.revert();
}

// ------------------------------------------------------------- sidebar highlight ----
/** Slides the highlight behind the active menu entry to its new place. */
export function moveGlider(glider: HTMLElement | null, target: HTMLElement | null, instant = false): void {
  if (!glider) return;
  if (!target) { gsap.to(glider, { opacity: 0, duration: 0.2 }); return; }
  const y = target.offsetTop, h = target.offsetHeight, x = target.offsetLeft, w = target.offsetWidth;
  if (instant || prefersReduced()) { gsap.set(glider, { y, x, height: h, width: w, opacity: 1 }); return; }
  gsap.to(glider, { y, x, height: h, width: w, opacity: 1, duration: 0.55, ease: 'power3.inOut', overwrite: true });
}

// ------------------------------------------------------------------- brand shapes ----
/** Very slow drift of the background shapes; stops when the tab is hidden and under reduced motion. */
export function driftShapes(root: HTMLElement): () => void {
  const mm = gsap.matchMedia();
  mm.add(FULL, () => {
    const shapes = gsap.utils.toArray<HTMLElement>(root.querySelectorAll('.shape'));
    const tweens = shapes.map((s, i) => gsap.to(s, {
      x: gsap.utils.random(-60, 60), y: gsap.utils.random(-40, 50), rotation: gsap.utils.random(-18, 18), scale: gsap.utils.random(0.94, 1.1),
      duration: 26 + i * 7, ease: 'sine.inOut', yoyo: true, repeat: -1,
    }));
    const vis = () => tweens.forEach((t) => (document.hidden ? t.pause() : t.resume()));
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  });
  return () => mm.revert();
}

/** Small press feedback for buttons (under the hand, 140 ms). */
export function pressFeedback(root: HTMLElement): () => void {
  if (prefersReduced()) return () => {};
  const down = (e: PointerEvent) => {
    const b = (e.target as Element | null)?.closest?.('.btn, .icon-btn, .round-cell, .nav-link');
    if (b) gsap.to(b, { scale: 0.97, duration: 0.14, ease: QUINT, overwrite: 'auto' });
  };
  const up = () => gsap.to(root.querySelectorAll('.btn, .icon-btn, .round-cell, .nav-link'), { scale: 1, duration: 0.3, ease: QUINT, overwrite: 'auto', clearProps: 'scale' });
  root.addEventListener('pointerdown', down);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
  return () => { root.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
}

// ----------------------------------------------------------------- smooth scrolling ----
let lenis: Lenis | null = null;

/**
 * Lenis smooth scrolling for the window, driven by GSAP's clock so ScrollTrigger reveals stay in step.
 * Off under reduced motion (the browser's own scrolling stays). Scrollable boxes inside the page (tables,
 * dialogs, menus, the sidebar) keep their own scrolling.
 */
export function smoothScroll(): () => void {
  if (prefersReduced() || lenis) return () => {};
  const l = new Lenis({ duration: 1.1, easing: (t) => 1 - Math.pow(2, -10 * t), smoothWheel: true, allowNestedScroll: true });
  lenis = l;
  l.on('scroll', ScrollTrigger.update);
  const tick = (time: number) => l.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  return () => { gsap.ticker.remove(tick); gsap.ticker.lagSmoothing(500, 33); l.destroy(); lenis = null; };
}

/** Back to the top of a new page at once (no glide across two pages). */
export function scrollToTop(): void {
  if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
  else window.scrollTo(0, 0);
}

/** Stops page scrolling while a full-screen layer (the phone menu) is open. */
export function holdScroll(on: boolean): void {
  document.documentElement.classList.toggle('scroll-held', on);
  if (lenis) { if (on) lenis.stop(); else lenis.start(); }
}
