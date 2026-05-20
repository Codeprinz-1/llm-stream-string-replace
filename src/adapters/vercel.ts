import { applyRules } from "@/core/compose";
import type { ChannelReplacerOptions, Rules, TextAccess } from "@/core/types";
import { assertAsyncIterable, isAsyncIterable } from "@/adapters/type-guards";

export type VercelTextStream = AsyncIterable<string>;

export type VercelFullStreamPart = {
  type: string;
  text?: string;
  [key: string]: unknown;
};

export type VercelStreamTextResult = {
  textStream: VercelTextStream;
  fullStream?: AsyncIterable<VercelFullStreamPart>;
  [key: string]: unknown;
};

function assertVercelResultShape(
  value: unknown,
): asserts value is VercelStreamTextResult {
  const candidate = value as Partial<VercelStreamTextResult> | null | undefined;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    !isAsyncIterable(candidate.textStream)
  ) {
    throw new Error(
      "replaceInVercelStreamText expected an object with a textStream async iterable.",
    );
  }
}

function textStreamAccess(): TextAccess<string> {
  return {
    getText: (chunk) => chunk,
    setText: (_chunk, text) => text,
    channelKey: () => 0,
  };
}

function fullStreamAccess(): TextAccess<VercelFullStreamPart> {
  return {
    getText(part): string | null {
      return part.type === "text" && typeof part.text === "string"
        ? part.text
        : null;
    },
    setText(part, text): VercelFullStreamPart {
      return { ...part, text };
    },
    channelKey(): number {
      return 0;
    },
    isChannelEnd(part): boolean {
      return part.type === "finish" || part.type === "error";
    },
  };
}

/**
 * Wraps only the Vercel textStream (AsyncIterable<string>) portion.
 */
export function replaceInVercelTextStream<T extends VercelTextStream>(
  textStream: T,
  rules: Rules,
  options?: ChannelReplacerOptions,
): T {
  assertAsyncIterable(textStream, "replaceInVercelTextStream");
  return applyRules(textStream, rules, textStreamAccess(), options);
}

/**
 * Wraps only the Vercel fullStream (AsyncIterable<VercelFullStreamPart>) portion.
 * Replaces text in parts where type === "text".
 */
export function replaceInVercelFullStream<
  T extends AsyncIterable<VercelFullStreamPart>,
>(fullStream: T, rules: Rules, options?: ChannelReplacerOptions): T {
  assertAsyncIterable(fullStream, "replaceInVercelFullStream");
  return applyRules(fullStream, rules, fullStreamAccess(), options);
}

/**
 * Wraps a Vercel StreamTextResult, replacing text in both textStream and
 * fullStream. All other properties on the result are preserved via prototype
 * delegation so helpers like .text, .usage, etc. remain accessible.
 */
export function replaceInVercelStreamText<T extends VercelStreamTextResult>(
  result: T,
  rules: Rules,
  options?: ChannelReplacerOptions,
): T {
  assertVercelResultShape(result);

  const wrappedTextStream = replaceInVercelTextStream(
    result.textStream,
    rules,
    options,
  );
  const wrappedFullStream = result.fullStream
    ? replaceInVercelFullStream(result.fullStream, rules, options)
    : undefined;

  const patch: Partial<VercelStreamTextResult> = {
    textStream: wrappedTextStream,
  };
  if (wrappedFullStream !== undefined) {
    patch.fullStream = wrappedFullStream;
  }

  return Object.assign(Object.create(result as object) as T, result, patch);
}
