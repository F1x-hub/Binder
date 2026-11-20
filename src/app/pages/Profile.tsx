import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { useOwned } from '@/lib/collection-state';
import { CARD_FORMS, SET_FORMS, countLabel, formatCardPrice, formatInteger, pluralWord } from '@/lib/format';
import { joinedLabel } from '@/lib/friends';
import { LANGUAGE_LABELS, htmlLang } from '@/lib/languages';
import { useMembership } from '@/lib/membership-state';
import { displayNames } from '@/lib/names';
import { MAX_SHOWCASE, pickShowcase, showcaseOf } from '@/lib/showcase';
import { collectionTotals, useCardViews, type CardView } from '@/lib/useCardViews';
import { useClubMember, useFriendAlbum } from '@/lib/useFriendAlbum';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { CardViewer } from '@/ui/CardViewer';
import { EmptyState } from '@/ui/EmptyState';
import { BackIcon, PencilIcon, PlusIcon } from '@/ui/Icons';
import { TiltCard } from '@/ui/TiltCard';
import { CardTile, Stat, byPrice, groupBySet, numberLabel, valueParts } from './ProfileParts';
import { ShowcaseEditor } from './ShowcaseEditor';
import styles from './Profile.module.css';

/** Сколько карт показывать в «Нет у тебя»: самые дорогие. */
const MISSING_LIMIT = 12;

/**
 * Профиль участника по макету Profile: шапка с числами, витрина и альбом. `/u/me` и свой uid —
 * свой профиль, где выбирается витрина. Чужой альбом только для чтения: карта открывается
 * в просмотре, а страница карточки (`#/card/…`) показывает только свой альбом.
 */
export function Profile() {
  const { uid } = useParams<{ uid: string }>();
  const auth = useAuth();
  const myUid = auth.status === 'signed-in' ? auth.user.uid : null;
  if (!myUid) return null;
  if (uid === 'me' || uid === myUid) return <MyProfile uid={myUid} />;
  return <FriendProfile key={uid} uid={uid} />;
}

function MyProfile({ uid }: { uid: string }) {
  usePageTitle('Мой профиль');
  const auth = useAuth();
  const membership = useMembership();
  const member = membership.status === 'member' ? membership.member : null;
  const user = auth.status === 'signed-in' ? auth.user : null;
  const { cards, byId, ready } = useOwned();
  const views = useCardViews(cards, ready);
  const [editing, setEditing] = useState(false);
  const showcase = showcaseOf(member);

  return (
    <>
      <ProfileView
        name={member?.displayName ?? user?.displayName ?? 'Без имени'}
        photoURL={member?.photoURL ?? user?.photoURL ?? null}
        since={joinedLabel(member?.joinedAt ?? null)}
        mine
        album={ready ? 'ready' : 'loading'}
        views={views}
        showcase={showcase}
        onEditShowcase={() => setEditing(true)}
        tile={(view, size) => <CardTile view={view} size={size} href={`/card/${encodeURIComponent(view.docId)}`} />}
      />
      <ShowcaseEditor open={editing} uid={uid} views={views} owned={byId} current={showcase} onClose={() => setEditing(false)} />
    </>
  );
}

