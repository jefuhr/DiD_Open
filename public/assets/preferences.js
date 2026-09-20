export const cacheKey = "nyc-ferry-did-data-v6";
// Which landing this device is showing. Persisted so an agent's choice survives a reload and
// so an offline start knows which cached board to restore.
export const landingKey = "nyc-ferry-did-selected-landing";
export const landingsKey = "nyc-ferry-did-landings";
// Whether the board orders route cards by which one leaves next (the default) or by route.
// Persisted like the landing choice, and deliberately per-device: it is a reading preference,
// not board config.
export const sortKey = "nyc-ferry-did-sort";
// Whether times print as 24-hour (the default, and what the schedule, the workbook and the radio
// all speak in) or 12-hour. Persisted per device like the sort choice: it is a reading preference,
// not board config, and an agent who wants one wants it on every landing they open.
export const clockKey = "nyc-ferry-did-clock";
// Which operators the board has been told to hide, as a list of operator names. Persisted per
// device and deliberately not per landing: an agent who does not want to read NY Waterway boats
// does not want to read them at Pier 79 either. Stored by name rather than by route id so a
// partner adding a route does not quietly reappear on a board that hid the operator.
export const hiddenOperatorsKey = "nyc-ferry-did-hidden-operators";
// Every operator the system serves anywhere, as /api/landings reports it. Cached like the landing
// list so the panel is complete offline too.
export const operatorsKey = "nyc-ferry-did-operators";
// Which landings have been starred, as a list of landing ids. Persisted per device like the other
// reading preferences: an agent works a handful of docks out of the 26 on the list, and the ones
// they work do not change because they opened the board somewhere else.
export const favouriteLandingsKey = "nyc-ferry-did-favourite-landings";
// Which paint the board wears. Persisted per device like the other reading preferences, and read
// again by the external theme initializer so the choice is on the document before the first paint.
export const themeKey = "nyc-ferry-did-theme";
// Theme choices and persistent keys retain their existing IDs across app upgrades.
export const THEMES = [
  { id: "nyc-ferry", name: "NYC Ferry", note: "Terminal signage blue", color: "#001d41" },
  { id: "night", name: "Night", note: "Dark, for a wheelhouse after dark", color: "#0d1b26" },
  { id: "hello-kitty", name: "Hello Kitty", note: "Juliet's favorite theme 😇", color: "#ff9dbb" },
  { id: "cinnamoroll", name: "Cinnamoroll", note: "Sky blue and quiet", color: "#7ec8f0" },
  { id: "pompompurin", name: "Pompompurin", note: "Butter yellow, brown beret", color: "#ffd94a" },
  { id: "kuromi", name: "Kuromi", note: "Purple, with a loud pink streak", color: "#4a2d6b" },
  { id: "windows-xp", name: "Windows XP", note: "Luna blue and Tahoma", color: "#0058ee" },
  { id: "hacker", name: "Hacker", note: "Green phosphor on black", color: "#000000" },
  { id: "burger-king", name: "Burger King", note: "Flame-grilled, in Flame", color: "#D62300" }
];
// The newest change-log entry this device has already been shown. The mark beside the kitty is
// meant to say "there is something you have not read", so it has to remember what was read.
export const changelogSeenKey = "nyc-ferry-did-changelog-seen";
// The landing a location fix last resolved to, so the shortcut survives a reload.
export const nearestKey = "nyc-ferry-did-nearest";
// A fix is only good for about the shift it was taken in. Crew move between landings, and a
// shortcut still pointing at yesterday's dock is worse than no shortcut at all.
export const nearestMaxAgeMs = 12 * 60 * 60 * 1000;
