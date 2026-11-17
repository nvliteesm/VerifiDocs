// A transaction helper shared by the pipeline stages that write to the database.
import type postgres from "postgres";
import type { SqlLike } from "./rag/retrieve";

export type Atomic = <T>(fn: (tx: postgres.Sql) => Promise<T>) => Promise<T>;

/** Runs `fn` in a transaction: a real one on a pool, a savepoint when already inside one. */
export function atomically(db: SqlLike): Atomic {
  const handle = db as unknown as {
    begin?: <T>(cb: (tx: postgres.TransactionSql) => Promise<T>) => Promise<T>;
    savepoint?: <T>(cb: (tx: postgres.TransactionSql) => Promise<T>) => Promise<T>;
  };
  return (fn) => {
    if (handle.savepoint) return handle.savepoint((tx) => fn(tx as unknown as postgres.Sql));
    if (handle.begin) return handle.begin((tx) => fn(tx as unknown as postgres.Sql));
    throw new Error("A database handle that can run transactions is required.");
  };
}
