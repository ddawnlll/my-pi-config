/**
 * codemode-log — her `codemode` çalıştırmasını diske kaydeder.
 *
 * Kayıtlar merkezî olarak tutulur (proje başına değil), böylece her projede aynı
 * yerde birikir:
 *
 *   ~/.pi/agent/logs/codemode-runs.db    (SQLite; okunabilir, sorgulanabilir)
 *   ~/.pi/agent/logs/codemode-runs.jsonl (aynı kayıtların satır satır JSON kopyası)
 *
 * Yolları değiştirmek için:
 *   PI_CODEMODE_LOG_DIR=/baska/dizin
 *   PI_CODEMODE_LOG_DB=/baska/dosya.db
 *   PI_CODEMODE_LOG_JSONL=/baska/dosya.jsonl
 *   PI_CODEMODE_LOG_DISABLE=1   (tamamen kapat)
 *
 * Kullanım:
 *   /codemode-log        son 5 çalıştırmayı göster
 *   /codemode-log 20     son 20 çalıştırmayı göster
 *
 * Not: codemode kum havuzunun (QuickJS) diske erişimi yoktur. Bu yüzden kayıt,
 * her çağrıyı sarmalayan bir pi eklentisi (extension) ile pi sürecinde yapılır;
 * modelin her seferinde ayrıca bir "log" çağrısı yapmasına gerek kalmaz.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TOOL_NAME = "codemode";

/* ------------------------------------------------------------------ */
/* Yollar                                                              */
/* ------------------------------------------------------------------ */

