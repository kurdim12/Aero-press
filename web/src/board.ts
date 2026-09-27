// The Board's data, team settings, and the owner's backup download.
import { queryOptions } from '@tanstack/react-query';
import { type BoardResponse, EXPORT_PARTS, type ExportPage, type TeamSettings } from '../../shared/types';
import { api } from './api';

/** null = the whole team (owner). Baristas always get their own. */
export const boardQuery = (memberId: string | null) =>
  queryOptions({
    queryKey: ['board', memberId ?? 'team'],
    queryFn: () => api<BoardResponse>('GET', `/api/board${memberId ? `?member=${encodeURIComponent(memberId)}` : ''}`),
    // The Board is the home screen: a minute-old copy is fine, and it spares D1's daily read quota.
    staleTime: 60_000,
  });

export const teamSettingsQuery = queryOptions({
  queryKey: ['team-settings'],
  queryFn: () => api<TeamSettings>('GET', '/api/team'),
});

/**
 * Collect every table page by page and save one JSON file. The Worker only ever builds one
 * page, so this stays inside the Free plan's CPU limit however big the team's history gets.
 */
export async function downloadBackup(onProgress: (part: string, rows: number) => void): Promise<string> {
  const backup: Record<string, unknown> = { app: 'aeropress-lab-team', v: 2, exported_at: new Date().toISOString() };
  for (const part of EXPORT_PARTS) {
    const rows: Record<string, unknown>[] = [];
    let after: string | null = null;
    do {
      const page: ExportPage = await api<ExportPage>(
        'GET',
        `/api/export?part=${part}${after ? `&after=${encodeURIComponent(after)}` : ''}`,
        undefined,
        { timeoutMs: 30_000 },
      );
      rows.push(...page.rows);
      after = page.next;
      onProgress(part, rows.length);
    } while (after);
    backup[part] = part === 'team' ? (rows[0] ?? null) : rows;
  }
  const name = `aeropress-lab-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}
