import { describe, expect, it } from "vitest";

import { replaceInAnthropicStream } from "@/adapters/anthropic";
import {
  replaceInOpenAIChatCompletionsStream,
  replaceInOpenAIResponsesStream,
  replaceInOpenAIStream,
} from "@/adapters/openai";
import { replaceInVercelStreamText } from "@/adapters/vercel";
import { collectAsync, fromArray } from "@tests/helpers";

describe("provider wrappers", () => {
  it("replaceInOpenAIChatCompletionsStream keeps parallel channels independent", async () => {
    const stream = fromArray([
      {
        choices: [
          { index: 0, delta: { content: "he" } },
          { index: 1, delta: { content: "wo" } },
        ],
      },
      {
        choices: [
          { index: 0, delta: { content: "llo" } },
          { index: 1, delta: { content: "rld" } },
        ],
      },
    ]);

    const wrapped = replaceInOpenAIChatCompletionsStream(stream, [
      /hello/g,
      "hi",
    ]);
    const out = await collectAsync(wrapped);

    expect(out).toEqual([
      {
        choices: [
          { index: 0, delta: { content: "hi" } },
          { index: 1, delta: { content: "wo" } },
        ],
      },
      {
        choices: [
          { index: 0, delta: { content: "" } },
          { index: 1, delta: { content: "rld" } },
        ],
      },
    ]);
  });

  it("replaceInOpenAIChatCompletionsStream handles two sequential multi-choice messages with staggered lane endings", async () => {
    const stream = fromArray([
      // Message 1
      {
        choices: [
          { index: 0, delta: { content: "he" }, finish_reason: null },
          { index: 1, delta: { content: "go" }, finish_reason: null },
          { index: 2, delta: { content: "fi" }, finish_reason: null },
        ],
      },
      {
        choices: [
          { index: 0, delta: { content: "llo" }, finish_reason: "stop" },
          { index: 1, delta: { content: "od" }, finish_reason: null },
          { index: 2, delta: { content: "rst" }, finish_reason: "stop" },
        ],
      },
      {
        choices: [
          { index: 1, delta: { content: "bye" }, finish_reason: "stop" },
        ],
      },
      // Message 2 (same choice indexes reused after prior lanes ended)
      {
        choices: [
          { index: 0, delta: { content: "he" }, finish_reason: null },
          { index: 1, delta: { content: "go" }, finish_reason: null },
          { index: 2, delta: { content: "sec" }, finish_reason: null },
        ],
      },
      {
        choices: [
          { index: 2, delta: { content: "ond" }, finish_reason: "stop" },
          { index: 1, delta: { content: "od" }, finish_reason: null },
        ],
      },
      {
        choices: [
          { index: 0, delta: { content: "llo" }, finish_reason: "stop" },
        ],
      },
      {
        choices: [
          { index: 1, delta: { content: "bye" }, finish_reason: "stop" },
        ],
      },
    ]);

    const wrapped = replaceInOpenAIChatCompletionsStream(stream, [
      [/hello/g, "hullo"],
      [/goodbye/g, "badbye!"],
      [/first/g, "third"],
      [/second/g, "fourth"],
    ]);
    const out = await collectAsync(wrapped);

    expect(out).toEqual([
      {
        choices: [
          { index: 0, delta: { content: "hullo" }, finish_reason: null },
          { index: 1, delta: { content: "badbye!" }, finish_reason: null },
          { index: 2, delta: { content: "third" }, finish_reason: null },
        ],
      },
      {
        choices: [
          { index: 0, delta: { content: "" }, finish_reason: "stop" },
          { index: 1, delta: { content: "" }, finish_reason: null },
          { index: 2, delta: { content: "" }, finish_reason: "stop" },
        ],
      },
      {
        choices: [{ index: 1, delta: { content: "" }, finish_reason: "stop" }],
      },
      {
        choices: [
          { index: 0, delta: { content: "hullo" }, finish_reason: null },
          { index: 1, delta: { content: "badbye!" }, finish_reason: null },
          { index: 2, delta: { content: "fourth" }, finish_reason: null },
        ],
      },
      {
        choices: [
          { index: 2, delta: { content: "" }, finish_reason: "stop" },
          { index: 1, delta: { content: "" }, finish_reason: null },
        ],
      },
      {
        choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
      },
      {
        choices: [{ index: 1, delta: { content: "" }, finish_reason: "stop" }],
      },
    ]);
  });

  it("replaceInAnthropicStream trusts caller-provided stream surface", async () => {
    const stream = fromArray([{ unknown: true }]) as unknown as AsyncIterable<{
      type: string;
    }>;

    const out = await collectAsync(
      replaceInAnthropicStream(stream, [/x/g, "y"]),
    );

    expect(out).toEqual([{ unknown: true }]);
  });

  it("replaceInAnthropicStream keeps indexed blocks separate from flat text_delta lane", async () => {
    const stream = fromArray([
      { type: "message_start" },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "he" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "hello" },
      },
      { type: "text_delta", text: "llo" },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_stop", index: 1 },
      { type: "message_stop" },
    ]);

    const out = await collectAsync(
      replaceInAnthropicStream(stream, [/hello/g, "hi"]),
    );

    expect(out).toEqual([
      { type: "message_start" },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "hi" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "he" },
      },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_stop", index: 1 },
      { type: "text_delta", text: "llo" },
      { type: "message_stop" },
    ]);
  });

  it("replaceInOpenAIStream routes response events", async () => {
    const stream = fromArray([
      { type: "response.created", id: "a" },
      {
        type: "response.output_text.delta" as const,
        output_index: 0,
        delta: "he",
      },
      {
        type: "response.output_text.delta" as const,
        output_index: 0,
        delta: "llo",
      },
    ]);

    const wrapped = replaceInOpenAIStream(stream, [/hello/g, "hi"]);
    const out = await collectAsync(wrapped);

    expect(out).toEqual([
      { type: "response.created", id: "a" },
      {
        type: "response.output_text.delta",
        output_index: 0,
        delta: "hi",
      },
      {
        type: "response.output_text.delta",
        output_index: 0,
        delta: "",
      },
    ]);
  });

  it("replaceInOpenAIStream throws for unknown stream surfaces", async () => {
    const stream = fromArray([{ unknown: true }]) as unknown as AsyncIterable<{
      choices: Array<{ index: number; delta: { content?: string | null } }>;
    }>;
    const wrapped = replaceInOpenAIStream(stream, [/x/g, "y"]);

    await expect(collectAsync(wrapped)).rejects.toThrow(
      "could not infer stream surface",
    );
  });

  it("replaceInVercelStreamText wraps both streams and preserves helper methods", async () => {
    const textStream = fromArray(["ab", "cd"]);
    const fullStream = fromArray([
      { type: "text" as const, text: "ab" },
      { type: "tool-call" as const, toolCallId: "1" },
      { type: "text" as const, text: "cd" },
    ]);

    const wrapped = replaceInVercelStreamText(
      {
        textStream,
        fullStream,
        helper() {
          return "ok";
        },
      },
      [/abcd/g, "xy"],
    );

    const textOut = await collectAsync(wrapped.textStream);
    const fullOut = await collectAsync(wrapped.fullStream);

    expect(textOut).toEqual(["xy", ""]);
    expect(fullOut).toEqual([
      { type: "tool-call", toolCallId: "1" },
      { type: "text", text: "xy" },
      { type: "text", text: "" },
    ]);
    expect((wrapped as { helper: () => string }).helper()).toBe("ok");
  });
});
