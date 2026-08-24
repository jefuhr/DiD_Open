/**
 * A single flap: one character position on a split-flap board.
 *
 * Real boards can only advance in one direction. A flap holds a drum of
 * characters and clacks forward one step per tick until the character it is
 * showing matches the one it was asked for, wrapping past the end of the drum.
 * That constraint is the whole reason the boards look the way they do, so the
 * engine keeps it rather than jumping straight to the target.
 */

/** The drum, in physical order. Position 0 is blank, as on a real unit. */
export const ALPHABET = [
  ' ',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'0123456789',
  ...":.,'-!?/&$#*+()",
];

const INDEX = new Map(ALPHABET.map((ch, i) => [ch, i]));

/** Fold a character onto the drum. Lowercase is raised; anything else is blank. */
export function normalize(ch) {
  if (typeof ch !== 'string' || ch.length === 0) return ' ';
  const upper = ch[0].toUpperCase();
  return INDEX.has(upper) ? upper : ' ';
}

/** Drum position of a character, after normalizing it. */
export function indexOf(ch) {
  return INDEX.get(normalize(ch));
}

/** Ticks needed to clack from one character to another, going forward only. */
export function distance(from, to) {
  const delta = indexOf(to) - indexOf(from);
  return delta < 0 ? delta + ALPHABET.length : delta;
}

export class Flap {
  /**
   * @param {string} char  character showing at rest
   * @param {number} delay ticks to wait before this flap starts moving
   */
  constructor(char = ' ', delay = 0) {
    this.index = indexOf(char);
    this.targetIndex = this.index;
    this.delay = delay;
    this.wait = 0;
  }

  get char() {
    return ALPHABET[this.index];
  }

  get target() {
    return ALPHABET[this.targetIndex];
  }

  get settled() {
    return this.index === this.targetIndex;
  }

  /** Ticks left before this flap comes to rest, including its start delay. */
  get remaining() {
    return this.settled ? 0 : this.wait + distance(this.char, this.target);
  }

  /** Ask for a character. Restarts the start delay if the target actually moves. */
  setTarget(char) {
    const next = indexOf(char);
    if (next === this.targetIndex) return this;
    this.targetIndex = next;
    this.wait = this.settled ? 0 : this.delay;
    return this;
  }

  /** Advance one frame. Returns true if the visible character changed. */
  tick() {
    if (this.settled) return false;
    if (this.wait > 0) {
      this.wait -= 1;
      return false;
    }
    this.index = (this.index + 1) % ALPHABET.length;
    return true;
  }

  /** Snap to the target with no animation. */
  settle() {
    this.index = this.targetIndex;
    this.wait = 0;
    return this;
  }
}
