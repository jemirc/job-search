import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CODEX_WORKDIR = path.join(os.tmpdir(), 'job-search-codex-workdir');
const MAX_CAPTURED_OUTPUT = 512_000;

type RawCodexAuthFile = {
  auth_mode?: unknown;
  tokens?: {
    access_token?: unknown;
    refresh_token?: unknown;
  };
};

export interface CodexAuthStatus {
  cliAvailable: boolean;
  cliPath?: string;
  authMode?: string;
  oauthAvailable: boolean;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isExecutable(filePath: string): boolean {
  try {
    fsSync.accessSync(filePath, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCodexHome(): string {
  const configured = asNonEmptyString(process.env.CODEX_HOME);
  if (!configured) return path.join(os.homedir(), '.codex');
  if (configured === '~') return os.homedir();
  if (configured.startsWith('~/')) return path.join(os.homedir(), configured.slice(2));
  return path.resolve(configured);
}

function readCodexAuthFile(): RawCodexAuthFile | null {
  try {
    const raw = fsSync.readFileSync(path.join(resolveCodexHome(), 'auth.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as RawCodexAuthFile) : null;
  } catch {
    return null;
  }
}

function resolveCodexBinaryFromPath(): string | undefined {
  const configured = asNonEmptyString(process.env.CODEX_BIN);
  if (configured && isExecutable(configured)) return configured;

  const pathValue = process.env.PATH;
  if (!pathValue) return undefined;

  const executableName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, executableName);
    if (isExecutable(candidate)) return candidate;
  }

  return undefined;
}

function resolveCodexBinaryFromEditors(): string | undefined {
  const extensionRoots = [
    path.join(os.homedir(), '.vscode', 'extensions'),
    path.join(os.homedir(), '.vscode-insiders', 'extensions'),
    path.join(os.homedir(), '.cursor', 'extensions'),
  ];

  let relativeBinaryPath: string;
  if (process.platform === 'darwin') {
    relativeBinaryPath = path.join('bin', process.arch === 'arm64' ? 'macos-aarch64' : 'macos-x64', 'codex');
  } else if (process.platform === 'win32') {
    relativeBinaryPath = path.join('bin', 'win32-x64', 'codex.exe');
  } else {
    relativeBinaryPath = path.join('bin', process.arch === 'arm64' ? 'linux-aarch64' : 'linux-x64', 'codex');
  }

  for (const root of extensionRoots) {
    try {
      const candidates = fsSync.readdirSync(root)
        .filter((entry) => entry.startsWith('openai.chatgpt-'))
        .sort()
        .reverse();

      for (const entry of candidates) {
        const candidate = path.join(root, entry, relativeBinaryPath);
        if (isExecutable(candidate)) return candidate;
      }
    } catch {
      // Ignore unreadable editor extension directories.
    }
  }

  return undefined;
}

function resolveCodexBinary(): string | undefined {
  return resolveCodexBinaryFromPath() || resolveCodexBinaryFromEditors();
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text.trim();
}

function extractBalancedJson(text: string, openChar: '{' | '[', closeChar: '}' | ']'): string | undefined {
  const start = text.indexOf(openChar);
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === openChar) depth += 1;
    if (char === closeChar) depth -= 1;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return undefined;
}

function normalizeJsonText(raw: string): string {
  const candidates = [
    raw.trim(),
    stripCodeFences(raw),
    extractBalancedJson(raw, '{', '}'),
    extractBalancedJson(raw, '[', ']'),
  ].filter((value): value is string => Boolean(value && value.trim()));

  for (const candidate of candidates) {
    try {
      return JSON.stringify(JSON.parse(candidate));
    } catch {
      // Try the next extraction strategy.
    }
  }

  throw new Error('Codex가 유효한 JSON을 반환하지 않았습니다.');
}

function formatCodexError(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const stderr = typeof error === 'object' && error && 'stderr' in error
    ? String((error as { stderr?: string }).stderr || '')
    : '';
  const combined = `${message}\n${stderr}`.trim();

  if (/not logged in|logged out|authenticate|login/i.test(combined)) {
    return new Error('Codex ChatGPT 로그인 세션을 찾을 수 없습니다. 터미널에서 `codex login` 후 다시 시도해주세요.');
  }

  if (/timed out|timeout/i.test(combined)) {
    return new Error('Codex 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.');
  }

  if (/rate limit|quota|credits|limit reached/i.test(combined)) {
    return new Error('Codex 사용 한도에 도달했습니다. 잠시 후 다시 시도해주세요.');
  }

  return new Error(`Codex 실행에 실패했습니다: ${message}`);
}

async function runCodexExec(cliPath: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cliPath, args, {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Codex execution timed out'));
    }, 180_000);

    const appendChunk = (current: string, chunk: Buffer | string) => {
      const next = current + chunk.toString();
      return next.length > MAX_CAPTURED_OUTPUT ? next.slice(-MAX_CAPTURED_OUTPUT) : next;
    };

    child.stdout.on('data', (chunk) => {
      stdout = appendChunk(stdout, chunk);
    });

    child.stderr.on('data', (chunk) => {
      stderr = appendChunk(stderr, chunk);
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(Object.assign(new Error(`Codex exited with code ${code ?? 'unknown'}`), { stdout, stderr }));
    });

    child.stdin.end();
  });
}

export function getCodexAuthStatus(): CodexAuthStatus {
  const cliPath = resolveCodexBinary();
  const authFile = readCodexAuthFile();
  const authMode = asNonEmptyString(authFile?.auth_mode);
  const accessToken = asNonEmptyString(authFile?.tokens?.access_token);
  const refreshToken = asNonEmptyString(authFile?.tokens?.refresh_token);

  return {
    cliAvailable: Boolean(cliPath),
    cliPath,
    authMode,
    oauthAvailable: Boolean(cliPath && authMode === 'chatgpt' && accessToken && refreshToken),
  };
}

export async function runCodexPrompt(prompt: string, options?: { expectJson?: boolean }): Promise<string> {
  const status = getCodexAuthStatus();
  if (!status.cliPath) {
    throw new Error('Codex CLI를 찾을 수 없습니다. `codex`가 설치된 환경에서 다시 실행해주세요.');
  }
  if (!status.oauthAvailable) {
    throw new Error('Codex ChatGPT 로그인 세션을 찾을 수 없습니다. 터미널에서 `codex login` 후 다시 시도해주세요.');
  }

  await fs.mkdir(CODEX_WORKDIR, { recursive: true });
  const outputPath = path.join(os.tmpdir(), `job-search-codex-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  const instructionPrefix = options?.expectJson
    ? 'Respond directly. Do not inspect files, use tools, or run shell commands. Return ONLY valid JSON with no markdown or extra commentary.'
    : 'Respond directly. Do not inspect files, use tools, or run shell commands. Return only the final answer text.';

  try {
    await runCodexExec(
      status.cliPath,
      [
        'exec',
        '--ephemeral',
        '--skip-git-repo-check',
        '--disable',
        'plugins',
        '-c',
        'model_reasoning_effort="low"',
        '--sandbox',
        'read-only',
        '--color',
        'never',
        '-C',
        CODEX_WORKDIR,
        '--output-last-message',
        outputPath,
        `${instructionPrefix}\n\n${prompt}`,
      ]
    );

    const text = (await fs.readFile(outputPath, 'utf8')).trim();
    if (!text) {
      throw new Error('Codex가 빈 응답을 반환했습니다.');
    }

    return options?.expectJson ? normalizeJsonText(text) : text;
  } catch (error) {
    throw formatCodexError(error);
  } finally {
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}
