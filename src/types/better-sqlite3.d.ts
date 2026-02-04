// Type declarations for better-sqlite3
declare module 'better-sqlite3' {
  interface Database {
    prepare(sql: string): Statement;
    exec(sql: string): this;
    pragma(pragma: string, simplify?: boolean): unknown;
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
    close(): void;
    readonly open: boolean;
    readonly name: string;
    readonly memory: boolean;
    readonly readonly: boolean;
    readonly inTransaction: boolean;
  }

  interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): IterableIterator<unknown>;
    pluck(toggle?: boolean): this;
    expand(toggle?: boolean): this;
    raw(toggle?: boolean): this;
    bind(...params: unknown[]): this;
    readonly source: string;
    readonly reader: boolean;
  }

  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Options {
    readonly?: boolean;
    fileMustExist?: boolean;
    timeout?: number;
    verbose?: (sql: string) => void;
    nativeBinding?: string;
  }

  function Database(filename: string, options?: Options): Database;
  
  namespace Database {
    export { Database, Statement, RunResult, Options };
  }

  export = Database;
}
