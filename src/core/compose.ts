import { ChannelReplacer } from "@/core/channel-replacer";
import { makeIteratorProxy } from "@/adapters/type-guards";
import type {
  ChannelReplacerOptions,
  Rule,
  Rules,
  TextAccess,
} from "@/core/types";

function toRuleArray(rules: Rules): Rule[] {
  if (rules.length === 2 && !Array.isArray((rules as unknown[])[0])) {
    return [rules as Rule];
  }

  return rules as Rule[];
}

async function* applySingleRule<TEvent>(
  source: AsyncIterable<TEvent>,
  rule: Rule,
  access: TextAccess<TEvent>,
  options?: ChannelReplacerOptions,
): AsyncGenerator<TEvent> {
  const channelMap = new Map<string | number, ChannelReplacer<TEvent>>();

  async function* flushAndDeleteChannel(
    key: string | number,
  ): AsyncGenerator<TEvent> {
    const replacer = channelMap.get(key);
    if (!replacer) {
      return;
    }

    const pending = await replacer.end();
    yield* pending;

    channelMap.delete(key);
  }

  for await (const event of source) {
    const text = access.getText(event);
    const isChannelEnd = access.isChannelEnd?.(event) ?? false;

    // Process text first so text+end events emit transformed text before final flush.
    if (text !== null) {
      const key = access.channelKey(event);
      let replacer = channelMap.get(key);

      if (!replacer) {
        replacer = new ChannelReplacer(rule, access.setText, options);
        channelMap.set(key, replacer);
      }

      yield* replacer.feed(text, event);
    }

    if (isChannelEnd) {
      const key = access.channelKey(event);
      yield* flushAndDeleteChannel(key);
    }

    // For null-text end events, passthrough must happen after flush to preserve ordering.
    if (text === null) {
      yield event;
    }
  }

  for (const replacer of channelMap.values()) {
    yield* await replacer.end();
  }
}

export function applyRules<TEvent, TStream extends AsyncIterable<TEvent>>(
  source: TStream,
  rules: Rules,
  access: TextAccess<TEvent>,
  options?: ChannelReplacerOptions,
): TStream {
  const normalizedRules = toRuleArray(rules);

  return makeIteratorProxy(source, () =>
    normalizedRules.reduce<AsyncIterable<TEvent>>(
      (stream, rule) => applySingleRule(stream, rule, access, options),
      source,
    ),
  );
}
