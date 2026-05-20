import type { ToolBackend, ToolDefinition } from '@llm-helpers/types';

type RegistryEntry = {
	definition: ToolDefinition;
	providerId: string;
	provider: ToolBackend;
};

export type Registry = {
	ensureBuilt(): Promise<void>;
	invalidate(): void;
	refresh(): Promise<void>;
	getProvider(name: string): ToolBackend | undefined;
	listAll(): (ToolDefinition & { providerId: string })[];
};

export const createRegistry = (providers: ToolBackend[]): Registry => {
	let map = new Map<string, RegistryEntry>();
	let built = false;
	let buildPromise: Promise<void> | null = null;

	const reset = () => {
		map = new Map<string, RegistryEntry>();
		built = false;
		buildPromise = null;
	};

	const isPlainObject = (value: unknown): value is Record<string, unknown> =>
		typeof value === 'object' && value !== null && !Array.isArray(value);

	const validateToolDefinition = (tool: ToolDefinition, providerId: string) => {
		if (tool.name.trim().length === 0) {
			throw new Error(`Provider '${providerId}' registered a tool with an empty name`);
		}

		if (tool.inputSchema !== undefined && !isPlainObject(tool.inputSchema)) {
			throw new Error(
				`Provider '${providerId}' registered tool '${tool.name}' with an invalid inputSchema; expected an object`,
			);
		}
	};

	const build = async () => {
		const nextMap = new Map<string, RegistryEntry>();

		for (const provider of providers) {
			const tools = await provider.listTools();
			for (const tool of tools) {
				validateToolDefinition(tool, provider.id);

				const existing = nextMap.get(tool.name);
				if (existing) {
					throw new Error(
						`Duplicate tool '${tool.name}' registered by providers '${existing.providerId}' and '${provider.id}'`,
					);
				}

				nextMap.set(tool.name, { definition: tool, providerId: provider.id, provider });
			}
		}

		map = nextMap;
		built = true;
	};

	return {
		ensureBuilt: () => {
			if (built) return Promise.resolve();
			if (!buildPromise) {
				buildPromise = build().catch((error: unknown) => {
					built = false;
					buildPromise = null;
					throw error;
				});
			}
			return buildPromise;
		},
		invalidate: () => {
			reset();
		},
		refresh: async () => {
			reset();
			await build();
			buildPromise = Promise.resolve();
		},
		getProvider: (name) => map.get(name)?.provider,
		listAll: () => [...map.values()].map((e) => ({ ...e.definition, providerId: e.providerId })),
	};
};
