# Third-party notices

Five Letters uses the following third-party data. Nothing here is fetched at
runtime: the generated dictionary and word lists are committed to the
repository and served from this site.

## WordNet 3.0

The definitions, examples and relation lists for accepted words outside the
MineWords bank are derived from WordNet 3.0.

> WordNet Release 3.0
>
> This software and database is being provided to you, the LICENSEE, by
> Princeton University under the following license. By obtaining, using and/or
> copying this software and database, you agree that you have read, understood,
> and will comply with these terms and conditions.:
>
> Permission to use, copy, modify and distribute this software and database and
> its documentation for any purpose and without fee or royalty is hereby
> granted, provided that you agree to comply with the following copyright
> notice and statements, including the disclaimer, and that the same appear on
> ALL copies of the software, database and documentation, including
> modifications that you make for internal use or for distribution.
>
> WordNet 3.0 Copyright 2006 by Princeton University. All rights reserved.
>
> THIS SOFTWARE AND DATABASE IS PROVIDED "AS IS" AND PRINCETON UNIVERSITY MAKES
> NO REPRESENTATIONS OR WARRANTIES, EXPRESS OR IMPLIED. BY WAY OF EXAMPLE, BUT
> NOT LIMITATION, PRINCETON UNIVERSITY MAKES NO REPRESENTATIONS OR WARRANTIES
> OF MERCHANTABILITY OR FITNESS FOR ANY PARTICULAR PURPOSE OR THAT THE USE OF
> THE LICENSED SOFTWARE, DATABASE OR DOCUMENTATION WILL NOT INFRINGE ANY THIRD
> PARTY PATENTS, COPYRIGHTS, TRADEMARKS OR OTHER RIGHTS.
>
> The name of Princeton University or Princeton may not be used in advertising
> or publicity pertaining to distribution of the software and/or database.
> Title to copyright in this software, database and any associated
> documentation shall at all times remain with Princeton University and
> LICENSEE agrees to preserve same.

Source: <https://wordnet.princeton.edu/>

The generated cards are in `data/five-letters/dictionary.json`; the public copy
is `public/five-letters/dictionary.json`.

## Wordle valid-guess list

`data/five-letters/valid-guesses.txt` is the 14,855-word Wordle valid-guess list
from tabatkins/wordle-list:

<https://github.com/tabatkins/wordle-list>

The game applies `data/five-letters/blocklist.txt` as a safety filter for a
children's game.

MIT License

Copyright (c) 2022 Tab Atkins Jr.

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Common five-letter answer list

`data/five-letters/common-answers.txt` is the 2,315-word common Wordle answer
list published in cfreshman's gist:

<https://gist.github.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b>

The list is a factual compilation of five-letter English words. It decides which
words get a dictionary card; the eight bank answer words missing from the list
are added by `scripts/build-five-letters-dictionary.mjs`. The full valid-guess
list above decides which guesses the game accepts.

## MineWords word bank

The 194 five-letter answer cards copied from the MineWords bank are this
project's own curated content. The bank's word-level frequency and difficulty
data is documented in `data/word-levels/README.md`.

## Wordle

Five Letters follows the familiar six-guess, green/yellow/grey rules. It is an
independent game and is not affiliated with, endorsed by, or connected to
Wordle or The New York Times.
