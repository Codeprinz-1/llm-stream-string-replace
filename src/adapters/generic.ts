import { applyRules } from "@/core/compose";
import type { ChannelReplacerOptions, Rules, TextAccess } from "@/core/types";
import { assertAsyncIterable } from "@/adapters/type-guards";

export function replaceInStringIterable<T extends AsyncIterable<string>>(
  stream: T,
  rules: Rules,
  options?: ChannelReplacerOptions,
): T {
  assertAsyncIterable(stream, "replaceInStringIterable");

  const access: TextAccess<string> = {
    getText: (event) => event,
    setText: (_, text) => text,
    channelKey: () => "default",
  };

  return applyRules(stream, rules, access, options);
}

export function replaceInAsyncIterable<
  TEvent,
  TStream extends AsyncIterable<TEvent>,
>(
  stream: TStream,
  rules: Rules,
  access: TextAccess<TEvent>,
  options?: ChannelReplacerOptions,
): TStream {
  assertAsyncIterable(stream, "replaceInAsyncIterable");
  return applyRules(stream, rules, access, options);
}
