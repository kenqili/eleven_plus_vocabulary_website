"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/client/api";
import {
  availableHintKinds,
  gradeGuess,
  HINT_SCORE_PENALTY,
  hintFor,
  isAcceptedGuess,
  keyboardMarks,
  MAX_GUESSES,
  normalizeGuess,
  type FiveLettersAnswer,
  type FiveLettersCard,
  type FiveLettersGame,
  type FiveLettersGuess,
  type FiveLettersHintKind,
  type FiveLettersMark,
  type FiveLettersState,
  type FiveLettersStatus,
} from "@/lib/challenge/five-letters";

type DemoWord = { word: string; card: FiveLettersCard };

const FALLBACK_CARD: FiveLettersCard = {
  definition:
    "This is a valid five-letter word, but it is not one of the vocabulary words.",
  example: "",
  synonyms: [],
  antonyms: [],
  source: "Game list",
};

/**
 * The card shown while the dictionary is still on its way.
 *
 * A guest's guess is put on the board the moment it is made, because the
 * marks are worked out in the browser and the card is only a gloss on top of
 * them. The dictionary is a 400 KB file, so waiting for it would mean the
 * child watches nothing happen for as long as it takes to download.
 */
const PENDING_CARD: FiveLettersCard = {
  definition: "Looking up this word...",
  example: "",
  synonyms: [],
  antonyms: [],
  source: "Game list",
};

const KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"] as const;

const markLabel = (mark: FiveLettersMark) =>
  mark === "green"
    ? "right letter, right place"
    : mark === "yellow"
      ? "right letter, wrong place"
      : "letter not in the word";

const displayWord = (word: string) => word.toUpperCase();

function CardDetails({
  card,
  compact = false,
}: {
  card: FiveLettersCard;
  compact?: boolean;
}) {
  const definition = card.definition
    ? card.definition[0].toUpperCase() + card.definition.slice(1)
    : "No definition is available.";
  return (
    <div className={`five-card-details${compact ? " is-compact" : ""}`}>
      <p className="five-card-definition">{definition}</p>
      {card.example ? (
        <p className="five-card-example">“{card.example}”</p>
      ) : (
        <p className="five-card-empty">No example in this dictionary.</p>
      )}
      <div className="five-relations">
        <div>
          <span className="five-relation-label">Synonyms</span>
          {card.synonyms.length ? (
            <ul>
              {card.synonyms.map((synonym) => (
                <li key={synonym}>{synonym}</li>
              ))}
            </ul>
          ) : (
            <p className="five-card-empty">None recorded.</p>
          )}
        </div>
        <div>
          <span className="five-relation-label">Antonyms</span>
          {card.antonyms.length ? (
            <ul>
              {card.antonyms.map((antonym) => (
                <li key={antonym}>{antonym}</li>
              ))}
            </ul>
          ) : (
            <p className="five-card-empty">None recorded.</p>
          )}
        </div>
      </div>
      <div className="five-card-foot">
        <span>
          {card.source === "WordNet 3.0"
            ? "WordNet 3.0"
            : card.source === "Game list"
              ? "Game list"
              : "MineWords"}
        </span>
        {card.base ? <span>Base word: {card.base}</span> : null}
      </div>
    </div>
  );
}

function GuessCard({
  guess,
  guest,
}: {
  guess: FiveLettersGuess;
  guest: boolean;
}) {
  return (
    <article className="five-word-card">
      <div className="five-card-heading">
        <strong>{displayWord(guess.word)}</strong>
        <span className="five-card-marks" aria-label="Letter result">
          {guess.marks.map((mark, index) => (
            <span
              key={`${guess.word}-${index}`}
              className={`five-mini-mark is-${mark}`}
              aria-label={`${guess.word[index]}: ${markLabel(mark)}`}
            >
              {guess.word[index].toUpperCase()}
            </span>
          ))}
        </span>
      </div>
      <p className={`five-count-note${guess.mastered ? " is-mastered" : ""}`}>
        {guest
          ? "Demo guess — no progress is saved."
          : guess.counted
            ? `${guess.correct} of 5 correctness${guess.mastered ? " — mastered!" : ""}`
            : "Not in your collection for this game — no count."}
      </p>
      <CardDetails card={guess.card} compact />
    </article>
  );
}

