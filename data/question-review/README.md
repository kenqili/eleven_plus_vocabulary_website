# Independent question review

An independent reviewing agent read all 730 merged source entries and every
initial question: 727 synonym rows and 661 antonym rows. Each question's answer
and all three distractors were checked semantically, including alternative
senses. This was an editorial review, not just a check that the answer appeared
once in the options array.

`overrides.json` contains the resulting explicit corrections, sense contexts,
distractor replacements and exclusions. The generator consumes this file.
`build-review-overrides.mjs` records these decisions in a readable form; running
it rebuilds the overrides. `review-report.json` records final reviewed file hashes
and counts, so edits to a CSV can be distinguished from this reviewed version.

Examples corrected include:

- **cordial / antonym:** both *hostile* and *belligerent* were initially options.
- **nebulous / antonym:** both *clear* and *lucid* were initially options.
- **radiant / antonym:** both *gloomy* and *melancholy* were initially options.
- **apprehend / synonym:** *arrest* and *perceive* invited different senses.
- **sage / antonym:** *novice* contrasts with experience, not wisdom; changed to
  *fool* in the person sense.
- **amoral / synonym:** changed *unprincipled* to *morally indifferent*, matching
  the taught distinction between disregard for morality and immoral behaviour.
- **domestic / antonym:** excluded *foreign*: it contrasts with the national
  sense, whereas the supplied definition teaches the household sense.

The three idioms lacking supplied synonyms received common equivalents:
*break a leg* → *good luck*; *crack up* in its laughing sense → *burst into
laughter*; *chew the fat* → *chat*.

Some words do not have a defensible antonym. The review excludes misleading
opposites instead of inventing them to meet a numerical target. Examples include
*merchant / customer* (roles), *pigment / bleach* (associated substances),
*notion / fact* (a notion can be factual), and *tepid* (both hotter and colder are
possible contrasts). Full reasons are in the overrides and generation report.

Dictionary checks for uncertain senses used primary dictionary publishers:

- [Oxford: sage](https://www.oxfordlearnersdictionaries.com/definition/english/sage_1)
  distinguishes the wise-person sense used here.
- [American Heritage: amoral](https://ahdictionary.com/word/search.html?q=amoral)
  distinguishes moral indifference from an assertion that something is immoral.
- [Oxford: vapour](https://www.oxfordlearnersdictionaries.com/definition/english/vapour)
  supports *steam* as a closer common-language equivalent for this question.
- [Oxford: virulent](https://www.oxfordlearnersdictionaries.com/us/definition/english/virulent)
  supports the disease sense, with severe harmful effects.

Residual limits: natural-language synonyms and antonyms are sense-dependent and
often approximate. The bank uses the ordinary 11+ teaching sense or an explicit
usage context; it is not a claim that words are interchangeable in every
sentence. Distractors deliberately avoid plausible alternative answers and
may differ in part of speech, so difficulty is not psychometrically calibrated.
The original source CSV explanations are preserved; excluding a question does
not remove an original relation from those source files. Future edits or
regeneration with changed data should receive a fresh semantic review.
