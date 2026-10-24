/**
 * GENERATED FILE — DO NOT EDIT.
 * Snapshot of packages/core/src/learning.ts by the BloomMD mirror sync.
 * Source SHA-256: 855be35f39e7bf1e6c902d5a74d78fa7b18dfbb25528b6f9d06d186bab155111
 */
/**
 * Personal learning progress on a BloomMD map: ratings per node, a small spaced-repetition
 * schedule, and the storage format shared by the Obsidian plugin and (later) the BloomMD apps.
 *
 * Progress is personal and never changes the note's Markdown. It lives next to the vault in
 * `.bloommd/learning/<key>.json`, keyed by the map note and, inside, by each node's `bloommd:id`.
 * This module is dependency-free on purpose: the Obsidian plugin imports it through the narrow
 * `@bloommd/core/learning` entry, and its public mirror carries it as a standalone snapshot.
 *
 * Scheduling (documented in the plugin README):
 * - Every level has an interval in days (defaults New 0, Unsure 1, Got it 4). Rating a node sets
 *   `due` to the rating day plus that interval; a node is due once that day has come.
 * - Rating the top level again in a row multiplies the top interval by the growth factor per
 *   repetition (4 → 10 → 25 → 63 days with 2.5), capped at MAX_INTERVAL_DAYS. Any lower rating
 *   resets that streak, so a forgotten node comes back soon.
 */

export const LEARNING_FOLDER = ".bloommd/learning";
export const LEARNING_FORMAT = 1;
export const MAX_INTERVAL_DAYS = 180;

export type LevelCount = 3 | 5;
export type LearningDisplay = "border" | "fill" | "badge" | "off";
export type StudyOrder = "map" | "due" | "onlyDue" | "onlyUnsure";

export interface LearningEntry {
  /** Rating on a scale of `of` levels: 0 is the lowest ("New"), `of - 1` means mastered. */
  level: number;
  of: LevelCount;
  /** ISO timestamp of the latest rating. When devices disagree, the newer rating wins. */
  lastReviewed: string;
  /** Local calendar day (YYYY-MM-DD) from which the node is due again. */
  due: string;
  /** Top ratings in a row; the top interval grows with it. */
  streak: number;
}

export interface LearningFile {
  format: typeof LEARNING_FORMAT;
  /** Vault path of the map note when the file was last written (informational, for re-keying). */
  path?: string;
  /** Exam day (YYYY-MM-DD) for this map, or absent. */
  examDate?: string;
  /** When the exam date was last set or cleared; the newer choice wins across devices. */
  examUpdated?: string;
  /** Ratings up to this moment were reset and are dropped when files merge. */
  resetAt?: string;
  entries: Record<string, LearningEntry>;
}

export interface LearningSettings {
  enabled: boolean;
  levels: LevelCount;
  names: Record<LevelCount, string[]>;
  colors: Record<LevelCount, string[]>;
  intervals: Record<LevelCount, number[]>;
  display: LearningDisplay;
  branchProgress: boolean;
  spacedRepetition: boolean;
  /** Factor by which the top interval grows for each further top rating in a row. */
  growth: number;
  order: StudyOrder;
}

