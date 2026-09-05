# The strip under the alert bar on an installed board

Built on local `mobile`. Supersedes the first attempt at this, `4fad843`, which read the
symptom backwards and cut the alert bar in half.

## What the phone actually showed

Two home-screen screenshots of the same iPhone (390×844pt, 3×), taken twenty-six minutes
apart, measured pixel by pixel:

| | shell height | alert bar | painted down to |
| --- | ---: | --- | ---: |
| Before `4fad843` (shell sized from `visualViewport.height`) | 797pt | whole bar, home-indicator padding and all | 797pt |
| After `4fad843` (shell sized `100vh` when installed) | 844pt | second line and padding gone, first line cut through the middle | 797pt |

The shell moved down by 47pt and the bar's last line disappeared, but the yellow ended on
exactly the same screen row both times, with the same 47pt of page-background colour below
it and the home indicator sitting in that strip.

47pt is the status bar. That is the whole diagnosis: with
`apple-mobile-web-app-status-bar-style: black-translucent`, iOS lets the board draw under the
status bar and then gives it a web view one status bar shorter than the window, anchored to the
top. The board is painted from 0 to 797 on an 844pt screen; the system fills the rest with the
document's background colour, which is why the strip is canvas-coloured rather than white or
navy, and why nothing the page does can reach it.

The two measurements disagree because they answer different questions. `visualViewport.height`
and `innerHeight` report 797 — what is on screen. CSS `vh` reports 844 — the window. `4fad843`
took the difference as WebKit under-reporting and forced `100vh`, so the shell hung 47pt over
the edge the screen stops painting at, and the last thing in it lost its bottom half. The
`env(safe-area-inset-bottom)` iOS hands out is measured against that window too, which is why
the bar's home-indicator clearance was landing 47pt above the home indicator.

## The change

- `public/index.html`, `public/map.html`: `default` instead of `black-translucent`. The web view
  then starts below the status bar and ends at the screen's own bottom edge. This is the fix;
  everything else keeps the board honest while it gets there.
  `env(safe-area-inset-top)` goes to 0 to match, which every use of it here already tolerates —
  they all add it to a padding rather than standing in for one.
- `public/assets/mobile-runtime.js`, `public/assets/mobile-console.css`: the shell is measured
  from the visual viewport again, with no branch on how the board was launched and no `100vh`.
  A viewport unit describes the window; only `visualViewport` describes what is painted. The
  keyboard is now recognised by the one thing that distinguishes it — it shrinks the visual
  viewport without shrinking `innerHeight` — rather than by tracking focus, which also means the
  bottom safe-area padding gets out of the way without any state to get stuck in.

An already-installed icon may hold the status bar style it was added with. If the strip survives
a deploy, remove the board from the home screen and add it again.

## Verification

- 344 Node tests pass, including the shell tracking the visual viewport on board and map, the
  keyboard opening and closing, a shrink too small to be a keyboard, pinch zoom, rotation, and
  the kiosk keeping the fixed screen it was drawn for.
- 26 browser geometry checks pass in `viewport-checks.json`. The fixture reports a window of 844
  with 47 of it unpainted, as the phone does, and every check asserts that a shell, drawer, sheet
  or alert bar ends where the paint ends. `viewport-baseline.json` is the same run against
  `4fad843`: it overshoots in nine of the thirteen cases per view — every one where the window is
  larger than what is painted in it.
- Existing route-layout and map-drag checks pass; the browser runs report no page errors.

Run an application server at `MOBILE_TEST_ORIGIN` (default `http://127.0.0.1:8094`), then:

```sh
npm test
npm run test:mobile-viewport
node scripts/check-mobile-viewport.cjs --baseline
npm run test:mobile-route-layout
npm run test:mobile-map-drag
```

The limit worth stating plainly: Chromium can be told to report a short visual viewport, so the
shell-sizing half of this is genuinely tested. It cannot reproduce an iOS web view that is
smaller than its window, so the screenshots here show the shell stopping at 797 rather than the
screen doing it, and the status bar change itself — the part that removes the strip — has been
reasoned from the two device screenshots and not reproduced on a physical iPhone. Home-screen
launch, rotation and resume still need confirming on the phone.

Asset version 96, generated with `npm run stamp:bump`. No deployment was performed.
