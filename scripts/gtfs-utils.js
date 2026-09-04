import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export function toCsv(headers, rows) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n") + "\n";
}

export function gtfsDate(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addMinutes(value, minutes) {
  const [hours, mins] = value.split(":").map(Number);
  const total = hours * 60 + mins + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export async function writeGtfsFiles(outputDirectory, files) {
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(Object.entries(files).map(([name, contents]) =>
    writeFile(path.join(outputDirectory, name), contents, "utf8")));
}
