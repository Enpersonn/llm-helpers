# an-llm-request-router

A small package for routing diffrent LLM requests through the same input. 

Usefull in cases where you work with local models in development enviorments.



The pacakge comes with inbuildt adapters for `ollama`, `openai`, `anthropic` and `gemini`.

In cases where you use a diffrent LLM provider or want to add custome logic to a adapter you can deffine custome adapters and pass them into the LLM class. 