import type { LLMMessage, LLMUsage } from '@llm-helpers/types';

export type Bus<TEvents extends Record<string, unknown>> = {
	on<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): void;
	off<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): void;
	once<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): void;
	emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void;
};

export type AgentEventMap = {
	thinking: { content: string; step: number; metadata?: Record<string, unknown> };
	tool_call: { toolName: string; args: Record<string, unknown>; step: number; metadata?: Record<string, unknown> };
	tool_result: { toolName: string; result: string; step: number; metadata?: Record<string, unknown> };
	tool_error: { toolName: string; error: unknown; step: number; metadata?: Record<string, unknown> };
	step_start: { step: number; metadata?: Record<string, unknown> };
	step_end: { step: number; usage?: LLMUsage; metadata?: Record<string, unknown> };
	retry: { step: number; attempt: number; error: unknown; delayMs: number; metadata?: Record<string, unknown> };
	complete: { finalMessage: LLMMessage; totalUsage: LLMUsage; metadata?: Record<string, unknown> };
	aborted: { reason: 'signal' | 'timeout' | 'stop'; metadata?: Record<string, unknown> };
	context_trim: { before: number; after: number; step: number; metadata?: Record<string, unknown> };
};

export function createBus<TEvents extends Record<string, unknown>>(): Bus<TEvents> {
	const handlers = new Map<keyof TEvents, Set<(payload: unknown) => void>>();
	const onceWrappers = new Map<keyof TEvents, Map<(payload: unknown) => void, (payload: unknown) => void>>();

	const getOrCreate = (event: keyof TEvents): Set<(payload: unknown) => void> => {
		let set = handlers.get(event);
		if (!set) {
			set = new Set();
			handlers.set(event, set);
		}
		return set;
	};

	const bus: Bus<TEvents> = {
		on(event, handler) {
			getOrCreate(event).add(handler as (payload: unknown) => void);
		},
		off(event, handler) {
			const raw = handler as (payload: unknown) => void;
			const wrapperMap = onceWrappers.get(event);
			const wrapper = wrapperMap?.get(raw);
			if (wrapperMap && wrapper) {
				handlers.get(event)?.delete(wrapper);
				wrapperMap.delete(raw);
			} else {
				handlers.get(event)?.delete(raw);
			}
		},
		once(event, handler) {
			const raw = handler as (payload: unknown) => void;
			const wrapper = (payload: unknown) => {
				raw(payload);
				bus.off(event, handler);
			};
			let wrapMap = onceWrappers.get(event);
			if (!wrapMap) {
				wrapMap = new Map();
				onceWrappers.set(event, wrapMap);
			}
			wrapMap.set(raw, wrapper);
			getOrCreate(event).add(wrapper);
		},
		emit(event, payload) {
			handlers.get(event)?.forEach((h) => {
				try {
					h(payload);
				} catch {
					// handler errors must not affect the agent loop
				}
			});
		},
	};

	return bus;
}
