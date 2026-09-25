import { TopBar } from '../components/TopBar';
import { strings } from '../strings';

type Section = 'duel' | 'coach';

/** Placeholder for tabs that later phases fill in. */
export function ComingSoonScreen({ section }: { section: Section }) {
  const copy = strings.comingSoon[section];
  return (
    <>
      <TopBar title={copy.title} />
      <main className="page shell-main">
        <section className="empty">
          <span className="tag accent">{strings.comingSoon.label}</span>
          <p style={{ marginTop: 12 }}>{copy.body}</p>
        </section>
      </main>
    </>
  );
}
