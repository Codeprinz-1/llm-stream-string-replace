import type ReplaceStreamFactory from "replacestream";

export type ReplaceFn = (
  match: string,
  captures: string[],
  offset: number,
  input: string,
) => string;

export type Rule = [pattern: string | RegExp, replacement: string | ReplaceFn];

export type Rules = Rule | Rule[];

export interface ChannelReplacerOptions {
  /**
   * Sets a limit on the number of times the replacement will be made. This
   * is forced to one when a regex without the global flag is provided.
   *
   * Default: `Infinity`
   */
  limit?: number;
  /**
   * The text encoding used during search and replace.
   *
   * Default: `"utf8"`
   */
  encoding?: BufferEncoding;
  /**
   * When doing cross-chunk replacing, this sets the maximum length match
   * that will be supported.
   *
   * Default: `100`
   */
  maxMatchLen?: number;
  /**
   * When doing string match (not relevant for regex matching) whether to do a
   * case insensitive search.
   *
   * Default: `true`
   */
  ignoreCase?: boolean;
}

export interface Segment<TEvent> {
  event: TEvent;
  inputStart: number;
  inputEnd: number;
  expectedOutputEnd: number;
}

export interface MatchRecord {
  absStart: number;
  absEnd: number;
  newLen: number;
}

export interface TextAccess<TEvent> {
  getText: (event: TEvent) => string | null;
  setText: (event: TEvent, text: string) => TEvent;
  channelKey: (event: TEvent) => string | number;
  isChannelEnd?: (event: TEvent) => boolean;
}
