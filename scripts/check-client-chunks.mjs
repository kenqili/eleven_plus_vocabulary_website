#!/usr/bin/env node
/**
 * Check the built client chunks for the class of bug that no unit test can see.
 *
 * A link in this app does nothing when the browser cannot find a function the
 * client router needs, and that only happens in a production build. It happened
 * for real: vinext's client entry and its Link shim imported each other, so the
 * bundler left `navigateClientSide` out of the entry chunk's export list, the
 * Link chunk destructured it off a namespace that did not have it, and every
 * link died with "navigateClientSide is not a function" - after calling
 * preventDefault, so the browser never navigated either. All 175 tests passed
 * the whole time, because none of them load a built chunk.
 *
 * So this runs against dist/ and checks the three ways a chunk can end up
 * asking for a binding that is not there:
 *
 *   1. a static named import from another chunk that the target does not export
 *   2. a dynamic import whose result is read as a property, where the property is
 *      not an export of the chunk it came from - this is the one that bit us
 *   3. two chunks that dynamically import each other, which is what produced the
 *      missing export in the first place
 *
 * It is a guard, not a proof. A bundler can still break navigation in a way that
 * does not look like a missing binding, so this complements clicking a link on
 * the deployed site rather than replacing it.
 *
 * Known gap: a destructuring taken from `await Promise.all([import(a),
 * import(b)])` is not attributed to either module, because what it destructures
 * is a merged result rather than one chunk's namespace. That shape is really
 * present in this build. Each check below has been verified to fail when the
 * thing it looks for is removed from a real build, which is the only thing that
 * makes a guard worth having.
 *
 * Run after a production build:  npm run verify:chunks
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const CHUNK_DIR = "dist/client/_next/static/chunks";

if (!existsSync(CHUNK_DIR)) {
  console.error(
    `No ${CHUNK_DIR}. Run a production build first:\n  D1_ID=… D1_NAME=… npm run build`,
  );
  process.exit(1);
}

const files = readdirSync(CHUNK_DIR).filter((f) => f.endsWith(".js"));
const sources = new Map(
  files.map((f) => [f, readFileSync(join(CHUNK_DIR, f), "utf8")]),
);

/**
 * The names a chunk exports, as the outside world sees them.
 *
 * `export { a as b, c }` exports `b` and `c`; `a` is only the local name. Only
 * the exported spelling can be imported, so that is the only thing worth
 * collecting - getting this backwards reports every binding as missing.
 */
const exportedNames = (src) => {
  const names = new Set();
  for (const block of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of block[1].split(",")) {
      const entry = part.trim();
      if (!entry) continue;
      const as = entry.split(/\s+as\s+/);
      names.add((as[1] ?? as[0]).trim());
    }
  }
  for (const m of src.matchAll(
    /export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(m[1]);
  }
  if (/export\s+default\b/.test(src)) names.add("default");
  // `export * from "./x.js"` re-exports whatever x exports, without writing the
  // names out. The set is resolved transitively in resolveExports() below, so
  // there is deliberately no catch-all entry here: an entry that silently
  // accepted every name would turn this whole check into a no-op for any chunk
  // that used one, which is exactly how it managed to pass a build that was
  // genuinely broken.
  return names;
};

/** Exported names of a chunk, following `export * from` chains. */
const problems = [];
const exportsByFile = new Map();
const resolveExports = (file, seen = new Set()) => {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const src = sources.get(file);
  if (src === undefined) return new Set();
  const names = exportedNames(src);
  for (const m of src.matchAll(/export\s*\*\s*from\s*"\.\/([^"]+\.js)"/g)) {
    if (!sources.has(m[1])) {
      problems.push(`${file} re-exports * from ${m[1]}, which is not in the build`);
      continue;
    }
    for (const name of resolveExports(m[1], seen)) names.add(name);
  }
  return names;
};
for (const f of files) exportsByFile.set(f, resolveExports(f));

/**
 * Property names of the aggregate objects a chunk builds with `__exportAll({…})`.
 *
 * A framework can hand a dynamic importer something other than its own module
 * namespace. vinext does: the Link shim asks for one export, which is an
 * `__exportAll` object gathering a group of functions, and then destructures
 * names off that. Those names are therefore not module exports, so checking them
 * against the export list alone would report a working build as broken.
 */
