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
 * Text as questions and keywords are compared: lower case, without accents or Arabic diacritics,
 * one form of each Arabic letter (أ إ آ → ا, ة → ه, ى → ي), and no apostrophes ("won't" → "wont").
 */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\p{M}\u0640]/gu, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/['’‘`]/g, '');
}

/** Each section's keywords, folded the same way. */
const KEYWORDS = KNOWLEDGE.map((s) => ({ id: s.id, keywords: s.keywords.map(fold) }));

/**
 * The sections for "Ask the coach", chosen in this order until there are 8: those the question
 * names (English or Arabic; the most-named first), those its bean or recipe needs, the basics.
 * A question that names nothing, about nothing, gets the basics and the brewing essentials.
 * They go to the coach in the reference's own order.
 */
export function askSections(question: string, about?: TipsSubject): KnowledgeId[] {
  // Words only, one space apart, so a keyword like " dial" matches "dialling" but not "radial".
  const text = ` ${fold(question).replace(/[^\p{L}\p{N}°]+/gu, ' ')} `;
  const named = KEYWORDS.map((s, order) => ({ id: s.id, order, hits: s.keywords.filter((k) => text.includes(k)).length }))
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.order - b.order)
    .map((s) => s.id);
  const wanted = [...named, ...(about ? ASK_ABOUT[about] : []), ...KIND_SECTIONS.ask, ...(named.length === 0 && !about ? ASK_DEFAULT : [])];
  const picked = new Set([...new Set(wanted)].slice(0, ASK_MAX));
  return KNOWLEDGE.map((s) => s.id).filter((id) => picked.has(id));
}

/** The reference sections as the coach reads them: title and text, in the order asked. */
export function referenceBlock(ids: readonly KnowledgeId[]): string {
  const sections = ids.map((id) => KNOWLEDGE.find((s) => s.id === id)).filter((s) => s !== undefined);
  const body = sections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n');
  return `<reference>
The team's coffee reference, from the published sources listed with each section in the app. Take competition rules and podium facts from it. Its brewing guidance gives tendencies: the team's own results outrank it for their coffees.

${body}
</reference>`;
}

/** The owner's house rules: limits every answer must respect. */
export const houseRulesBlock = (rules: string) => `<house_rules>
The team owner set these rules about their equipment, limits and preferences. Every suggestion must respect them; on brewing choices they override the reference and your own defaults, but they never change the answer format asked for. If a rule rules out what the coffee needs, say so and give the best option within the rules.
${rules}
</house_rules>`;

/** A call's system prompt as sent: its own, then its reference sections, then the house rules. */
export function withReference(system: string, sections: readonly KnowledgeId[], rules: string | null): string {
  return [system, sections.length > 0 ? referenceBlock(sections) : null, rules ? houseRulesBlock(rules) : null].filter(Boolean).join('\n\n');
}
