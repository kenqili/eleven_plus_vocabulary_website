export const DAILY_QUESTION_TARGET = 20;
export type Mission = { day: string; questions: number; stories: number };
export function missionProgress(mission: Mission) {
  const questions = Math.max(
    0,
    Math.min(DAILY_QUESTION_TARGET, mission.questions),
  );
  const stories = Math.max(0, Math.min(1, mission.stories));
  return {
    questions,
    stories,
    complete: questions === DAILY_QUESTION_TARGET && stories === 1,
  };
}
export function missionMessage(mission: Mission) {
  const { questions, complete } = missionProgress(mission);
  if (complete)
    return `You’ve tried ${DAILY_QUESTION_TARGET} questions and finished a story. A lovely place to stop—or keep exploring!`;
  if (questions === DAILY_QUESTION_TARGET)
    return `${DAILY_QUESTION_TARGET} questions tried! Time for a story.`;
  if (questions >= 15)
    return "Fifteen questions tried. You’re on the last stretch!";
  if (questions >= 10)
    return "Halfway through your questions. Keep taking them one at a time.";
  if (questions >= 5) return "Five questions tried. A good start!";
  return `Try ${DAILY_QUESTION_TARGET} questions and finish 1 story. Mistakes are part of learning.`;
}
