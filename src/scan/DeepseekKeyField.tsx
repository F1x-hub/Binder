import { useEffect, useState, type KeyboardEvent } from 'react';
import { checkDeepseekKey, loadDeepseekKey, saveDeepseekKey, type KeyStatus } from '@/lib/deepseek';
import { CheckIcon } from '@/ui/Icons';
import { TextField } from '@/ui/TextField';
import styles from './DeepseekKeyField.module.css';

type Status = 'empty' | 'checking' | KeyStatus;

/**
 * Ключ DeepSeek: сохраняется в этом браузере и сразу проверяется.
 * onReady получает ключ, когда проверка прошла (так сканер продолжает работу без перехода в настройки).
 */
export function DeepseekKeyField({ onReady }: { onReady?: (key: string) => void }) {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<Status>('empty');

  const check = async (value: string) => {
    setStatus('checking');
    const result = await checkDeepseekKey(value);
    setStatus(result);
    if (result === 'ok') onReady?.(value.trim());
  };

  useEffect(() => {
    void loadDeepseekKey().then((stored) => {
      setKey(stored);
      if (stored) void check(stored);
    });
  }, []);

  const commit = async () => {
    await saveDeepseekKey(key);
    if (key.trim()) await check(key);
    else setStatus('empty');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  return (
    <TextField
      label="Ключ DeepSeek"
      emphasis
      type="password"
      placeholder="sk-…"
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
  switch (status) {
    case 'ok':
      return (
        <span className={styles.ok}>
          <CheckIcon size={14} stroke={2.4} />
          Ключ работает, модель V4.1 Flash
        </span>
      );
    case 'checking':
      return <span>Проверяем ключ…</span>;
    case 'invalid':
      return <span className={styles.problem}>Ключ не подошёл</span>;
    case 'no-model':
      return <span className={styles.problem}>Ключ работает, но модель deepseek-flash недоступна</span>;
    case 'offline':
      return <span className={styles.problem}>Не удалось проверить ключ: нет связи</span>;
    case 'empty':
      return <span>Хранится только в этом браузере. Взять ключ: platform.deepseek.com</span>;
  }
}
