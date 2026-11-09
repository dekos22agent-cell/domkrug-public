import { NavLink } from 'react-router-dom';
import styles from './ObjectTabs.module.css';

export type ObjectTabKey = 'overview' | 'units' | 'owners' | 'meters';

const TABS: { key: ObjectTabKey; label: string; suffix: string }[] = [
  { key: 'overview', label: 'Обзор', suffix: '' },
  { key: 'units', label: 'Помещения', suffix: '/units' },
  { key: 'owners', label: 'Собственники', suffix: '/owners' },
  { key: 'meters', label: 'Счётчики', suffix: '/meters' },
];

/** Навигация внутри паспорта объекта. */
export function ObjectTabs({
  objectId,
  active,
}: {
  objectId: string;
  active: ObjectTabKey;
}) {
  return (
    <nav className={styles.tabs} aria-label="Разделы объекта">
      {TABS.map((tab) => (
        <NavLink
          key={tab.key}
          to={`/objects/${objectId}${tab.suffix}`}
          end={tab.key === 'overview'}
          className={[styles.tab, active === tab.key ? styles.active : '']
            .filter(Boolean)
            .join(' ')}
          aria-current={active === tab.key ? 'page' : undefined}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
