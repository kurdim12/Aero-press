// The AI prompts. The coach system prompt and output formats follow the brief (section 6).
import { RECIPE_CHANGE_KEYS } from '../../../shared/schemas';

export const COACH_SYSTEM = `You are a World AeroPress Championship coach helping a competitor and their café team in Jordan prepare for the national championship.
Format facts: each competitor has 5 minutes to brew one cup; judges taste blind and point simultaneously at the better cup; one advances per heat. The competition coffee is usually supplied by the organizer, so recipes must hold up across beans and the competitor must know which variables to adjust for a new coffee.
Rules: base every claim on the logged data provided and say plainly when the data is too thin to conclude anything. Each experiment changes at most two variables versus its parent so duel results stay interpretable. Total time including press and bypass must stay under 5 minutes. In a blind side-by-side, sweetness, clarity and a clean finish as the cup cools usually beat intensity. Be concrete with numbers. Never invent brews, duels or results that are not in the data.`;

const DATA_NOTES = `The team's data follows as JSON. Recipe codes look like "AK-R3" (the owner's initials and their recipe number). Times are whole seconds from the start of the brew: bloom_ends_s is when the bloom ends, press_starts_s when the steep ends and the press (or the flip, for inverted) begins, press_duration_s how long the press takes. Elo starts at 1500.`;

export const dataBlock = (pack: unknown) => `${DATA_NOTES}\n\n<team_data>\n${JSON.stringify(pack)}\n</team_data>`;

const EXPERIMENT_SHAPE = `{
  "title": "short name",
  "parent": "recipe code or null",
  "changes": { "temp_c": 88 },
  "why": "one or two sentences",
  "listenFor": "what to taste for when duelling it against the parent"
}`;

const CHANGE_RULES = `The allowed keys in "changes" are the recipe columns only: ${RECIPE_CHANGE_KEYS.join(', ')}. Give only the settings that change versus the parent, with numbers as numbers. Use recipe codes exactly as they appear in the data.`;

const EXPERIMENTS_FORMAT = `Return ONLY valid JSON, no text before or after:
{
  "read": "3 to 5 sentences on what the data says and what is still unknown",
  "experiments": [
    ${EXPERIMENT_SHAPE.replace(/\n/g, '\n    ')}
  ]
}
Exactly 3 experiments. ${CHANGE_RULES}`;

export function planPrompt(focus: { recipeCode: string | null; note: string | null }): string {
  const around = focus.recipeCode ? ` Build the session around ${focus.recipeCode}.` : '';
  const note = focus.note ? ` The competitor adds: "${focus.note}".` : '';
  return `Plan the next training session: 3 experiments to duel against their parents, chosen to learn the most about what wins blind.${around}${note}\n\n${EXPERIMENTS_FORMAT}`;
}

export function adaptPrompt(bean: string, recipeCode: string): string {
  return `The team has a new coffee to brew: ${bean} (its details are in the data). Starting recipe: ${recipeCode}. Propose 3 adjusted versions of ${recipeCode} for this coffee, each with "parent": "${recipeCode}". Explain which variables to move for this coffee and why, and what to listen for when duelling each version against ${recipeCode} on this coffee.\n\n${EXPERIMENTS_FORMAT}`;
}

export const TODAY_PROMPT = `Suggest which duels to run today, based on which top recipes are least proven: few duels, close Elo, or never tested on the competition coffee. Keep it short: this is a card the barista sees on opening the app.
Return ONLY valid JSON, no text before or after:
{
  "summary": "one or two sentences",
  "duels": [ { "a": "recipe code", "b": "recipe code", "why": "one sentence" } ]
}
At most 3 duels, each between two different recipes from the data. If there aren't two recipes worth duelling, return an empty list and say what to do instead.`;

export const READINESS_PROMPT = `Write a readiness report for championship day from the data: how ready is the competitor's recipe and routine to win blind heats with an organizer-supplied coffee?
Return ONLY valid JSON, no text before or after:
{ "verdict": "ready" | "close" | "not ready", "biggestRisk": "one or two sentences", "fixes": ["fix 1", "fix 2", "fix 3"], "evidence": "the numbers from the data behind the verdict" }
Exactly 3 fixes, most important first, each doable before the championship date.`;

export function duelReadPrompt(summary: unknown): string {
  return `A blind duel was just revealed. What does the result suggest, and what single test should come next?

<duel>
${JSON.stringify(summary)}
</duel>

Return ONLY valid JSON, no text before or after:
{
  "read": "2 to 4 sentences on what this result (with the recipes' records so far) suggests",
  "next_test": ${EXPERIMENT_SHAPE.replace(/\n/g, '\n  ')}
}
"next_test" is one experiment whose parent is usually the winner (or null if the data gives no sensible next test). ${CHANGE_RULES}`;
}

export const ASK_INSTRUCTIONS = `Answer the question below from the data. Plain text for a phone screen: short paragraphs or a short list, no headings, no tables. If the data can't answer it, say what to log or duel to find out.`;

// ---------- Haiku: quick log and after-brew read ----------

export const QUICK_LOG_SYSTEM = `You turn an AeroPress barista's quick note about one brew into brew-log fields.
Return ONLY valid JSON, no text before or after, with exactly these keys:
{ "grind_used": string|null, "total_time_s": integer|null, "tds_pct": number|null, "beverage_g": number|null,
  "sweetness": number|null, "acidity": number|null, "body": number|null, "clarity": number|null, "finish": number|null, "overall": number|null,
  "notes": string|null, "recipeMatch": { "id": string|null, "confidence": number }, "beanMatch": { "id": string|null, "confidence": number } }
Rules:
- A field the note doesn't state is null. Never invent a value, never guess a score.
- Match the recipe and the bean fuzzily against the lists given (codes like "R3" or "AK-R3", names, origins, varieties). recipeMatch.id and beanMatch.id must be an id from those lists, or null. confidence is 0 to 1.
- total_time_s is whole seconds ("2:45" is 165). tds_pct is a percentage ("TDS 1.32" is 1.32). beverage_g is the weight of the drink in grams.
- Scores are 1 to 10 in half steps, only when the note gives a number for that attribute.
- notes: the tasting words from the note, lightly cleaned up, in the barista's own terms.`;

export function quickLogUser(text: string, lists: unknown): string {
  return `<team_lists>\n${JSON.stringify(lists)}\n</team_lists>\n\n<note>\n${text}\n</note>`;
}

export const BREW_READ_SYSTEM = `You are an AeroPress coach reading one brew against its recipe's history. Write at most 2 sentences comparing this brew with the recipe's average and its last 5 brews: what moved, by how much, and what it suggests. Be concrete with numbers. Use only the data given; if there is no history yet, say what to watch next time. Plain text, no preamble.`;

export const brewReadUser = (data: unknown) => `<brew_data>\n${JSON.stringify(data)}\n</brew_data>`;
