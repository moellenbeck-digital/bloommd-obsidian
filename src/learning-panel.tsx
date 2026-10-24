import { useState, type CSSProperties } from "react";
import { CalendarDays, SkipForward } from "lucide-react";
import { examPlan, isMastered, type LearningEntry, type LearningSettings, type LearningSummary, type LevelCount, type StudyOrder } from "./learning";

/** What the map needs to show and record learning progress; absent when progress is off. */
export interface CanvasLearning {
  settings: LearningSettings;
  entries: Record<string, LearningEntry>;
  examDate: string | null;
  rate: (id: string, level: number) => void;
  setExamDate: (date: string | null) => void;
}

export const STUDY_ORDERS: Record<StudyOrder, string> = {
  due: "Due first",
  map: "Map order",
  onlyDue: "Only due",
  onlyUnsure: "Only unsure",
};

/** Mastered and total study cards in each branch (the node and everything below it). */
export function branchProgress(
  headings: Array<{ id: string; parentId: string | null }>,
  cards: string[],
  entries: Record<string, LearningEntry>,
  levels: LevelCount,
): Map<string, { mastered: number; total: number }> {
  const parentOf = new Map(headings.map((heading) => [heading.id, heading.parentId]));
  const result = new Map<string, { mastered: number; total: number }>();
  for (const id of cards) {
    const mastered = isMastered(entries[id], levels) ? 1 : 0;
    for (let current: string | null | undefined = id; current; current = parentOf.get(current)) {
      const counts = result.get(current) ?? { mastered: 0, total: 0 };
      counts.mastered += mastered;
      counts.total += 1;
      result.set(current, counts);
    }
  }
  return result;
}

export const learnColor = (color: string | undefined): CSSProperties | undefined =>
  color ? ({ "--bloommd-learn": color } as CSSProperties) : undefined;

/** Self-rating after revealing a node: tap, pen, click or keys 1–5. */
export function RatingButtons(props: { title: string; names: string[]; colors: string[]; level: number | null; onRate: (level: number) => void }) {
  return (
    <div className="bloommd-rate nodrag" role="group" aria-label={`How well did you know ${props.title}?`}>
      {props.names.map((name, index) => (
        <button
          key={index}
          type="button"
          className="nodrag"
          style={learnColor(props.colors[index])}
          aria-pressed={props.level === index}
          title={`${name} (key ${index + 1})`}
          onClick={(event) => {
            event.stopPropagation();
            props.onRate(index);
          }}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

/** Progress, session order and exam plan in the study bar. */
export function LearningStatus(props: {
  summary: LearningSummary;
  spaced: boolean;
  order: StudyOrder;
  onOrder: (order: StudyOrder) => void;
  onNext: (() => void) | null;
  examDate: string | null;
  today: string;
  onExamDate: (date: string | null) => void;
}) {
  const { summary } = props;
  const plan = examPlan(props.examDate ?? undefined, props.today, summary.total - summary.mastered);
  // The date field only takes room once an exam date is being set.
  const [pickExam, setPickExam] = useState(false);
  return (
    <div className="bloommd-learn-status">
      <span className="bloommd-learn-progress" title={`${summary.rated} of ${summary.total} rated`}>
        <span className="bloommd-learn-meter" aria-hidden="true"><span style={{ width: `${summary.total ? (summary.mastered / summary.total) * 100 : 0}%` }} /></span>
        <span>{summary.mastered}/{summary.total} mastered{props.spaced ? ` · ${summary.due} due` : ""}</span>
      </span>
      <select aria-label="Study order" value={props.order} onChange={(event) => props.onOrder(event.target.value as StudyOrder)}>
        {Object.entries(STUDY_ORDERS).filter(([order]) => props.spaced || (order !== "due" && order !== "onlyDue")).map(([order, label]) => (
          <option key={order} value={order}>{label}</option>
        ))}
      </select>
      <button type="button" aria-label="Next card" title="Next card" onClick={props.onNext ?? undefined} disabled={!props.onNext}><SkipForward size={14} /></button>
      {props.examDate || pickExam ? (
        <label className="bloommd-learn-exam" title="Exam date for this map">
          <input
            type="date"
            aria-label="Exam date"
            autoFocus={!props.examDate}
            value={props.examDate ?? ""}
            onChange={(event) => props.onExamDate(event.target.value || null)}
            onBlur={(event) => { if (!event.target.value) setPickExam(false); }}
          />
          {plan && (
            <span>{plan.daysLeft < 0 ? "Exam passed" : plan.daysLeft === 0 ? `Exam today · ${plan.perDay} left` : `${plan.daysLeft} d left · ${plan.perDay}/day`}</span>
          )}
        </label>
      ) : (
        <button type="button" aria-label="Set exam date" title="Exam date for this map" onClick={() => setPickExam(true)}><CalendarDays size={14} /></button>
      )}
    </div>
  );
}
