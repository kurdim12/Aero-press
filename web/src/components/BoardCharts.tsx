// The Board's charts (Recharts). Loaded on their own, so the rest of the app opens without them.
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { EloSeries, WeeklyScore } from '../../../shared/types';
import { SERIES_COLORS } from '../chartColors';
import { formatDate } from '../format';
import { strings } from '../strings';

const b = strings.board;

const axis = { fontSize: 12, fill: 'var(--ink-3)' };
const tooltipStyle = {
  contentStyle: { background: 'var(--bg-raised)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13 },
  labelStyle: { color: 'var(--ink-2)' },
};
const dayLabel = (day: string) => formatDate(Date.parse(`${day}T12:00:00Z`));

export function EloChart({ series }: { series: EloSeries[] }) {
  const all = series.flatMap((s) => s.points);
  const lo = Math.min(...all.map((p) => p.elo));
  const hi = Math.max(...all.map((p) => p.elo));
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(t: number) => formatDate(t)}
          tick={axis}
          tickLine={false}
          axisLine={false}
          minTickGap={24}
        />
        <YAxis domain={[Math.floor((lo - 10) / 10) * 10, Math.ceil((hi + 10) / 10) * 10]} tick={axis} tickLine={false} axisLine={false} width={48} />
        <Tooltip {...tooltipStyle} labelFormatter={(t) => formatDate(Number(t))} />
        {series.map((s, i) => (
          <Line
            key={s.recipe.id}
            data={s.points}
            dataKey="elo"
            name={s.recipe.display_code}
            stroke={SERIES_COLORS[i]}
            strokeWidth={2.5}
            dot={{ r: 3 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function WeeklyChart({ weeks }: { weeks: WeeklyScore[] }) {
  const values = weeks.map((w) => w.avg_overall);
  const lo = Math.max(1, Math.floor(Math.min(...values) - 0.5));
  const hi = Math.min(10, Math.ceil(Math.max(...values) + 0.5));
  return (
    <ResponsiveContainer width="100%" height={170}>
      <LineChart data={weeks} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis dataKey="week" tickFormatter={dayLabel} tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis domain={[lo, hi]} allowDecimals={false} tick={axis} tickLine={false} axisLine={false} width={40} />
        <Tooltip {...tooltipStyle} labelFormatter={(w) => b.weekOf(dayLabel(String(w)))} />
        <Line dataKey="avg_overall" name={b.overall} stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ActivityChart({ days, brews, duels }: { days: string[]; brews: number[]; duels: number[] }) {
  const data = days.map((day, i) => ({ day, brews: brews[i] ?? 0, duels: duels[i] ?? 0 }));
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -24 }} barCategoryGap={2}>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis dataKey="day" tickFormatter={dayLabel} tick={axis} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} width={36} />
        <Tooltip {...tooltipStyle} labelFormatter={(d) => dayLabel(String(d))} cursor={{ fill: 'var(--accent-soft)' }} />
        <Bar dataKey="brews" name={b.activityLegend.brews} stackId="a" fill="var(--ink-3)" isAnimationActive={false} />
        <Bar dataKey="duels" name={b.activityLegend.duels} stackId="a" fill="var(--accent)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
