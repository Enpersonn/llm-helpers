import type { LLMMessage, ToolContent } from '@llm-helpers/types';

const summarizeToolContent = (block: ToolContent): string => {
	if (block.type === 'text') return block.text;
	if (block.type === 'json') return JSON.stringify(block.value);
	if (block.type === 'image') return `[image ${block.mimeType}]`;
	return block.mimeType ? `[file ${block.path} (${block.mimeType})]` : `[file ${block.path}]`;
};

export const toolContentToText = (content?: ToolContent[], fallback = ''): string => {
	if (!content?.length) return fallback;
	return content.map(summarizeToolContent).join('\n');
};

const toGeminiToolBlock = (block: ToolContent): Record<string, unknown> => {
	if (block.type === 'text') return { type: 'text', text: block.text };
	if (block.type === 'json') return { type: 'json', value: block.value };
	if (block.type === 'image') {
		return { type: 'image', mimeType: block.mimeType, summary: summarizeToolContent(block) };
	}
	return {
		type: 'file',
		path: block.path,
		...(block.mimeType ? { mimeType: block.mimeType } : {}),
		summary: summarizeToolContent(block),
	};
};

export const toolContentToGeminiResponse = (message: Pick<LLMMessage, 'toolContent' | 'content'>): Record<string, unknown> => {
	if (!message.toolContent?.length) {
		return { result: message.content };
	}

	if (message.toolContent.length === 1) {
		const [block] = message.toolContent;
		if (block.type === 'text') return { result: block.text };
		if (block.type === 'json') return { result: block.value };
	}

	return {
		content: message.toolContent.map((block) => toGeminiToolBlock(block)),
	};
};
