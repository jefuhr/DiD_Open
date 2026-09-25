import { readFile } from "node:fs/promises";

// Execute the actual browser module graph in the existing lightweight VM harness.
// Each module has its own scope; this supports the named imports/exports used by the app.
export async function clientSource(url, unwrap = true) {
  let source = await readFile(url, "utf8");
  const imports = [...source.matchAll(/^import \{([^}]+)\} from "([^"]+)";$/gm)];
  for (const [statement, bindings, relative] of imports) {
    const dependency = new URL(relative, url);
    const body = await clientSource(dependency, false);
    const names = [...body.matchAll(/^export (?:function|const) (\w+)/gm)].map((match) => match[1]);
    const aliases = bindings.trim().replace(/\s+as\s+/g, ": ");
    const implementation = body.replace(/^export /gm, "");
    source = source.replace(statement, () =>
      `const { ${aliases} } = (() => {\n${implementation}\nreturn { ${names.join(", ")} };\n})();`);
  }
  // Legacy function-level harnesses inspect lexical state directly. Browser integration tests
  // mount the real controllers; here unwrap just the controller boundary, not its implementation.
  if (unwrap && /export function mount(?:Board|Map)\(/.test(source)) {
    source = source.replace(/^export function mount(?:Board|Map)\(.*\) \{\n/m,
      'const root = document; const header = null; const setTheme = null; const onRide = () => {}; const boardURL = "./"; const navigate = url => location.assign(url); const getGeometry = () => MobileRuntime.request("/api/map");\n');
    source = source.slice(0, source.lastIndexOf("\nreturn {"));
    source = source.replace("const lifecycle = createViewLifecycle();", "const lifecycle = createViewLifecycle(); lifecycle.activate();");
    source = source.replaceAll("root.classList", "document.body.classList");
  }
  return source;
}
