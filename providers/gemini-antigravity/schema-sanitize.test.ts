import { describe, expect, test } from "bun:test";
import { normalizeSchemaForCCA, normalizeSchemaForGoogle } from "@oh-my-pi/pi-ai/utils/schema";
import { sanitizeToolsForCca, stripCcaUnsupportedSchemaFields } from "./schema-sanitize.ts";

describe("stripCcaUnsupportedSchemaFields", () => {
	test("removes uniqueItems from nested array properties", () => {
		const schema = {
			type: "object",
			properties: {
				path: { type: "string" },
				tags: {
					type: "array",
					items: { type: "string" },
					uniqueItems: true,
					minItems: 1,
				},
				paths: {
					type: "array",
					items: { type: "string" },
					uniqueItems: true,
					minProperties: 1,
				},
			},
			required: ["path"],
		};

		const stripped = stripCcaUnsupportedSchemaFields(schema) as typeof schema;
		expect(stripped.properties.tags).not.toHaveProperty("uniqueItems");
		expect(stripped.properties.paths).not.toHaveProperty("uniqueItems");
		expect(stripped.properties.paths).not.toHaveProperty("minProperties");
		// structural fields preserved
		expect(stripped.properties.tags.type).toBe("array");
		expect(stripped.properties.tags.items).toEqual({ type: "string" });
		expect(stripped.properties.path).toEqual({ type: "string" });
		// non-target keywords left for omp normalize to handle
		expect(stripped.properties.tags).toHaveProperty("minItems");
	});

	test("does not mutate input", () => {
		const schema = {
			type: "array",
			items: { type: "string" },
			uniqueItems: true,
		};
		const copy = structuredClone(schema);
		stripCcaUnsupportedSchemaFields(schema);
		expect(schema).toEqual(copy);
	});

	test("sanitizeToolsForCca maps tool.parameters", () => {
		const tools = [
			{
				name: "demo",
				description: "d",
				parameters: {
					type: "object",
					properties: {
						a: { type: "array", items: { type: "string" }, uniqueItems: true },
					},
				},
			},
		];
		const out = sanitizeToolsForCca(tools)!;
		expect(JSON.stringify(out[0].parameters)).not.toContain("uniqueItems");
		expect(JSON.stringify(tools[0].parameters)).toContain("uniqueItems");
	});

	test("omp normalize alone still leaves uniqueItems (documents why we strip)", () => {
		const schema = {
			type: "object",
			properties: {
				tags: { type: "array", items: { type: "string" }, uniqueItems: true, maxItems: 5 },
			},
		};
		const google = normalizeSchemaForGoogle(schema);
		const cca = normalizeSchemaForCCA(schema);
		expect(JSON.stringify(google)).toContain("uniqueItems");
		expect(JSON.stringify(cca)).toContain("uniqueItems");
		expect(JSON.stringify(google)).not.toMatch(/"maxItems"/);
		const combined = stripCcaUnsupportedSchemaFields(normalizeSchemaForCCA(schema));
		expect(JSON.stringify(combined)).not.toContain("uniqueItems");
	});
});
