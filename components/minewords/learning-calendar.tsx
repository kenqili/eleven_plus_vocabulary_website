"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Header from "./header";
import { api } from "@/lib/client/api";
import {
  calendarCells,
  calendarTime,
  shiftMonth,
  validMonth,
  type CalendarData,
} from "@/lib/challenge/calendar";
import { studyDuration } from "@/lib/challenge/rewards";
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
type Loaded = { requested: string; data?: CalendarData; error?: string };
export default function LearningCalendar() {
  const [month, setMonth] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true,
      sequence = 0;
    const refresh = () => {
      const request = ++sequence;
      void api<CalendarData>(
        `/api/calendar${month ? `?month=${encodeURIComponent(month)}` : ""}`,
      )
        .then((data) => {
          if (active && sequence === request)
            setLoaded({ requested: month, data });
        })
        .catch((error: Error) => {
          if (active && sequence === request)
            setLoaded({ requested: month, error: error.message });
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    const interval = setInterval(() => {
      if (!document.hidden) refresh();
    }, 60000);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [month, retry]);
  const current = loaded?.requested === month ? loaded : null;
  const data = current?.data;
  const selectedDay =
    data?.days.find((day) => day.day === selected) ||
    data?.days.find((day) => day.day === data.today) ||
    data?.days.findLast((day) => day.questions > 0 || day.seconds > 0) ||
    data?.days[0];
  function navigate(value: string) {
    setSelected("");
    setMonth(value);
  }
  return (
    <>
      <Header />
      <main className="workspace calendar-workspace">
        <Link className="text-button" href="/">
          ← Back to practice
        </Link>
        <div className="page-heading">
          <div>
            <div className="eyebrow">YOUR LEARNING JOURNEY</div>
            <h1>Every day adds up.</h1>
            <p className="muted">
              Your words, your time, and the small steps that build lasting
              knowledge.
            </p>
          </div>
        </div>
        {!current && <p role="status">Loading your learning calendar…</p>}
        {current?.error && (
          <div className="error" role="alert">
            <p>{current.error}</p>
            <div className="control-row">
              <Link className="text-button" href="/account">
                Go to your account →
              </Link>
              <button
                className="text-button"
                onClick={() => setRetry((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          </div>
        )}
        {data && (
          <>
            <div className="calendar-month-controls">
              <div className="calendar-month-nav">
                <button
                  aria-label="Previous month"
                  disabled={data.month === "2000-01"}
                  onClick={() => navigate(shiftMonth(data.month, -1))}
                >
                  <ChevronLeft size={22} />
                </button>
                <h2 id="calendar-month-title">{monthLabel(data.month)}</h2>
                <button
                  aria-label="Next month"
                  disabled={data.month >= data.today.slice(0, 7)}
                  onClick={() => navigate(shiftMonth(data.month, 1))}
                >
                  <ChevronRight size={22} />
                </button>
              </div>
              <div className="calendar-jump">
                <label htmlFor="calendar-month">Jump to month</label>
                <input
                  id="calendar-month"
                  type="month"
                  min="2000-01"
                  max={data.today.slice(0, 7)}
                  value={data.month}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (validMonth(value) && value <= data.today.slice(0, 7))
                      navigate(value);
                  }}
                />
                <button className="text-button" onClick={() => navigate("")}>
                  This month
                </button>
              </div>
            </div>
            <div className="calendar-month-summary" aria-label="Month summary">
              <div>
                <strong>{data.totals.words}</strong>
                <span>Different words studied</span>
              </div>
              <div>
                <strong>{calendarTime(data.totals.seconds)}</strong>
                <span>Active study time</span>
              </div>
              <div>
                <strong>{data.totals.studyDays}</strong>
                <span>Days with activity</span>
              </div>
              <div>
                <strong>{data.totals.mastered}</strong>
                <span>Words mastered</span>
              </div>
            </div>
            <p className="muted calendar-explanation">
              Each day shows different words answered or revealed and saved
              active study time. Repeated answers to the same word count once
              per day. All dates use London time.
            </p>
            <div className="learning-calendar">
              <table aria-labelledby="calendar-month-title">
                <thead>
                  <tr>
                    {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                      (label) => (
                        <th scope="col" key={label}>
                          {label}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {Array.from(
                    { length: calendarCells(data.month).length / 7 },
                    (_, week) => (
                      <tr key={week}>
                        {calendarCells(data.month)
                          .slice(week * 7, week * 7 + 7)
                          .map((date, index) => {
                            if (!date)
                              return (
                                <td key={`empty-${index}`} aria-hidden="true" />
                              );
                            const day = data.days[Number(date.slice(-2)) - 1];
                            const future = date > data.today;
                            const activity =
                              day.seconds >= 1200
                                ? 3
                                : day.seconds >= 300
                                  ? 2
                                  : day.questions > 0 || day.seconds > 0
                                    ? 1
                                    : 0;
                            return (
                              <td key={date}>
                                <button
                                  className={`calendar-day activity-${activity}`}
                                  disabled={future}
                                  aria-current={
                                    date === data.today ? "date" : undefined
                                  }
                                  aria-pressed={date === selectedDay?.day}
                                  aria-label={`${dayLabel(date)}: ${future ? "Future date" : `${day.words} ${day.words === 1 ? "word" : "words"}, ${studyDuration(day.seconds)}`}`}
                                  onClick={() => setSelected(date)}
                                >
                                  <span className="calendar-day-number">
                                    {Number(date.slice(-2))}
                                    {date === data.today && (
                                      <span className="calendar-today-dot" />
                                    )}
                                  </span>
                                  {!future && (
                                    <>
                                      <span className="calendar-day-words">
                                        {day.words}{" "}
                                        {day.words === 1 ? "word" : "words"}
                                      </span>
                                      <span className="calendar-day-time">
                                        {calendarTime(day.seconds)}
                                      </span>
                                    </>
                                  )}
                                </button>
                              </td>
                            );
                          })}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            <div className="calendar-legend" aria-label="Study time colour key">
              <span>
                <i className="activity-0" />
                No activity
              </span>
              <span>
                <i className="activity-1" />
                Under 5 min
              </span>
              <span>
                <i className="activity-2" />
                5–19 min
              </span>
              <span>
                <i className="activity-3" />
                20+ min
              </span>
            </div>
            {selectedDay && (
              <section
                className="calendar-day-detail"
                aria-live="polite"
                aria-label="Selected day details"
              >
                <div className="eyebrow">DAILY SUMMARY</div>
                <h2>{dayLabel(selectedDay.day)}</h2>
                {selectedDay.questions === 0 && selectedDay.seconds === 0 ? (
                  <p className="muted">
                    No learning recorded on this day.{" "}
                    <Link className="text-button" href="/">
                      Start practising →
                    </Link>
                  </p>
                ) : (
                  <>
                    <dl className="calendar-day-stats">
                      <div>
                        <dt>Different words studied</dt>
                        <dd>{selectedDay.words}</dd>
                      </div>
                      <div>
                        <dt>Active study time</dt>
                        <dd>{studyDuration(selectedDay.seconds)}</dd>
                      </div>
                      <div>
                        <dt>New words explored</dt>
                        <dd>{selectedDay.newWords}</dd>
                      </div>
                      <div>
                        <dt>Words mastered</dt>
                        <dd>{selectedDay.mastered}</dd>
                      </div>
                      <div>
                        <dt>Questions answered / revealed</dt>
                        <dd>{selectedDay.questions}</dd>
                      </div>
                      <div>
                        <dt>Correct answers</dt>
                        <dd>{selectedDay.correct}</dd>
                      </div>
                    </dl>
                    <p className="muted">
                      {selectedDay.reveals}{" "}
                      {selectedDay.reveals === 1 ? "answer" : "answers"}{" "}
                      revealed. Study time includes reading questions and
                      explanations; it pauses while you’re away.
                    </p>
                  </>
                )}
              </section>
            )}
            {data.totals.studyDays === 0 && (
              <p className="muted" role="status">
                No activity recorded for {monthLabel(data.month)}. Choose
                another month to look back at your learning.
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
