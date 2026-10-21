import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// The D1 subset used by the application, backed by SQLite for Node development.
//
// D1 allows at most 100 bound parameters per query. SQLite allows 32,766, so
// without this check a statement that D1 rejects - "too many SQL variables" -
// runs happily here, and a local test passes on a change that cannot work in
// production. That is not hypothetical: a flush of a long sitting binds one
// parameter per word it touches, and it reached production as a 503 before this
// was here. The limit is checked where the parameters are bound, which is where
// the count is known, and it applies per statement, as D1 applies it.
const D1_MAX_BOUND_PARAMETERS = 100;

export function openLocalDatabase(filename, migrations = resolve("drizzle")) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  sqlite.exec("CREATE TABLE IF NOT EXISTS _node_migrations (name TEXT PRIMARY KEY)");
  for (const name of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    if (sqlite.prepare("SELECT name FROM _node_migrations WHERE name=?").get(name)) continue;
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(readFileSync(resolve(migrations, name), "utf8"));
      sqlite.prepare("INSERT INTO _node_migrations VALUES (?)").run(name);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      sqlite.close();
      throw error;
    }
  }
  function prepare(sql, values = []) {
    if (values.length > D1_MAX_BOUND_PARAMETERS) {
      throw new Error(
        `too many SQL variables: this statement binds ${values.length} parameters, and D1 allows ${D1_MAX_BOUND_PARAMETERS} per query.`,
      );
    }
    function execute() {
      const statement = sqlite.prepare(sql);
      const results = statement.columns().length ? statement.all(...values) : [];
      const info = results.length || statement.columns().length ? null : statement.run(...values);
      return { success: true, results, meta: { changes: Number(info?.changes ?? 0), last_row_id: Number(info?.lastInsertRowid ?? 0) } };
    }
    return {
      bind: (...args) => prepare(sql, args),
      async first(column) {
        const row = sqlite.prepare(sql).get(...values);
        return row ? (column === undefined ? row : row[column]) : null;
      },
      async all() { return execute(); },
      async run() { return execute(); },
      execute,
    };
  }
  return {
    prepare,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
    close() { sqlite.close(); },
  };
}
