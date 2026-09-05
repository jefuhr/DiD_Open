# Route-card sizing and drawer sorting

Phone route cards inherited `flex-shrink: 1` while the scrolling parent had a fixed available height. Because cards also allowed zero minimum height and clipped overflow, all route cards compressed into thin strips. Timeline cards already used `flex: 0 0 auto`. Route cards now also retain their natural content height; the list scrolls instead of squeezing its children.

Route / Departure time sorting lives at the bottom of the full-height landing drawer. The landing list scrolls independently above it. This applies to the docked tablet sidebar as well. The board footer retains date, operator, theme, and clock controls.

Verification: all 337 Node tests pass. `node scripts/check-mobile-route-layout.cjs` (with the application server running on port 8094 and Playwright Chromium installed) checks 21 route cards across five viewport sizes and three text sizes. All 15 combinations have zero clipped cards or page overflow. It also checks that sorting sits at the drawer bottom and is absent from the board footer. Results and screenshots: `route-layout-checks.json`, `route-cards-fixed.png`, `drawer-sort-bottom.png`. Physical iOS verification remains outstanding. Asset version 92 delivers this fix to installed clients.
