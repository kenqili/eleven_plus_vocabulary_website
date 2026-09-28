# Performance profile

Measured 28 September 2026, from a production build.

**Read this first: most of it is measured, and some of it is not.** The parts
marked *not measured* are marked because the Cloudflare Workers runtime needs
macOS 13.5 or newer and this machine is on 12.6, so no server was ever started
and no browser ever loaded the site. Everything below is either read off a
built artefact or timed in Node, both of which are real. Nothing below is a
guess dressed as a number.

---

## The short answer

The request is already fast. The compute for one answered question is **35
microseconds** — about a millionth of the 10 ms budget a Cloudflare free-plan
Worker gets.

What a child actually waits for is not compute. It is:

1. **140 KB of compressed JavaScript and CSS** before the page is usable
2. **about five database round trips** per answer
3. **the audio**, which is now cached but is 167 MB on a first run

Those are the three things worth spending effort on, and only the first two are
under our control.

---

## Server

### Compute, per answered question

| | before | now |
|---|---|---|
| Module load, cold | 1,390 ms | **145 ms** |
| Resident memory | 74 MB | **25 MB** |
| Build one question | ~1.3 s | **35 µs** |

For scale, Cloudflare says the average Worker uses 2.2 ms per request. This
app's warm request uses 0.035 ms.

### Startup, which is a different limit

The 145 ms is not measured against the 10 ms figure, because it does not apply
there. Loading the bank is top-level code, so it counts against the **1 second
worker startup limit**. Wrangler prints the real number as `startup_time_ms`
on every deploy, and that is the figure to watch.

### Database round trips

Free against a CPU budget, and they are what a waiting child actually feels.
Counted from the source of `answerQuestion`:

- **one batched write** covering the answer, the attempt, the progress row, the
  learning event and the award
- **five reads**, which run one after another

The reads are the optimisable part. `answerQuestion` re-reads the progress row
for the word, the session, and the attempt. Each is a round trip, and they could
in principle share one batched read — D1 supports batching reads the same way it
batches writes. **Not done, and deliberately: it needs a real latency
measurement to know whether it is worth the loss of readability.**

One read *has* been narrowed. `nextQuestion` used to run
`SELECT * FROM progress WHERE user_id = ?` on every question handed out, which
pulls the child's entire progress table across the network, including every word
they have already retired. It now names the eight columns it uses and asks only
for unretired words. For an established child that is the difference between
hundreds of rows and tens.

---

## Client

| | files | raw | gzipped |
|---|---|---|---|
| JavaScript | 45 | 627 KB | **202 KB** |
| CSS | 1 | 210 KB | **36 KB** |
| JSON | 4 | 185 KB | 48 KB |

**The practice page costs about 140 KB compressed** — the framework chunk, the
index chunk and the challenge chunk. That is good for a React application. Most
of a Next.js site's first paint is framework code that this app does not
particularly need.

The single largest item is `framework` at 186 KB raw. That is React and the
server-component runtime, and it is not removable without giving up the App
Router. **Worth doing only if the page is measurably slow on a real connection,
which has not been tested.**

### The 2.9 MB question bank is not in the browser

Verified by searching the built client chunks for word data and finding none.
This is the check that matters most, because the bank is the largest thing the
app holds and shipping it to a child on a phone connection would be the single
worst thing that could happen to it. It is worth keeping a test on, because the
natural way to break it is to import a server module from a client component
"just to get the word list".

### The audio index

`public/audio/vocabulary/manifest.json` is 158 KB raw, about 48 KB compressed.
It is fetched at most once per session, prefetched while the browser is idle
rather than on the first tap, and skipped entirely on a save-data or 2G
connection.

The clips themselves are 167 MB across 2,369 files, now cached for a year with
`immutable`, so a child pays that once. On a phone that is still a real cost,
and the honest options are fewer words' audio rather than worse audio.

---

## What is not measured

Everything that needs a running server or a browser:

- **Real HTTP latency.** No server was started. The round-trip counts above are
  counted from source, not observed.
- **Time to first paint, and to interactive.** Needs a browser.
- **Per-page RSC payload size.** The framework streams a server-rendered tree
  per navigation; the size of that payload is unknown here.
- **Lighthouse, and what a real 3G connection costs.** Not run.
- **Whether the Content-Security-Policy blocks anything.** It has never been
  loaded in a browser. If the page renders and does not respond, that is why.

---

## What to do next, in order

**Before deploying, because they are cheap and they are correctness:**

1. Nothing. The app is not slow in any way that has been measured.

**After deploying, and only then, because they need the numbers above:**

2. Watch `startup_time_ms` in the wrangler output on the first deploy. Under a
   second and the free plan is viable.
3. Read the dashboard's CPU figure after a week of real use. Under 10 ms per
   invocation and $5 a month is an optimisation, not a requirement.
4. Load the site on a real phone on mobile data and time the first paint. If it
   is slow, the framework chunk is the thing to look at, and the first thing to
   try is the audio: a child on 3G pays for a 158 KB index before they can
   press Listen.

**Not worth doing without a measurement:**

5. Batching the five reads in `answerQuestion`. Free CPU-wise, unclear
   latency-wise.
6. Replacing the App Router. That is a rewrite to save 186 KB of framework
   code, on a site that is not measurably slow.
