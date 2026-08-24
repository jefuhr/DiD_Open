import test from 'node:test';
import assert from 'node:assert/strict';
import { ALPHABET, Flap, distance, indexOf, normalize } from '../src/flap.js';

test('the drum starts blank and holds no duplicates', () => {
  assert.equal(ALPHABET[0], ' ');
  assert.equal(new Set(ALPHABET).size, ALPHABET.length);
});

test('normalize raises case and folds anything off-drum to blank', () => {
  assert.equal(normalize('c'), 'C');
  assert.equal(normalize('7'), '7');
  assert.equal(normalize('~'), ' ');
  assert.equal(normalize(''), ' ');
  assert.equal(normalize(undefined), ' ');
  assert.equal(indexOf('~'), 0);
});

test('distance only ever counts forward, wrapping past the end of the drum', () => {
  assert.equal(distance('A', 'C'), 2);
  assert.equal(distance('A', 'A'), 0);
  assert.equal(distance('C', 'A'), ALPHABET.length - 2);
  assert.equal(distance(' ', 'A'), 1);
});

test('a flap reaches its target in exactly distance() ticks', () => {
  const flap = new Flap('A');
  flap.setTarget('e');
  const expected = distance('A', 'E');
  for (let i = 0; i < expected; i += 1) {
    assert.equal(flap.settled, false, `settled early at tick ${i}`);
    assert.equal(flap.tick(), true);
  }
  assert.equal(flap.char, 'E');
  assert.equal(flap.settled, true);
  assert.equal(flap.tick(), false, 'a settled flap does not move');
});

test('a start delay holds the flap still, then it clacks as normal', () => {
  const flap = new Flap(' ', 3);
  flap.setTarget('A');
  assert.equal(flap.remaining, 4);
  assert.deepEqual([flap.tick(), flap.tick(), flap.tick()], [false, false, false]);
  assert.equal(flap.char, ' ');
  assert.equal(flap.tick(), true);
  assert.equal(flap.char, 'A');
});

test('retargeting a resting flap restarts its delay; asking for what it shows does nothing', () => {
  const flap = new Flap('A', 2);
  flap.setTarget('A');
  assert.equal(flap.remaining, 0, 'no wait for a target it is already showing');
  flap.setTarget('B');
  assert.equal(flap.remaining, 3);
});

test('settle snaps to the target without animating', () => {
  const flap = new Flap('A', 10);
  flap.setTarget('Z').settle();
  assert.equal(flap.char, 'Z');
  assert.equal(flap.settled, true);
});
