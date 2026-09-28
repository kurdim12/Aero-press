// What every coach call is taught: the sections of the coffee reference (shared/knowledge.ts)
// that fit its job, and the owner's house rules. client.ts adds both to the call's own system
// prompt, so no call can go out without them.
import { KNOWLEDGE, type KnowledgeId } from '../../../shared/knowledge';
import type { TipsSubject } from '../../../shared/types';
import type { AiKind } from './config';

/** Each job's sections, most useful first. Quick log only parses a note, so it gets none. */
export const KIND_SECTIONS: Record<AiKind, readonly KnowledgeId[]> = {
  plan: ['method', 'extraction', 'temperature', 'grind', 'ratio', 'aeropress', 'troubleshooting', 'podium'],
  adapt: ['method', 'beans', 'process', 'roast', 'temperature', 'grind', 'ratio', 'troubleshooting'],
  today: ['method', 'competition'],
  readiness: ['competition', 'method', 'sensory', 'troubleshooting', 'water'],
  ask: ['method', 'extraction', 'troubleshooting'],
  duelRead: ['sensory', 'troubleshooting', 'extraction', 'method'],
  beanTips: ['beans', 'process', 'roast', 'temperature', 'grind', 'method'],
  recipeTips: ['extraction', 'temperature', 'grind', 'ratio', 'aeropress', 'troubleshooting'],
  compare: ['extraction', 'temperature', 'grind', 'ratio', 'aeropress', 'podium'],
  championRead: ['podium', 'aeropress', 'ratio', 'temperature', 'grind', 'water'],
  quickLog: [],
  brewRead: ['extraction', 'troubleshooting'],
};

/** Most sections one question brings in, so an answer stays affordable. */
const ASK_MAX = 8;
/** When a question names nothing in particular: the brewing basics. */
const ASK_DEFAULT: readonly KnowledgeId[] = ['temperature', 'grind', 'aeropress'];
/** What a question about one bean or one recipe needs besides the basics. */
const ASK_ABOUT: Record<TipsSubject, readonly KnowledgeId[]> = {
  bean: ['beans', 'process', 'roast', 'temperature', 'grind'],
  recipe: ['temperature', 'grind', 'ratio', 'aeropress'],
};

/**
 * The sections for "Ask the coach": the basics, then every section whose words appear in the
 * question (English or Arabic), then what the bean or recipe it's about needs.
 */
export function askSections(question: string, about?: TipsSubject): KnowledgeId[] {
  // Words only, space-separated, so a keyword like " rest" matches "resting" but not "interest".
  const text = ` ${question.toLowerCase().replace(/[^\p{L}\p{N}°µ:]+/gu, ' ')} `;
  const picked: KnowledgeId[] = [...KIND_SECTIONS.ask];
  const add = (id: KnowledgeId) => {
    if (!picked.includes(id) && picked.length < ASK_MAX) picked.push(id);
  };
  const matched = KNOWLEDGE.filter((s) => s.keywords.some((k) => text.includes(k))).map((s) => s.id);
  for (const id of matched) add(id);
  for (const id of about ? ASK_ABOUT[about] : []) add(id);
  if (picked.length === KIND_SECTIONS.ask.length) for (const id of ASK_DEFAULT) add(id);
  return picked;
}

/** The reference sections as the coach reads them: title and text, in the order asked. */
export function referenceBlock(ids: readonly KnowledgeId[]): string {
  const sections = ids.map((id) => KNOWLEDGE.find((s) => s.id === id)).filter((s) => s !== undefined);
  const body = sections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n');
  return `<reference>
The team's coffee reference, checked against published sources. Reason from it and use its numbers. The team's own results outrank it for their coffees; when your general knowledge disagrees with it, follow the reference.

${body}
</reference>`;
}

/** The owner's house rules: limits every answer must respect. */
export const houseRulesBlock = (rules: string) => `<house_rules>
The team owner set these rules. Every suggestion must respect them; they override the reference and your own defaults. If a rule rules out what the coffee needs, say so and give the best option within the rules.
${rules}
</house_rules>`;

/** A call's system prompt as sent: its own, then its reference sections, then the house rules. */
export function withReference(system: string, sections: readonly KnowledgeId[], rules: string | null): string {
  return [system, sections.length > 0 ? referenceBlock(sections) : null, rules ? houseRulesBlock(rules) : null].filter(Boolean).join('\n\n');
}
