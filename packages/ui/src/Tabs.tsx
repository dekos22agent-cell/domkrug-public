import { useId, useRef, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}

/**
 * Табы с ручной активацией по стрелкам.
 *
 * role=tablist/tab/tabpanel, aria-selected и aria-controls; неактивные табы
 * не попадают в Tab-порядок, стрелки перемещают фокус и переключают панель.
 */
export function Tabs({ items, value, onChange, label }: TabsProps) {
  const baseId = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const enabled = items.filter((item) => !item.disabled);

  const move = (current: number, delta: number) => {
    if (enabled.length === 0) return;
    const index = enabled.findIndex((item) => item.id === items[current]?.id);
    const next = enabled[(index + delta + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.id);
    const nextIndex = items.findIndex((item) => item.id === next.id);
    refs.current[nextIndex]?.focus();
  };

  return (
    <div className={styles.root}>
      <div className={styles.tablist} role="tablist" aria-label={label}>
        {items.map((item, index) => {
          const selected = item.id === value;
          return (
            <button
              key={item.id}
              ref={(element) => {
                refs.current[index] = element;
              }}
              id={`${baseId}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={[styles.tab, selected ? styles.active : ''].filter(Boolean).join(' ')}
              onClick={() => onChange(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  move(index, 1);
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  move(index, -1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  const first = enabled[0];
                  if (first) {
                    onChange(first.id);
                    refs.current[items.findIndex((item) => item.id === first.id)]?.focus();
                  }
                } else if (event.key === 'End') {
                  event.preventDefault();
                  const last = enabled[enabled.length - 1];
                  if (last) {
                    onChange(last.id);
                    refs.current[items.findIndex((item) => item.id === last.id)]?.focus();
                  }
                }
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {items.map((item) => (
        <div
          key={item.id}
          id={`${baseId}-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${item.id}`}
          hidden={item.id !== value}
          tabIndex={0}
          className={styles.panel}
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
