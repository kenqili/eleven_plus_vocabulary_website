import { createHash } from "node:crypto";
import { words } from "./load-word-bank.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
// Generation is an explicit maintenance task, never part of app startup.
if (existsSync(".env")) process.loadEnvFile(".env");
const voice = "en-GB-SoniaNeural";
const folder = resolve("public/audio/vocabulary");
const generate = process.argv.includes("--generate");
const check = process.argv.includes("--check");
const only = process.argv.find((arg) => arg.startsWith("--word="))?.slice(7);
const force = process.argv.includes("--force");
if (only && !words.some((word) => word.id === only))
  throw new Error("Unknown vocabulary word.");
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
const manifest = { voice, locale: "en-GB", words: {} };
let missing = 0;
for (const word of words) {
  const file = filename(word.id),
    path = resolve(folder, file);
  if (generate && (!only || only === word.id) && (force || !existsSync(path))) {
    const override = overrides[word.id];
    const spoken = override?.ipa
      ? `<phoneme alphabet="ipa" ph="${escape(override.ipa)}">${escape(word.word)}</phoneme>`
      : escape(word.word);
    const response = await fetch(
      `https://${process.env.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        },
        body: `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB"><voice name="${voice}">${spoken}</voice></speak>`,
        signal: AbortSignal.timeout(30000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Azure audio generation failed for ${word.id} (HTTP ${response.status}). Rerun to resume.`,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (
      bytes.length < 100 ||
      !response.headers.get("content-type")?.includes("audio")
    )
      throw new Error(`Invalid audio for ${word.id}`);
    writeFileSync(path, bytes);
    console.log(`Generated ${word.id}`);
  }
  const available = existsSync(path) && readFileSync(path).length > 100;
  if (!available) missing++;
  manifest.words[word.id] = available
    ? `/audio/vocabulary/${file}?v=${createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 12)}`
    : null;
}
if (!check)
  writeFileSync(
    resolve(folder, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
console.log(
  `${words.length - missing}/${words.length} pronunciation files available. Voice: ${voice}.`,
);
if (check && missing) process.exitCode = 1;
