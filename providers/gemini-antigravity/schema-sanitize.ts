/**
 * Pre-wire CCA schema sanitize for Google Antigravity.
 *
 * @oh-my-pi/pi-ai normalizeSchemaForGoogle / normalizeSchemaForCCA strip
 * minItems/maxItems (etc.) via UNSUPPORTED_SCHEMA_FIELDS, but leave
 * `uniqueItems` because it is only listed in LIFTABLE_TO_DESCRIPTION_FIELDS.
 * Cloud Code Assist protojson then 400s: Unknown name "uniqueItems".
 *
 * Strip leftovers here so the extension stream path is safe regardless of
 * whether upstream adds uniqueItems to UNSUPPORTED later.
 */

/** Keywords known to survive omp normalize but rejected by CCA Schema proto. */
const CCA_LEFTOVER_UNSUPPORTED_FIELDS: Record<string, true> = {
	uniqueItems: true,
	minProperties: true,
	maxProperties: true,
};

/**
 * Recursively strip CCA-unknown JSON Schema keywords (notably `uniqueItems`)
 * from a tool parameters schema. Pure; does not mutate the input.
 */
export function stripCcaUnsupportedSchemaFields(schema: unknown): unknown {
	if (Array.isArray(schema)) {
		return schema.map(stripCcaUnsupportedSchemaFields);
	}
	if (schema === null || typeof schema !== "object") {
		return schema;
	}
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
		if (Object.hasOwn(CCA_LEFTOVER_UNSUPPORTED_FIELDS, key)) continue;
		out[key] = stripCcaUnsupportedSchemaFields(value);
	}
	return out;
}

type ToolLike = {
	name?: string;
	description?: string;
	parameters?: unknown;
	[key: string]: unknown;
};

/** Return tools with parameters schemas sanitized for CCA. */
export function sanitizeToolsForCca<T extends ToolLike>(tools: T[] | undefined): T[] | undefined {
	if (!tools?.length) return tools;
	return tools.map((tool) => {
		if (!tool || typeof tool !== "object") return tool;
		if (!("parameters" in tool) || tool.parameters === undefined) return tool;
		return {
			...tool,
			parameters: stripCcaUnsupportedSchemaFields(tool.parameters),
		};
	});
}
