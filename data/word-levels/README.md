# Five vocabulary difficulty levels

`levels.json` supplies every merged vocabulary word with a letter count, English
Zipf frequency, difficulty score and level from 1 (easier) to 5 (harder).
The source word CSVs and personal mastery records remain unchanged.

Frequency comes from **wordfreq 3.1.1 by Robyn Speer**, English large wordlist:
https://github.com/rspeer/wordfreq. Its frequencies reflect a general-language
snapshot through approximately 2021, not a child-specific or 11+ exam corpus.
Higher Zipf values mean more frequent words. Phrase values are estimates from
component words, not measured idiom frequencies. Missing values are explicitly
flagged, treated as maximum rarity, and do not invent an observed frequency.

The heuristic combines **70% rarity and 30% letter count**:

- Rarity: `1 - clamp((Zipf - 1) / 5, 0, 1)`.
- Length: `clamp((letters - 3) / 12, 0, 1)`; letters only, excluding spaces and punctuation.
- Score: `100 × (0.7 × rarity + 0.3 × length)`, rounded to four decimals.
- Sort by score, then normalized word ID to break ties; divide into five equal
  bands (146 words each in the current 730-word collection).

These are estimated, relative difficulty levels for this collection. They do not
measure meaning complexity, exam grades, or the learner's personal progress.
Regenerating after adding words can change band boundaries. Learning status
(New, Learning, Needs practice, Mastered) is calculated separately from saved answers.

## Regeneration

With Node 24 on PATH, create a Python environment and install `wordfreq==3.1.1`.
Run `python scripts/generate-word-levels.py`, then `npm test`. Python and wordfreq
are only generation dependencies; the app uses the checked-in snapshot offline.
Tests check complete coverage, source-word lengths, scores and band assignments.

## Attribution and licence

The extracted frequency data and derived level snapshot are distributed under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Changes from the
source: selected this app's 730 entries, added letter counts and derived five
relative difficulty bands. Credit: wordfreq by Robyn Speer, incorporating freely
available SUBTLEX data by Marc Brysbaert and colleagues, Google Books Ngrams,
OpenSubtitles, Wikipedia, the Leeds Internet Corpus, and ParaCrawl. See the copied
upstream `NOTICE.md` for full source attribution. This data licence applies to
this derived snapshot, not to unrelated application code or learner progress.
