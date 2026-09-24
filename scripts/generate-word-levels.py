"""Generate the checked-in difficulty snapshot; requires wordfreq==3.1.1 and Node 24."""
import hashlib
import json
import math
import subprocess
from importlib.metadata import version
from pathlib import Path
from wordfreq import zipf_frequency

ROOT = Path(__file__).resolve().parent.parent
if version("wordfreq") != "3.1.1":
    raise RuntimeError("Use wordfreq==3.1.1 to reproduce this snapshot")
words = json.loads(subprocess.check_output([
    "node", "--input-type=module", "-e",
    'import { words } from "./scripts/load-word-bank.mjs"; console.log(JSON.stringify(words));',
], cwd=ROOT, text=True))
entries = {}
for word in words:
    letters = sum(char.isalpha() for char in word["word"])
    frequency = zipf_frequency(word["word"], "en", wordlist="large")
    rarity = 1 - min(1, max(0, (frequency - 1) / 5))
    length_score = min(1, max(0, (letters - 3) / 12))
    entries[word["id"]] = {
        "letterCount": letters,
        "frequencyZipf": frequency,
        "frequencyKind": "unavailable" if frequency == 0 else "phrase-estimate" if " " in word["word"] else "word",
        "score": round(100 * (0.7 * rarity + 0.3 * length_score), 4),
    }
ordered = sorted(entries, key=lambda key: (entries[key]["score"], key))
for index, key in enumerate(ordered):
    entries[key]["difficulty"] = min(5, math.floor(index * 5 / len(ordered)) + 1)
result = {
    "version": 1,
    "source": {"name": "wordfreq", "version": "3.1.1", "author": "Robyn Speer", "url": "https://github.com/rspeer/wordfreq", "language": "en", "wordlist": "large", "license": "CC-BY-SA-4.0", "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/"},
    "method": "70% rarity + 30% letter count. Rarity = 1 - clamp((Zipf - 1) / 5, 0, 1). Length = clamp((letters - 3) / 12, 0, 1). Score rounded to 4 decimals; sort by score then normalized word ID; divide into five equal bands. Levels are relative to this library, not exam grades. Phrase frequency is estimated from component words; missing frequency uses Zipf 0 and is flagged.",
    "wordIdsSha256": hashlib.sha256("\n".join(word["id"] for word in words).encode()).hexdigest(),
    "counts": {str(level): sum(row["difficulty"] == level for row in entries.values()) for level in range(1, 6)},
    "words": entries,
}
(ROOT / "data/word-levels/levels.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"counts": result["counts"], "missingFrequency": [key for key, row in entries.items() if row["frequencyKind"] == "unavailable"]}, indent=2))
