import { describe, expect, it } from "vitest";

import { replaceInLangChainStream } from "@/adapters/langchain";
import { collectAsync, fromArray } from "@tests/helpers";

describe("replaceInLangChainStream", () => {
  it("handles mixed string and text-object content parts without truncation", async () => {
    const stream = fromArray([
      {
        content: [
          "he",
          { type: "text", text: "llo" },
          { type: "tool_call", name: "demo" },
        ],
      },
    ]);

    const out = await collectAsync(
      replaceInLangChainStream(stream, [/hello/g, "hello!!"]),
    );

    expect(out).toEqual([
      {
        content: [
          "he",
          { type: "text", text: "llo!!" },
          { type: "tool_call", name: "demo" },
        ],
      },
    ]);
  });

  it("resets channel on usage_metadata to avoid cross-message bleed", async () => {
    const stream = fromArray([
      { content: "he" },
      {
        content: "",
        usage_metadata: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
      },
      { content: "llo" },
      {
        content: "",
        usage_metadata: { input_tokens: 0, output_tokens: 1, total_tokens: 1 },
      },
    ]);

    const out = await collectAsync(
      replaceInLangChainStream(stream, [/hello/g, "hi"]),
    );

    expect(out).toEqual([
      { content: "he" },
      {
        content: "",
        usage_metadata: { input_tokens: 1, output_tokens: 0, total_tokens: 1 },
      },
      { content: "llo" },
      {
        content: "",
        usage_metadata: { input_tokens: 0, output_tokens: 1, total_tokens: 1 },
      },
    ]);
  });

  it("treats usage_metadata as end-of-message", async () => {
    const stream = fromArray([
      { content: "he" },
      {
        content: "llo",
        usage_metadata: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    ]);

    const out = await collectAsync(
      replaceInLangChainStream(stream, [/hello/g, "hi"]),
    );

    expect(out).toEqual([
      { content: "hi" },
      {
        content: "",
        usage_metadata: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      },
    ]);
  });

  it("replaces across two sequential messages each with mixed content blocks", async () => {
    // Simulates two back-to-back LLM responses in the same stream.
    // Message 1: tokens arrive as plain strings and text-object blocks, spelling "hello world".
    // Message 2: tokens arrive the same way, spelling "say hello again".
    // The rule replaces every "hello" → "hey".
    // usage_metadata terminates each message so channels reset between them.
    const stream = fromArray([
      // --- message 1 ---
      { content: [{ type: "text", text: "hel" }, "lo "] },
      { content: "wor" },
      {
        content: [{ type: "text", text: "ld" }],
        usage_metadata: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
      },
      // --- message 2 ---
      { content: "say " },
      {
        content: [
          { type: "text", text: "hel" },
          { type: "text", text: "lo" },
        ],
      },
      {
        content: " again",
        usage_metadata: { input_tokens: 2, output_tokens: 5, total_tokens: 7 },
      },
    ]);

    const out = await collectAsync(
      replaceInLangChainStream(stream, [/hello/g, "hey"]),
    );

    expect(out).toStrictEqual([
      // message 1 — "hello world" → "hey world"
      { content: [{ type: "text", text: "hey" }, " "] },
      { content: "wor" },
      {
        content: [{ type: "text", text: "ld" }],
        usage_metadata: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
      },
      // message 2 — "say hello again" → "say hey again"
      { content: "say " },
      {
        content: [
          { type: "text", text: "hey" },
          { type: "text", text: "" },
        ],
      },
      {
        content: " again",
        usage_metadata: { input_tokens: 2, output_tokens: 5, total_tokens: 7 },
      },
    ]);
  });

  it("replaces a match that spans plain-string and text-object blocks within one chunk", async () => {
    // "hel" arrives as a plain string, "lo!" as a text object — both inside one chunk.
    // The replacer should reunite them through extractText/injectText and replace "hello".
    const stream = fromArray([
      {
        content: [
          "hel",
          { type: "text", text: "lo!" },
          { type: "tool_call", name: "fn" },
        ],
        usage_metadata: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      },
    ]);

    const out = await collectAsync(
      replaceInLangChainStream(stream, [/hello/g, "hey"]),
    );

    expect(out).toStrictEqual([
      {
        // "hey!" distributed: plain-string slot (len 3) → "hey", text-object slot (last) → "!"
        content: [
          "hey",
          { type: "text", text: "!" },
          { type: "tool_call", name: "fn" },
        ],
        usage_metadata: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
      },
    ]);
  });
});
