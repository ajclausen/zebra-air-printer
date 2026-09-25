import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

export interface CommandResult {
  stdout: string;
  stderr: string;
}

/** Runs a program without a shell. Rejects on non-zero exit, missing binary, or timeout. */
export type CommandRunner = (file: string, args: string[], options?: { timeoutMs?: number }) => Promise<CommandResult>;

export const runCommand: CommandRunner = (file, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeoutMs ?? 5000,
        maxBuffer: 8 * 1024 * 1024,
        // Stable, parseable output regardless of the service's locale.
        env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SYSTEMD_PAGER: '', SYSTEMD_COLORS: '0' },
      },
      (err, stdout, stderr) => {
        if (err) {
          const message = stderr.trim() || err.message;
          reject(Object.assign(new Error(message), { cause: err }));
        } else {
          resolve({ stdout, stderr });
        }
      },
    );
  });

/** Reads a text file, returning null if it is missing or unreadable. */
export type TextReader = (path: string) => Promise<string | null>;

export const readText: TextReader = async (path) => {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
};
