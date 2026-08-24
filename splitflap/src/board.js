/**
 * A grid of flaps.
 *
 * The board owns layout — fixed rows and columns, text padded or clipped to
 * fit — and the stagger that gives a board its wave: column n starts moving
 * n * stagger ticks after the row is set, so the change sweeps left to right
 * instead of every unit clacking in lockstep.
 */

import { Flap, normalize } from './flap.js';

/** Pad or clip a line to exactly `cols` normalized characters. */
export function fit(line, cols, align = 'left') {
  const chars = [...String(line ?? '')].map(normalize).slice(0, cols);
  const pad = cols - chars.length;
  if (pad <= 0) return chars;
  const blanks = Array(pad).fill(' ');
  if (align === 'right') return [...blanks, ...chars];
  if (align === 'center') {
    const left = Math.floor(pad / 2);
    return [...Array(left).fill(' '), ...chars, ...Array(pad - left).fill(' ')];
  }
  return [...chars, ...blanks];
}

export class Board {
  /**
   * @param {object} opts
   * @param {number} opts.rows
   * @param {number} opts.cols
   * @param {number} [opts.stagger] ticks of lag added per column
   */
  constructor({ rows, cols, stagger = 0 }) {
    if (!Number.isInteger(rows) || rows < 1) throw new RangeError('rows must be a positive integer');
    if (!Number.isInteger(cols) || cols < 1) throw new RangeError('cols must be a positive integer');
    this.rows = rows;
    this.cols = cols;
    this.stagger = stagger;
    this.flaps = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, (_, c) => new Flap(' ', c * stagger)),
    );
  }

  /** Every flap is showing what it was asked for. */
  get settled() {
    return this.flaps.every((row) => row.every((flap) => flap.settled));
  }

  /** Ticks until the last flap comes to rest. */
  get remaining() {
    let most = 0;
    for (const row of this.flaps) {
      for (const flap of row) most = Math.max(most, flap.remaining);
    }
    return most;
  }

  /**
   * Ask the board for new text.
   * @param {string[]} lines one string per row; missing rows go blank
   * @param {'left'|'right'|'center'} [align]
   */
  setLines(lines, align = 'left') {
    for (let r = 0; r < this.rows; r += 1) {
      const chars = fit(lines?.[r] ?? '', this.cols, align);
      for (let c = 0; c < this.cols; c += 1) this.flaps[r][c].setTarget(chars[c]);
    }
    return this;
  }

  /** Advance one frame. Returns true if anything visibly moved. */
  tick() {
    let moved = false;
    for (const row of this.flaps) {
      for (const flap of row) moved = flap.tick() || moved;
    }
    return moved;
  }

  /** What the board is showing right now. */
  lines() {
    return this.flaps.map((row) => row.map((flap) => flap.char).join(''));
  }

  /** Snap every flap to its target with no animation. */
  settle() {
    for (const row of this.flaps) {
      for (const flap of row) flap.settle();
    }
    return this;
  }

  /**
   * Run frames until the board rests.
   * @param {number} [maxTicks] safety stop; throws if the board has not settled
   * @returns {number} frames actually run
   */
  run(maxTicks = 10000) {
    let ticks = 0;
    while (!this.settled) {
      if (ticks >= maxTicks) throw new Error(`board did not settle within ${maxTicks} ticks`);
      this.tick();
      ticks += 1;
    }
    return ticks;
  }
}
