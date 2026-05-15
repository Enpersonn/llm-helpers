export type Bus<TEvents extends Record<string, unknown>> = {
	on<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): void;
	emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void;
};

export type AgentEventMap = {
	thinking: { content: string; step: number };
	tool_call: { toolName: string; args: Record<string, unknown>; step: number };
	tool_result: { toolName: string; result: string; step: number };
};

export function createBus<TEvents extends Record<string, unknown>>(): Bus<TEvents> {
	const handlers = new Map<keyof TEvents, Set<(payload: unknown) => void>>();
	return {
		on(event, handler) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			const handlersForEvent = handlers.get(event);
			if (handlersForEvent) {
				handlersForEvent.add(handler as (payload: unknown) => void);
			}
		},
		emit(event, payload) {
			handlers.get(event)?.forEach((h) => {
				h(payload);
			});
		},
	};
}
