import { useEffect, useState } from 'react';
import { binderDb } from '@/lib/db';
import { DECK_SIZE, type DeckReport } from '@/lib/deck-rules';
import { deleteDeck } from '@/lib/decks';
import { cx } from '@/ui/cx';
import { CheckIcon, MinusIcon } from '@/ui/Icons';
import styles from './Decks.module.css';

/** ✓ или ! перед текстом проверки. */
export function CheckMark({ ok }: { ok: boolean }) {
  return ok ? (
    <span className={styles.ok} aria-hidden="true">
      <CheckIcon size={16} stroke={2.4} />
    </span>
  ) : (
    <span className={styles.warn} aria-hidden="true">
      !
    </span>
  );
}

export function DeckChecks({ report }: { report: DeckReport }) {
  return (
    <ul className={styles.checks} aria-label="Проверка правил">
      {report.checks.map((check) => (
        <li key={check.id} className={styles.check}>
          <CheckMark ok={check.ok} />
          <span>
            <span className={styles.visuallyHidden}>{check.ok ? 'Выполнено: ' : 'Не выполнено: '}</span>
            {check.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DeckTrack({ total }: { total: number }) {
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label="Карт в колоде"
      aria-valuemin={0}
      aria-valuemax={DECK_SIZE}
      aria-valuenow={total}
    >
      <div className={styles.fill} style={{ width: `${Math.min(100, Math.round((total / DECK_SIZE) * 100))}%` }} />
    </div>
  );
}

/**
 * Удаление колоды со второго нажатия, как «−» на последней копии в альбоме:
 * первое нажатие спрашивает, через 4 секунды вопрос снимается сам.
 */
export function DeleteDeckButton({
  uid,
  deckId,
  name,
  variant,
  onDeleted,
}: {
  uid: string;
  deckId: string;
  name: string;
  variant: 'icon' | 'text';
  onDeleted?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const remove = async () => {
    if (!confirming) {
      setConfirming(true);
      setFailed(false);
      return;
    }
    setBusy(true);
    try {
      await deleteDeck(binderDb(), uid, deckId);
      onDeleted?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  const label = confirming ? `Точно удалить колоду ${name}` : `Удалить колоду ${name}`;
  const text = failed ? 'Не удалилась, ещё раз?' : confirming ? 'Удалить?' : null;
  return (
    <button
      type="button"
      className={cx(
        variant === 'icon' ? cx(styles.iconButton, styles.surfaceButton) : styles.textButton,
        confirming && styles.confirming,
      )}
      aria-label={label}
      title={label}
      disabled={busy}
      onClick={() => void remove()}
    >
      {text ?? (variant === 'icon' ? <MinusIcon size={16} stroke={2.2} /> : 'Удалить колоду')}
    </button>
  );
}
