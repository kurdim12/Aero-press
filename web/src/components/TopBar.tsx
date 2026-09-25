import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { useMe } from '../session';
import { strings } from '../strings';
import { BackIcon } from './Icons';

interface TopBarProps {
  title: string;
  /** Where the back arrow goes. Tab roots have no back arrow. */
  backHref?: string;
  /** Hide the avatar (used on the settings screens themselves). */
  hideAvatar?: boolean;
  actions?: ReactNode;
}

export function TopBar({ title, backHref, hideAvatar, actions }: TopBarProps) {
  const me = useMe();
  return (
    <header className="topbar">
      <div className="page topbar-inner">
        {backHref && (
          <Link href={backHref} className="icon-btn" aria-label={strings.common.back} style={{ marginLeft: -10 }}>
            <BackIcon />
          </Link>
        )}
        <h1 className="topbar-title">{title}</h1>
        {actions}
        {!hideAvatar && (
          <Link href="/settings" className="icon-btn" aria-label={strings.shell.openSettings} style={{ marginRight: -4 }}>
            <span className="avatar" style={{ width: 38, height: 38, fontSize: 15 }}>
              {me.member.initials}
            </span>
          </Link>
        )}
      </div>
    </header>
  );
}
