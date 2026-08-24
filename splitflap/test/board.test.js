import test from 'node:test';
import assert from 'node:assert/strict';
import { Board, fit } from '../src/board.js';

test('fit pads, clips and aligns to the column count', () => {
  assert.equal(fit('ok', 5).join(''), 'OK   ');
  assert.equal(fit('ok', 5, 'right').join(''), '   OK');
  assert.equal(fit('ok', 6, 'center').join(''), '  OK  ');
  assert.equal(fit('overlong', 4).join(''), 'OVER');
  assert.equal(fit(null, 3).join(''), '   ');
});

test('a board starts blank and lands on exactly what it was asked for', () => {
  const board = new Board({ rows: 2, cols: 8 });
  assert.deepEqual(board.lines(), ['        ', '        ']);
  board.setLines(['pier 11', 'st george']);
  board.run();
  assert.deepEqual(board.lines(), ['PIER 11 ', 'ST GEORG']);
  assert.equal(board.settled, true);
});

test('rows with no text given are blanked rather than left stale', () => {
  const board = new Board({ rows: 2, cols: 4 });
  board.setLines(['hold', 'gone']).run();
  board.setLines(['hold']).run();
  assert.deepEqual(board.lines(), ['HOLD', '    ']);
});

test('stagger lags each column, and run() takes exactly the predicted frames', () => {
  const board = new Board({ rows: 1, cols: 2, stagger: 2 });
  board.setLines(['ab']);
  assert.equal(board.remaining, 4);
  board.tick();
  assert.deepEqual(board.lines(), ['A '], 'column 0 moves while column 1 still waits');
  assert.equal(board.run(), 3, 'three more frames finish the sweep');
  assert.deepEqual(board.lines(), ['AB']);
});

test('settle skips the animation entirely', () => {
  const board = new Board({ rows: 1, cols: 3, stagger: 5 });
  board.setLines(['yes']).settle();
  assert.deepEqual(board.lines(), ['YES']);
  assert.equal(board.remaining, 0);
});

test('run gives up rather than spinning forever', () => {
  const board = new Board({ rows: 1, cols: 1 });
  board.setLines(['z']);
  assert.throws(() => board.run(1), /did not settle/);
});

test('the shape of the board is validated up front', () => {
  assert.throws(() => new Board({ rows: 0, cols: 4 }), RangeError);
  assert.throws(() => new Board({ rows: 2, cols: 1.5 }), RangeError);
});
