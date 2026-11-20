import { useState } from 'react';
import { UserIcon } from '@/ui/Icons';
import styles from './Avatar.module.css';

type Props = { src?: string | null; size: number };

/** Круглая аватарка: фото из аккаунта Google, а если его нет или оно не загрузилось, значок. */
export function Avatar({ src, size }: Props) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={styles.avatar} style={{ width: size, height: size }} aria-hidden="true">
      {src && !broken ? (
        <img src={src} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <UserIcon size={Math.round(size / 2)} />
      )}
    </span>
  );
}