function agentDir(): string {
    return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function logPaths() {
    const dir = process.env.PI_CODEMODE_LOG_DIR || join(agentDir(), "logs");
    return {
        dir,
        db: process.env.PI_CODEMODE_LOG_DB || join(dir, "codemode-runs.db"),
        jsonl: process.env.PI_CODEMODE_LOG_JSONL || join(dir, "codemode-runs.jsonl"),
        errors: join(dir, "codemode-log-errors.log"),
    };
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

/** Yerel saat dilimini koruyan ISO benzeri zaman damgası: 2026-10-28T13:20:00.000+03:00 */
function isoLocal(d = new Date()): string {
    const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");
    const offset = -d.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
        `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
    );
}

function resultText(result: unknown): string {
    if (typeof result === "string") return result;
    if (!result || typeof result !== "object") return "";
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.content)) {
        return r.content
            .map((block) => {
                if (block && typeof block === "object" && (block as any).type === "text") {
                    return String((block as any).text ?? "");
                }
                return "";
            })
            .join("");
    }
    if (typeof r.output === "string") return r.output;
    if (typeof r.text === "string") return r.text;
    return "";
}

function fullOutputPath(result: unknown): string | undefined {
    if (!result || typeof result !== "object") return undefined;
    const details = (result as any).details;
    const p = details?.fullOutputPath;
    return typeof p === "string" ? p : undefined;
}

function extractError(output: string): string | undefined {
    const match = output.match(/Script error:\s*\n?([\s\S]*)$/);
    return match ? match[1].trim() : undefined;
}

/* ------------------------------------------------------------------ */
/* Kayıt modeli                                                        */
/* ------------------------------------------------------------------ */

export interface CodemodeRunRecord {
    runKey: string;
    toolCallId: string;
    sessionId: string;
    sessionFile?: string;
    cwd: string;
    model?: string;
    startedAt: string;
    finishedAt: string;
    durationMs?: number;
    status: "ok" | "error";
    code: string;
    output: string;
    error?: string;
    fullOutputPath?: string;
    toolCalls: number;
    toolErrors: number;
    toolsUsed: string[];
}

interface Store {
    readonly kind: "sqlite" | "jsonl";
    readonly dbPath: string;
    readonly jsonlPath: string;
    append(record: CodemodeRunRecord): Promise<void>;
    report(limit: number): Promise<string>;
    close(): Promise<void> | void;
}

/* ------------------------------------------------------------------ */
/* SQLite (node:sqlite / bun:sqlite) + JSONL aynası                    */
/* ------------------------------------------------------------------ */

const SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS codemode_runs (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    run_key           TEXT NOT NULL UNIQUE,
    started_at        TEXT NOT NULL,
    finished_at       TEXT NOT NULL,
    duration_ms       INTEGER,
    session_id        TEXT,
    session_file      TEXT,
    cwd               TEXT,
    model             TEXT,
    tool_call_id      TEXT,
    status            TEXT NOT NULL,
    code              TEXT NOT NULL,
    output            TEXT,
    error             TEXT,
    output_chars      INTEGER,
    tool_calls        INTEGER NOT NULL DEFAULT 0,
    tool_errors       INTEGER NOT NULL DEFAULT 0,
    tools_used        TEXT,
    full_output_path  TEXT
);
CREATE INDEX IF NOT EXISTS idx_codemode_runs_started ON codemode_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_codemode_runs_status  ON codemode_runs(status);
`;

const INSERT_SQL = `
INSERT OR REPLACE INTO codemode_runs
    (run_key, started_at, finished_at, duration_ms, session_id, session_file,
     cwd, model, tool_call_id, status, code, output, error, output_chars,
     tool_calls, tool_errors, tools_used, full_output_path)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

async function loadSqlite(): Promise<any | undefined> {
    try {
        return await import("node:sqlite");
    } catch {
        /* Node < 22.5 veya node:sqlite kapalı */
    }
    try {
        return await import("bun:sqlite");
    } catch {
        /* Bun değil */
    }
    return undefined;
}

function createSqliteStore(
    sqlite: any,
    paths: ReturnType<typeof logPaths>,
): Store {
    const isBun = typeof sqlite.Database === "function" && typeof sqlite.DatabaseSync !== "function";
    const db = isBun ? new sqlite.Database(paths.db) : new sqlite.DatabaseSync(paths.db);

    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
    db.exec(SQLITE_SCHEMA);

    const insert = db.prepare(INSERT_SQL);

    const mirrorJsonl = (record: CodemodeRunRecord) => {
        try {
            mkdirSync(paths.dir, { recursive: true });
            appendFileSync(paths.jsonl, JSON.stringify(record) + "\n", "utf8");
        } catch {
            /* JSONL aynası başarısız olsa da SQLite kaydı devam eder */
        }
    };

    return {
        kind: "sqlite",
        dbPath: paths.db,
        jsonlPath: paths.jsonl,
        async append(record) {
            insert.run(
                record.runKey,
                record.startedAt,
                record.finishedAt,
                record.durationMs ?? null,
                record.sessionId,
                record.sessionFile ?? null,
                record.cwd,
                record.model ?? null,
                record.toolCallId,
                record.status,
                record.code,
                record.output,
                record.error ?? null,
                record.output.length,
                record.toolCalls,
                record.toolErrors,
                JSON.stringify(record.toolsUsed),
                record.fullOutputPath ?? null,
            );
            mirrorJsonl(record);
        },
        async report(limit) {
            const rows = db
                .prepare(
                    `SELECT started_at, status, duration_ms, tool_calls, output_chars,
                            substr(replace(code, char(10), ' '), 1, 90) AS preview
                     FROM codemode_runs
                     ORDER BY id DESC
                     LIMIT ?`,
                )
                .all(limit) as any[];
            const totals = db
                .prepare(
                    `SELECT count(*) AS total,
                            sum(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok,
                            sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS err
                     FROM codemode_runs`,
                )
                .get() as any;
            return formatReport(paths, totals, rows);
        },
        close() {
            try {
                db.close();
            } catch {
                /* yoksay */
            }
        },
    };
}

function createJsonlOnlyStore(paths: ReturnType<typeof logPaths>): Store {
    return {
        kind: "jsonl",
        dbPath: paths.db,
        jsonlPath: paths.jsonl,
        async append(record) {
            mkdirSync(paths.dir, { recursive: true });
            appendFileSync(paths.jsonl, JSON.stringify(record) + "\n", "utf8");
        },
        async report(limit) {
            return (
                `SQLite kullanılamıyor; yalnızca JSONL kaydı tutuluyor.\n` +
                `Dosya: ${paths.jsonl}\n` +
                `Son ${limit} kayıt için: tail -n ${limit} "${paths.jsonl}"`
            );
        },
        close() {
            /* yok */
        },
    };
}

function formatReport(
    paths: ReturnType<typeof logPaths>,
    totals: { total?: number; ok?: number; err?: number } | undefined,
    rows: Array<{
        started_at: string;
        status: string;
        duration_ms: number | null;
        tool_calls: number | null;
        output_chars: number | null;
        preview: string;
    }>,
): string {
    const total = totals?.total ?? 0;
    const ok = totals?.ok ?? 0;
    const err = totals?.err ?? 0;
    const lines = [
        `codemode kayıtları: ${paths.db}`,
        `JSONL ayna      : ${paths.jsonl}`,
        `Toplam ${total} çalıştırma — başarılı ${ok}, hatalı ${err}`,
        "",
    ];
    if (rows.length === 0) {
        lines.push("Henüz kayıt yok.");
        return lines.join("\n");
    }
    for (const r of rows) {
        const dur = r.duration_ms == null ? "?" : `${(r.duration_ms / 1000).toFixed(1)}s`;
        lines.push(
            `${r.started_at}  ${r.status.padEnd(5)}  ${dur.padStart(6)}  ` +
                `${String(r.tool_calls ?? 0).padStart(2)} araç  ${String(r.output_chars ?? 0).padStart(6)} kr  | ${r.preview}`,
        );
    }
    return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Tembel (lazy) store                                                 */
/* ------------------------------------------------------------------ */

let storePromise: Promise<Store> | undefined;

function logInternalError(err: unknown): void {
    try {
        const p = logPaths();
        mkdirSync(dirname(p.errors), { recursive: true });
        appendFileSync(
            p.errors,
            `${isoLocal()} ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
            "utf8",
        );
    } catch {
        /* son çare: sessiz kal */
    }
}

function getStore(): Promise<Store> {
    if (storePromise) return storePromise;
    storePromise = (async () => {
        const paths = logPaths();
        mkdirSync(paths.dir, { recursive: true });
        const sqlite = await loadSqlite();
        if (sqlite) {
            try {
                return createSqliteStore(sqlite, paths);
            } catch (err) {
                logInternalError(err);
            }
        }
        return createJsonlOnlyStore(paths);
    })();
    return storePromise;
}

/** Kayıt API'si (test ve harici kullanım için de açık). */
export async function appendCodemodeRun(record: CodemodeRunRecord): Promise<void> {
    if (process.env.PI_CODEMODE_LOG_DISABLE === "1") return;
    const store = await getStore();
    await store.append(record);
}

export async function codemodeLogReport(limit = 5): Promise<string> {
    const store = await getStore();
    return store.report(limit);
}

export function codemodeLogPaths() {
    return logPaths();
}

/* ------------------------------------------------------------------ */
/* Extension                                                           */
/* ------------------------------------------------------------------ */

interface PendingRun {
    toolCallId: string;
    code: string;
    startedAtMs: number;
    startedAt: string;
    sessionId: string;
    sessionFile?: string;
    cwd: string;
    model?: string;
    toolCalls: number;
    toolErrors: number;
    toolsUsed: Set<string>;
}

export default function codemodeLogExtension(pi: ExtensionAPI) {
    const pending = new Map<string, PendingRun>();

    function captureCall(event: any, ctx: ExtensionContext) {
        if (event.toolName !== TOOL_NAME) return;
        if (event.parentToolCallId) return; // codemode içinden yapılan çağrı
        const code = typeof event.input?.code === "string" ? event.input.code : "";
        pending.set(event.toolCallId, {
            toolCallId: event.toolCallId,
            code,
            startedAtMs: Date.now(),
            startedAt: isoLocal(),
            sessionId: ctx.sessionManager.getSessionId(),
            sessionFile: ctx.sessionManager.getSessionFile(),
            cwd: ctx.cwd,
            model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
            toolCalls: 0,
            toolErrors: 0,
            toolsUsed: new Set(),
        });
    }

    function noteNested(event: any) {
        const parentId = event.parentToolCallId;
        if (!parentId) return;
        const run = pending.get(parentId);
        if (!run) return;
        run.toolCalls += 1;
        if (event.isError) run.toolErrors += 1;
        if (typeof event.toolName === "string") run.toolsUsed.add(event.toolName);
    }

    async function finishRun(event: any, ctx: ExtensionContext) {
        if (event.toolName !== TOOL_NAME) return;
        if (event.parentToolCallId) return;
        const run = pending.get(event.toolCallId);
        pending.delete(event.toolCallId);
        if (!run) return;

        const output = resultText(event.result);
        const isError = event.isError === true;
        const record: CodemodeRunRecord = {
            runKey: `${run.sessionId}:${run.toolCallId}`,
            toolCallId: run.toolCallId,
            sessionId: run.sessionId,
            sessionFile: run.sessionFile,
            cwd: run.cwd,
            model: run.model,
            startedAt: run.startedAt,
            finishedAt: isoLocal(),
            durationMs: typeof event.durationMs === "number" ? Math.round(event.durationMs) : Date.now() - run.startedAtMs,
            status: isError ? "error" : "ok",
            code: run.code,
            output,
            error: isError ? (extractError(output) ?? output.slice(-2000)) : undefined,
            fullOutputPath: fullOutputPath(event.result),
            toolCalls: run.toolCalls,
            toolErrors: run.toolErrors,
            toolsUsed: [...run.toolsUsed].sort(),
        };

        try {
            await appendCodemodeRun(record);
        } catch (err) {
            logInternalError(err);
            try {
                ctx.ui.notify(`codemode-log: kayıt yazılamadı (${String(err)})`, "warning");
            } catch {
                /* yoksay */
            }
        }
    }

    // tool_call: script kaynağını ve oturum bilgisini yakala (çalışma başlamadan).
    pi.on("tool_call", (event, ctx) => {
        try {
            captureCall(event, ctx);
        } catch (err) {
            logInternalError(err);
        }
    });

    // tool_execution_end: sonucu, süreyi ve iç çağrıları yakala.
    pi.on("tool_execution_end", (event, ctx) => {
        try {
            noteNested(event);
        } catch (err) {
            logInternalError(err);
        }
        // Yazma işi bitişi geciktirmesin; yine de hata olursa loglanır.
        void finishRun(event, ctx).catch(logInternalError);
    });

    pi.on("session_shutdown", () => {
        const store = storePromise;
        storePromise = undefined;
        pending.clear();
        void store?.then((s) => s.close()).catch(() => undefined);
    });

    pi.registerCommand("codemode-log", {
        description: "Son codemode çalıştırmalarını ve kayıt veritabanını göster",
        handler: async (args, ctx) => {
            const n = Number.parseInt(args.trim(), 10);
            const limit = Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 5;
            try {
                ctx.ui.notify(await codemodeLogReport(limit), "info");
            } catch (err) {
                ctx.ui.notify(`codemode-log: ${String(err)}`, "error");
            }
        },
    });
}
