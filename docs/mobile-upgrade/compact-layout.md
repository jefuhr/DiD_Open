# Compact typography and viewport follow-up

The board now uses smaller relative type: at a 16px browser text preference, departure times are 24px (previously 30px) and destinations are 18px (previously 22px). The header has a sentence-case landing name and two aligned rows instead of loosely wrapping controls. Touch targets remain at least 44px.

The app root uses the browser's preferred text size, with `font: -apple-system-body` where supported to opt into [WebKit's Dynamic Type behavior](https://webkit.org/blog/3709/using-the-system-font-in-web-content/). Theme typography is retained. Actual OS text-size propagation varies by browser; Chromium checks simulate a larger root text preference.

This initial attempt tracked visible viewport height and offset on resize, resume, and viewport changes. It did not solve the installed iOS gap: WebKit can report a shorter visual viewport. It is superseded by the [installed app viewport fix](installed-viewport-fix.md). Pinch zoom still leaves the layout alone and the alert bar retains safe-area padding for the home indicator.

`compact-board.png` shows the smaller layout in Pompompurin. `compact-layout-checks.json` records 15 browser combinations: five phone/tablet viewports and root text sizes of 16, 20, and 24px. In each, the alert bar ends at the visible viewport bottom, navigation targets remain 44px, and the page has no horizontal overflow. A DOM regression test covers viewport resize and pinch-zoom behavior. Shell and manifest asset versions are 91 so installed clients can receive the update.
