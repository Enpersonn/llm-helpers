import type { ToolBackend, ToolDefinition } from '@llm-helpers/types';

type RegistryEntry = {
	definition: ToolDefinition;
	providerId: string;
	provider: ToolBackend;
};

export type Registry = {
	ensureBuilt(): Promise<void>;
	getProvider(name: string): ToolBackend | undefined;
	listAll(): (ToolDefinition & { providerId: string })[];
};

export const createRegistry = (providers: ToolBackend[]): Registry => {
	const map = new Map<string, RegistryEntry>();
	let built = false;
	let buildPromise: Promise<void> | null = null;

	const build = async () => {
		for (const provider of providers) {
			const tools = await provider.listTools();
			for (const tool of tools) {
				map.set(tool.name, { definition: tool, providerId: provider.id, provider });
			}
		}
		built = true;
	};

	return {
		ensureBuilt: () => {
			if (built) return Promise.resolve();
			if (!buildPromise) buildPromise = build();
			return buildPromise;
		},
		getProvider: (name) => map.get(name)?.provider,
		listAll: () => [...map.values()].map((e) => ({ ...e.definition, providerId: e.providerId })),
	};
};
