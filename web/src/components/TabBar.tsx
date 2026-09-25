import type { ComponentType, SVGProps } from 'react';
import { Link, useLocation } from 'wouter';
import { useTimer } from '../brew/timer';
import { strings } from '../strings';
import { BeanIcon, BoardIcon, BrewIcon, CoachIcon, DuelIcon, RecipeIcon } from './Icons';

interface Tab {
  href: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const TABS: Tab[] = [
  { href: '/', label: strings.tabs.board, Icon: BoardIcon },
  { href: '/beans', label: strings.tabs.beans, Icon: BeanIcon },
  { href: '/recipes', label: strings.tabs.recipes, Icon: RecipeIcon },
  { href: '/brew', label: strings.tabs.brew, Icon: BrewIcon },
  { href: '/duel', label: strings.tabs.duel, Icon: DuelIcon },
  { href: '/coach', label: strings.tabs.coach, Icon: CoachIcon },
];

function isActive(href: string, location: string): boolean {
  if (href === '/') return location === '/';
  return location === href || location.startsWith(`${href}/`);
}

export function TabBar() {
  const [location] = useLocation();
  const brewing = useTimer().status !== 'idle';
  return (
    <nav className="tabbar" aria-label={strings.tabs.label}>
      <ul>
        {TABS.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link href={href} className="tab" aria-current={isActive(href, location) ? 'page' : undefined}>
              <Icon />
              <span>{label}</span>
              {href === '/brew' && brewing && <span className="tab-dot" role="img" aria-label={strings.shell.brewRunning} />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
