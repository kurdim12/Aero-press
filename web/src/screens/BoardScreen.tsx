import { Suspense, lazy, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { BoardRecipe, BoardResponse, ReadinessItem, VolumeMember } from '../../../shared/types';
import { modelLabel } from '../../../shared/aiModels';
import { UNRELIABLE_OVERALL_SD, UNRELIABLE_TDS_SD } from '../../../shared/dashboard';
import { boardQuery } from '../board';
import { SERIES_COLORS } from '../chartColors';
import { errorMessage } from '../api';
import { FormError, SelectField } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { formatNumber } from '../format';
import { useOnline } from '../offline/useOnline';
import { membersQuery, useIsOwner, useMe } from '../session';
import { strings } from '../strings';
import { TodayCard } from './CoachScreen';

const s = strings.board;
const charts = () => import('../components/BoardCharts');
const EloChart = lazy(() => charts().then((m) => ({ default: m.EloChart })));
const WeeklyChart = lazy(() => charts().then((m) => ({ default: m.WeeklyChart })));
const ActivityChart = lazy(() => charts().then((m) => ({ default: m.ActivityChart })));

/** The Board: the owner's team dashboard (or one member's), and each barista's own. */
export function BoardScreen() {
  const me = useMe();
  const isOwner = useIsOwner();
  const online = useOnline();
  const members = useQuery({ ...membersQuery, enabled: isOwner });
  const [memberId, setMemberId] = useState<string | null>(null);
  const board = useQuery(boardQuery(isOwner ? memberId : me.member.id));
  const needsBaristas = isOwner && members.data !== undefined && !members.data.members.some((m) => m.role === 'barista' && m.active);
  const activeMembers = members.data?.members.filter((m) => m.active) ?? [];

  return (
    <>
      <TopBar title={s.title} />
      <main className="page shell-main">
        <p className="eyebrow" style={{ marginTop: 8 }}>
          {me.team.name}
        </p>
        <h2 className="hello condensed">{s.greeting(me.member.name)}</h2>

        {needsBaristas && (
          <section className="callout">
            <h2>{s.addTeamTitle}</h2>
            <p className="muted">{s.addTeamBody}</p>
            <Link href="/settings/members" className="btn block">
              {s.addTeamAction}
            </Link>
          </section>
        )}

        {isOwner && activeMembers.length > 1 && (
          <div className="section board-picker">
            <SelectField
              label={s.whose}
              value={memberId ?? ''}
              onChange={(v) => setMemberId(v || null)}
              options={[{ value: '', label: s.team }, ...activeMembers.map((m) => ({ value: m.id, label: m.name }))]}
            />
          </div>
        )}

        {board.data ? (
          <Board data={board.data} isOwner={isOwner} online={online} />
        ) : board.isError ? (
          <div className="section">
            <FormError>{online ? errorMessage(board.error) : s.offline}</FormError>
          </div>
        ) : (
          <div className="center-block">
            <div className="spinner" role="status" aria-label={strings.app.loading} />
          </div>
        )}
      </main>
    </>
  );
}

function Board({ data, isOwner, online }: { data: BoardResponse; isOwner: boolean; online: boolean }) {
  const me = useMe();
  const personal = data.view.member_id !== null;
  // Today's duels are the signed-in member's own card: not shown on someone else's board.
  const ownBoard = !personal || data.view.member_id === me.member.id;
  return (
    <>
      <Countdown champ={data.champ} isOwner={isOwner} />
      {ownBoard && <TodayCard enabled={online && data.ai.configured && data.ai.month_spend_usd < data.ai.cap_usd} quiet />}
      <Readiness items={data.readiness} locked={data.locked_recipe} />
      <TopRecipe recipe={data.top_recipe} view={data.view} />
      <Progress data={data} />
      <Consistency rows={data.consistency} />
      <Activity volume={data.volume} personal={personal} />
      <Leaderboard entries={data.leaderboard} />
      <AiSpend ai={data.ai} isOwner={isOwner} />
    </>
  );
}

function Countdown({ champ, isOwner }: { champ: BoardResponse['champ']; isOwner: boolean }) {
  if (champ.days_left === null) {
    return (
      <section className="countdown muted-card">
        <p className="muted">{s.noDate}</p>
        {isOwner && (
          <Link href="/settings/team" className="link-inline">
            {s.setDate}
          </Link>
        )}
      </section>
    );
  }
  const days = champ.days_left;
  return (
    <section className="countdown" aria-live="polite">
      {days > 0 ? (
        <>
          <span className="countdown-num condensed">{days}</span>
          <span className="countdown-label">
            <strong>{s.daysLeft(days)}</strong> {s.toChamp(champ.name)}
          </span>
        </>
      ) : (
        <span className="countdown-label">
          <strong>{days === 0 ? s.champToday : s.champPast(champ.name)}</strong>
        </span>
      )}
    </section>
  );
}

function Readiness({ items, locked }: { items: ReadinessItem[]; locked: BoardRecipe | null }) {
  const counted = items.filter((i) => i.applicable);
  const done = counted.filter((i) => i.done).length;
  const detail = (item: ReadinessItem): string => {
    const d = s.readinessDetail;
    if (!item.applicable) return d.noComp;
    switch (item.key) {
      case 'locked':
        return d.locked(locked?.display_code ?? null);
      case 'wins':
        return locked ? `${d.wins(item.value)} · ${s.readinessScore(Math.min(item.value, item.target), item.target)}` : d.needsLock;
      case 'beans':
        return locked ? `${d.beans(item.value)} · ${s.readinessScore(Math.min(item.value, item.target), item.target)}` : d.needsLock;
      case 'timed':
        return locked ? `${d.timed(item.value)} · ${s.readinessScore(Math.min(item.value, item.target), item.target)}` : d.needsLock;
      case 'comp_duel':
        return d.comp_duel(item.value);
    }
  };
  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">{s.readiness}</span>
        <span className={`tag ${done === counted.length ? 'accent' : ''}`}>{s.readinessScore(done, counted.length)}</span>
      </div>
      <ul className="checklist">
        {items.map((item) => (
          <li key={item.key} className={item.done ? 'done' : item.applicable ? undefined : 'na'}>
            <span className="check" aria-hidden="true">
              {item.done ? '✓' : item.applicable ? '' : '–'}
            </span>
            <span className="row-main">
              <span className="row-title">{s.readinessItems[item.key]}</span>
              <span className="row-sub">{detail(item)}</span>
            </span>
            <span className="visually-hidden">{item.done ? '✓' : '✗'}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const record = (r: BoardRecipe) => strings.recipes.record(r);

function TopRecipe({ recipe, view }: { recipe: BoardRecipe | null; view: BoardResponse['view'] }) {
  const me = useMe();
  const title = view.member_id === null ? s.topRecipe : view.member_id === me.member.id ? s.myTopRecipe : s.theirTopRecipe(view.name ?? '');
  return (
    <section className="section">
      <span className="eyebrow">{title}</span>
      {recipe ? (
        <Link href={`/recipes/${recipe.id}`} className="top-recipe">
          <span className="row-main">
            <span className="row-title">
              <span className="code">{recipe.display_code}</span>
              {recipe.name ?? strings.recipes.untitled}
            </span>
            <span className="row-sub">{strings.recipes.detail.by(recipe.owner_name)}</span>
          </span>
          <span className="stat-cell">
            <span className="stat-num condensed gold">{recipe.elo}</span>
            <span className="stat-label">{record(recipe)}</span>
          </span>
        </Link>
      ) : (
        <p className="muted">{s.noTop}</p>
      )}
    </section>
  );
}

function ChartFallback({ height }: { height: number }) {
  return <div className="chart-fallback" style={{ height }} />;
}

function Progress({ data }: { data: BoardResponse }) {
  const series = data.elo_series.filter((x) => x.points.length > 0);
  return (
    <section className="section">
      <span className="eyebrow">{s.progress}</span>
      <h3 className="subhead">{s.eloOverTime}</h3>
      {series.length > 0 ? (
        <figure className="chart" aria-label={s.eloOverTime}>
          <Suspense fallback={<ChartFallback height={200} />}>
            <EloChart series={series} />
          </Suspense>
          <figcaption className="legend">
            {series.map((x, i) => (
              <span key={x.recipe.id}>
                <i style={{ background: SERIES_COLORS[i] }} />
                {s.eloSummary(x.recipe.display_code, x.points[0]!.elo, x.points.at(-1)!.elo, x.points.length)}
              </span>
            ))}
          </figcaption>
        </figure>
      ) : (
        <p className="muted">{s.eloEmpty}</p>
      )}
      <h3 className="subhead">{s.weekly}</h3>
      {data.weekly.length > 0 ? (
        <figure className="chart" aria-label={s.weekly}>
          <Suspense fallback={<ChartFallback height={170} />}>
            <WeeklyChart weeks={data.weekly} />
          </Suspense>
        </figure>
      ) : (
        <p className="muted">{s.weeklyEmpty}</p>
      )}
    </section>
  );
}

function Consistency({ rows }: { rows: BoardResponse['consistency'] }) {
  return (
    <section className="section">
      <span className="eyebrow">{s.consistency}</span>
      <p className="field-hint">{s.consistencyHint(formatNumber(UNRELIABLE_TDS_SD), formatNumber(UNRELIABLE_OVERALL_SD))}</p>
      {rows.length === 0 ? (
        <p className="muted">{s.consistencyEmpty}</p>
      ) : (
        <ul className="rows">
          {rows.map((row) => (
            <li key={row.recipe.id}>
              <Link href={`/recipes/${row.recipe.id}`} className="row">
                <span className="row-main">
                  <span className="row-title">
                    <span className="code">{row.recipe.display_code}</span>
                    {row.recipe.name ?? strings.recipes.untitled}
                  </span>
                  <span className="row-sub">
                    {s.spread(row.tds_sd === null ? null : formatNumber(row.tds_sd, 3), row.overall_sd === null ? null : formatNumber(row.overall_sd, 2))} ·{' '}
                    {s.brewsCount(row.brews)}
                  </span>
                </span>
                <span className={`tag ${row.unreliable ? 'warn' : 'accent'}`}>{row.unreliable ? s.unreliable : s.steady}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Activity({ volume, personal }: { volume: BoardResponse['volume']; personal: boolean }) {
  const sum = (key: 'brews' | 'duels') => volume.days.map((_, i) => volume.members.reduce((t, m) => t + (m[key][i] ?? 0), 0));
  const brews = sum('brews');
  const duels = sum('duels');
  const any = brews.some((n) => n > 0) || duels.some((n) => n > 0);
  return (
    <section className="section">
      <span className="eyebrow">{s.activity}</span>
      {!any && <p className="muted">{s.activityEmpty}</p>}
      <figure className="chart" aria-label={s.activity} hidden={!any}>
        <Suspense fallback={<ChartFallback height={150} />}>
          {any && <ActivityChart days={volume.days} brews={brews} duels={duels} />}
        </Suspense>
        <figcaption className="legend">
          <span>
            <i style={{ background: 'var(--ink-3)' }} />
            {s.activityLegend.brews}
          </span>
          <span>
            <i style={{ background: 'var(--accent)' }} />
            {s.activityLegend.duels}
          </span>
        </figcaption>
      </figure>
      <ul className="rows">
        {volume.members.map((m) => (
          <MemberVolume key={m.member_id} member={m} showName={!personal} />
        ))}
      </ul>
    </section>
  );
}

function MemberVolume({ member: m, showName }: { member: VolumeMember; showName: boolean }) {
  const brews = m.brews.reduce((a, b) => a + b, 0);
  const duels = m.duels.reduce((a, b) => a + b, 0);
  const peak = Math.max(1, ...m.brews.map((v, i) => v + (m.duels[i] ?? 0)));
  const stale = m.days_since === null || m.days_since >= 7;
  return (
    <li className="row volume-row">
      {showName && <span className="avatar small">{m.initials}</span>}
      <span className="row-main">
        {showName && <span className="row-title">{m.name}</span>}
        <span className="row-sub">{s.memberVolume(brews, duels)}</span>
        <span className={`row-sub${stale ? ' warn-text' : ''}`}>{s.lastActive(m.days_since)}</span>
      </span>
      <span className="spark" aria-hidden="true">
        {m.brews.map((v, i) => {
          const d = m.duels[i] ?? 0;
          return (
            <span key={i} className="spark-day">
              <span className="spark-duels" style={{ height: `${(d / peak) * 100}%` }} />
              <span className="spark-brews" style={{ height: `${(v / peak) * 100}%` }} />
            </span>
          );
        })}
      </span>
    </li>
  );
}

function Leaderboard({ entries }: { entries: BoardResponse['leaderboard'] }) {
  return (
    <section className="section">
      <span className="eyebrow">{s.leaderboard}</span>
      <p className="field-hint">{s.leaderboardHint}</p>
      <ul className="rows">
        {entries.map((e, i) => (
          <li key={e.member_id}>
            <div className="row">
              <span className="rank condensed">{strings.recipes.rank(i + 1)}</span>
              <span className="row-main">
                <span className="row-title">{e.name}</span>
                <span className="row-sub">
                  {e.recipe ? `${e.recipe.display_code} ${e.recipe.name ?? ''} · ${record(e.recipe)}`.trim() : s.noRecipeYet}
                </span>
              </span>
              <span className="stat-cell">
                <span className={`stat-num condensed${i === 0 && e.recipe ? ' gold' : ''}`}>{e.recipe?.elo ?? '—'}</span>
                <span className="stat-label">{strings.recipes.elo}</span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AiSpend({ ai, isOwner }: { ai: BoardResponse['ai']; isOwner: boolean }) {
  const pct = ai.cap_usd > 0 ? Math.min(100, (ai.month_spend_usd / ai.cap_usd) * 100) : 100;
  return (
    <section className="section">
      <span className="eyebrow">{s.ai}</span>
      {ai.configured ? (
        <>
          <p className="ai-line">
            <strong>{s.aiLine(strings.coach.money(ai.month_spend_usd), strings.coach.money(ai.cap_usd))}</strong>
            <span className="muted"> · {s.aiCalls(ai.calls)}</span>
          </p>
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={ai.cap_usd} aria-valuenow={ai.month_spend_usd} aria-label={s.ai}>
            <span className={pct >= 90 ? 'warn' : undefined} style={{ width: `${pct}%` }} />
          </div>
          {ai.models && <p className="muted small" style={{ marginTop: 8 }}>{s.aiModel(modelLabel(ai.models.coach))}</p>}
        </>
      ) : (
        <p className="muted">{s.aiNotConfigured}</p>
      )}
      {isOwner && (
        <Link href="/settings/team" className="link-inline" style={{ display: 'inline-block', marginTop: 10 }}>
          {s.aiChange}
        </Link>
      )}
    </section>
  );
}
