import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { OwnedCard } from '@/lib/collection';
import { binderDb } from '@/lib/db';
import { formatCardPrice } from '@/lib/format';
import { displayNames } from '@/lib/names';
import { MAX_SHOWCASE, saveShowcase, toggleShowcase } from '@/lib/showcase';
import type { CardView } from '@/lib/useCardViews';
import { Button } from '@/ui/Button';
import { CardImage } from '@/ui/CardImage';
import { cx } from '@/ui/cx';
import { CloseIcon } from '@/ui/Icons';
import { TextField } from '@/ui/TextField';
import { byPrice, numberLabel } from './ProfileParts';
import styles from './ShowcaseEditor.module.css';

type Props = {
  open: boolean;
  uid: string;
  /** Карты своего альбома; null — ещё грузятся */
  views: CardView[] | null;
  owned: ReadonlyMap<string, OwnedCard>;
  current: string[];
  onClose: () => void;
};

function matches(view: CardView, query: string): boolean {
  if (!query) return true;
  return [view.name, view.englishName, view.setName, view.localId, view.printed?.number]
    .filter((text): text is string => Boolean(text))
    .some((text) => text.toLowerCase().includes(query));
}

/**
 * Выбор витрины: до шести карт своего альбома, порядок — порядок выбора. Нативный модальный
 * dialog, как у оценки состояния. Сохраняется одной записью в members/{uid}.showcase.
 */
export function ShowcaseEditor({ open, uid, views, owned, current, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // Витрина берётся на момент открытия: карты, которых уже нет в альбоме, не выбраны
      setSelected(current.filter((id) => owned.has(id)));
      setFilter('');
      setError(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
    // current и owned нужны только в момент открытия
  }, [open]);

  const query = filter.trim().toLowerCase();
  const list = useMemo(() => (views ?? []).filter((view) => matches(view, query)).sort(byPrice), [views, query]);
  const full = selected.length >= MAX_SHOWCASE;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveShowcase(binderDb(), uid, selected, owned);
      onClose();
    } catch (failure) {
      console.warn('[binder] витрина не сохранена', failure);
      setError('Не получилось сохранить витрину. Проверь интернет и попробуй ещё раз.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 id={titleId} className={styles.title}>
            Витрина
          </h2>
          <p className={styles.muted}>Выбери до шести карт из альбома. Друзья увидят их в твоём профиле в этом порядке.</p>
        </div>
        <button type="button" className={styles.close} aria-label="Закрыть" onClick={onClose}>
          <CloseIcon size={20} stroke={2} />
        </button>
      </div>

      <div className={styles.tools}>
        <div className={styles.search}>
          <TextField
            label="Найти в альбоме"
            type="search"
            placeholder="Имя, сет или номер"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            autoComplete="off"
          />
        </div>
        <span className={styles.counter} role="status">
          Выбрано {selected.length} из {MAX_SHOWCASE}
        </span>
      </div>
      {full && <p className={styles.muted}>В витрине уже шесть карт. Чтобы добавить другую, убери одну из выбранных.</p>}

      <div className={styles.grid}>
        {list.map((view) => {
          const position = selected.indexOf(view.docId);
          const on = position >= 0;
          const names = displayNames(view.name, view.englishName);
          return (
            <button
              key={view.docId}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              className={cx(styles.option, on && styles.on)}
              onClick={() => setSelected((previous) => toggleShowcase(previous, view.docId))}
            >
              <span className={styles.image}>
                <CardImage
                  image={view.image}
                  limitless={view.limitless}
                  thumb={view.thumb}
                  name={names.primary}
                  number={numberLabel(view)}
                  lang={view.lang}
                />
                {on && (
                  <span className={styles.position} aria-hidden="true">
                    {position + 1}
                  </span>
                )}
              </span>
              <span className={styles.name}>{names.primary}</span>
              <span className={styles.price}>{formatCardPrice(view.price)}</span>
            </button>
          );
        })}
        {!views && <p className={styles.muted}>Загружаем альбом…</p>}
        {views && list.length === 0 && (
          <p className={styles.muted}>{query ? 'В альбоме нет карт с таким именем или номером.' : 'В альбоме пока нет карт.'}</p>
        )}
      </div>

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.footer}>
        <Button variant="link" disabled={selected.length === 0 || busy} onClick={() => setSelected([])}>
          Убрать все
        </Button>
        <Button className={styles.save} disabled={busy} onClick={() => void save()}>
          {busy ? 'Сохраняем…' : 'Сохранить витрину'}
        </Button>
      </div>
    </dialog>
  );
}
