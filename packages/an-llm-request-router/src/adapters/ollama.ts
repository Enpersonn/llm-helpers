import type { LLMAdapter } from "../types.js";

export function createOllamaAdapter(config: {
	endpoint?: string;
	model: string;
}): LLMAdapter {
	const endpoint = config.endpoint ?? "http://localhost:11434/api/chat";

	return {
		provider: "ollama",

		async chat(request) {
			const res = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				signal: request.signal,
				body: JSON.stringify({
					model: request.model ?? config.model,
					messages: request.messages,
					stream: false,
					format: request.json ? "json" : undefined,
					options: {
						temperature: request.temperature,
						num_predict: request.maxTokens,
					},
				}),
			});

			if (!res.ok) {
				throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
			}

			const data = (await res.json()) as {
				message?: {
					content?: string;
				};
			};

			return {
				provider: "ollama",
				model: request.model ?? config.model,
				text: data.message?.content ?? "",
				raw: data,
			};
		},

		async *stream(request) {
			const res = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				signal: request.signal,
				body: JSON.stringify({
					model: request.model ?? config.model,
					messages: request.messages,
					stream: true,
					format: request.json ? "json" : undefined,
					options: {
						temperature: request.temperature,
						num_predict: request.maxTokens,
					},
				}),
			});

			if (!res.ok) {
				throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
			}

			if (!res.body) {
				throw new Error("No response body from Ollama");
			}

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = "";

			while (true) {
				const { done, value } = await reader.read();

				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";

				for (const line of lines) {
					if (!line.trim()) continue;

					const chunk = JSON.parse(line) as {
						message?: {
							content?: string;
						};
						done?: boolean;
					};

					const text = chunk.message?.content ?? "";

					if (text || chunk.done) {
						yield {
							text,
							done: chunk.done,
							raw: chunk,
						};
					}
				}
			}
		},
	};
}
