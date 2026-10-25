// Web Worker host for WebLLM. Keeps token generation off the main thread so
// pose analysis never waits for the language model. No video reaches here.
import { WebWorkerMLCEngineHandler } from 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';

const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message) => handler.onmessage(message);
