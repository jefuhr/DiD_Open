/**
 * <split-flap> — the engine, wearing a board.
 *
 * Attributes: rows, cols, stagger, fps, sound.
 * Property: `lines` (string[]) — assign to it and the board clacks over.
 *
 *   const board = document.querySelector('split-flap');
 *   board.lines = ['PIER 11', '7:04 PM'];
 */

import { Board } from './board.js';

const STYLE = `
  :host {
    --flap-bg: #14161a;
    --flap-fg: #f2f0e6;
    --flap-hinge: rgba(0, 0, 0, 0.55);
    --flap-radius: 0.12em;
    --flap-gap: 0.06em;
    display: inline-block;
    font-family: ui-monospace, "SF Mono", "Roboto Mono", Menlo, monospace;
    font-size: 32px;
    line-height: 1;
  }
  .board { display: grid; gap: calc(var(--flap-gap) * 2); }
  .row { display: flex; gap: var(--flap-gap); }
  .cell {
    position: relative;
    width: 0.72em;
    height: 1.1em;
    border-radius: var(--flap-radius);
    background: linear-gradient(180deg, #23262c 0%, var(--flap-bg) 49%, #0e1013 51%, #1a1d22 100%);
    color: var(--flap-fg);
    display: grid;
    place-items: center;
    font-weight: 600;
    text-shadow: 0 1px 0 rgba(0, 0, 0, 0.8);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.05), 0 1px 2px rgba(0, 0, 0, 0.5);
    transform-style: preserve-3d;
    will-change: transform;
  }
  .cell::after {
    content: "";
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    height: 1px;
    background: var(--flap-hinge);
  }
  .cell.flip { animation: flap 90ms ease-in; }
  @keyframes flap {
    0% { transform: perspective(200px) rotateX(0deg); }
    55% { transform: perspective(200px) rotateX(-38deg); }
    100% { transform: perspective(200px) rotateX(0deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .cell.flip { animation: none; }
  }
`;

class Clack {
  constructor() {
    this.ctx = null;
  }

  play() {
    const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctx) return;
    this.ctx ??= new Ctx();
    const ctx = this.ctx;
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    const frames = Math.floor(ctx.sampleRate * 0.03);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 6;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(now);
  }
}

export class SplitFlapElement extends HTMLElement {
  static observedAttributes = ['rows', 'cols', 'stagger', 'fps', 'sound'];

  #board = null;
  #cells = [];
  #lines = [];
  #align = 'left';
  #timer = null;
  #clack = new Clack();

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this.#build();
  }

  disconnectedCallback() {
    this.#stop();
  }

  attributeChangedCallback(name) {
    if (!this.shadowRoot) return;
    if (name === 'fps' || name === 'sound') return;
    this.#build();
  }

  /** Text the board has been asked to show. */
  get lines() {
    return [...this.#lines];
  }

  set lines(value) {
    this.#lines = Array.isArray(value) ? value.map(String) : [String(value ?? '')];
    this.#board?.setLines(this.#lines, this.#align);
    this.#start();
  }

  /** 'left' | 'right' | 'center' — applied on the next assignment to `lines`. */
  get align() {
    return this.#align;
  }

  set align(value) {
    this.#align = value;
    this.#board?.setLines(this.#lines, this.#align);
    this.#start();
  }

  #number(name, fallback) {
    const raw = Number(this.getAttribute(name));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  #build() {
    const rows = Math.max(1, Math.round(this.#number('rows', this.#lines.length || 1)));
    const cols = Math.max(1, Math.round(this.#number('cols', 12)));
    const stagger = Math.round(Number(this.getAttribute('stagger')) || 0);

    this.#stop();
    this.#board = new Board({ rows, cols, stagger });

    const style = document.createElement('style');
    style.textContent = STYLE;
    const board = document.createElement('div');
    board.className = 'board';
    board.setAttribute('role', 'img');

    this.#cells = [];
    for (let r = 0; r < rows; r += 1) {
      const row = document.createElement('div');
      row.className = 'row';
      const cells = [];
      for (let c = 0; c < cols; c += 1) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.textContent = ' ';
        row.append(cell);
        cells.push(cell);
      }
      this.#cells.push(cells);
      board.append(row);
    }

    this.shadowRoot.replaceChildren(style, board);
    if (this.#lines.length) {
      this.#board.setLines(this.#lines, this.#align);
      this.#start();
    }
  }

  #paint(animate) {
    const shown = this.#board.lines();
    for (let r = 0; r < this.#cells.length; r += 1) {
      const row = shown[r];
      for (let c = 0; c < this.#cells[r].length; c += 1) {
        const cell = this.#cells[r][c];
        const next = row[c];
        if (cell.textContent === next) continue;
        cell.textContent = next;
        if (!animate) continue;
        cell.classList.remove('flip');
        void cell.offsetWidth;
        cell.classList.add('flip');
      }
    }
    this.shadowRoot.querySelector('.board')?.setAttribute('aria-label', shown.join(' — ').trim());
  }

  #start() {
    if (!this.#board || this.#timer !== null) return;
    const interval = 1000 / this.#number('fps', 14);
    const sound = this.hasAttribute('sound');
    let last = 0;
    const frame = (now) => {
      if (now - last >= interval) {
        last = now;
        if (this.#board.tick()) {
          this.#paint(true);
          if (sound) this.#clack.play();
        }
      }
      if (this.#board.settled) {
        this.#timer = null;
        this.#paint(false);
        this.dispatchEvent(new CustomEvent('settled', { detail: { lines: this.#board.lines() } }));
        return;
      }
      this.#timer = requestAnimationFrame(frame);
    };
    this.#timer = requestAnimationFrame(frame);
  }

  #stop() {
    if (this.#timer !== null) cancelAnimationFrame(this.#timer);
    this.#timer = null;
  }
}

if (globalThis.customElements && !customElements.get('split-flap')) {
  customElements.define('split-flap', SplitFlapElement);
}
