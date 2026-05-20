# llm-stream-string-replace

String replacement for async object streams — with built-in adapters for popular LLM SDKs (OpenAI, Anthropic, Vercel AI SDK, LangChain).

Replace text inside structured chunk objects without flattening or reconstructing the stream shape, including matches that span chunk boundaries. Works with LLM provider streams out of the box, and with any `AsyncIterable<T>` via a simple accessor interface. Supports regex and string patterns.

## Install

```bash
npm install llm-stream-string-replace
```

Each provider adapter is a separate subpath export (`/openai`, `/anthropic`, `/vercel`, `/langchain`). Bundlers that support `"exports"` (Webpack 5, Rollup, esbuild, Vite) will tree-shake unused adapters automatically — the package is marked `"sideEffects": false`.

```ts
// only the OpenAI adapter ends up in your bundle
import { replaceInOpenAIStream } from "llm-stream-string-replace/openai";
```

## Quick Start

### LLM provider (OpenAI)

```ts
import { replaceInOpenAIStream } from "llm-stream-string-replace/openai";

const stream = await client.chat.completions.create({
  model: "gpt-4o",
  stream: true,
  messages: [{ role: "user", content: "say hello" }],
});

const replaced = replaceInOpenAIStream(stream, [/hello/gi, "hi"]);

for await (const chunk of replaced) {
  // full chunk shape is preserved — only delta.content is replaced
  // and cross-chunk patterns like "he" + "llo" are still matched as "hello"
}
```

### Any object stream

You can use `replaceInAsyncIterable` with any `AsyncIterable<T>` by supplying a `TextAccess` descriptor that tells the library how to read and write the text field on your event type:

```ts
import { replaceInAsyncIterable } from "llm-stream-string-replace";

interface LogEvent {
  level: string;
  message: string;
  done?: boolean;
}

async function* source(): AsyncIterable<LogEvent> {
  yield { level: "info", message: "user said hello world" };
  yield { level: "warn", message: "connection to hello-service lost" };
  yield { level: "debug", message: "", done: true };
}

const replaced = replaceInAsyncIterable(source(), [/hello/g, "hi"], {
  getText: (event) => event.message,
  setText: (event, text) => ({ ...event, message: text }),
  channelKey: () => "default",
  isChannelEnd: (event) => event.done === true,
});

for await (const event of replaced) {
  // { level: "info",  message: "user said hi world" }
  // { level: "warn",  message: "connection to hi-service lost" }
}
```

The `channelKey` callback lets you route parallel text lanes independently — e.g. two concurrent SSE topics, parallel OpenAI choices, or Anthropic content blocks — so replacements never bleed across lanes.

The optional `isChannelEnd` callback marks logical lane boundaries (for example, message-stop/control events), so buffered partial matches are flushed at the right time and never carry into the next message in the same stream.

## API

### Provider adapters (subpath imports)

```ts
import {
  replaceInOpenAIStream,
  replaceInOpenAIChatCompletionsStream,
  replaceInOpenAIResponsesStream,
} from "llm-stream-string-replace/openai";
import { replaceInAnthropicStream } from "llm-stream-string-replace/anthropic";
import {
  replaceInVercelStreamText,
  replaceInVercelTextStream,
  replaceInVercelFullStream,
} from "llm-stream-string-replace/vercel";
import {
  replaceInLangChainStream,
  LLMStreamReplaceCallback,
} from "llm-stream-string-replace/langchain";
```

### Generic (main entry)

```ts
import {
  replaceInAsyncIterable,
  replaceInStringIterable,
  applyRules,
  ChannelReplacer,
} from "llm-stream-string-replace";
```

### Full symbol list

- `applyRules(source, rules, access, options?)` — core primitive; wraps any async iterable
- `ChannelReplacer(rule, options?)` — low-level per-channel replacer
- `replaceInAsyncIterable(stream, rules, access, options?)` — generic object stream wrapper
- `replaceInStringIterable(stream, rules, options?)` — plain `AsyncIterable<string>` wrapper
- `replaceInOpenAIStream(stream, rules, options?)` — auto-detects Chat Completions vs Responses surface
- `replaceInOpenAIChatCompletionsStream(stream, rules, options?)` — Chat Completions only
- `replaceInOpenAIResponsesStream(stream, rules, options?)` — Responses API only
- `replaceInAnthropicStream(stream, rules, options?)` — Anthropic message stream
- `replaceInVercelStreamText(result, rules, options?)` — wraps both `textStream` and `fullStream`
- `replaceInVercelTextStream(textStream, rules, options?)` — `textStream` only
- `replaceInVercelFullStream(fullStream, rules, options?)` — `fullStream` only
- `replaceInLangChainStream(stream, rules, options?)` — `AIMessageChunk` or plain string stream
- `LLMStreamReplaceCallback(rules, sink, options?)` — LangChain `handleLLMNewToken` callback adapter

### Rules

```ts
// single rule
[pattern, replacement];

// multiple rules
[
  [pattern1, replacement1],
  [pattern2, replacement2],
];
```

- **pattern**: `string` or `RegExp`
- **replacement**: `string` or a function that returns `string`. Function type is `(match, captures, offset, input) => string`

### TextAccess

```ts
interface TextAccess<TEvent> {
  getText: (event: TEvent) => string | null; // return null to skip this event
  setText: (event: TEvent, text: string) => TEvent;
  channelKey: (event: TEvent) => string | number; // separate parallel lanes
  isChannelEnd?: (event: TEvent) => boolean; // flush accumulated state
}
```

## Tests

```bash
npm run typecheck
npm test
```

Type-level overload assertions are included in compile-time checks under `tests/types`.

## Current Limitations

- Class event-emitter callbacks provided by SDK stream classes may still receive original text. Async iteration on the wrapped stream returns replaced text.

## License

MIT

## Credits

This package builds on [replacestream](https://github.com/eugeneware/replacestream) and extends it with stream-surface adapters, channel-aware replacement bookkeeping, and provider-shape-preserving stream transforms.
