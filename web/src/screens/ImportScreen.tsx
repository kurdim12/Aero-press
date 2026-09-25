import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { IMPORT_CHUNK_MAX, type ImportKind, type ImportResult, type ImportWarning } from '../../../shared/types';
import type { ImportRequest } from '../../../shared/schemas';
import { chunk, planV1Import, type V1Plan } from '../../../shared/v1import';
import { api, errorMessage } from '../api';
import { FormError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { invalidateLibrary } from '../queries';
import { meQuery } from '../session';
import { strings } from '../strings';

const s = strings.importV1;

type Loaded = { fileName: string; plan: V1Plan };
type Stage =
  | { step: 'pick'; error?: string }
  | { step: 'reading' }
  | ({ step: 'ready' } & Loaded)
  | ({ step: 'importing'; kind: ImportKind; done: number; total: number } & Loaded)
  | ({ step: 'done'; results: ImportResult[] } & Loaded)
  | ({ step: 'failed'; results: ImportResult[]; message: string } & Loaded);

const RECORD_KINDS = ['beans', 'recipes', 'brews', 'duels'] as const;

/** Owner-only: map a v1 backup in the browser, preview it, then send it in chunks. */
export function ImportScreen() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ step: 'pick' });

  async function readFile(file: File) {
    setStage({ step: 'reading' });
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      setStage({ step: 'pick', error: s.fileErrors.not_json });
      return;
    }
    const planned = planV1Import(data);
    if (!planned.ok) {
      setStage({ step: 'pick', error: s.fileErrors[planned.error] });
      return;
    }
    setStage({ step: 'ready', fileName: file.name, plan: planned.plan });
  }

  async function run({ fileName, plan }: Loaded) {
    const jobs: Array<{ kind: ImportKind; body: ImportRequest }> = [];
    for (const kind of RECORD_KINDS) {
      for (const records of chunk<object>(plan[kind], IMPORT_CHUNK_MAX)) {
        jobs.push({ kind, body: { kind, records } as ImportRequest });
      }
    }
    if (plan.settings) jobs.push({ kind: 'settings', body: { kind: 'settings', settings: plan.settings } });

    const results: ImportResult[] = [];
    for (const [i, job] of jobs.entries()) {
      setStage({ step: 'importing', fileName, plan, kind: job.kind, done: i, total: jobs.length });
      try {
        results.push(await api<ImportResult>('POST', '/api/import/v1', job.body));
      } catch (err) {
        await invalidateLibrary(qc);
        setStage({ step: 'failed', fileName, plan, results, message: errorMessage(err) });
        return;
      }
    }
    await Promise.all([invalidateLibrary(qc), qc.invalidateQueries({ queryKey: meQuery.queryKey })]);
    setStage({ step: 'done', fileName, plan, results });
  }

  const choose = () => input.current?.click();

  return (
    <>
      <TopBar title={s.title} backHref="/settings" hideAvatar />
      <main className="page shell-main">
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void readFile(file);
          }}
        />

        {stage.step === 'pick' && (
          <section className="section" style={{ marginTop: 8 }}>
            <p className="lead">{s.intro}</p>
            {stage.error && (
              <div style={{ marginTop: 16 }}>
                <FormError>{stage.error}</FormError>
              </div>
            )}
            <button type="button" className="btn block section" onClick={choose}>
              {s.choose}
            </button>
          </section>
        )}

        {stage.step === 'reading' && (
          <div className="center-block" role="status">
            <div className="spinner" />
            <p className="muted" style={{ marginTop: 12 }}>
              {s.reading}
            </p>
          </div>
        )}

        {stage.step === 'ready' && <Preview loaded={stage} onStart={() => void run(stage)} onChoose={choose} />}

        {stage.step === 'importing' && (
          <section className="section" role="status" aria-live="polite">
            <p className="lead">{s.progress(s.kinds[stage.kind] ?? stage.kind, stage.done + 1, stage.total)}</p>
            <div className="progress" style={{ marginTop: 14 }}>
              <span style={{ width: `${Math.round((stage.done / stage.total) * 100)}%` }} />
            </div>
          </section>
        )}

        {(stage.step === 'done' || stage.step === 'failed') && (
          <Results
            results={stage.results}
            failure={stage.step === 'failed' ? stage.message : null}
            onRetry={() => void run(stage)}
          />
        )}
      </main>
    </>
  );
}

