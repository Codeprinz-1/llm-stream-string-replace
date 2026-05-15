import { applyRules } from "@/core/compose";
import type { ChannelReplacerOptions, Rules, TextAccess } from "@/core/types";
import {
  assertAsyncIterable,
  hasMethod,
  hasProperty,
  makeIteratorProxy,
} from "@/adapters/type-guards";

export interface OpenAIChatCompletionChunkChoice {
  index: number;
  delta: {
    content?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface OpenAIChatCompletionChunk {
  choices: OpenAIChatCompletionChunkChoice[];
  [key: string]: unknown;
}

export interface OpenAIResponseTextDeltaEvent {
  type: "response.output_text.delta";
  output_index?: number;
  item_id?: string;
  delta: string;
  [key: string]: unknown;
}

export type OpenAIResponseStreamEvent =
  | OpenAIResponseTextDeltaEvent
  | {
      type: string;
      [key: string]: unknown;
    };

export type OpenAIChunkStream = AsyncIterable<OpenAIChatCompletionChunk>;

const p: OpenAIChunkStream = {} as OpenAIChunkStream;

const MISSING_RESPONSE_TEXT_CHANNEL_KEY =
  "__llm_stream_replace_missing_output_lane__";

export type OpenAIResponseStream = AsyncIterable<OpenAIResponseStreamEvent>;

export interface OpenAIChatCompletionStream extends OpenAIChunkStream {
  finalMessage: (...args: unknown[]) => Promise<unknown>;
}

interface OpenAIChoiceWorkItem {
  state: OpenAIChunkState;
  choiceArrayIndex: number;
  choiceChannelIndex: number;
  text: string;
}

interface OpenAIChunkState {
  chunk: OpenAIChatCompletionChunk;
  pending: number;
  resolved: number;
}

function isResponseTextDeltaEvent(
  event: unknown,
): event is OpenAIResponseTextDeltaEvent {
  if (!event || typeof event !== "object") {
    return false;
  }

  const maybe = event as Partial<OpenAIResponseTextDeltaEvent>;
  return (
    maybe.type === "response.output_text.delta" &&
    typeof maybe.delta === "string"
  );
}

function isChunkEvent(event: unknown): event is OpenAIChatCompletionChunk {
  if (!event || typeof event !== "object") {
    return false;
  }

  return Array.isArray((event as { choices?: unknown[] }).choices);
}

function hasTypeField(event: unknown): event is { type: string } {
  return (
    !!event &&
    typeof event === "object" &&
    typeof (event as { type?: unknown }).type === "string"
  );
}

function cloneChunk(
  event: OpenAIChatCompletionChunk,
): OpenAIChatCompletionChunk {
  return {
    ...event,
    choices: event.choices.map((choice) => ({
      ...choice,
      delta: {
        ...choice.delta,
      },
    })),
  };
}

function choiceAccess(): TextAccess<OpenAIChoiceWorkItem> {
  return {
    getText: (event) => event.text,
    setText: (event, text) => ({ ...event, text }),
    channelKey: (event) => event.choiceChannelIndex,
    isChannelEnd: (event) => {
      const choice = event.state.chunk.choices[event.choiceArrayIndex];
      return (
        choice.finish_reason !== null && choice.finish_reason !== undefined
      );
    },
  };
}

function responseAccess(): TextAccess<OpenAIResponseStreamEvent> {
  return {
    getText(event): string | null {
      if (isResponseTextDeltaEvent(event)) {
        return event.delta;
      }

      return null;
    },
    setText(event, text) {
      if (!isResponseTextDeltaEvent(event)) {
        return event;
      }

      return {
        ...event,
        delta: text,
      };
    },
    channelKey(event) {
      const maybe = event as {
        item_id?: unknown;
        output_index?: unknown;
      };

      if (typeof maybe.item_id === "string") {
        return maybe.item_id;
      }

      if (typeof maybe.output_index === "number") {
        return maybe.output_index;
      }

      return MISSING_RESPONSE_TEXT_CHANNEL_KEY;
    },
    isChannelEnd(event) {
      return (
        event.type === "response.done" || event.type === "response.output_done"
      );
    },
  };
}

async function* createDetectedSource<T>(
  iterator: AsyncIterator<T>,
  first: T,
): AsyncGenerator<T> {
  yield first;

  while (true) {
    const next = await iterator.next();
    if (next.done) {
      break;
    }

    yield next.value;
  }
}

async function* transformOpenAIChunkStream(
  source: AsyncIterable<OpenAIChatCompletionChunk>,
  rules: Rules,
  options?: ChannelReplacerOptions,
): AsyncGenerator<OpenAIChatCompletionChunk> {
  const queue: OpenAIChunkState[] = [];

  async function* flatten(): AsyncGenerator<OpenAIChoiceWorkItem> {
    for await (const event of source) {
      const state: OpenAIChunkState = {
        chunk: cloneChunk(event),
        pending: 0,
        resolved: 0,
      };

      state.chunk.choices.forEach((choice) => {
        if (typeof choice.delta.content === "string") {
          state.pending += 1;
        }
      });

      queue.push(state);

      for (
        let choiceArrayIndex = 0;
        choiceArrayIndex < state.chunk.choices.length;
        choiceArrayIndex += 1
      ) {
        const choice = state.chunk.choices[choiceArrayIndex];
        if (typeof choice.delta.content !== "string") {
          continue;
        }

        yield {
          state,
          choiceArrayIndex,
          choiceChannelIndex: choice.index,
          text: choice.delta.content,
        };
      }
    }
  }

  const transformed = applyRules(flatten(), rules, choiceAccess(), options);

  function* flushReady(): Generator<OpenAIChatCompletionChunk> {
    while (queue.length > 0) {
      const current = queue[0];
      if (current.resolved < current.pending) {
        break;
      }

      queue.shift();
      yield current.chunk;
    }
  }

  for await (const item of transformed) {
    item.state.chunk.choices[item.choiceArrayIndex] = {
      ...item.state.chunk.choices[item.choiceArrayIndex],
      delta: {
        ...item.state.chunk.choices[item.choiceArrayIndex].delta,
        content: item.text,
      },
    };
    item.state.resolved += 1;

    yield* flushReady();
  }

  yield* flushReady();
}

export function replaceInOpenAIChatCompletionsStream<
  T extends OpenAIChunkStream,
>(stream: T, rules: Rules, options?: ChannelReplacerOptions): T {
  assertAsyncIterable(stream, "replaceInOpenAIChatCompletionsStream");

  const transformed = transformOpenAIChunkStream(stream, rules, options);
  return makeIteratorProxy(stream, () => transformed);
}

export function replaceInOpenAIResponsesStream<T extends OpenAIResponseStream>(
  stream: T,
  rules: Rules,
  options?: ChannelReplacerOptions,
): T {
  assertAsyncIterable(stream, "replaceInOpenAIResponsesStream");
  return applyRules(stream, rules, responseAccess(), options);
}

export function replaceInOpenAIStream(
  stream: OpenAIChatCompletionStream,
  rules: Rules,
  options?: ChannelReplacerOptions,
): OpenAIChatCompletionStream;
export function replaceInOpenAIStream(
  stream: OpenAIChunkStream,
  rules: Rules,
  options?: ChannelReplacerOptions,
): OpenAIChunkStream;
export function replaceInOpenAIStream(
  stream: OpenAIResponseStream,
  rules: Rules,
  options?: ChannelReplacerOptions,
): OpenAIResponseStream;
export function replaceInOpenAIStream<T extends AsyncIterable<unknown>>(
  stream: T,
  rules: Rules,
  options?: ChannelReplacerOptions,
): T {
  assertAsyncIterable(stream, "replaceInOpenAIStream");

  async function* routed(): AsyncGenerator<unknown> {
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();

    if (first.done) {
      return;
    }

    const detectedSource = createDetectedSource(iterator, first.value);

    if (isChunkEvent(first.value)) {
      yield* transformOpenAIChunkStream(
        detectedSource as AsyncIterable<OpenAIChatCompletionChunk>,
        rules,
        options,
      );
      return;
    }

    if (hasTypeField(first.value)) {
      yield* applyRules(
        detectedSource as AsyncIterable<OpenAIResponseStreamEvent>,
        rules,
        responseAccess(),
        options,
      );
      return;
    }

    throw new TypeError(
      "replaceInOpenAIStream could not infer stream surface from the first event. Use replaceInOpenAIChatCompletionsStream or replaceInOpenAIResponsesStream explicitly.",
    );
  }

  return makeIteratorProxy(stream as object, () => routed()) as T;
}

export function isLikelyOpenAIChatCompletionStream(
  value: unknown,
): value is OpenAIChatCompletionStream {
  return hasMethod(value, "finalMessage") && hasProperty(value, "controller");
}
