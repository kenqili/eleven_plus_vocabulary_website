import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
// Generation is an explicit maintenance task, never part of app startup.
if (existsSync(".env")) process.loadEnvFile(".env");
const voice = "en-GB-SoniaNeural";
// Learners meet each word first on a card, then in a story. A touch slower
// than conversation pace keeps the harder target words followable.
const rate = "-5%";
const folder = resolve("public/audio/stories");
const generate = process.argv.includes("--generate");
const check = process.argv.includes("--check");
const only = process.argv.find((arg) => arg.startsWith("--story="))?.slice(8);
const force = process.argv.includes("--force");
// The story files are the same reviewed JSON the app validates at startup.
// Keep each story with the file it came from so a later edit can be spotted.
const stories = [0, 1, 2, 3, 4, 5].flatMap((level) => {
  const file = resolve(`data/stories/level-${level}.txt`);
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Stories must be a JSON array.");
  return parsed.map((story) => ({ story, file }));
});
if (only && !stories.some(({ story }) => story.id === only))
  throw new Error("Unknown story.");
const filename = (id) => Buffer.from(id).toString("hex") + ".mp3";
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
const overridesPath = "data/learning/pronunciation-overrides.json";
const overrides = JSON.parse(readFileSync(overridesPath, "utf8"));
// Bold marks the target vocabulary. Spoken as plain words, except where a
// reviewed IPA override exists, so a word sounds the same in a story and on
// its flash card.
function speak(paragraph) {
  return paragraph
    .split(/(\*\*[^*]+\*\*)/g)
    .map((part) => {
      if (!part.startsWith("**")) return escape(part);
      const word = part.slice(2, -2),
        override = overrides[word.toLowerCase()];
      return override?.ipa
        ? `<phoneme alphabet="ipa" ph="${escape(override.ipa)}">${escape(word)}</phoneme>`
        : escape(word);
    })
    .join("");
}
// The title, then each paragraph with a beat between them. The comprehension
// question is deliberately left out so hearing the story cannot hand over the
// answer.
const narration = (story) =>
  [speak(story.title), ...story.paragraphs.map(speak)].join(
    '<break time="700ms"/>',
  );
const ssml = (story) =>
  `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB"><voice name="${voice}"><prosody rate="${rate}">${narration(story)}</prosody></voice></speak>`;
const digest = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 12);
if (
  generate &&
  (!process.env.AZURE_SPEECH_KEY || !process.env.AZURE_SPEECH_REGION)
) {
  console.error(
    "Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in the local .env before generating audio.",
  );
  process.exit(1);
}
if (generate && !/^[a-z0-9-]+$/.test(process.env.AZURE_SPEECH_REGION))
  throw new Error("Invalid Azure Speech region.");
if (!check) mkdirSync(folder, { recursive: true });
// Story prose is edited as the vocabulary is reviewed, so an audio file that
// merely exists is not proof that it still matches the story. Remember the
// narrated text each file was built from and rebuild only what drifted.
const manifestPath = resolve(folder, "manifest.json");
const previous = (() => {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")).sources || {};
  } catch {
    return {};
  }
})();
const manifest = { voice, locale: "en-GB", rate, stories: {}, sources: {} };
let missing = 0,
  rebuilt = 0,
  stale = 0;
for (const { story, file } of stories) {
  const output = filename(story.id),
    path = resolve(folder, output),
    source = digest(narration(story)),
    text = [story.title, ...story.paragraphs].join(" ").replaceAll("**", "");
  if (text.length > 15000)
    throw new Error(
      `${story.id}: ${text.length} characters exceeds the 15000 character speech request limit.`,
    );
  // A manifest written before hashes existed falls back to comparing when the
  // prose file was last touched, so the first hashed run stays accurate.
  const outdated = !previous[story.id]
    ? existsSync(path) && statSync(path).mtimeMs < statSync(file).mtimeMs
    : previous[story.id] !== source;
  if (outdated) stale++;
  if (
    generate &&
    (!only || only === story.id) &&
    (force || outdated || !existsSync(path))
  ) {
    const response = await fetch(
      `https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        },
        body: ssml(story),
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Azure audio generation failed for ${story.id} (HTTP ${response.status}). Rerun to resume.`,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      bytes.length < 100 ||
      !response.headers.get("content-type")?.includes("audio")
    )
      throw new Error(`Invalid audio for ${story.id}`);
    writeFileSync(path, bytes);
    rebuilt++;
    console.log(
      `${outdated || force ? "Rebuilt" : "Generated"} ${story.id} (${bytes.length} bytes)`,
    );
  }
  const available = existsSync(path) && readFileSync(path).length > 100;
  if (!available) missing++;
  manifest.stories[story.id] = available
    ? `/audio/stories/${output}?v=${digest(readFileSync(path))}`
    : null;
  manifest.sources[story.id] = source;
}
if (!check)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `${stories.length - missing}/${stories.length} story audio files available. Voice: ${voice}.`,
);
if (stale && check)
  console.log(
    `${stale} story audio file(s) no longer match the prose. Rebuild with \`npm run audio:stories:generate\`.`,
  );
if (generate) console.log(`${rebuilt} audio file(s) written this run.`);
if (check && (missing || stale)) process.exitCode = 1;
