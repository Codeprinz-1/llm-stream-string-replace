import { describe, expect, it } from "vitest";

import { applyRules } from "@/core/compose";
import type { TextAccess } from "@/core/types";
import { collectAsync, fromArray } from "@tests/helpers";

interface EventChunk {
  id: number;
  text: string;
}

const access: TextAccess<EventChunk> = {
  getText: (event) => event.text,
  setText: (event, text) => ({ ...event, text }),
  channelKey: () => "default",
};

describe("core replacement engine", () => {
  it("simple replace", async () => {
    const source = fromArray<EventChunk>([{ id: 1, text: "hello world" }]);

    const output = await collectAsync(
      applyRules(source, [/hello/g, "hi"], access),
    );

    expect(output).toEqual([{ id: 1, text: "hi world" }]);
  });

  it("is transparent with no matches", async () => {
    const source = fromArray<EventChunk>([
      { id: 1, text: "hello" },
      { id: 2, text: " " },
      { id: 3, text: "world" },
    ]);

    const output = await collectAsync(
      applyRules(source, [/abc/g, "x"], access),
    );

    expect(output).toEqual([
      { id: 1, text: "hello" },
      { id: 2, text: " " },
      { id: 3, text: "world" },
    ]);
  });

  it("replace across chunks", async () => {
    const source = fromArray<EventChunk>([
      { id: 1, text: "pe" },
      { id: 2, text: "ter" },
      { id: 3, text: " parker" },
    ]);

    const output = await collectAsync(
      applyRules(source, [/peter/g, "penelope"], access),
    );

    expect(output).toEqual([
      { id: 1, text: "penelope" },
      { id: 2, text: "" },
      { id: 3, text: " parker" },
    ]);
  });

  it("replace across 4 chunks", async () => {
    const source = fromArray<EventChunk>([
      { id: 1, text: "a" },
      { id: 2, text: "b" },
      { id: 3, text: "c" },
      { id: 4, text: "d tail" },
    ]);

    const output = await collectAsync(
      applyRules(source, [/abcd/g, "X"], access),
    );

    expect(output).toEqual([
      { id: 1, text: "X" },
      { id: 2, text: "" },
      { id: 3, text: "" },
      { id: 4, text: " tail" },
    ]);
  });

  it("handles empty chunks", async () => {
    const source = fromArray<EventChunk>([
      { id: 1, text: "" },
      { id: 2, text: "he" },
      { id: 3, text: "" },
      { id: 4, text: "llo" },
      { id: 5, text: "" },
    ]);

    const output = await collectAsync(
      applyRules(source, [/hello/g, "hi"], access),
    );

    expect(output).toEqual([
      { id: 1, text: "" },
      { id: 2, text: "hi" },
      { id: 3, text: "" },
      { id: 4, text: "" },
      { id: 5, text: "" },
    ]);
  });

  it("supports emoji replacement", async () => {
    const source = fromArray<EventChunk>([
      { id: 1, text: "hi 😀" },
      { id: 2, text: " and 😀" },
    ]);

    const output = await collectAsync(
      applyRules(source, [/😀/g, "🙂"], access),
    );

    expect(output).toEqual([
      { id: 1, text: "hi 🙂" },
      { id: 2, text: " and 🙂" },
    ]);
  });
});

it("does not match across sequential messages in one stream", async () => {
  interface MessageEvent {
    id: number;
    messageId: number;
    text: string;
  }

  const messageAccess: TextAccess<MessageEvent> = {
    getText: (event) => event.text,
    setText: (event, text) => ({ ...event, text }),
    channelKey: (event) => event.messageId,
  };

  const source = fromArray<MessageEvent>([
    { id: 1, messageId: 1, text: "hel" },
    { id: 2, messageId: 2, text: "lo" },
  ]);

  const output = await collectAsync(
    applyRules(source, [/hello/g, "hi"], messageAccess),
  );

  expect(output).toEqual([
    { id: 1, messageId: 1, text: "hel" },
    { id: 2, messageId: 2, text: "lo" },
  ]);
});

