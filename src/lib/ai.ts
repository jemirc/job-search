import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getCodexAuthStatus, runCodexPrompt } from '@/lib/codex';

type Provider = 'gemini' | 'openai' | 'codex';

interface AiResponse {
  text: string;
}

function getDbSetting(key: string): string | undefined {
  try {
    const dbPath = path.join(process.cwd(), 'data', 'job-search.db');
    if (!fs.existsSync(dbPath)) return undefined;
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return row?.value || undefined;
    } catch {
      return undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

function getProvider(): { provider: Provider; geminiKey?: string; openaiKey?: string } {
  // DB keys take priority over env vars
  const geminiKey = getDbSetting('GEMINI_API_KEY') || process.env.GEMINI_API_KEY;
  const openaiKey = getDbSetting('OPENAI_API_KEY') || process.env.OPENAI_API_KEY;
  const codexStatus = getCodexAuthStatus();

  // Check if user explicitly chose a provider
  const preferredProvider = getDbSetting('AI_PROVIDER');
  if (preferredProvider === 'codex') {
    if (codexStatus.oauthAvailable) return { provider: 'codex' };
    throw new Error('Codex ChatGPT 로그인이 필요합니다. 터미널에서 `codex login` 후 다시 시도해주세요.');
  }
  if (preferredProvider === 'openai' && openaiKey) return { provider: 'openai', openaiKey };
  if (preferredProvider === 'gemini' && geminiKey) return { provider: 'gemini', geminiKey };

  if (geminiKey) return { provider: 'gemini', geminiKey };
  if (openaiKey) return { provider: 'openai', openaiKey };
  if (codexStatus.oauthAvailable) return { provider: 'codex' };

  throw new Error('GEMINI_API_KEY, OPENAI_API_KEY 또는 Codex ChatGPT 로그인을 설정해주세요');
}

export function getProviderName(): string {
  try {
    const { provider } = getProvider();
    if (provider === 'gemini') return 'Gemini';
    if (provider === 'codex') return 'Codex';
    return 'OpenAI';
  } catch {
    return 'Not configured';
  }
}

export async function generateText(prompt: string): Promise<AiResponse> {
  const { provider, geminiKey, openaiKey } = getProvider();

  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(geminiKey!);
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
    const result = await model.generateContent(prompt);
    return { text: result.response.text() };
  } else if (provider === 'openai') {
    const openai = new OpenAI({ apiKey: openaiKey! });
    const result = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      messages: [{ role: 'user', content: prompt }],
    });
    return { text: result.choices[0]?.message?.content || '' };
  }

  return { text: await runCodexPrompt(prompt) };
}

export async function generateJson(prompt: string): Promise<AiResponse> {
  const { provider, geminiKey, openaiKey } = getProvider();

  if (provider === 'gemini') {
    const genAI = new GoogleGenerativeAI(geminiKey!);
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    });
    return { text: result.response.text() };
  } else if (provider === 'openai') {
    const openai = new OpenAI({ apiKey: openaiKey! });
    const result = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      messages: [{ role: 'user', content: prompt + '\n\nReturn ONLY valid JSON, no markdown or extra text.' }],
      response_format: { type: 'json_object' },
    });
    return { text: result.choices[0]?.message?.content || '{}' };
  }

  return {
    text: await runCodexPrompt(`${prompt}\n\nReturn ONLY valid JSON, no markdown or extra text.`, { expectJson: true }),
  };
}