function AnswerCard({
  answer,
  revealed,
  guest,
}: {
  answer: FiveLettersAnswer;
  revealed: boolean;
  guest: boolean;
}) {
  return (
    <div className="five-answer">
      <div className="five-answer-heading">
        <div>
          <div className="eyebrow">{revealed ? "THE WORD WAS" : "SOLVED"}</div>
          <h3>{displayWord(answer.word)}</h3>
        </div>
        {!guest ? (
          answer.newlyMastered ? (
            <span className="five-pill is-mastered">Mastered</span>
          ) : answer.alreadyMastered ? (
            <span className="five-pill">Already known</span>
          ) : null
        ) : (
          <span className="five-pill">Guest demo</span>
        )}
      </div>
      <CardDetails card={answer.card} />
      {guest ? (
        <p className="five-result-note">
          This is a guest round. Sign in to save progress and mastery.
        </p>
      ) : answer.newlyMastered ? (
        <p className="five-result-note">
          This word is now mastered, so it will not appear in practice again.
        </p>
      ) : answer.alreadyMastered ? (
        <p className="five-result-note">
          You already knew this word. Nothing was counted twice.
        </p>
      ) : revealed ? (
        <p className="five-result-note">
          Showing the answer does not master a word or count a correctness.
        </p>
      ) : (
        <p className="five-result-note">
          A solved word is mastered even when it was not in your practice
          collection.
        </p>
      )}
    </div>
  );
}

