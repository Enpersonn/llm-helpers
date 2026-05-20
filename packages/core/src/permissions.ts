export type PermissionRule = {
	type: 'allow' | 'deny' | 'ask';
	pattern: string;
	when?: (args: Record<string, unknown>) => boolean;
	message?: string;
	reason?: string;
};

export type PermissionDecision =
	| { type: 'allow' }
	| { type: 'deny'; reason?: string }
	| { type: 'ask'; message: string };

export type RuleSet = {
	evaluate(name: string, args?: Record<string, unknown>): PermissionDecision;
};

export const matchPattern = (pattern: string, name: string): boolean => {
	if (pattern === '*') return true;
	if (!pattern.includes('*')) return pattern === name;
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
	return new RegExp(`^${escaped}$`).test(name);
};

export const allow = <TArgs = Record<string, unknown>>(
	pattern: string,
	opts?: { when?: (args: TArgs) => boolean },
): PermissionRule => ({
	type: 'allow',
	pattern,
	when: opts?.when as PermissionRule['when'],
});

export const deny = <TArgs = Record<string, unknown>>(
	pattern: string,
	opts?: { when?: (args: TArgs) => boolean; reason?: string },
): PermissionRule => ({
	type: 'deny',
	pattern,
	when: opts?.when as PermissionRule['when'],
	reason: opts?.reason,
});

export const ask = <TArgs = Record<string, unknown>>(
	pattern: string,
	opts?: { when?: (args: TArgs) => boolean; message?: string },
): PermissionRule => ({
	type: 'ask',
	pattern,
	when: opts?.when as PermissionRule['when'],
	message: opts?.message,
});

export const createRuleSet = (config: {
	rules: PermissionRule[];
	default?: 'allow' | 'deny' | 'ask';
}): RuleSet => {
	const defaultDecision = config.default ?? 'allow';

	return {
		evaluate: (name, args): PermissionDecision => {
			for (const rule of config.rules) {
				if (!matchPattern(rule.pattern, name)) continue;
				if (rule.when && args !== undefined && !rule.when(args)) continue;

				if (rule.type === 'allow') return { type: 'allow' };
				if (rule.type === 'deny') return { type: 'deny', reason: rule.reason };
				if (rule.type === 'ask') return { type: 'ask', message: rule.message ?? `Allow '${name}'?` };
			}

			if (defaultDecision === 'deny') return { type: 'deny' };
			if (defaultDecision === 'ask') return { type: 'ask', message: `Allow '${name}'?` };
			return { type: 'allow' };
		},
	};
};
