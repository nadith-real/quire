import { createOpenAI } from "@ai-sdk/openai";
import { generateObject, generateText } from "ai";
import { extractJson, repairJson } from "./json.js";

export function getModelId() {
  return process.env.USER_LLM_MODEL || "openai/gpt-4o-mini";
}

export function createClient() {
  const apiKey = process.env.USER_LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set USER_LLM_API_KEY in .env with your OpenRouter API key"
    );
  }
  return createOpenAI({
    apiKey,
    baseURL: process.env.USER_LLM_BASE_URL || "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": "https://quire.local",
      "X-Title": "Quire Document Crew",
    },
  });
}

export function getModel() {
  return createClient()(getModelId());
}

export async function complete({
  system,
  prompt,
  messages,
  maxTokens = 4000,
  temperature = 0.3,
}) {
  const { text } = await generateText({
    model: getModel(),
    system,
    prompt,
    messages,
    temperature,
    maxTokens,
  });
  return text;
}

function isFatalLlmError(err) {
  const msg = String(err?.message || err || "");
  return /api key|unauthorized|401|402|429|quota|USER_LLM_API_KEY/i.test(msg);
}

export async function completeObject({ system, prompt, schema }) {
  try {
    const { object } = await generateObject({
      model: getModel(),
      schema,
      system,
      prompt,
      temperature: 0.2,
      maxTokens: 3500,
      experimental_repairText: async ({ text }) => repairJson(text),
    });
    return schema.parse(object);
  } catch (err) {
    if (isFatalLlmError(err)) throw err;
    const text = await complete({
      system: `${system}\n\nReturn one valid JSON object only. No markdown fences. No trailing commas. Escape every quote inside strings with a backslash.`,
      prompt: `${prompt}\n\nKeep arrays short. If a field is long, summarize it.`,
      maxTokens: 2500,
    });
    return schema.parse(extractJson(text));
  }
}
