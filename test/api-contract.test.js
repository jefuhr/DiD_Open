import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDisplayData } from "../lib/schedule-builder.js";

const contract = JSON.parse(await readFile(new URL("../docs/api.openapi.json", import.meta.url)));

// Check the JSON type/required-field subset used by the contract against real builder output.
// This is a wire-compatibility check, not a general OpenAPI validator.
function check(value, schema, at = "$") {
  if (schema.$ref) return check(value, contract.components.schemas[schema.$ref.split("/").at(-1)], at);
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const allowed = [schema.type].flat();
  if (schema.type) assert.ok(allowed.includes(type) || (allowed.includes("integer") && Number.isInteger(value)), `${at}: expected ${allowed}, got ${type}`);
  if (schema.const !== undefined) assert.equal(value, schema.const, at);
  if (type === "object") {
    for (const key of schema.required || []) assert.ok(Object.hasOwn(value, key), `${at}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      const rule = schema.properties?.[key] || (typeof schema.additionalProperties === "object" ? schema.additionalProperties : null);
      if (rule) check(item, rule, `${at}.${key}`);
    }
  }
  if (type === "array" && schema.items) value.forEach((item, index) => check(item, schema.items, `${at}[${index}]`));
}

test("the schedule API contract describes real passenger and crew payloads", async () => {
  for (const landingNumber of [16, 27, 29]) {
    check(await buildDisplayData({ landingNumber }), contract.components.schemas.DisplayData);
  }
});

test("every documented API is still implemented and SFTP is retired", async () => {
  const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
  for (const path of Object.keys(contract.paths)) assert.ok(server.includes(JSON.stringify(path)), path);
  assert.equal(contract.paths["/api/override"], undefined);
  assert.doesNotMatch(server, /sftpOverride|api.override/);
});