function Preview({ loaded, onStart, onChoose }: { loaded: Loaded; onStart: () => void; onChoose: () => void }) {
  const { plan, fileName } = loaded;
  return (
    <section style={{ marginTop: 8 }}>
      <h2 className="hero-name condensed" style={{ fontSize: 28 }}>
        {s.readyTitle}
      </h2>
      <p className="muted" style={{ marginTop: 4 }}>
        {s.fileName(fileName)}
      </p>
      <div className="count-grid section">
        {RECORD_KINDS.map((kind) => (
          <div className="count-cell" key={kind}>
            <div className="stat-num condensed">{plan[kind].length}</div>
            <div className="stat-label">{s.kinds[kind]}</div>
          </div>
        ))}
      </div>
      {plan.settings && <p className="small muted" style={{ marginTop: 12 }}>✓ {s.settingsFound}</p>}

      {plan.warnings.length > 0 && (
        <div className="section">
          <span className="eyebrow">{s.checkTitle}</span>
          <ul className="plain-list">
            {plan.warnings.map((w) => (
              <li key={`${w.kind}:${w.code}`}>
                {(s.planWarnings[`${w.kind}:${w.code}`] ?? s.planWarnings[w.code])?.(w.count) ?? `${w.kind}: ${w.code} (${w.count})`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.ignoredFields.length > 0 && (
        <div className="section">
          <span className="eyebrow">{s.ignoredTitle}</span>
          <ul className="plain-list">
            {plan.ignoredFields.map((f) => (
              <li key={`${f.kind}.${f.field}`}>{s.ignoredField(f.kind, f.field, f.count)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="btn-stack section">
        <button type="button" className="btn block" onClick={onStart}>
          {s.start}
        </button>
        <button type="button" className="btn secondary block" onClick={onChoose}>
          {s.chooseAnother}
        </button>
      </div>
    </section>
  );
}

/** Add up chunk results per kind. */
function summarise(results: ImportResult[]) {
  const byKind = new Map<ImportKind, { inserted: number; already: number; skipped: number; warnings: Map<string, ImportWarning> }>();
  for (const r of results) {
    const sum = byKind.get(r.kind) ?? { inserted: 0, already: 0, skipped: 0, warnings: new Map<string, ImportWarning>() };
    sum.inserted += r.inserted;
    sum.already += r.already_there;
    sum.skipped += r.skipped;
    for (const w of r.warnings) {
      const prev = sum.warnings.get(w.code);
      sum.warnings.set(
        w.code,
        prev ? { ...w, count: prev.count + w.count, examples: [...prev.examples, ...w.examples].slice(0, 5) } : w,
      );
    }
    byKind.set(r.kind, sum);
  }
  return byKind;
}

function Results({ results, failure, onRetry }: { results: ImportResult[]; failure: string | null; onRetry: () => void }) {
  const summary = summarise(results);
  const warnings = [...summary].flatMap(([kind, sum]) =>
    [...sum.warnings.values()].map((w) => s.serverWarnings[`${kind}:${w.code}`]?.(w.count, w.examples) ?? w.message),
  );
  return (
    <section style={{ marginTop: 8 }}>
      {failure ? (
        <FormError>{s.failed(failure)}</FormError>
      ) : (
        <h2 className="hero-name condensed" style={{ fontSize: 28 }}>
          {s.doneTitle}
        </h2>
      )}
      {summary.size > 0 && (
        <dl className="kv-list section">
          {[...summary].map(([kind, sum]) => (
            <div className="kv" key={kind}>
              <dt>{s.kinds[kind]}</dt>
              <dd>{s.resultLine(sum.inserted, sum.already, sum.skipped)}</dd>
            </div>
          ))}
        </dl>
      )}
      {warnings.length > 0 && (
        <div className="section">
          <span className="eyebrow">{s.serverNotesTitle}</span>
          <ul className="plain-list">
            {warnings.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="btn-stack section">
        {failure && (
          <button type="button" className="btn block" onClick={onRetry}>
            {s.start}
          </button>
        )}
        <Link href="/recipes" className={`btn block${failure ? ' secondary' : ''}`}>
          {s.seeRecipes}
        </Link>
        <Link href="/beans" className="btn secondary block">
          {s.seeBeans}
        </Link>
      </div>
    </section>
  );
}
