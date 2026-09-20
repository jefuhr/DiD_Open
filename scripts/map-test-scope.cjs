// Test-only lexical access for camera instrumentation that formerly used classic-script globals.
// Injected into the served response, never into production files or the shared-shell/CSP tests.
function instrumentMap(source) {
  if (!source.includes("export function mountMap(")) {
    source = "export function mountMap() {\n" + source +
      "\nreturn { ready: Promise.resolve(), activate() {}, deactivate() {}, dispose() {} };\n}";
  }
  const boundary = source.lastIndexOf("\nreturn {");
  if (boundary < 0) throw new Error("Map controller lifecycle boundary missing");
  return source.slice(0, boundary) + "\nglobalThis.__mapTest = source => eval(source);\n" + source.slice(boundary);
}
function mapEvaluate(page, callback) {
  return page.evaluate(source => globalThis.__mapTest("(" + source + ")()"), callback.toString());
}
function mapWaitFor(page, callback) {
  return page.waitForFunction(source => globalThis.__mapTest("(" + source + ")()"), callback.toString());
}
module.exports = { instrumentMap, mapEvaluate, mapWaitFor };
