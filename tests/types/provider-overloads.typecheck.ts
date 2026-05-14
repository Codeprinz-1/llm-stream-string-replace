import { replaceInAnthropicStream } from "@/adapters/anthropic";
import { replaceInLangChainStream } from "@/adapters/langchain";
import { replaceInOpenAIStream } from "@/adapters/openai";

type IsAssignable<A, B> = A extends B ? true : false;

type Assert<T extends true> = T;

async function* openAIChunkStream() {
  yield {
    choices: [
      {
        index: 0,
        delta: { content: "hello" },
      },
    ],
  };
}

async function* anthropicStream() {
  yield {
    type: "content_block_delta" as const,
    index: 0,
    delta: {
      type: "text_delta" as const,
      text: "hello",
    },
  };
}

async function* langChainStringStream() {
  yield "hello";
}

const o = replaceInOpenAIStream(openAIChunkStream(), [/hello/g, "hi"]);
const a = replaceInAnthropicStream(anthropicStream(), [/hello/g, "hi"]);
const l = replaceInLangChainStream(langChainStringStream(), [/hello/g, "hi"]);

type _OpenAITest = Assert<
  IsAssignable<ReturnType<typeof openAIChunkStream>, typeof o>
>;
type _AnthropicTest = Assert<
  IsAssignable<ReturnType<typeof anthropicStream>, typeof a>
>;
type _LangChainTest = Assert<IsAssignable<typeof l, AsyncIterable<string>>>;

void [o, a, l];
