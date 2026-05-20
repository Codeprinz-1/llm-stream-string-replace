export type {
  ChannelReplacerOptions,
  ReplaceFn,
  Rule,
  Rules,
  TextAccess,
} from "@/core/types";

export { applyRules } from "@/core/compose";
export { ChannelReplacer } from "@/core/channel-replacer";

export {
  replaceInAsyncIterable,
  replaceInStringIterable,
} from "@/adapters/generic";
export {
  replaceInOpenAIStream,
  replaceInOpenAIChatCompletionsStream,
  replaceInOpenAIResponsesStream,
} from "@/adapters/openai";
export { replaceInAnthropicStream } from "@/adapters/anthropic";
export {
  replaceInVercelStreamText,
  replaceInVercelTextStream,
  replaceInVercelFullStream,
} from "@/adapters/vercel";
export {
  replaceInLangChainStream,
  LLMStreamReplaceCallback,
} from "@/adapters/langchain";
