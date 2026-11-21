import { useEffect, useState } from 'react';
import { driveReady, savePhotoStore } from '@/lib/drive-setup';
import { send } from '@/lib/messages';
import { usePhotoStore } from '@/lib/my-photos';
import { Button } from '@/ui/Button';
import { cx } from '@/ui/cx';
import styles from './SettingsSections.module.css';

/** soon — вариант ещё не сделан: виден, но выбрать его нельзя. */
const PHOTO_STORES = [
  { id: 'none', label: 'Не хранить, только для сканера', soon: false },
  { id: 'drive', label: 'Сохранять в мой Google Drive', soon: false },
  { id: 'cloud', label: 'Сохранять превью в облаке Binder', soon: true },
] as const;

type Props = { labelledBy: string; compact?: boolean };

/**
 * «Мои фото карточек»: не хранить или Google Drive участника (облако Binder — «скоро»).
 * Drive подключает service worker: окно согласия Google закрывает поп-ап, а выбор
 * всё равно запишется, и поп-ап при следующем открытии его покажет.
 */
export function PhotoStoreField({ labelledBy, compact = false }: Props) {
  const store = usePhotoStore();
  const [access, setAccess] = useState<'checking' | 'ready' | 'consent'>('checking');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Выбор идёт за аккаунтом Chrome, а согласие на Drive даётся в каждом браузере
  useEffect(() => {
    if (store !== 'drive') return;
    let active = true;
    setAccess('checking');
    void driveReady().then((ok) => active && setAccess(ok ? 'ready' : 'consent'));
    return () => {
      active = false;
    };
  }, [store]);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const reply = await send({ type: 'drive/connect' });
      if (!reply.ok) setError(reply.error);
      else setAccess('ready');
    } catch {
      setError('Не получилось подключить Google Drive. Попробуй ещё раз.');
    } finally {
      setConnecting(false);
    }
  };

  const choose = (id: string) => {
    setError(null);
    if (id === 'drive') void connect();
    else if (id === 'none') void savePhotoStore('none');
  };

  const selected = connecting ? 'drive' : (store ?? 'none');
  let status: string | null = null;
  if (connecting) status = 'Подключаем Google Drive… Если Chrome спросит разрешение, разреши Binder доступ к его файлам.';
  else if (store === 'drive' && access === 'ready') {
    status = compact
      ? 'Фото с «Моё фото» лежат в папке «Binder» в твоём Drive. Друзья видят официальный скан.'
      : 'Фото карт, у которых в сканере выбрано «Моё фото», лежат в папке «Binder» в твоём Google Drive. Binder видит там только свои файлы. Друзья твои фото не видят, у них официальный скан.';
  } else if (store === 'drive' && access === 'consent') {
    status = 'В этом браузере Binder ещё не может открыть твой Google Drive.';
  } else if (store === 'none') {
    status = compact
      ? 'Фото нужно только сканеру и после распознавания не хранится.'
      : 'Фото нужно только сканеру и после распознавания не хранится. Фото, которые уже лежат в Google Drive, там и останутся.';
  }

  return (
    <div className={styles.photoField}>
      <div role="radiogroup" aria-labelledby={labelledBy} className={styles.radios}>
        {PHOTO_STORES.map(({ id, label, soon }) => (
          <label key={id} className={cx(styles.radio, soon && styles.radioSoon)}>
            <input
              type="radio"
              name="photo-store"
              value={id}
              checked={selected === id}
              disabled={soon || store === null || connecting}
              onChange={() => choose(id)}
            />
            <span>{label}</span>
            {soon && <span className={styles.soon}>скоро</span>}
          </label>
        ))}
      </div>
      {status && (
        <p className={styles.note} role="status">
          {status}
        </p>
      )}
      {store === 'drive' && access === 'consent' && !connecting && (
        <Button className={styles.photoConnect} onClick={() => void connect()}>
          Разрешить доступ к Drive
        </Button>
      )}
      {error && (
        <p className={styles.photoError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
