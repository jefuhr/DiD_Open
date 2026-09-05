// Run before styles load, including on servers that disallow inline scripts.
try {
  const saved = localStorage.getItem("nyc-ferry-did-theme");
  const known = ["night", "hello-kitty", "cinnamoroll", "pompompurin", "kuromi", "windows-xp", "hacker", "burger-king"];
  document.documentElement.dataset.theme = known.includes(saved) ? saved : "nyc-ferry";
} catch {
  document.documentElement.dataset.theme = "nyc-ferry";
}
document.documentElement.dataset.surface = new URL("./", location).pathname === "/" ? "kiosk" : "app";
