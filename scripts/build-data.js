import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDisplayData } from "../lib/schedule-builder.js";
export * from "../lib/schedule-builder.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function writeDisplayData(options) {
  const data = await buildDisplayData(options);
  const outputDir = path.join(options?.root || ROOT, "public/data");
  await mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, "display-data.json"), temporary = `${output}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data)}\n`, "utf8");
  await rename(temporary, output);
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = await writeDisplayData();
  console.log(`Built landing ${data.meta.landingNumber}: ${data.meta.landing.displayName} (${data.departures.length} scheduled departures).`);
}
