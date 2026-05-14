import type ReplaceStreamFactory from "replacestream";

export type ReplaceFn = (
  match: string,
  captures: string[],
  offset: number,
  input: string,
) => string;

export type Rule = [pattern: string | RegExp, replacement: string | ReplaceFn];

export type Rules = Rule | Rule[];

export interface ChannelReplacerOptions extends Omit<
  ReplaceStreamFactory.Options,
  "encoding"
> {
  encoding?: BufferEncoding;
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