function FriendProfile({ uid }: { uid: string }) {
  const member = useClubMember(uid);
  const album = useFriendAlbum(uid);
  const views = useCardViews(album.status === 'ready' ? album.value : [], album.status === 'ready');
  const mine = useOwned();
  const [open, setOpen] = useState<CardView | null>(null);
  const person = member.status === 'ready' ? member.value : null;
  usePageTitle(person?.displayName ?? 'Профиль');

  if (member.status === 'loading') return <p className={styles.muted}>Загружаем профиль…</p>;
  if (member.status === 'error') return <EmptyState title="Не получилось открыть профиль">{member.message}</EmptyState>;
  if (!person) {
    return (
      <EmptyState
        title="Участник не найден"
        action={
          <Link href="/friends" className={styles.textLink}>
            Все участники клуба
          </Link>
        }
      >
        В клубе нет участника с таким адресом. Возможно, его убрали из клуба.
      </EmptyState>
    );
  }

  const missing = mine.ready && views ? views.filter((view) => !mine.byId.has(view.docId)).sort(byPrice) : null;

  return (
    <>
      <div className={styles.crumbs}>
        <Link href="/friends" className={styles.back}>
          <BackIcon size={18} stroke={2} />
          Друзья
        </Link>
      </div>
      <ProfileView
        name={person.displayName}
        photoURL={person.photoURL}
        since={joinedLabel(person.joinedAt)}
        mine={false}
        album={album.status}
        albumError={album.status === 'error' ? album.message : null}
        views={views}
        showcase={person.showcase}
        tile={(view, size) => <CardTile view={view} size={size} onOpen={() => setOpen(view)} />}
        extra={
          missing && missing.length > 0 ? (
            <section className={styles.section} aria-labelledby="missing-title">
              <div className={styles.sectionHead}>
                <h2 id="missing-title" className={styles.sectionTitle}>
                  Нет у тебя
                </h2>
                <span className={styles.muted}>
                  Этих карт нет в твоём альбоме: {countLabel(missing.length, CARD_FORMS)}
                  {missing.length > MISSING_LIMIT ? ', здесь самые дорогие' : ''}
                </span>
              </div>
              <div className={styles.smallGrid}>
                {missing.slice(0, MISSING_LIMIT).map((view) => (
                  <CardTile key={view.docId} view={view} size="small" onOpen={() => setOpen(view)} />
                ))}
              </div>
            </section>
          ) : null
        }
      />
      <FriendCardViewer view={open} owner={person.displayName} mine={open ? mine.byId.has(open.docId) : false} onClose={() => setOpen(null)} />
    </>
  );
}

type ViewProps = {
  name: string;
  photoURL: string | null;
  since: string | null;
  mine: boolean;
  album: 'loading' | 'ready' | 'error';
  albumError?: string | null;
  views: CardView[] | null;
  showcase: string[];
  onEditShowcase?: () => void;
  tile: (view: CardView, size: 'normal' | 'small') => ReactNode;
  /** Разделы под витриной */
  extra?: ReactNode;
};