/** Colors readable as border, tint and badge on light and dark themes. */
export const DEFAULT_LEARNING_SETTINGS: LearningSettings = {
  enabled: true,
  levels: 3,
  names: { 3: ["New", "Unsure", "Got it"], 5: ["New", "Hard", "Unsure", "Good", "Got it"] },
  colors: { 3: ["#e5484d", "#f5a524", "#30a46c"], 5: ["#e5484d", "#f76b15", "#f5a524", "#8db32b", "#30a46c"] },
  intervals: { 3: [0, 1, 4], 5: [0, 1, 2, 3, 4] },
  display: "border",
  branchProgress: false,
  spacedRepetition: true,
  growth: 2.5,
  order: "due",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const NODE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? value as T : fallback;

function list<T>(value: unknown, fallback: T[], valid: (item: unknown) => item is T): T[] {
  const source = Array.isArray(value) ? value : [];
  return fallback.map((item, index) => valid(source[index]) ? source[index] as T : item);
}

/** Fills missing or broken settings (older plugin data, hand edits) with the defaults. */
export function normalizeLearningSettings(raw: unknown): LearningSettings {
  const value = isRecord(raw) ? raw : {};
  const defaults = DEFAULT_LEARNING_SETTINGS;
  const scaled = <T>(key: "names" | "colors" | "intervals", valid: (item: unknown) => item is T) => {
    const source = isRecord(value[key]) ? value[key] as Record<string, unknown> : {};
    return {
      3: list(source[3], defaults[key][3] as T[], valid),
      5: list(source[5], defaults[key][5] as T[], valid),
    } as Record<LevelCount, T[]>;
  };
  const growth = typeof value.growth === "number" && value.growth >= 1 && value.growth <= 10 ? value.growth : defaults.growth;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : defaults.enabled,
    levels: pick(value.levels, [3, 5] as const, defaults.levels),
    names: scaled("names", (item): item is string => typeof item === "string" && item.trim().length > 0),
    colors: scaled("colors", (item): item is string => typeof item === "string" && COLOR.test(item)),
    intervals: scaled("intervals", (item): item is number => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= MAX_INTERVAL_DAYS),
    display: pick(value.display, ["border", "fill", "badge", "off"] as const, defaults.display),
    branchProgress: typeof value.branchProgress === "boolean" ? value.branchProgress : defaults.branchProgress,
    spacedRepetition: typeof value.spacedRepetition === "boolean" ? value.spacedRepetition : defaults.spacedRepetition,
    growth,
    order: pick(value.order, ["map", "due", "onlyDue", "onlyUnsure"] as const, defaults.order),
  };
}

// ── Days ────────────────────────────────────────────────────────────────────

/** The local calendar day of a moment: due dates follow the learner's day, not UTC. */
export function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000;

