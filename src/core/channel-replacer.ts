import ReplaceStreamFactory from "replacestream";

import { applyMatchToSegments } from "@/core/match-journal";
import type {
  ChannelReplacerOptions,
  Rule,
  Segment,
} from "@/core/types";

function escapeForRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePattern(
  pattern: string | RegExp,
  options: ChannelReplacerOptions,
): RegExp {
  if (typeof pattern !== "string") {
    return pattern;
  }

  const flags =
    options.regExpOptions ?? (options.ignoreCase === false ? "gm" : "gmi");

  // Keep string-search semantics while ensuring replacement callback receives
  // (match, p1, offset, input) compatible metadata.
  return new RegExp(`(${escapeForRegex(pattern)})`, flags);
}

function resolveOptions(
  pattern: string | RegExp,
  options: ChannelReplacerOptions,
): ChannelReplacerOptions {
  if (typeof pattern !== "string" || options.maxMatchLen !== undefined) {
    return options;
  }

  return {
    ...options,
    maxMatchLen: pattern.length,
  };
}

export class ChannelReplacer<TEvent> {
  private readonly replacer: NodeJS.ReadWriteStream;

  private readonly setText: (event: TEvent, text: string) => TEvent;

  private readonly encoding: BufferEncoding;

  private readonly pendingSegments: Segment<TEvent>[] = [];

  private outputBuffer = "";

  private outputStart = 0;

  private absoluteCharsSent = 0;

  private cumulativeDelta = 0;

  constructor(
    rule: Rule,
    setText: (event: TEvent, text: string) => TEvent,
    options: ChannelReplacerOptions = {},
  ) {
    const [rawPattern, replacement] = rule;
    const pattern = normalizePattern(rawPattern, options);
    const resolvedOptions = resolveOptions(rawPattern, options);
    this.setText = setText;
    this.encoding = resolvedOptions.encoding ?? "utf8";

    const replacementFn = (match: string, ...args: Array<string | number>): string => {
      const offset = args[args.length - 2] as number;
      const input = args[args.length - 1] as string;
      const captures = args
        .slice(0, -2)
        .map((value) => (typeof value === "string" ? value : ""));
      const produced =
        typeof replacement === "string"
          ? replacement
          : replacement(match, captures, offset, input);
      const absStart = this.absoluteCharsSent - input.length + offset;
      const delta = applyMatchToSegments(
        this.pendingSegments,
        { absStart, absEnd: absStart + match.length, newLen: produced.length },
        this.cumulativeDelta,
      );
      this.cumulativeDelta += delta;

      return produced;
    };

    this.replacer = ReplaceStreamFactory(
      pattern,
      replacementFn,
      resolvedOptions,
    ) as NodeJS.ReadWriteStream;

    this.replacer.on("data", (chunk: Buffer | string) => {
      this.outputBuffer +=
        typeof chunk === "string" ? chunk : chunk.toString(this.encoding);
    });
  }

  feed(text: string, event: TEvent): TEvent[] {
    const segment: Segment<TEvent> = {
      event,
      inputStart: this.absoluteCharsSent,
      inputEnd: this.absoluteCharsSent + text.length,
      expectedOutputEnd:
        this.absoluteCharsSent + text.length + this.cumulativeDelta,
    };

    this.pendingSegments.push(segment);
    this.absoluteCharsSent += text.length;

    this.replacer.write(text, this.encoding);

    return this.drainPendingSegments();
  }

  async end(): Promise<TEvent[]> {
    await new Promise<void>((resolve, reject) => {
      this.replacer.once("error", reject);
      this.replacer.once("end", resolve);
      this.replacer.end();
    });

    return this.drainPendingSegments();
  }

  private drainPendingSegments(): TEvent[] {
    const ready: TEvent[] = [];

    while (this.pendingSegments.length > 0) {
      const current = this.pendingSegments[0];
      const neededLength = current.expectedOutputEnd - this.outputStart;

      if (this.outputBuffer.length < neededLength) {
        break;
      }

      const emittedText = this.outputBuffer.slice(0, neededLength);
      this.outputBuffer = this.outputBuffer.slice(neededLength);
      this.outputStart = current.expectedOutputEnd;

      ready.push(this.setText(current.event, emittedText));
      this.pendingSegments.shift();
    }

    return ready;
  }
}