export default function FiveLetters({ demoWords }: { demoWords: DemoWord[] }) {
  const [game, setGame] = useState<FiveLettersGame | null>(null);
  const [score, setScore] = useState(0);
  const [scorePenalty, setScorePenalty] = useState(0);
  const [freeTier, setFreeTier] = useState(false);
  const [freeWordCount, setFreeWordCount] = useState(0);
  const [guest, setGuest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [dictionaryError, setDictionaryError] = useState("");
  const answerRef = useRef<string | null>(null);
  const dictionary = useRef<Record<string, FiveLettersCard> | null>(null);
  const dictionaryLoading = useRef<Promise<
    Record<string, FiveLettersCard>
  > | null>(null);

  const demoByWord = useMemo(
    () => new Map(demoWords.map((word) => [word.word, word.card])),
    [demoWords],
  );

  const keyMarks = useMemo(
    () => keyboardMarks(game?.guesses ?? []),
    [game?.guesses],
  );

  const applyState = useCallback((next: FiveLettersState) => {
    setGame(next.game);
    setScore(next.score);
    setScorePenalty(next.scorePenalty);
    setFreeTier(next.freeTier);
    setFreeWordCount(next.freeWordCount);
    setGuest(false);
  }, []);

  const guestGame = useCallback(
    (
      answerWord: string,
      guesses: FiveLettersGuess[],
      hints: FiveLettersHintKind[],
      status: FiveLettersStatus,
    ): FiveLettersGame => {
      const card = demoByWord.get(answerWord) ?? FALLBACK_CARD;
      const hintText: Partial<Record<FiveLettersHintKind, string>> = {};
      for (const kind of hints) {
        const relation = hintFor(card, kind, answerWord);
        if (relation) hintText[kind] = relation;
      }
      const answer: FiveLettersAnswer | undefined =
        status === "playing"
          ? undefined
          : {
              word: answerWord,
              card,
              newlyMastered: false,
              alreadyMastered: false,
            };
      return {
        id: "demo",
        guesses,
        hints,
        hintText,
        remainingGuesses: Math.max(0, MAX_GUESSES - guesses.length),
        remainingHints: availableHintKinds(card, answerWord).filter(
          (kind) => !hints.includes(kind),
        ),
        status,
        ...(answer ? { answer } : {}),
      };
    },
    [demoByWord],
  );

  /**
   * Fill in a guess's card once the dictionary arrives.
   *
   * The guess is already on the board; this only replaces the placeholder it
   * was given. A guess whose card is not the placeholder is left alone, so a
   * word that was already known keeps the card it was given.
   */
  const replaceGuestCard = useCallback(
    (word: string, card: FiveLettersCard) => {
      setGame((current) => {
        if (!current) return current;
        const guess = current.guesses.find((entry) => entry.word === word);
        if (!guess || guess.card !== PENDING_CARD) return current;
        return guestGame(
          answerRef.current ?? "",
          current.guesses.map((entry) =>
            entry.word === word ? { ...entry, card } : entry,
          ),
          current.hints,
          current.status,
        );
      });
    },
    [guestGame],
  );

  const startGuest = useCallback(() => {
    if (!demoWords.length) {
      setError(
        "The guest sample is not available. Please sign in to play Five Letters.",
      );
      setLoading(false);
      return;
    }
    const chosen = demoWords[Math.floor(Math.random() * demoWords.length)];
    answerRef.current = chosen.word;
    setGuest(true);
    setScore(0);
    setScorePenalty(0);
    setFreeTier(true);
    setFreeWordCount(demoWords.length);
    setGame(guestGame(chosen.word, [], [], "playing"));
    setDraft("");
    setNotice("");
    setError("");
    setLoading(false);
  }, [demoWords, guestGame]);

  const startSigned = useCallback(
    async (next = false) => {
      setBusy(true);
      setError("");
      try {
        const state = await api<FiveLettersState>("/api/five-letters", {
          action: next ? "next" : "start",
        });
        applyState(state);
      } catch (cause) {
        const status = (cause as { status?: number }).status;
        if (status === 401) {
          startGuest();
        } else {
          setError(
            cause instanceof Error
              ? cause.message
              : "Five Letters could not start. Please try again.",
          );
        }
      } finally {
        setBusy(false);
        setLoading(false);
      }
    },
    [applyState, startGuest],
  );

  useEffect(() => {
    // Deferred a turn so the first render paints the loading state before the
    // request's busy/error updates start. The lint rule is right that setState in
    // an effect body is usually a cascading render; here it is a request kicked
    // off after paint, not derived state.
    const timer = setTimeout(() => void startSigned(), 0);
    return () => clearTimeout(timer);
  }, [startSigned]);

  const loadDictionary = useCallback(async () => {
    if (dictionary.current) return dictionary.current;
    const pending = dictionaryLoading.current;
    if (pending) return pending;
    const created = fetch("/five-letters/dictionary.json", {
      cache: "force-cache",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("The dictionary could not load.");
        const data = (await response.json()) as Record<string, FiveLettersCard>;
        dictionary.current = data;
        setDictionaryError("");
        return data;
      })
      .catch((cause) => {
        setDictionaryError(
          cause instanceof Error
            ? cause.message
            : "The dictionary could not load.",
        );
        throw cause;
      })
      .finally(() => {
        dictionaryLoading.current = null;
      });
    dictionaryLoading.current = created;
    return created;
  }, []);

  useEffect(() => {
    if (!guest) return;
    void loadDictionary().catch(() => {
      // The error is shown once by the state setter; a child can still play the
      // sample answers, but a non-sample guess waits for the asset.
    });
  }, [guest, loadDictionary]);
  const canPlay = Boolean(game && game.status === "playing" && !busy);
  const availableHints = game?.remainingHints ?? [];
  const usedHints = game?.hints ?? [];
  const hintKinds: FiveLettersHintKind[] = ["syn", "ant"];
  const hasHintButtons = hintKinds.some(
    (kind) => availableHints.includes(kind) || usedHints.includes(kind),
  );

  const submitGuess = async (wordOverride?: string) => {
    if (!game || !canPlay) return;
    const word = normalizeGuess(wordOverride ?? draft);
    if (!word) {
      setError("A guess must be exactly five letters.");
      return;
    }
    if (!isAcceptedGuess(word)) {
      setError("That word is not in the Five Letters list.");
      return;
    }
    if (game.guesses.some((guess) => guess.word === word)) {
      setNotice("You already guessed that word.");
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (guest) {
        const answerWord = answerRef.current;
        if (!answerWord) throw new Error("This demo has no answer.");
        // The card for a word outside the sample comes from a dictionary that
        // is a 400 KB download. The guess itself does not need it: the marks
        // are worked out here, and the word is the thing the child is waiting
        // to see. So the guess goes on the board at once, with a placeholder
        // card if the real one is not here yet, and the card is filled in
        // when the dictionary lands.
        const sample = demoByWord.get(word);
        const ready = sample ?? dictionary.current?.[word];
        const card = ready ?? PENDING_CARD;
        const guesses = [
          ...game.guesses,
          {
            word,
            marks: gradeGuess(answerWord, word),
            card,
            counted: false,
            correct: 0,
            mastered: false,
          },
        ];
        const status: FiveLettersStatus =
          word === answerWord
            ? "solved"
            : guesses.length >= MAX_GUESSES
              ? "revealed"
              : "playing";
        setGame(guestGame(answerWord, guesses, game.hints, status));
        setDraft("");
        if (!ready) {
          void loadDictionary()
            .then((full) => replaceGuestCard(word, full[word] ?? FALLBACK_CARD))
            .catch(() => {
              // The dictionary is optional for a word outside the vocabulary;
              // the fallback card keeps the guess playable.
              replaceGuestCard(word, FALLBACK_CARD);
            });
        }
      } else {
        const state = await api<FiveLettersState>("/api/five-letters", {
          action: "guess",
          gameId: game.id,
          guess: word,
        });
        applyState(state);
        setDraft("");
        if (state.duplicate)
          setNotice("That guess was already used. No guess was spent.");
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "That guess could not be sent. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const pressLetter = (letter: string) => {
    if (!canPlay) return;
    setDraft((current) => {
      if (current.length >= 5) return current;
      const next = `${current}${letter}`;
      if (next.length === 5) {
        // A complete guess is submitted as soon as the fifth letter lands, so
        // the child never has to reach for Enter.
        window.setTimeout(() => void submitGuess(next), 0);
      }
      return next;
    });
    setError("");
    setNotice("");
  };

  const eraseLetter = () => {
    if (!canPlay) return;
    setDraft((current) => current.slice(0, -1));
    setError("");
    setNotice("");
  };

  const pressEnter = () => {
    if (!canPlay) return;
    void submitGuess();
  };

  const actionsRef = useRef({ pressLetter, eraseLetter, submitGuess });
  useEffect(() => {
    actionsRef.current = { pressLetter, eraseLetter, submitGuess };
  });

  useEffect(() => {
    if (!canPlay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Backspace") {
        event.preventDefault();
        actionsRef.current.eraseLetter();
      } else if (event.key === "Enter") {
        event.preventDefault();
        void actionsRef.current.submitGuess();
      } else if (/^[a-z]$/i.test(event.key)) {
        event.preventDefault();
        actionsRef.current.pressLetter(event.key.toUpperCase());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canPlay]);

  const addHint = async (kind: FiveLettersHintKind) => {
    if (!game || !canPlay || game.hints.includes(kind)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (guest) {
        const answerWord = answerRef.current;
        if (!answerWord) throw new Error("This demo has no answer.");
        const card = demoByWord.get(answerWord);
        if (!card || !hintFor(card, kind, answerWord))
          throw new Error("That hint is not available for this word.");
        setGame(
          guestGame(
            answerWord,
            game.guesses,
            [...game.hints, kind],
            game.status,
          ),
        );
        setNotice("Demo hint — no points are deducted.");
      } else {
        const state = await api<FiveLettersState>("/api/five-letters", {
          action: "hint",
          gameId: game.id,
          kind,
        });
        applyState(state);
        setNotice(
          state.duplicate
            ? "That hint was already used."
            : `A ${kind === "syn" ? "synonym" : "antonym"} hint was added. ${HINT_SCORE_PENALTY} points deducted.`,
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "That hint could not be added. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const reveal = async () => {
    if (!game || !canPlay) return;
    if (
      !window.confirm(
        "Show the answer? This round will not master the word or count a correctness.",
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (guest) {
        const answerWord = answerRef.current;
        if (!answerWord) throw new Error("This demo has no answer.");
        setGame(guestGame(answerWord, game.guesses, game.hints, "revealed"));
      } else {
        const state = await api<FiveLettersState>("/api/five-letters", {
          action: "reveal",
          gameId: game.id,
        });
        applyState(state);
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "That answer could not be shown. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    if (guest) {
      startGuest();
      return;
    }
    await startSigned(true);
  };

  if (loading)
    return (
      <div className="five-loading" role="status">
        Loading Five Letters…
      </div>
    );

  if (!game)
    return (
      <div className="five-empty">
        <div className="eyebrow">FIVE LETTERS</div>
        <h1>Five Letters</h1>
        <p>{error || "This game is not available right now."}</p>
        <button className="primary-button" onClick={() => void startSigned()}>
          Try again
        </button>
      </div>
    );

  const rowCount = Math.max(MAX_GUESSES, game.guesses.length);
  const rows = Array.from({ length: rowCount }, (_, index) => index);
  const currentRow = game.guesses.length;
  const playing = game.status === "playing";
  const answer = game.answer;

  return (
    <div className="five-page">
      <section className="five-hero">
        <div>
          <div className="eyebrow">A FIVE-LETTER WORD GAME</div>
          <h1>Five Letters</h1>
          <p>
            Guess the five-letter word in six tries. Every vocabulary guess
            teaches you a word — read the card, use a synonym or antonym hint if
            you are stuck, and take your time.
          </p>
        </div>
        <div className="five-hero-badges">
          {guest ? (
            <span className="five-pill is-demo">Guest demo · not saved</span>
          ) : freeTier ? (
            <span className="five-pill">
              Free collection · {freeWordCount} words
            </span>
          ) : (
            <span className="five-pill">Full collection</span>
          )}
          <span className="five-pill">
            {playing
              ? `${game.remainingGuesses} ${game.remainingGuesses === 1 ? "guess" : "guesses"} left`
              : game.status === "solved"
                ? "Solved"
                : "Answer shown"}
          </span>
        </div>
      </section>

      <div className="five-layout">
        <section className="five-board-card" aria-labelledby="five-board-title">
          <h2 id="five-board-title" className="five-sr-only">
            Guess board
          </h2>
          <div className="five-scorebar">
            {guest ? (
              <div>
                <span className="five-score-label">GUEST DEMO</span>
                <strong>No score</strong>
                <small>Sign in to keep progress.</small>
              </div>
            ) : (
              <div>
                <span className="five-score-label">SCORE</span>
                <strong>{score.toLocaleString("en-GB")}</strong>
                <small>
                  {scorePenalty
                    ? `${scorePenalty} point${scorePenalty === 1 ? "" : "s"} deducted by hints`
                    : "Hints deduct 5 points each."}
                </small>
              </div>
            )}
            <div className="five-board-legend" aria-label="How marks work">
              <span>
                <i className="five-legend-dot is-green" /> Right place
              </span>
              <span>
                <i className="five-legend-dot is-yellow" /> In the word
              </span>
              <span>
                <i className="five-legend-dot is-grey" /> Not in it
              </span>
            </div>
          </div>

          <div
            className="five-board"
            role="grid"
            aria-label="Six rows of five letter tiles"
          >
            {rows.map((row) => {
              const guess = game.guesses[row];
              const isCurrent = row === currentRow && playing;
              const letters = guess
                ? guess.word.split("")
                : isCurrent
                  ? draft.padEnd(5, " ").slice(0, 5).split("")
                  : ["", "", "", "", ""];
              return (
                <div className="five-row" role="row" key={row}>
                  {letters.map((letter, column) => {
                    const mark = guess?.marks[column];
                    return (
                      <div
                        key={column}
                        role="gridcell"
                        className={`five-tile${mark ? ` is-${mark}` : ""}${
                          letter.trim() ? "" : " is-empty"
                        }${isCurrent ? " is-current" : ""}`}
                        aria-label={
                          letter.trim()
                            ? `${letter.toUpperCase()}${
                                mark ? `, ${markLabel(mark)}` : ""
                              }`
                            : "empty"
                        }
                      >
                        {letter.trim().toUpperCase()}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div
            className="five-keyboard"
            role="group"
            aria-label="Letter keyboard"
          >
            {KEY_ROWS.map((row, rowIndex) => (
              <div className="five-keyboard-row" key={row}>
                {rowIndex === 1 ? (
                  <span className="five-key-spacer" aria-hidden="true" />
                ) : null}
                {rowIndex === 2 ? (
                  <button
                    type="button"
                    className="five-key is-action"
                    onClick={pressEnter}
                    onMouseDown={(event) => event.preventDefault()}
                    disabled={!canPlay}
                    aria-label="Enter guess"
                  >
                    Enter
                  </button>
                ) : null}
                {row.split("").map((letter) => {
                  const mark = keyMarks[letter];
                  return (
                    <button
                      key={letter}
                      type="button"
                      className={`five-key${mark ? ` is-${mark}` : ""}`}
                      onClick={() => pressLetter(letter)}
                      onMouseDown={(event) => event.preventDefault()}
                      disabled={!canPlay || draft.length >= 5}
                      aria-label={`${letter}${mark ? `, ${markLabel(mark)}` : ""}`}
                    >
                      {letter}
                    </button>
                  );
                })}
                {rowIndex === 1 ? (
                  <span className="five-key-spacer" aria-hidden="true" />
                ) : null}
                {rowIndex === 2 ? (
                  <button
                    type="button"
                    className="five-key is-action"
                    onClick={eraseLetter}
                    onMouseDown={(event) => event.preventDefault()}
                    disabled={!canPlay || draft.length === 0}
                    aria-label="Delete last letter"
                  >
                    ⌫
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          {error ? (
            <p className="error five-message" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="five-notice five-message" role="status">
              {notice}
            </p>
          ) : null}

          {playing ? (
            <p id="five-entry-help" className="five-entry-help">
              Tap letters; the fifth letter submits. Backspace edits the current
              guess.
            </p>
          ) : null}

          {playing && hasHintButtons ? (
            <div className="five-hint-buttons">
              {hintKinds.map((kind) => {
                const used = usedHints.includes(kind);
                const available = availableHints.includes(kind);
                if (!used && !available) return null;
                return (
                  <button
                    key={kind}
                    type="button"
                    className="five-hint-button"
                    onClick={() => void addHint(kind)}
                    disabled={busy || used}
                  >
                    <span>
                      {kind === "syn" ? "Synonym hint" : "Antonym hint"}
                    </span>
                    <small>
                      {guest
                        ? "Demo"
                        : used
                          ? "Used"
                          : `−${HINT_SCORE_PENALTY} points`}
                    </small>
                  </button>
                );
              })}
            </div>
          ) : null}

          {game.hints.length ? (
            <div className="five-hint-results" aria-live="polite">
              {game.hints.map((kind) => {
                const relation = game.hintText[kind];
                return relation ? (
                  <p key={kind}>
                    <strong>{kind === "syn" ? "Synonym:" : "Antonym:"}</strong>{" "}
                    {relation}
                  </p>
                ) : null;
              })}
            </div>
          ) : null}

          {dictionaryError && guest ? (
            <p className="five-notice five-message" role="status">
              {dictionaryError} Sample words still work; other guesses use a
              short note.
            </p>
          ) : null}

          {!playing && answer ? (
            <>
              <AnswerCard
                answer={answer}
                revealed={game.status === "revealed"}
                guest={guest}
              />
              <div className="five-finish-actions">
                <button
                  className="primary-button"
                  onClick={() => void next()}
                  disabled={busy}
                >
                  Next word
                </button>
              </div>
            </>
          ) : null}

          {playing ? (
            <button
              type="button"
              className="five-reveal-button"
              onClick={() => void reveal()}
              disabled={busy}
            >
              Show the word
            </button>
          ) : null}
        </section>

        <aside className="five-words-panel" aria-labelledby="five-words-title">
          <h2 id="five-words-title">Your words</h2>
          <p className="five-panel-intro">
            Vocabulary guesses appear here with their definition, example,
            synonyms and antonyms. Other valid five-letter words are accepted as
            guesses but have no card. A guess that is one of your vocabulary
            words also counts one correctness.
          </p>
          {game.guesses.length ? (
            <div className="five-word-list">
              {[...game.guesses].reverse().map((guess) => (
                <GuessCard key={guess.word} guess={guess} guest={guest} />
              ))}
            </div>
          ) : (
            <div className="five-words-empty">
              Your guessed words will appear here.
            </div>
          )}
          <p className="five-attribution">
            Definitions come from the MineWords word bank and WordNet 3.0.
            WordNet is © Princeton University.
          </p>
        </aside>
      </div>
    </div>
  );
}
