export type Bus<TEvents extends Record<string, unknown>> = {
	on<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): void;
	off<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): void;
	once<K extends keyof TEvents>(event: K, handler: (payload: TEvents[K]) => void): void;
	emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void;
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
					// handler errors must not propagate
				}
			});
		},
	};

	return bus;
}
