import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { KNOWLEDGE, type KnowledgeSection } from '../../../shared/knowledge';
import { teamSettingsQuery } from '../board';
import { TopBar } from '../components/TopBar';
import { useIsOwner } from '../session';
import { strings } from '../strings';

const k = strings.knowledge;

/** /coach/knowledge: the reference behind every coach answer, and the owner's house rules. */
export function KnowledgeScreen() {
  const isOwner = useIsOwner();
  const settings = useQuery(teamSettingsQuery);
  const rules = settings.data?.coach_rules ?? null;
  return (
    <>
      <TopBar title={k.title} backHref="/coach" />
      <main className="page shell-main">
        <p className="muted" style={{ marginTop: 8 }}>
          {k.intro}
        </p>

        <section className="section">
          <span className="eyebrow">{k.houseRules}</span>
          {settings.data && (rules ? <p className="house-rules">{rules}</p> : <p className="muted small">{k.houseRulesNone}</p>)}
          {isOwner && settings.data && (
            <Link href="/settings/team" className="btn secondary compact">
              {rules ? k.houseRulesEdit : k.houseRulesAdd}
            </Link>
          )}
        </section>

        <section className="section">
          <span className="eyebrow">{k.reference}</span>
          <div className="knowledge-list">
            {KNOWLEDGE.map((section) => (
              <KnowledgeItem key={section.id} section={section} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function KnowledgeItem({ section }: { section: KnowledgeSection }) {
  return (
    <details className="knowledge">
      <summary>
        <span className="knowledge-title">{section.title}</span>
        <span className="row-sub">{section.summary}</span>
      </summary>
      <div className="knowledge-body">
        {toBlocks(section.body).map((block, i) =>
          block.kind === 'list' ? (
            <ul key={i}>
              {block.lines.map((line, j) => (
                <li key={j}>{line}</li>
              ))}
            </ul>
          ) : (
            <p key={i} className={block.kind === 'head' ? 'knowledge-head' : undefined}>
              {block.lines[0]}
            </p>
          ),
        )}
        {section.sources.length > 0 && (
          <>
            <h3 className="eyebrow">{k.sources}</h3>
            <ul className="knowledge-sources">
              {section.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.label}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </details>
  );
}

interface Block {
  kind: 'head' | 'text' | 'list';
  lines: string[];
}

/**
 * The reference's plain text as blocks: runs of "- " lines become a list, a line ending in a
 * colon introduces what follows, and any other line is a paragraph.
 */
function toBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const last = blocks[blocks.length - 1];
    if (line.startsWith('- ')) {
      if (last?.kind === 'list') last.lines.push(line.slice(2));
      else blocks.push({ kind: 'list', lines: [line.slice(2)] });
    } else {
      blocks.push({ kind: line.endsWith(':') ? 'head' : 'text', lines: [line] });
    }
  }
  return blocks;
}
