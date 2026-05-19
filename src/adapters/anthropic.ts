import { applyRules } from "@/core/compose";
import type { ChannelReplacerOptions, Rules, TextAccess } from "@/core/types";
import { assertAsyncIterable } from "@/adapters/type-guards";

export type AnthropicMessageEvent = {
  type: string;
  index?: number;
  delta?: unknown;
  text?: string;
};

export type AnthropicMessageStream = AsyncIterable<AnthropicMessageEvent>;

const FLAT_TEXT_DELTA_CHANNEL_KEY = "anthropic:message-text-delta";

function getAnthropicDeltaText(event: AnthropicMessageEvent): string | null {
  if (!event.delta || typeof event.delta !== "object") {
    return null;
  }

  const maybe = event.delta as { text?: unknown };
  return typeof maybe.text === "string" ? maybe.text : null;
}

function accessForAnthropicStream(): TextAccess<AnthropicMessageEvent> {
  return {
    getText(event): string | null {
      if (event.type === "content_block_delta") {
        return getAnthropicDeltaText(event);
      }
      if (event.type === "text_delta" && typeof event.text === "string") {
        return event.text;
      }
      return null;
    },
    setText(event, text): AnthropicMessageEvent {
      if (event.type === "content_block_delta" && event.delta != null) {
        const deltaObject =
          typeof event.delta === "object"
            ? (event.delta as Record<string, unknown>)
            : {};
        return { ...event, delta: { ...deltaObject, text } };
      }
      if (event.type === "text_delta") {
        return { ...event, text };
      }
      return event;
    },
    channelKey(event): string | number {
      if (typeof event.index === "number") {
        return event.index;
      }

      if (event.type === "text_delta" || event.type === "message_stop") {
        return FLAT_TEXT_DELTA_CHANNEL_KEY;
      }

      return "anthropic:unindexed";
    },
    isChannelEnd(event): boolean {
      // content_block_stop ends indexed blocks (guaranteed by Anthropic protocol)
      // message_stop ends flat text_delta lane (no indexed content blocks after it)
      return (
        event.type === "content_block_stop" || event.type === "message_stop"
      );
    },
  };
}

/**
 * Wraps an Anthropic message stream and applies Anthropic routing rules.
 *
 * This wrapper trusts the caller-provided stream surface and applies text
 * replacement to supported Anthropic delta event shapes.
 */
export function replaceInAnthropicStream<
  TStream extends AnthropicMessageStream,
>(stream: TStream, rules: Rules, options?: ChannelReplacerOptions): TStream {
  assertAsyncIterable(stream, "replaceInAnthropicStream");
  return applyRules(stream, rules, accessForAnthropicStream(), options);
}
