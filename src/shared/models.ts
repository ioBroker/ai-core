/**
 * What to make of the models a provider lists, and of what a model answered.
 */
import type { AiResponseInfo } from './types';

const NON_CHAT_KEYWORDS: string[] = [
    // Embeddings (vector models, no text generation)
    'embedding',
    'text-embedding',
    'textembedding',
    'embeddinggemma', // Ollama: Google's Embedding-Gemma
    'embed-',
    '-embed',
    'bge-',
    'mxbai-embed',
    'nomic-embed',
    'arctic-embed',
    'snowflake-arctic-embed',
    'all-minilm',
    'multilingual-e5',
    'jina-embed',
    'voyage-',
    'gecko',
    'paraphrase-multilingual', // Ollama: sentence-paraphrase embedding

    // Image generation / editing
    'dall-e',
    'gpt-image',
    'image-edit',
    '-image-preview', // gemini-3-pro-image-preview, gemini-3.1-flash-image-preview
    '-image-latest',
    'flash-image', // gemini-2.5-flash-image
    'nano-banana', // Google's image editor (Gemini internal name for Imagen variants)
    'stable-diffusion',
    'sdxl',
    'midjourney',
    'flux-',
    'imagen',

    // Video generation
    'sora',
    'veo-',
    'cogvideo',
    'runway-',
    'lumiere',

    // Music generation
    'lyria', // Google Lyria music model

    // Audio, speech, realtime (TTS, STT, voice pipelines)
    'whisper',
    'tts-',
    '-tts', // gemini-2.5-flash-preview-tts, gemini-2.5-pro-preview-tts
    'speech-',
    'audio-preview',
    'mini-tts',
    'mini-transcribe',
    '-transcribe', // gpt-4o-transcribe, gpt-4o-transcribe-diarize
    'native-audio', // gemini-2.5-flash-native-audio-latest
    'flash-live', // gemini-3.1-flash-live-preview (realtime voice pipeline)
    'gpt-audio', // gpt-audio, gpt-audio-1.5, gpt-audio-mini
    'realtime',
    'bark-',
    'xtts',
    'voicebox',

    // Moderation / safety classifiers
    'moderation',
    'omni-moderation',
    'llama-guard',
    'shieldgemma',
    'prompt-guard',
    '-guardian', // granite3-guardian
    'safeguard', // gpt-oss-safeguard

    // Rerankers
    'rerank',
    'reranker',

    // Legacy OpenAI GPT-3-era completion models (no chat/tool calling)
    'babbage-',
    'davinci-',
    'curie-',
    'text-ada-',
    'text-davinci',
    'text-curie',
    'text-babbage',
    'instructgpt',
    'code-davinci',
    'code-cushman',
    '-turbo-instruct', // gpt-3.5-turbo-instruct, gpt-3.5-turbo-instruct-0914

    // Web search / browsing-only endpoints
    '-search-preview', // gpt-4o-search-preview, gpt-4o-mini-search-preview
    '-search-api', // gpt-5-search-api

    // Search / similarity endpoints (legacy)
    'code-search',
    'text-search',
    'similarity-',

    // Specialty / non-conversational
    'computer-use-preview', // OpenAI: action loop, not general chat
    'deep-research', // deep-research-pro-preview (long-running research agent, not general chat)
    'robotics', // gemini-robotics-er-* (robotics embodied reasoning)
    'aqa', // Gemini attributed question answering
    // Ollama single-task models
    'reader-lm', // HTML → Markdown converter
    '-nsql', // duckdb-nsql and similar text-to-SQL-only models
    'minicheck', // bespoke-minicheck (fact-checking classifier)
];

export function isChatModel(name: string): boolean {
    const lower = name.toLowerCase();
    // Reject obvious non-textual models and Anthropic's deprecated Claude 2.x line.
    if (NON_CHAT_KEYWORDS.some(kw => lower.includes(kw))) {
        return false;
    }
    // Anthropic: filter deprecated families that can't be reached by most users
    if (lower.startsWith('claude-1') || lower.startsWith('claude-instant')) {
        return false;
    }
    return true;
}

/** Strip LLM thinking artifacts from response content */
export function stripThinkingArtifacts(content: string): string {
    let cleaned = content;
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    cleaned = cleaned.replace(/<\|endoftext\|>/g, '');
    cleaned = cleaned.replace(/<\|im_start\|>[\s\S]*?<\|im_end\|>/g, '');
    cleaned = cleaned.replace(/<\|im_start\|>[\s\S]*/g, '');
    return cleaned.trim();
}

/**
 * Whether the endpoint stopped because it ran out of output budget rather than because it was done.
 *
 * Anthropic says `max_tokens`, the OpenAI-compatible ones say `length`. In both cases the answer
 * ends mid-word and is worthless as code, so it must not look like a finished reply.
 *
 * @param result the response as the adapter passed it on
 */
export function isTruncatedAnswer(result: AiResponseInfo): boolean {
    return result.finishReason === 'max_tokens' || result.finishReason === 'length';
}
