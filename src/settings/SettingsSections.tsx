import type { User } from 'firebase/auth/web-extension';
import { useId, type ReactNode } from 'react';
import { Link } from 'wouter';
import { invitesLeftLabel } from '@/lib/format';
import type { Member } from '@/lib/membership';
import { DeepseekKeyField } from '@/scan/DeepseekKeyField';
import { memberSinceLabel } from '@/settings/account';
import type { ThemeId } from '@/theme/themes';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { ThemePicker } from '@/ui/ThemePicker';
import styles from './SettingsSections.module.css';

/**
 * Где показаны настройки. popup — узкая колонка поп-апа по макету PopupSettings;
 * page — страница вкладки: в строке заголовок с пояснением слева и поля справа.
 */
export type SettingsLayout = 'popup' | 'page';

const PHOTO_STORES = [
  { id: 'none', label: 'Не хранить, только для сканера' },
  { id: 'drive', label: 'Сохранять в мой Google Drive' },
  { id: 'cloud', label: 'Сохранять превью в облаке Binder' },
] as const;

const PHOTO_NOTE = 'Хранение фото появится позже. Сейчас фото нужно только сканеру.';

type SectionsProps = {
  layout: SettingsLayout;
  theme: ThemeId;
  onTheme: (id: ThemeId) => void;
};

/**
 * Ключ DeepSeek, тема и «Мои фото карточек»: одни и те же в поп-апе и во вкладке.
 * Ключи JustTCG общие для клуба, их добавляет админ на своей странице (src/app/pages/AdminPage.tsx).
 */
export function SettingsSections({ layout, theme, onTheme }: SectionsProps) {
  const themeTitle = useId();
  const photosTitle = useId();

  const keys = <DeepseekKeyField />;
  const themes = <ThemePicker value={theme} onChange={onTheme} labelledBy={themeTitle} />;
  // Хранение фото ещё не сделано: выбор заблокирован на «Не хранить»
  const photos = (
    <div role="radiogroup" aria-labelledby={photosTitle} className={styles.radios}>
      {PHOTO_STORES.map(({ id, label }) => (
        <label key={id} className={styles.radio}>
          <input type="radio" name="photo-store" value={id} defaultChecked={id === 'none'} disabled />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );

  if (layout === 'popup') {
    return (
      <>
        {keys}
        <section className={styles.section}>
          <h2 id={themeTitle} className={styles.title}>
            Тема
          </h2>
          {themes}
        </section>
        <section className={styles.photos}>
          <h2 id={photosTitle} className={styles.title}>
            Мои фото карточек
          </h2>
          {photos}
          <p className={styles.note}>{PHOTO_NOTE}</p>
        </section>
      </>
    );
  }

  return (
    <div className={styles.panel}>
      <PageRow title="Ключ DeepSeek" text="DeepSeek распознаёт карты на фото и оценивает их состояние. Ключи для цен JustTCG общие для клуба, их добавляет админ.">
        {keys}
      </PageRow>
      <PageRow title="Тема" titleId={themeTitle} text="Меняется сразу и во вкладке, и в поп-апе.">
        {themes}
      </PageRow>
      <PageRow title="Мои фото карточек" titleId={photosTitle} text={PHOTO_NOTE}>
        {photos}
      </PageRow>
    </div>
  );
}

type PageRowProps = { title: string; titleId?: string; text: string; children: ReactNode };

function PageRow({ title, titleId, text, children }: PageRowProps) {
  const ownId = useId();
  const id = titleId ?? ownId;
  return (
    <section className={styles.row} aria-labelledby={id}>
      <div className={styles.rowHead}>
        <h2 id={id} className={styles.rowTitle}>
          {title}
        </h2>
        <p className={styles.rowText}>{text}</p>
      </div>
      <div className={styles.rowBody}>{children}</div>
    </section>
  );
}

type AccountProps = {
  layout: SettingsLayout;
  user: User;
  member: Member;
  onSignOut: () => void;
};

/** Аккаунт: в поп-апе строка в подвале, во вкладке отдельная панель. */
export function AccountSummary({ layout, user, member, onSignOut }: AccountProps) {
  const titleId = useId();
  const email = user.email ?? 'Без почты';

  if (layout === 'popup') {
    return (
      <>
        <Avatar src={user.photoURL} size={36} />
        <div className={styles.account}>
          <span className={styles.accountName}>{email}</span>
          <span className={styles.accountNote}>{invitesLeftLabel(member.invitesLeft)}</span>
        </div>
        <Button variant="link" className={styles.signOut} onClick={onSignOut}>
          Выйти
        </Button>
      </>
    );
  }

  const since = memberSinceLabel(member.joinedAt?.toDate());
  return (
    <section className={styles.accountPanel} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.rowTitle}>
        Аккаунт
      </h2>
      <div className={styles.person}>
        <Avatar src={user.photoURL} size={56} />
        <div className={styles.account}>
          <span className={styles.personName}>{user.displayName || member.displayName || email}</span>
          <span className={styles.personEmail}>{email}</span>
        </div>
      </div>
      <ul className={styles.facts}>
        {since && <li>{since}</li>}
        <li>
          <span>{invitesLeftLabel(member.invitesLeft)}</span>
          <Link href="/friends" className={styles.factLink}>
            Пригласить
          </Link>
        </li>
      </ul>
      <Button variant="link" className={styles.signOutPage} onClick={onSignOut}>
        Выйти из Binder
      </Button>
      <p className={styles.note}>Ключи и тема останутся в этом браузере. Вход снова — через тот же Google-аккаунт Chrome.</p>
    </section>
  );
}
