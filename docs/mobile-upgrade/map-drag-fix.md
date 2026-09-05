# Departure map visibility and gesture correction

A `?boat=` link now starts the phone's vessel sheet collapsed. The floating vessel card is limited to 40% of the map height so the selected vessel remains visible above it. The tablet roster remains available alongside the map.

Panning previously mixed the logical camera (updated immediately) with the SVG screen transform (updated on the next animation frame). Multiple pointer events between frames therefore compounded offsets and caused jumps. Pan and pinch now use a transform and camera captured at gesture start. Switching from two fingers to one rebases the gesture. Canceled or duplicate pointer endings do not launch inertia; inertia uses elapsed frame time and the SVG's actual screen scale, including letterboxing.

The DOM regression covers multiple moves before a render and another move after rendering. The real Chromium check verifies the selected vessel is above its card and eight sequential mouse moves yield consistent, monotonic camera movement. `map-drag-checks.json` records the results; `map-departure-link.png` shows the entry state. Run `node scripts/check-mobile-map-drag.cjs` with the app server on port 8094 and Playwright Chromium installed. Actual iPhone touch behavior still needs confirmation. Shell version 93 includes the correction.