function ProfileView({ name, photoURL, since, mine, album, albumError, views, showcase, onEditShowcase, tile, extra }: ViewProps) {
  const [tab, setTab] = useState<'show' | 'all'>('show');
  const loaded = views ?? [];
  const totals = views ? collectionTotals(views) : null;
  const value = totals ? valueParts(totals) : null;
  const pending = album === 'error' ? '—' : '…';
  const shown = pickShowcase(showcase, loaded);
  const emptySlots = mine && views && views.length > 0 ? MAX_SHOWCASE - shown.length : 0;

  return (
    <>
      <section className={styles.top}>
        <Avatar src={photoURL} size={88} />
        <div className={styles.identity}>
          <h1 className={styles.name}>{name}</h1>
          {(since || mine) && (
            <span className={styles.meta}>{[since, mine ? 'так твой профиль видят друзья' : null].filter(Boolean).join(' · ')}</span>
          )}
        </div>
        <div className={styles.stats}>
          <Stat value={totals ? formatInteger(totals.copies) : pending} label={totals ? pluralWord(totals.copies, CARD_FORMS) : 'карточек'} />
          <Stat value={value?.main ?? pending} label="стоимость" note={value?.note} />
          <Stat value={totals ? formatInteger(totals.sets) : pending} label={totals ? pluralWord(totals.sets, SET_FORMS) : 'сетов'} />
        </div>
        {mine && onEditShowcase && (
          <div className={styles.actions}>
            <Button className={styles.action} start={<PencilIcon size={16} stroke={2} />} onClick={onEditShowcase}>
              Изменить витрину
            </Button>
          </div>
        )}
      </section>

      <nav aria-label="Разделы профиля" className={styles.tabs}>
        <button type="button" aria-pressed={tab === 'show'} className={styles.tab} onClick={() => setTab('show')}>
          Витрина
        </button>
        <button type="button" aria-pressed={tab === 'all'} className={styles.tab} onClick={() => setTab('all')}>
          Коллекция
          {totals && <span className={styles.tabCount}>{formatInteger(totals.copies)}</span>}
        </button>
      </nav>

      {album === 'error' && <EmptyState title="Альбом не загрузился">{albumError}</EmptyState>}

      {tab === 'show' && album !== 'error' && (
        <div className={styles.column}>
          <section className={styles.section} aria-labelledby="showcase-title">
            <div className={styles.sectionHead}>
              <h2 id="showcase-title" className={styles.sectionTitle}>
                Витрина
              </h2>
              <span className={styles.muted}>
                {mine ? 'Эти карты друзья видят первыми в твоём профиле' : `Карты, которые ${name} показывает клубу`}
              </span>
            </div>
            {!views ? (
              <p className={styles.muted}>Загружаем альбом…</p>
            ) : mine && views.length === 0 ? (
              <EmptyState
                title="Сначала добавь карты в альбом"
                action={
                  <Link href="/scan" className={styles.textLink}>
                    Сканировать карточки
                  </Link>
                }
              >
                В витрину попадают карты из твоего альбома: до шести самых любимых или ценных.
              </EmptyState>
            ) : shown.length === 0 && !mine ? (
              <p className={styles.muted}>Витрина пока пуста.</p>
            ) : (
              <div className={styles.grid}>
                {shown.map((view) => (
                  <div key={view.docId}>{tile(view, 'normal')}</div>
                ))}
                {Array.from({ length: emptySlots }, (_, index) => (
                  <button key={index} type="button" className={styles.slot} onClick={onEditShowcase}>
                    <PlusIcon size={20} stroke={2} />
                    <span>{shown.length === 0 && index === 0 ? 'Выбрать карты' : 'Добавить карту'}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
          {extra}
        </div>
      )}

      {tab === 'all' && album !== 'error' && (
        <div className={styles.column}>
          {!views && <p className={styles.muted}>Загружаем альбом…</p>}
          {views && views.length === 0 && (
            <EmptyState title="В альбоме пока нет карт">
              {mine ? 'Сфотографируй свои карточки: Binder узнает их и сложит в альбом.' : 'Когда здесь появятся карты, их увидит весь клуб.'}
            </EmptyState>
          )}
          {groupBySet(loaded).map((group) => (
            <section key={group.key} className={styles.panel} aria-label={group.setName}>
              <div className={styles.panelHead}>
                <h2 className={styles.setName}>{group.setName}</h2>
                <span className={styles.muted}>{countLabel(group.cards.length, CARD_FORMS)}</span>
                {group.note && <span className={styles.muted}>{group.note}</span>}
              </div>
              <div className={styles.albumGrid}>
                {group.cards.map((view) => (
                  <div key={view.docId}>{tile(view, 'normal')}</div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** Карта из чужого альбома во весь экран: только посмотреть, без правки. */
function FriendCardViewer({ view, owner, mine, onClose }: { view: CardView | null; owner: string; mine: boolean; onClose: () => void }) {
  const names = view ? displayNames(view.name, view.englishName) : null;
  return (
    <CardViewer open={view !== null} label={names ? `Карта ${names.primary}` : 'Карта'} onClose={onClose}>
      {view && names && (
        <>
          <TiltCard
            key={view.docId}
            image={view.image}
            limitless={view.limitless}
            thumb={view.thumb}
            name={names.primary}
            number={numberLabel(view)}
            holo={view.variant === 'holo' || view.variant === 'reverse'}
            className={styles.viewerCard}
          />
          <div className={styles.viewerText}>
            <p className={styles.viewerName}>
              {names.primary} · {numberLabel(view)}
            </p>
            {names.secondary && (
              <p className={styles.viewerMuted} lang={htmlLang(view.lang)}>
                {names.secondary}
              </p>
            )}
            <p className={styles.viewerMuted}>
              {[view.setName, LANGUAGE_LABELS[view.lang].card, formatCardPrice(view.price)].join(' · ')}
            </p>
            <p className={styles.viewerMuted}>
              Альбом: {owner}
              {view.count > 1 ? `, копий: ${view.count}` : ''}
            </p>
            {mine && (
              <Link href={`/card/${encodeURIComponent(view.docId)}`} className={styles.viewerLink}>
                Такая есть и у тебя: открыть карточку
              </Link>
            )}
          </div>
        </>
      )}
    </CardViewer>
  );
}
