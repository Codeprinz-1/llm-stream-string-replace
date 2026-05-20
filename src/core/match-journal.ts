import type { MatchRecord, Segment } from "@/core/types";

export function applyMatchToSegments<TEvent>(
  segments: Segment<TEvent>[],
  match: MatchRecord,
  cumulativeDeltaBefore: number,
): number {
  const matchStart = match.absStart;
  const matchEnd = match.absEnd;
  const originalMatchLen = matchEnd - matchStart;
  const delta = match.newLen - originalMatchLen;
  const outputPosAtMatchStart = matchStart + cumulativeDeltaBefore;

  for (const segment of segments) {
    const segmentStart = segment.inputStart;
    const segmentEnd = segment.inputEnd;

    const isBeforeMatch = segmentEnd <= matchStart;
    if (isBeforeMatch) {
      continue;
    }

    const isAfterMatch = segmentStart >= matchEnd;
    const fullyContainsMatch =
      segmentStart <= matchStart && segmentEnd >= matchEnd;
    if (isAfterMatch || fullyContainsMatch) {
      segment.expectedOutputEnd += delta;
      continue;
    }

    const endsInsideMatch = segmentStart <= matchStart && segmentEnd < matchEnd;
    const fullyInsideMatch =
      segmentStart > matchStart && segmentEnd <= matchEnd;
    if (endsInsideMatch || fullyInsideMatch) {
      segment.expectedOutputEnd = outputPosAtMatchStart + match.newLen;
      continue;
    }

    // Segment starts inside the match and extends beyond it.
    segment.expectedOutputEnd =
      outputPosAtMatchStart + match.newLen + (segmentEnd - matchEnd);
  }

  return delta;
}
