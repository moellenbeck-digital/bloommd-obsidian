import { LEARNING_FOLDER, emptyLearningFile, learningFilePath, mergeLearningFiles, parseLearningFile, serializeLearningFile, type LearningFile } from "./learning";

/** The part of Obsidian's DataAdapter used here; it reaches hidden folders on desktop and mobile. */
export interface LearningAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/**
 * Progress files in `.bloommd/learning/`. Every write first reads the file and merges node by node,
 * so a rating synced in from another device is never overwritten by a stale copy in memory, and
 * every load writes back what only memory knew. Operations run one at a time.
 */
export class LearningStore {
  private readonly memory = new Map<string, LearningFile>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly adapter: LearningAdapter) {}

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async disk(key: string): Promise<{ file: LearningFile; text: string } | null> {
    const path = learningFilePath(key);
    if (!(await this.adapter.exists(path))) return null;
    const file = parseLearningFile(await this.adapter.read(path));
    return { file, text: serializeLearningFile(file) };
  }

  private async save(key: string, file: LearningFile, previous: string | null): Promise<LearningFile> {
    this.memory.set(key, file);
    const text = serializeLearningFile(file);
    if (text === previous) return file;
    for (const folder of [LEARNING_FOLDER.split("/")[0]!, LEARNING_FOLDER]) {
      if (!(await this.adapter.exists(folder))) await this.adapter.mkdir(folder);
    }
    await this.adapter.write(learningFilePath(key), text);
    return file;
  }

  /** Reads a map's progress (also after an external edit or sync), merged with what memory holds. */
  load(key: string): Promise<LearningFile> {
    return this.serial(async () => {
      const stored = await this.disk(key);
      const known = this.memory.get(key);
      if (!known) {
        const file = stored?.file ?? emptyLearningFile();
        this.memory.set(key, file);
        return file;
      }
      return this.save(key, mergeLearningFiles(known, stored?.file ?? emptyLearningFile()), stored?.text ?? null);
    });
  }

  /** Applies a change on top of the latest file on disk and writes the result. */
  update(key: string, change: (file: LearningFile) => LearningFile): Promise<LearningFile> {
    return this.serial(async () => {
      const stored = await this.disk(key);
      const base = mergeLearningFiles(this.memory.get(key) ?? emptyLearningFile(), stored?.file ?? emptyLearningFile());
      return this.save(key, change(base), stored?.text ?? null);
    });
  }

  /** Moves progress to a new key (the note was renamed or got a BloomMD id), merging with any file there. */
  move(from: string, to: string, path: string): Promise<boolean> {
    if (from === to) return Promise.resolve(false);
    return this.serial(async () => {
      const source = await this.disk(from);
      const known = this.memory.get(from);
      if (!source && !known) return false;
      const target = await this.disk(to);
      const moved = mergeLearningFiles(mergeLearningFiles(target?.file ?? emptyLearningFile(), source?.file ?? emptyLearningFile()), known ?? emptyLearningFile());
      await this.save(to, { ...moved, path }, target?.text ?? null);
      this.memory.delete(from);
      if (source) await this.adapter.remove(learningFilePath(from));
      return true;
    });
  }
}
