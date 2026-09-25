import { readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const CAPTURE_NAME = /^job-(\d+)-page-(\d+)\.pbm$/;

export interface CaptureFile {
  name: string;
  path: string;
  /** Parsed from job-<jobId>-page-<page>.pbm; null for anything else (including dotfile temps). */
  jobId: number | null;
  page: number | null;
  mtime: Date;
}

/**
 * Page bitmaps the patched LPrint driver writes while printing
 * (`job-<jobId>-page-<n>.pbm`, written as a dotfile and renamed into place).
 */
export class CaptureStore {
  constructor(readonly dir: string) {}

  async list(): Promise<CaptureFile[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const files = await Promise.all(
      names.map(async (name): Promise<CaptureFile | null> => {
        const full = path.join(this.dir, name);
        const info = await stat(full).catch(() => null);
        if (!info?.isFile()) return null;
        const match = name.startsWith('.') ? null : CAPTURE_NAME.exec(name);
        return {
          name,
          path: full,
          jobId: match ? Number(match[1]) : null,
          page: match ? Number(match[2]) : null,
          mtime: info.mtime,
        };
      }),
    );
    return files.filter((f): f is CaptureFile => f !== null);
  }

  /** Complete page files for a job, in page order. */
  async pagesFor(jobId: number, files?: CaptureFile[]): Promise<CaptureFile[]> {
    return (files ?? (await this.list()))
      .filter((f) => f.jobId === jobId)
      .sort((a, b) => a.page! - b.page!);
  }

  read(file: CaptureFile): Promise<Buffer> {
    return readFile(file.path);
  }

  async remove(files: CaptureFile[]): Promise<void> {
    await Promise.all(files.map((f) => rm(f.path, { force: true })));
  }
}
