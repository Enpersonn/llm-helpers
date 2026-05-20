import type { PermissionDecision, PermissionRule } from '@llm-helpers/core';
import { allow, ask, createRuleSet, deny } from '@llm-helpers/core';
import type { ToolCall, ToolExecutionContext } from '@llm-helpers/types';

export type { PermissionDecision, PermissionRule };
export { allow, ask, deny };

export type Permissions = {
	check(call: ToolCall, context: ToolExecutionContext): PermissionDecision;
};

export const createPermissions = (config: {
	rules: PermissionRule[];
	default?: 'allow' | 'deny' | 'ask';
}): Permissions => {
	const ruleSet = createRuleSet(config);
	return { check: (call, _context) => ruleSet.evaluate(call.name, call.arguments) };
};
