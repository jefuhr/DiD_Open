/**
 * Demo: a harbor departure board that stays live.
 *
 * Departures are generated relative to the moment the page loads, so the
 * countdowns actually count down, boats leave, and new ones get added to the
 * bottom of the board — which is the only honest way to show off a display
 * whose whole job is changing text.
 */

const ROUTES = [
  { code: 'ER', name: 'ST. GEORGE', pier: 'SLIP A' },
  { code: 'SB', name: 'BAY RIDGE', pier: 'SLIP B' },
  { code: 'RW', name: 'ROCKAWAY', pier: 'SLIP C' },
  { code: 'AS', name: 'ASTORIA', pier: 'SLIP A' },
  { code: 'SV', name: 'SOUNDVIEW', pier: 'SLIP D' },
  { code: 'GI', name: 'GOVERNORS IS', pier: 'SLIP B' },
];

const COLS = 32;
const ROWS = 6;

/** Deal out the next `count` departures, first one a couple of minutes out. */
function schedule(count, now = Date.now()) {
  const departures = [];
  let offset = 2 * 60_000;
  for (let i = 0; i < count; i += 1) {
    const route = ROUTES[i % ROUTES.length];
    departures.push({
      at: now + offset,
      route,
      delayed: i > 0 && i % 4 === 0,
    });
    offset += (4 + ((i * 7) % 9)) * 60_000;
  }
  return departures;
}

function clockTime(ms) {
  const date = new Date(ms);
  let hours = date.getHours() % 12;
  if (hours === 0) hours = 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}${date.getHours() < 12 ? 'A' : 'P'}`;
}

function status(departure, now) {
  const minutes = Math.round((departure.at - now) / 60_000);
  if (minutes <= 0) return 'DEPARTED';
  if (minutes <= 1) return 'NOW';
  if (minutes <= 5) return 'BOARDING';
  if (departure.delayed) return 'DELAYED';
  if (minutes >= 60) return `${Math.floor(minutes / 60)} HR`;
  return `${minutes} MIN`;
}

function pad(text, width, align = 'left') {
  const value = String(text).slice(0, width);
  const fill = ' '.repeat(width - value.length);
  return align === 'right' ? fill + value : value + fill;
}

function row(departure, now) {
  return [
    pad(clockTime(departure.at), 6),
    pad(departure.route.code, 2),
    pad(departure.route.name, 13),
    pad(status(departure, now), 8, 'right'),
  ].join(' ');
}

export function start({ board, clock, header }) {
  let departures = schedule(ROWS + 4);

  if (header) header.lines = ['PIER 11 / WALL ST'];
  if (clock) clock.align = 'right';

  const render = () => {
    const now = Date.now();
    // Boats that have gone stay up for a beat, then fall off the top.
    departures = departures.filter((departure) => departure.at > now - 45_000);
    if (departures.length < ROWS + 2) {
      const last = departures.at(-1)?.at ?? now;
      departures.push(...schedule(4, last + 6 * 60_000));
    }
    board.lines = departures.slice(0, ROWS).map((departure) => row(departure, now));
    if (clock) clock.lines = [clockTime(now)];
  };

  render();
  return setInterval(render, 5000);
}

export const layout = { COLS, ROWS };