const aggregateNames = (src) => {
  const names = new Set();
  for (const start of src.matchAll(/__exportAll\(\{/g)) {
    let i = start.index + start[0].length;
    let depth = 1;
    const bodyStart = i;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    const body = src.slice(bodyStart, i);
    for (const key of body.matchAll(/(?:^|[{,\s])([A-Za-z_$][\w$]*)\s*[:,(]/g)) {
      names.add(key[1]);
    }
  }
  return names;
};

const aggregatesByFile = new Map(
  [...sources].map(([f, src]) => [f, aggregateNames(src)]),
);

let staticChecked = 0;
let dynamicChecked = 0;

// 1. Static named imports between chunks.
for (const [file, src] of sources) {
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*"\.\/([^"]+\.js)"/g)) {
    const target = m[2];
    if (!exportsByFile.has(target)) {
      problems.push(`${file} imports from ${target}, which is not in the build`);
      continue;
    }
    const available = exportsByFile.get(target);
    for (const part of m[1].split(",")) {
      const entry = part.trim();
      if (!entry) continue;
      const wanted = entry.split(/\s+as\s+/)[0].trim();
      staticChecked++;
      if (!available.has(wanted)) {
        problems.push(`${file} imports { ${wanted} } from ${target}, which does not export it`);
      }
    }
  }
}

// 2. Dynamic imports read as a property of the resulting namespace.
for (const [file, src] of sources) {
  // import("./t.js").then(n => n.ALIAS) and import("./t.js").then((n) => n["A"])
  const dynamic = [
    ...src.matchAll(
      /import\("\.\/([^"]+\.js)"\)[\s\S]{0,80}?\.then\(\s*\(?\s*\w+\s*\)?\s*=>\s*\(?\s*\w+\s*\.\s*([A-Za-z_$][\w$]*)/g,
    ),
  ];
  for (const m of dynamic) {
    const [, target, wanted] = m;
    if (!exportsByFile.has(target)) {
      problems.push(`${file} dynamically imports ${target}, which is not in the build`);
      continue;
    }
    dynamicChecked++;
    const available = exportsByFile.get(target);
    if (!available.has(wanted)) {
      problems.push(
        `${file} reads ${target}#${wanted}, which that chunk does not export - ` +
          `this is the shape that left every link in the app dead`,
      );
    }
  }
}

// 2b. A whole dynamically imported namespace, destructured later.
//
//     This is the shape that actually broke the app. vinext's Link shim kept the
//     imported module in a variable and pulled named values off it at the point
//     of use:
//
//       loadedNavigationModule = module;                 // from import("./entry.js")
//       const { navigateClientSide } = loadedNavigationModule ?? await load();
//
//     Reading a property of the namespace (check 2) cannot see inside that, so
//     this follows the variable from the dynamic import to each destructuring
//     and checks the names individually.
const namespaceOf = new Map(); // variable name -> target chunk, per file
const destructureOf = new Map(); // variable name -> [names destructured from it]
for (const [file, src] of sources) {
  // `NAME = module` inside a .then() over a dynamic import. The local alias the
  // module arrives as is irrelevant: the point is that NAME now holds that
  // chunk's namespace.
  for (const m of src.matchAll(
    /(\w+)\s*=\s*\w+\s*;[\s\S]{0,200}?import\("\.\/([^"]+\.js)"\)/g,
  )) {
    namespaceOf.set(`${file}:${m[1]}`, m[2]);
  }
  // `const NAME = await import("./t.js")` and `NAME = import("./t.js")`.
  for (const m of src.matchAll(
    /(\w+)\s*=\s*(?:await\s+)?(?:__vitePreload\(\(\)\s*=>\s*)?import\("\.\/([^"]+\.js)"\)/g,
  )) {
    namespaceOf.set(`${file}:${m[1]}`, m[2]);
  }
  // Every destructuring off such a variable.
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([A-Za-z_$][\w$]*)/g)) {
    const names = m[1]
      .split(",")
      .map((p) => p.trim().split(":")[0].trim())
      .filter(Boolean);
    const key = `${file}:${m[2]}`;
    if (!destructureOf.has(key)) destructureOf.set(key, []);
    destructureOf.get(key).push(...names);
  }
}
for (const [key, names] of destructureOf) {
  const target = namespaceOf.get(key);
  if (!target || !exportsByFile.has(target)) continue;
  const asExport = exportsByFile.get(target);
  const asAggregate = aggregatesByFile.get(target) ?? new Set();
  for (const name of new Set(names)) {
    dynamicChecked++;
    if (asExport.has(name) || asAggregate.has(name)) continue;
    const [file, variable] = key.split(":");
    problems.push(
      `${file} destructures { ${name} } from ${variable}, which holds a binding from ` +
        `${target}, and ${target} neither exports it nor puts it in an aggregate object - ` +
        `this is the exact shape that left every link in the app dead`,
    );
  }
}

// 3. Dynamic import cycles between chunks.
const dynamicTargets = new Map(
  [...sources].map(([f, src]) => [
    f,
    new Set(
      [...src.matchAll(/import\("\.\/([^"]+\.js)"\)/g)]
        .map((m) => m[1])
        .filter((t) => exportsByFile.has(t)),
    ),
  ]),
);
for (const [file, targets] of dynamicTargets) {
  for (const target of targets) {
    if (dynamicTargets.get(target)?.has(file)) {
      problems.push(
        `${file} and ${target} dynamically import each other; a cycle like this ` +
          `makes the bundler drop exports and is what caused the dead links`,
      );
    }
  }
}

console.log(`Checked ${files.length} client chunks.`);
console.log(`  ${staticChecked} static cross-chunk imports resolved`);
console.log(`  ${dynamicChecked} dynamic namespace reads resolved`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("  no missing bindings, no cyclic chunk imports");
