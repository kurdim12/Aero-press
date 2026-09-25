import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import type { RecipeRow } from '../../../shared/types';
import { WINDOW_S, phaseIndexAt, planBrew } from '../../../shared/phases';
import { phaseDetail, phaseTitle } from '../brew/phaseText';
import { type TimerState, elapsedMs, pauseBrew, resetBrew, resumeBrew, startBrew, useNow, useTimer } from '../brew/timer';
import { FormError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { formatGrams, formatRatio, formatSeconds, formatTemp } from '../format';
import { recipesQuery } from '../queries';
import { strings } from '../strings';

const b = strings.brew;

/** /brew/:id — the step timer. Works offline from the recipes saved on the phone. */
export function BrewTimerScreen({ id }: { id: string }) {
  const recipes = useQuery(recipesQuery('all', null));
  const timer = useTimer();
  const recipe = recipes.data?.recipes.find((r) => r.id === id);

  if (!recipe) {
    return (
      <>
        <TopBar title={b.title} backHref="/brew" />
        <main className="page shell-main">
          {recipes.isPending ? (
            <div className="center-block">
              <div className="spinner" role="status" aria-label={strings.app.loading} />
            </div>
          ) : (
            <FormError>{b.missingRecipe}</FormError>
          )}
        </main>
      </>
    );
  }
  const other = timer.status !== 'idle' && timer.recipeId !== recipe.id;
  const otherRecipe = other ? recipes.data?.recipes.find((r) => r.id === timer.recipeId) : undefined;
  return <Timer recipe={recipe} timer={timer} otherCode={other ? (otherRecipe?.display_code ?? '…') : null} />;
}

function Timer({ recipe, timer, otherCode }: { recipe: RecipeRow; timer: TimerState; otherCode: string | null }) {
  const [, navigate] = useLocation();
  const plan = useMemo(() => planBrew(recipe), [recipe]);
  const mine = timer.status !== 'idle' && timer.recipeId === recipe.id;
  // Once started, follow the plan captured at Start, even if the recipe changes meanwhile.
  const runPlan = mine && timer.plan ? timer.plan : plan;
  const now = useNow(mine && timer.status === 'running');
  const elapsed = mine ? elapsedMs(timer, now) / 1000 : 0;
  // Whole seconds shown, rounded down, so the clock and the step countdowns agree.
  const shown = Math.floor(elapsed);
  const index = mine ? phaseIndexAt(runPlan, elapsed) : -1;
  const phases = runPlan.phases;
  const complete = runPlan.missing.length === 0;
  const current = index >= 0 && index < phases.length ? phases[index] : undefined;
  const next = !mine ? phases[0] : current ? phases[index + 1] : undefined;
  const finished = mine && index >= phases.length && complete;
  const over = elapsed > WINDOW_S;

  let title = b.ready;
  let detail = b.readyDetail;
  if (current) {
    title = phaseTitle(current.kind);
    detail = phaseDetail(current.kind, recipe);
  } else if (finished) {
    title = b.done;
    detail = b.doneDetail;
  } else if (mine) {
    // Past the known steps of an incomplete recipe: steep until the brewer presses.
    title = phaseTitle('steep');
    detail = phaseDetail('steep', recipe);
  }
  const progress = current ? Math.min(1, (elapsed - current.start) / (current.end - current.start)) : 0;

  const logThis = () => {
    pauseBrew();
    navigate(`/brew/${recipe.id}/log?time=${shown}`);
  };

  return (
    <>
      <TopBar title={recipe.display_code} backHref="/brew" />
      <main className="page shell-main brew">
        {otherCode && (
          <div className="banner warn" style={{ display: 'grid', gap: 10 }}>
            <span>{b.otherRunning(otherCode)}</span>
            <div className="action-row">
              <Link href={`/brew/${timer.recipeId ?? ''}`} className="btn secondary">
                {b.goToOther(otherCode)}
              </Link>
              <button type="button" className="btn secondary" onClick={resetBrew}>
                {b.stopOther}
              </button>
            </div>
          </div>
        )}

        <p className="brew-name">{recipe.name ?? strings.recipes.untitled}</p>
        <SetupChips recipe={recipe} />
        {complete ? (
          <p className={`plan-line${plan.fits ? '' : ' warn'}`}>
            {b.planned(formatSeconds(plan.total))} · {plan.fits ? b.fits : b.over(formatSeconds(plan.total - WINDOW_S))}
          </p>
        ) : (
          <p className="notice small" style={{ marginTop: 10 }}>
            {b.incomplete}{' '}
            <Link href={`/recipes/${recipe.id}/edit`} className="link-inline">
              {b.editRecipe}
            </Link>
          </p>
        )}

        <div className={`clock condensed${over ? ' over' : ''}`} role="timer" aria-label={formatSeconds(shown)}>
          {formatSeconds(shown)}
        </div>
        {over && <p className="over-label">{b.over5}</p>}

        <section className={`phase-panel${finished ? ' finished' : ''}`} aria-live="polite">
          <div className="phase-title condensed">{timer.status === 'paused' && mine ? `${title} · ${b.paused}` : title}</div>
          <p className="phase-detail">{detail}</p>
          {current && (
            <>
              <div className="phase-left num">{b.left(formatSeconds(Math.ceil(current.end - elapsed)))}</div>
              <div className="progress">
                <span style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            </>
          )}
          {next && <p className="phase-next">{b.next(phaseTitle(next.kind), formatSeconds(next.start))}</p>}
        </section>

        <div className="controls">
          {!mine && (
            <button type="button" className="btn huge" onClick={() => startBrew(recipe.id, plan)} disabled={Boolean(otherCode)}>
              {b.start}
            </button>
          )}
          {mine && timer.status === 'running' && (
            <button type="button" className="btn secondary huge" onClick={pauseBrew}>
              {b.pause}
            </button>
          )}
          {mine && timer.status === 'paused' && (
            <button type="button" className="btn secondary huge" onClick={resumeBrew}>
              {b.resume}
            </button>
          )}
          {mine && (
            <button type="button" className="btn huge" onClick={logThis}>
              {b.logThis}
            </button>
          )}
        </div>
        {mine && timer.status === 'paused' && (
          <button type="button" className="btn ghost block" onClick={resetBrew}>
            {b.startOver}
          </button>
        )}

        <section className="section">
          <span className="eyebrow">{b.steps}</span>
          <ol className="steps">
            {phases.map((p, i) => (
              <li key={p.kind} className={i === index ? 'current' : mine && i < index ? 'past' : undefined}>
                <span className="step-at num">{formatSeconds(p.start)}</span>
                <span className="step-body">
                  <strong>{phaseTitle(p.kind)}</strong>
                  <span>{phaseDetail(p.kind, recipe)}</span>
                </span>
              </li>
            ))}
            {complete && (
              <li className={finished ? 'current' : undefined}>
                <span className="step-at num">{formatSeconds(runPlan.total)}</span>
                <span className="step-body">
                  <strong>{b.done}</strong>
                </span>
              </li>
            )}
          </ol>
        </section>
      </main>
    </>
  );
}

function SetupChips({ recipe: r }: { recipe: RecipeRow }) {
  const ratio = formatRatio(r.water_g, r.dose_g);
  const chips = [
    r.dose_g != null && r.water_g != null
      ? `${formatGrams(r.dose_g)} → ${formatGrams(r.water_g)}${ratio ? ` (${ratio})` : ''}`
      : formatGrams(r.dose_g) || formatGrams(r.water_g),
    formatTemp(r.temp_c),
    [r.grind_setting, r.grinder].filter(Boolean).join(' · '),
    r.filter,
    r.water_recipe,
  ].filter((c): c is string => Boolean(c));
  return (
    <ul className="chips" aria-label={b.setup}>
      {chips.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  );
}
