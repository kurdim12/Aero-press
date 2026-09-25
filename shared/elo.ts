// Elo for recipes, computed on read by replaying revealed duels in order.

export const ELO_START = 1500;
export const ELO_K = 32;

export interface EloDuel {
  id: string;
  recipe_x_id: string;
  recipe_y_id: string;
  /** null means a draw. */
  winner_recipe_id: string | null;
  revealed_at: number;
  bean_id: string | null;
}

export interface Standing {
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  duels: number;
}

export const newStanding = (): Standing => ({ elo: ELO_START, wins: 0, losses: 0, draws: 0, duels: 0 });

/**
 * Replay duels oldest-first (by revealed_at, then id so ties are stable) and return each
 * recipe's rating and win-loss-draw record. A draw scores 0.5. With `beanId`, only duels
 * brewed on that bean count. Duels whose winner is neither recipe are ignored.
 */
export function replayElo(duels: readonly EloDuel[], options: { beanId?: string | null } = {}): Map<string, Standing> {
  const table = new Map<string, Standing>();
  const standing = (id: string) => {
    let s = table.get(id);
    if (!s) {
      s = newStanding();
      table.set(id, s);
    }
    return s;
  };

  const ordered = duels
    .filter((d) => options.beanId == null || d.bean_id === options.beanId)
    .slice()
    .sort((a, b) => a.revealed_at - b.revealed_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const d of ordered) {
    if (d.recipe_x_id === d.recipe_y_id) continue;
    let scoreX: number;
    if (d.winner_recipe_id === null) scoreX = 0.5;
    else if (d.winner_recipe_id === d.recipe_x_id) scoreX = 1;
    else if (d.winner_recipe_id === d.recipe_y_id) scoreX = 0;
    else continue;

    const x = standing(d.recipe_x_id);
    const y = standing(d.recipe_y_id);
    const expectedX = 1 / (1 + 10 ** ((y.elo - x.elo) / 400));
    const delta = ELO_K * (scoreX - expectedX);
    x.elo += delta;
    y.elo -= delta;
    x.duels++;
    y.duels++;
    if (scoreX === 1) {
      x.wins++;
      y.losses++;
    } else if (scoreX === 0) {
      x.losses++;
      y.wins++;
    } else {
      x.draws++;
      y.draws++;
    }
  }
  return table;
}
