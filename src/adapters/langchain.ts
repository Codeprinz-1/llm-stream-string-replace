import { applyRules } from "@/core/compose";
import type { ChannelReplacerOptions, Rules, TextAccess } from "@/core/types";
import { assertAsyncIterable } from "@/adapters/type-guards";

export interface LangChainTextContentPart {
  type: "text";
  text: string;
}

interface LangChainChunkEndMarker {
  usage?: unknown;
  usage_metadata?: unknown;
}

export interface LangChainAIMessageChunk {
  content:
    | string
    | Array<
        | string
        | LangChainTextContentPart
        | { type: string; [key: string]: unknown }
      >;
  [key: string]: unknown;
}

function isTextObjectPart(part: unknown): part is LangChainTextContentPart {
  if (typeof part !== "object" || part === null) {
    return false;
  }

  const candidate = part as { type?: unknown; text?: unknown };
  return candidate.type === "text" && typeof candidate.text === "string";
}

function getPartText(part: unknown): string | null {
  if (typeof part === "string") {
    return part;
  }

  if (isTextObjectPart(part)) {
    return part.text;
  }

  return null;
}

function extractTextFromChunk(chunk: LangChainAIMessageChunk): string {
  if (typeof chunk.content === "string") {
    return chunk.content;
  }

  return chunk.content
    .map((part) => getPartText(part))
    .filter((part): part is string => part !== null)
    .join("");
}

function injectTextIntoChunk(
  chunk: LangChainAIMessageChunk,
  text: string,
): LangChainAIMessageChunk {
  if (typeof chunk.content === "string") {
    return {
      ...chunk,
      content: text,
    };
  }

  const textSlots = chunk.content
    .map((part, index) => {
      const partText = getPartText(part);
      return partText === null
        ? null
        : { index, originalLength: partText.length };
    })
    .filter(
      (
        slot,
      ): slot is {
        index: number;
        originalLength: number;
      } => slot !== null,
    );

  if (textSlots.length === 0) {
    return chunk;
  }

  const updatedParts = [...chunk.content];
  let consumed = 0;

  textSlots.forEach((slot, slotIndex) => {
    const isLastSlot = slotIndex === textSlots.length - 1;
    const sliceLength = isLastSlot ? undefined : slot.originalLength;
    const assignedText =
      sliceLength === undefined
        ? text.slice(consumed)
        : text.slice(consumed, consumed + sliceLength);
    consumed += assignedText.length;

    const currentPart = updatedParts[slot.index];

    if (typeof currentPart === "string") {
      updatedParts[slot.index] = assignedText;
      return;
    }

    updatedParts[slot.index] = {
      ...(currentPart as Record<string, unknown>),
      text: assignedText,
    } as unknown as (typeof updatedParts)[number];
  });

  return {
    ...chunk,
    content: updatedParts,
  };
}

function isChunkEnd(chunk: LangChainChunkEndMarker): boolean {
  return chunk.usage !== undefined || chunk.usage_metadata !== undefined;
}

export function replaceInLangChainStream<
  T extends AsyncIterable<string> | AsyncIterable<LangChainAIMessageChunk>,
>(stream: T, rules: Rules, options?: ChannelReplacerOptions): T {
  assertAsyncIterable(stream, "replaceInLangChainStream");

  type EventType = T extends AsyncIterable<infer E> ? E : never;

  const access: TextAccess<EventType> = {
    getText(event) {
      if (typeof event === "string") {
        return event;
      }

      return extractTextFromChunk(event);
    },
    setText(event, text) {
      if (typeof event === "string") {
        return text;
      }

      return injectTextIntoChunk(event, text) as EventType;
    },
    channelKey() {
      return "default";
    },
    isChannelEnd(event) {
      if (typeof event === "string") {
        return false;
      }

      return isChunkEnd(event as unknown as LangChainChunkEndMarker);
    },
  } as TextAccess<EventType>;

  return applyRules(
    stream as AsyncIterable<EventType>,
    rules,
    access,
    options,
  ) as T;
}

export interface LLMNewTokenCallback {
  handleLLMNewToken: (token: string) => Promise<void> | void;
}

export class LLMStreamReplaceCallback implements LLMNewTokenCallback {
  constructor(
    private readonly rules: Rules,
    private readonly sink: (token: string) => Promise<void> | void,
    private readonly options?: ChannelReplacerOptions,
  ) {}

  async handleLLMNewToken(token: string): Promise<void> {
    const access: TextAccess<string> = {
      getText: (event) => event,
      setText: (_event, text) => text,
      channelKey: () => "default",
    };

    const stream = applyRules(
      (async function* (): AsyncGenerator<string> {
        yield token;
      })(),
      this.rules,
      access,
      this.options,
    );

    for await (const replaced of stream) {
      await this.sink(replaced);
    }
  }
}
