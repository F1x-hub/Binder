import { useEffect, useState, type KeyboardEvent } from 'react';
import { checkJusttcgKey, loadJusttcgKey, saveJusttcgKey, type KeyCheck } from '@/lib/justtcg';
import { CheckIcon } from '@/ui/Icons';
import { TextField } from '@/ui/TextField';
import styles from './DeepseekKeyField.module.css';

type Status = { status: 'empty' | 'saved' | 'checking' } | KeyCheck;

/**
 * Ключ JustTCG для цен японских карт в долларах. Хранится только в этом браузере.
 * Проверяется только при вводе: каждая проверка — один запрос из бесплатных 100 в день.
 */
export function JusttcgKeyField() {
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState('');
  const [status, setStatus] = useState<Status>({ status: 'empty' });

  useEffect(() => {
    void loadJusttcgKey().then((stored) => {
      setKey(stored);
      setSaved(stored);
      setStatus({ status: stored ? 'saved' : 'empty' });
    });
  }, []);

  const commit = async () => {
    const trimmed = key.trim();
    if (trimmed === saved) return;
    await saveJusttcgKey(trimmed);
    setSaved(trimmed);
    if (!trimmed) {
      setStatus({ status: 'empty' });
      return;
    }
    setStatus({ status: 'checking' });
    setStatus(await checkJusttcgKey(trimmed));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  return (
    <TextField
      label="Ключ JustTCG"
      type="password"
      placeholder="tcg_…"
      autoComplete="off"
      spellCheck={false}
      value={key}
      onChange={(event) => setKey(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKeyDown}
      hint={<KeyHint status={status} />}
    />
  );
}

function KeyHint({ status }: { status: Status }) {
  switch (status.status) {
    case 'ok':
      return (
        <span className={styles.ok}>
          <CheckIcon size={14} stroke={2.4} />
          {status.left === null ? 'Ключ работает' : `Ключ работает, сегодня осталось запросов: ${status.left}`}
        </span>
      );
    case 'saved':
      return <span>Ключ сохранён. Цены японских карт берутся из JustTCG раз в сутки на весь клуб</span>;
    case 'checking':
      return <span>Проверяем ключ…</span>;
    case 'invalid':
      return <span className={styles.problem}>Ключ не подошёл</span>;
    case 'rate-limit':
      return <span className={styles.problem}>Запросы на сегодня кончились, ключ проверим завтра</span>;
    case 'no-game':
      return <span className={styles.problem}>Ключ работает, но японских карт в JustTCG не нашлось</span>;
    case 'offline':
      return <span className={styles.problem}>Не удалось проверить ключ: нет связи</span>;
    case 'empty':
      return <span>Цены японских карт в долларах. Бесплатный ключ: justtcg.com. Хранится только в этом браузере</span>;
  }
}