it("keeps channels independent for parallel messages", async () => {
  interface ChannelEvent {
    id: number;
    channel: number;
    text: string;
  }

  const channelAccess: TextAccess<ChannelEvent> = {
    getText: (event) => event.text,
    setText: (event, text) => ({ ...event, text }),
    channelKey: (event) => event.channel,
  };

  const source = fromArray<ChannelEvent>([
    { id: 1, channel: 0, text: "he" },
    { id: 2, channel: 1, text: "wo" },
    { id: 3, channel: 0, text: "llo" },
    { id: 4, channel: 1, text: "rld" },
  ]);

  const output = await collectAsync(
    applyRules(source, [/hello/g, "hi"], channelAccess),
  );

  expect(output).toEqual([
    { id: 1, channel: 0, text: "hi" },
    { id: 3, channel: 0, text: "" },
    { id: 2, channel: 1, text: "wo" },
    { id: 4, channel: 1, text: "rld" },
  ]);
});

it("handles multiple replacement occurrences", async () => {
  const source = fromArray<EventChunk>([
    { id: 1, text: "ab" },
    { id: 2, text: "ab" },
    { id: 3, text: "ab" },
  ]);

  const output = await collectAsync(applyRules(source, [/ab/g, "X"], access));

  expect(output).toEqual([
    { id: 1, text: "X" },
    { id: 2, text: "X" },
    { id: 3, text: "X" },
  ]);
});

it("handles multiple chained rules", async () => {
  const source = fromArray<EventChunk>([
    { id: 1, text: "alpha" },
    { id: 2, text: " beta" },
  ]);

  const output = await collectAsync(
    applyRules(
      source,
      [
        [/alpha/g, "omega"],
        [/beta/g, "theta"],
      ],
      access,
    ),
  );

  expect(output).toEqual([
    { id: 1, text: "omega" },
    { id: 2, text: " theta" },
  ]);
});

it("handles adjacent matches across chunk boundaries", async () => {
  const source = fromArray<EventChunk>([
    { id: 1, text: "ab" },
    { id: 2, text: "ab" },
    { id: 3, text: "ab" },
  ]);

  const output = await collectAsync(applyRules(source, [/ab/g, "X"], access));

  expect(output).toEqual([
    { id: 1, text: "X" },
    { id: 2, text: "X" },
    { id: 3, text: "X" },
  ]);
});

it("handles match completed at stream end boundary", async () => {
  const source = fromArray<EventChunk>([
    { id: 1, text: "12a" },
    { id: 2, text: "b" },
  ]);

  const output = await collectAsync(applyRules(source, [/ab/g, "Z"], access));

  expect(output).toEqual([
    { id: 1, text: "12Z" },
    { id: 2, text: "" },
  ]);
});

it("passes through non-text events while still replacing text events", async () => {
  interface MixedEvent {
    id: number;
    kind: "text" | "control";
    text?: string;
  }

  const mixedAccess: TextAccess<MixedEvent> = {
    getText: (event) => (event.kind === "text" ? (event.text ?? "") : null),
    setText: (event, text) => ({ ...event, text }),
    channelKey: () => "default",
  };

  const source = fromArray<MixedEvent>([
    { id: 1, kind: "text", text: "he" },
    { id: 2, kind: "control" },
    { id: 3, kind: "text", text: "llo" },
  ]);

  const output = await collectAsync(
    applyRules(source, [/hello/g, "hi"], mixedAccess),
  );

  expect(output).toEqual([
    { id: 2, kind: "control" },
    { id: 1, kind: "text", text: "hi" },
    { id: 3, kind: "text", text: "" },
  ]);
});

it("handles matches that span multiple chunks with untouched edge chunks", async () => {
  const source = fromArray<EventChunk>([
    { id: 1, text: "xxa" },
    { id: 2, text: "bc" },
    { id: 3, text: "yy" },
  ]);

  const output = await collectAsync(applyRules(source, [/abc/g, "Z"], access));

  expect(output).toEqual([
    { id: 1, text: "xxZ" },
    { id: 2, text: "" },
    { id: 3, text: "yy" },
  ]);
});
