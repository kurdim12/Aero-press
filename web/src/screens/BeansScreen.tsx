import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { BeanRow } from '../../../shared/types';
import { daysOffRoast } from '../../../shared/formulas';
import { errorMessage } from '../api';
import { FormError } from '../components/Fields';
import { TopBar } from '../components/TopBar';
import { beansQuery } from '../queries';
import { strings } from '../strings';

const s = strings.beans;

export function BeansScreen() {
  const beans = useQuery(beansQuery);
  return (
    <>
      <TopBar
        title={s.title}
        actions={
          <Link href="/beans/new" className="btn compact">
            {s.add}
          </Link>
        }
      />
      <main className="page shell-main">
        {beans.isPending && (
          <div className="center-block">
            <div className="spinner" role="status" aria-label={strings.app.loading} />
          </div>
        )}
        {beans.isError && <FormError>{errorMessage(beans.error)}</FormError>}
        {beans.data &&
          (beans.data.beans.length === 0 ? (
            <section className="empty">
              <h2>{s.emptyTitle}</h2>
              <p>{s.emptyBody}</p>
            </section>
          ) : (
            <ul className="rows list-section">
              {beans.data.beans.map((bean) => (
                <BeanItem key={bean.id} bean={bean} />
              ))}
            </ul>
          ))}
      </main>
    </>
  );
}

function BeanItem({ bean }: { bean: BeanRow }) {
  const days = daysOffRoast(bean.roast_date);
  const details = [bean.roaster, bean.origin, bean.process].filter(Boolean).join(' · ');
  return (
    <li>
      <Link href={`/beans/${bean.id}`} className="row">
        <span className="row-main">
          <span className="row-title">{bean.name}</span>
          {bean.is_competition_coffee && (
            <span className="tag gold" style={{ margin: '4px 0 2px' }}>
              {s.competition}
            </span>
          )}
          {details && <span className="row-sub">{details}</span>}
          <span className="row-sub">{s.brews(bean.brew_count)}</span>
        </span>
        <span className="stat-cell">
          {days === null ? (
            <span className="stat-label">{s.noRoastDate}</span>
          ) : (
            <>
              <span className="stat-num condensed">{Math.abs(days)}</span>
              <span className="stat-label">{s.daysOffLabel(days)}</span>
            </>
          )}
        </span>
      </Link>
    </li>
  );
}
