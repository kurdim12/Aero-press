import { Fragment } from 'react';
import { Link } from 'wouter';
import { CHAMPION_RECIPES, type ChampionRecipe, type ChampionSetup } from '../../../shared/champions';
import { WINDOW_S, planBrew } from '../../../shared/phases';
import { TopBar } from '../components/TopBar';
import { stashRecipeDraft } from '../drafts';
import { formatRatio, formatSeconds, formatTemp } from '../format';
import { COLUMN_LABELS, formatColumn } from '../recipeFields';
import { strings } from '../strings';

const c = strings.champions;

/** The setup fields shown on a champion's page, in the recipe detail's order. */
const SETUP_KEYS: (keyof ChampionSetup)[] = [
  'method',
  'filter',
  'dose_g',
  'water_g',
  'temp_c',
  'grinder',
  'grind_setting',
  'water_recipe',
  'bloom_water_g',
  'bloom_ends_s',
  'agitation',
  'press_starts_s',
  'press_duration_s',
  'bypass_g',
  'bypass_temp',
];

const byYear = (): [number, ChampionRecipe[]][] => {
  const years = new Map<number, ChampionRecipe[]>();
  for (const entry of CHAMPION_RECIPES) years.set(entry.year, [...(years.get(entry.year) ?? []), entry]);
  return [...years.entries()].sort(([a], [b]) => b - a);
};

/** /recipes/champions: every published podium recipe, newest first. */
export function ChampionsScreen() {
  return (
    <>
      <TopBar title={c.title} backHref="/recipes" />
      <main className="page shell-main">
        <p className="lead" style={{ marginTop: 8 }}>
          {c.intro}
        </p>
        <p className="muted small" style={{ marginTop: 10 }}>
          {c.trust}
        </p>
        {byYear().map(([year, entries]) => (
          <section key={year} className="section">
            <span className="eyebrow">{year}</span>
            <ul className="rows">
              {entries.map((entry) => (
                <ChampionRow key={entry.id} entry={entry} />
              ))}
            </ul>
            {year === 2021 && <p className="muted small">{c.noFinal2020}</p>}
          </section>
        ))}
      </main>
    </>
  );
}

function ChampionRow({ entry }: { entry: ChampionRecipe }) {
  const r = entry.recipe;
  const details = r
    ? [strings.recipes.methods[r.method], formatRatio(r.water_g, r.dose_g), formatTemp(r.temp_c)].filter(Boolean).join(' · ')
    : c.noRecipe;
  const plan = r ? planBrew(r) : null;
  return (
    <li>
      <Link href={`/recipes/champions/${entry.id}`} className="row">
        <span className={`place condensed${entry.place === 1 ? ' gold' : ''}`}>{c.place[entry.place]}</span>
        <span className="row-main">
          <span className="row-title">{entry.name}</span>
          <span className="row-sub">
            {entry.country} · {details}
          </span>
        </span>
        {plan && plan.missing.length === 0 && (
          <span className="stat-cell">
            <span className="stat-num condensed">{formatSeconds(plan.total)}</span>
            <span className="stat-label">{plan.fits ? strings.brew.fits : strings.brew.over(formatSeconds(plan.total - WINDOW_S))}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

/** "Add to our recipes": the new-recipe form, filled in with the champion's setup and where it came from. */
function addHref(entry: ChampionRecipe): string {
  const { recipe } = entry;
  if (!recipe) return '/recipes/new';
  const changes = Object.fromEntries(Object.entries(recipe).filter(([, v]) => v !== null));
  const key = stashRecipeDraft({
    changes: { ...changes, name: c.recipeName(entry.year, entry.place, entry.name) },
    note: c.draftNote(entry.year, entry.place, entry.name, entry.country, entry.sources),
  });
  return `/recipes/new?draft=${key}`;
}

/** /recipes/champions/:id */
export function ChampionScreen({ id }: { id: string }) {
  const entry = CHAMPION_RECIPES.find((e) => e.id === id);
  if (!entry) {
    return (
      <>
        <TopBar title={c.title} backHref="/recipes/champions" />
        <main className="page shell-main">
          <p className="notice" style={{ marginTop: 8 }}>
            {strings.errors.byCode.not_found as string}
          </p>
        </main>
      </>
    );
  }
  const r = entry.recipe;
  const plan = r ? planBrew(r) : null;
  return (
    <>
      <TopBar title={c.yearTitle(entry.year)} backHref="/recipes/champions" />
      <main className="page shell-main">
        <section className="hero">
          {entry.place === 1 && <span className="tag gold" style={{ justifySelf: 'start' }}>{c.winner}</span>}
          <h2 className="hero-name condensed">{entry.name}</h2>
          <p className="muted">{c.placeLong(entry.place, entry.country)}</p>
        </section>

        {r ? (
          <div className="btn-stack">
            <Link href={addHref(entry)} className="btn block">
              {c.add}
            </Link>
            <p className="field-hint">{c.addHint}</p>
          </div>
        ) : (
          <p className="notice">{c.noRecipe}</p>
        )}

        {r && (
          <section className="section">
            <span className="eyebrow">{strings.recipes.detail.setup}</span>
            <dl className="kv-list">
              {SETUP_KEYS.map((key) => (
                <Fragment key={key}>
                  <div className="kv">
                    <dt>{COLUMN_LABELS[key]}</dt>
                    <dd>{formatColumn(key, r[key])}</dd>
                  </div>
                  {key === 'water_g' && formatRatio(r.water_g, r.dose_g) && (
                    <div className="kv">
                      <dt>{strings.recipes.fields.ratio}</dt>
                      <dd>{formatRatio(r.water_g, r.dose_g)}</dd>
                    </div>
                  )}
                </Fragment>
              ))}
              {plan && plan.missing.length === 0 && (
                <div className="kv">
                  <dt>{strings.recipes.detail.plannedTime}</dt>
                  <dd className={plan.fits ? undefined : 'warn-text'}>
                    {formatSeconds(plan.total)} · {plan.fits ? strings.brew.fits : strings.brew.over(formatSeconds(plan.total - WINDOW_S))}
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {r?.other_steps && (
          <section className="section">
            <span className="eyebrow">{c.steps}</span>
            <p className="prose">{r.other_steps}</p>
          </section>
        )}
        {entry.notes && (
          <section className="section">
            <span className="eyebrow">{c.notes}</span>
            <p className="prose">{entry.notes}</p>
          </section>
        )}
        {entry.caveats && (
          <section className="section">
            <span className="eyebrow">{c.caveats}</span>
            <p className="prose muted">{entry.caveats}</p>
          </section>
        )}
        <section className="section">
          <span className="eyebrow">{c.sources}</span>
          <ul className="source-list">
            {entry.sources.map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  {sourceLabel(url)}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}

/** "aeropress.com › 1st-tuomas-merikanto…": the site and the page, short enough for a phone. */
function sourceLabel(url: string): string {
  try {
    const u = new URL(url);
    const page = u.pathname.split('/').filter(Boolean).pop() ?? '';
    return page ? `${u.hostname.replace(/^www\./, '')} › ${decodeURIComponent(page)}` : u.hostname;
  } catch {
    return url;
  }
}