export function addDays(day: string, days: number): string {
  return new Date((dayNumber(day) + days) * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(dayNumber(to) - dayNumber(from));
}

// ── Scheduling ──────────────────────────────────────────────────────────────

/** A rating on another scale (the learner switched between 3 and 5 levels) mapped onto `levels`. */
export function levelOn(entry: Pick<LearningEntry, "level" | "of">, levels: LevelCount): number {
  if (entry.of === levels) return entry.level;
  return Math.round((entry.level * (levels - 1)) / (entry.of - 1));
}

export function isMastered(entry: LearningEntry | undefined, levels: LevelCount): boolean {
  return Boolean(entry) && levelOn(entry!, levels) === levels - 1;
}

export function isDue(entry: LearningEntry | undefined, today: string): boolean {
  return Boolean(entry) && entry!.due <= today;
}

/** The next state of a node rated `level` (0-based) at `now`. */
export function rateEntry(previous: LearningEntry | undefined, level: number, settings: LearningSettings, now: Date): LearningEntry {
  const levels = settings.levels;
  const top = levels - 1;
  const clamped = Math.max(0, Math.min(top, Math.round(level)));
  const streak = clamped === top ? (previous && isMastered(previous, levels) ? previous.streak + 1 : 1) : 0;
  const intervals = settings.intervals[levels];
  const base = intervals[clamped] ?? 0;
  const interval = !settings.spacedRepetition
    ? 0
    : clamped === top
      ? Math.min(MAX_INTERVAL_DAYS, Math.round(base * settings.growth ** (streak - 1)))
      : base;
  return { level: clamped, of: levels, lastReviewed: now.toISOString(), due: addDays(dayKey(now), interval), streak };
}

export interface LearningSummary {
  total: number;
  rated: number;
  mastered: number;
  due: number;
  /** Rated, but below the top level. */
  unsure: number;
}

export function summarize(ids: string[], entries: Record<string, LearningEntry>, levels: LevelCount, today: string, spaced = true): LearningSummary {
  const summary: LearningSummary = { total: ids.length, rated: 0, mastered: 0, due: 0, unsure: 0 };
  for (const id of ids) {
    const entry = entries[id];
    if (!entry) continue;
    summary.rated += 1;
    if (isMastered(entry, levels)) summary.mastered += 1;
    else summary.unsure += 1;
    if (spaced && isDue(entry, today)) summary.due += 1;
  }
  return summary;
}

/**
 * The cards of a study session in the chosen order. "Due first" puts due nodes (longest overdue
 * first) before new ones and leaves nodes that are not due at the end; the filters drop the rest.
 */
export function studyOrder(ids: string[], entries: Record<string, LearningEntry>, levels: LevelCount, today: string, order: StudyOrder): string[] {
  if (order === "map") return ids;
  if (order === "onlyUnsure") return ids.filter((id) => entries[id] && !isMastered(entries[id], levels));
  const due = ids.filter((id) => isDue(entries[id], today)).sort((a, b) => entries[a]!.due.localeCompare(entries[b]!.due));
  if (order === "onlyDue") return due;
  return [...due, ...ids.filter((id) => !entries[id]), ...ids.filter((id) => entries[id] && !isDue(entries[id], today))];
}

/** Days until the exam and how many not-yet-mastered nodes to cover per day (exam day included). */
export function examPlan(examDate: string | undefined, today: string, remaining: number): { daysLeft: number; perDay: number } | null {
  if (!examDate || !DAY.test(examDate)) return null;
  const daysLeft = daysBetween(today, examDate);
  return { daysLeft, perDay: daysLeft < 0 ? 0 : Math.ceil(remaining / (daysLeft + 1)) };
}

// ── Storage ─────────────────────────────────────────────────────────────────

/** 53-bit string hash (cyrb53); stable across platforms and plugin versions. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * File key of a map: its BloomMD frontmatter `id` when it has one (survives renames and moves),
 * otherwise a hash of its vault path (re-keyed by the plugin when the note is renamed). Paths are
 * NFC-normalized because macOS and iOS may report the same name in different Unicode forms.
 */
export function learningKey(map: { id?: unknown; path: string }): string {
  if (typeof map.id === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(map.id)) return `id-${map.id}`;
  return `path-${hash(map.path.normalize("NFC"))}`;
}

export function learningFilePath(key: string): string {
  return `${LEARNING_FOLDER}/${key}.json`;
}

export function emptyLearningFile(): LearningFile {
  return { format: LEARNING_FORMAT, entries: {} };
}

function parseEntry(value: unknown): LearningEntry | null {
  if (!isRecord(value)) return null;
  const of = value.of === 5 ? 5 : value.of === 3 ? 3 : null;
  const { level, lastReviewed, due, streak } = value;
  if (!of || typeof level !== "number" || !Number.isInteger(level) || level < 0 || level >= of) return null;
  if (typeof lastReviewed !== "string" || Number.isNaN(Date.parse(lastReviewed)) || typeof due !== "string" || !DAY.test(due)) return null;
  return { level, of, lastReviewed, due, streak: typeof streak === "number" && streak >= 0 ? Math.floor(streak) : 0 };
}

/** Reads a progress file leniently: broken entries are skipped, never the whole file. */
export function parseLearningFile(text: string | null | undefined): LearningFile {
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const file = emptyLearningFile();
  if (!isRecord(raw)) return file;
  if (typeof raw.path === "string") file.path = raw.path;
  if (typeof raw.examDate === "string" && DAY.test(raw.examDate)) file.examDate = raw.examDate;
  if (typeof raw.examUpdated === "string") file.examUpdated = raw.examUpdated;
  if (typeof raw.resetAt === "string") file.resetAt = raw.resetAt;
  if (isRecord(raw.entries)) {
    for (const [id, value] of Object.entries(raw.entries)) {
      const entry = NODE_ID.test(id) ? parseEntry(value) : null;
      if (entry) file.entries[id] = entry;
    }
  }
  return file;
}

export function serializeLearningFile(file: LearningFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

const later = (left: string | undefined, right: string | undefined) => ((left ?? "") >= (right ?? "") ? left : right);

/**
 * Combines two versions of a progress file (this device and another one, or memory and disk) node
 * by node: the newer rating of each node wins, so concurrent sessions on Mac and iPad both count.
 * A reset drops every rating made before it; the newer exam date choice wins.
 */
export function mergeLearningFiles(base: LearningFile, incoming: LearningFile): LearningFile {
  const resetAt = later(base.resetAt, incoming.resetAt);
  const entries: Record<string, LearningEntry> = {};
  for (const source of [base.entries, incoming.entries]) {
    for (const [id, entry] of Object.entries(source)) {
      if (resetAt && entry.lastReviewed <= resetAt) continue;
      const current = entries[id];
      if (!current || entry.lastReviewed > current.lastReviewed) entries[id] = entry;
    }
  }
  const exam = (incoming.examUpdated ?? "") >= (base.examUpdated ?? "") ? incoming : base;
  const merged: LearningFile = { format: LEARNING_FORMAT, entries };
  const path = incoming.path ?? base.path;
  if (path) merged.path = path;
  if (exam.examDate) merged.examDate = exam.examDate;
  if (exam.examUpdated) merged.examUpdated = exam.examUpdated;
  if (resetAt) merged.resetAt = resetAt;
  return merged;
}
