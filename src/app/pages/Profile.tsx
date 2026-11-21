import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { useOwned } from '@/lib/collection-state';
import { CARD_FORMS, SET_FORMS, countLabel, formatInteger, pluralWord } from '@/lib/format';
import { joinedLabel } from '@/lib/friends';
import { useMembership } from '@/lib/membership-state';
import { MAX_SHOWCASE, pickShowcase, showcaseOf } from '@/lib/showcase';
import { collectionTotals, useCardViews, type CardView } from '@/lib/useCardViews';
import { useClubMember, useFriendAlbum } from '@/lib/useFriendAlbum';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Skeleton, SkeletonArea } from '@/ui/Skeleton';
import { BackIcon, PencilIcon, PlusIcon } from '@/ui/Icons';
import { FeedPanel, type FeedOwner } from './FeedPanel';
import { FriendCardViewer } from './FriendCardViewer';
import { CardTile, Stat, byPrice, groupBySet, valueParts } from './ProfileParts';
import { ShowcaseEditor } from './ShowcaseEditor';
import page from './Page.module.css';
import styles from './Profile.module.css';

/** Сколько карт показывать в «Нет у тебя»: самые дорогие. */
const MISSING_LIMIT = 12;

/**
 * Профиль участника по макету Profile: шапка с числами, витрина и альбом, справа — лента
 * новых карт этого участника. `/u/me` и свой uid — свой профиль, где выбирается витрина.
 * Чужой альбом только для чтения: карта открывается в просмотре, а страница карточки
 * (`#/card/…`) показывает только свой альбом.
 */
export function Profile() {
  const { uid } = useParams<{ uid: string }>();
  const auth = useAuth();
  // «Обновить» после ошибки монтирует профиль друга заново: документ и альбом читаются ещё раз
  const [attempt, setAttempt] = useState(0);
  const myUid = auth.status === 'signed-in' ? auth.user.uid : null;
  if (!myUid) return null;
  if (uid === 'me' || uid === myUid) return <MyProfile uid={myUid} />;
  return <FriendProfile key={`${uid}:${attempt}`} uid={uid} onRetry={() => setAttempt((value) => value + 1)} />;
}

function MyProfile({ uid }: { uid: string }) {
  usePageTitle('Мой профиль');
  const auth = useAuth();
  const membership = useMembership();
  const member = membership.status === 'member' ? membership.member : null;
  const user = auth.status === 'signed-in' ? auth.user : null;
  const { cards, byId, ready, error, retry } = useOwned();
  const views = useCardViews(cards, ready);
  const [editing, setEditing] = useState(false);
  const showcase = showcaseOf(member);
  const name = member?.displayName ?? user?.displayName ?? 'Без имени';
  const photoURL = member?.photoURL ?? user?.photoURL ?? null;
  const owner = useMemo<FeedOwner>(() => ({ uid, displayName: name, photoURL }), [uid, name, photoURL]);
  const sources = useMemo(() => (views ? [{ owner, cards: views }] : null), [owner, views]);

  return (
    <>
      <ProfileView
        name={name}
        photoURL={photoURL}
        since={joinedLabel(member?.joinedAt ?? null)}
        mine
        album={error ? 'error' : ready ? 'ready' : 'loading'}
        albumError={error}
        onRetry={retry}
        views={views}
        showcase={showcase}
        onEditShowcase={() => setEditing(true)}
        tile={(view, size) => <CardTile view={view} size={size} href={cardHref(view)} />}
        feed={
          <FeedPanel
            title="Новое в альбоме"
            note="Так твои новые карты видят друзья в ленте"
            sources={sources}
            href={cardHref}
            empty="Новых карт пока нет. Отсканируй карточки, и они появятся здесь."
          />
        }
      />
      <ShowcaseEditor open={editing} uid={uid} views={views} owned={byId} current={showcase} onClose={() => setEditing(false)} />
    </>
  );
}

const cardHref = (view: CardView) => `/card/${encodeURIComponent(view.docId)}`;

function FriendProfile({ uid, onRetry }: { uid: string; onRetry: () => void }) {
  const member = useClubMember(uid);
  const album = useFriendAlbum(uid);
  const views = useCardViews(album.status === 'ready' ? album.value : [], album.status === 'ready');
  const mine = useOwned();
  const [open, setOpen] = useState<CardView | null>(null);
  const person = member.status === 'ready' ? member.value : null;
  const sources = useMemo(() => (person && views ? [{ owner: person, cards: views }] : null), [person, views]);
  usePageTitle(person?.displayName ?? 'Профиль');
  const [, navigate] = useLocation();

  if (member.status === 'loading') return <ProfileSkeleton />;
  if (member.status === 'error') {
    return (
      <EmptyState variant="page" tone="error" title="Не получилось открыть профиль" action={<Button onClick={onRetry}>Обновить</Button>}>
        {member.message}
      </EmptyState>
    );
  }
  if (!person) {
    return (
      <EmptyState
        variant="page"
        art="friends"
        title="Участник не найден"
        action={<Button onClick={() => navigate('/friends')}>Все участники клуба</Button>}
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
        onRetry={onRetry}
        views={views}
        showcase={person.showcase}
        tile={(view, size) => <CardTile view={view} size={size} onOpen={() => setOpen(view)} />}
        feed={
          <FeedPanel
            title="Новое в альбоме"
            sources={sources}
            onOpen={(_, view) => setOpen(view)}
            empty={views && views.length === 0 ? 'Альбом пока пуст.' : 'Новых карт пока нет.'}
          />
        }
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
  /** «Обновить» после ошибки альбома */
  onRetry?: () => void;
  views: CardView[] | null;
  showcase: string[];
  onEditShowcase?: () => void;
  tile: (view: CardView, size: 'normal' | 'small') => ReactNode;
  /** Разделы под витриной */
  extra?: ReactNode;
  /** Правая колонка из макета: лента новых карт */
  feed?: ReactNode;
};

function ProfileView({ name, photoURL, since, mine, album, albumError, onRetry, views, showcase, onEditShowcase, tile, extra, feed }: ViewProps) {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<'show' | 'all'>('show');
  const loaded = views ?? [];
  const totals = views ? collectionTotals(views) : null;
  const value = totals ? valueParts(totals) : null;
  // Пока альбом грузится — заглушки чисел, после ошибки — прочерк
  const pending = album === 'error' ? '—' : <Skeleton shape="text" width="2.2em" />;
  const shown = pickShowcase(showcase, loaded);
  const emptySlots = mine && views && views.length > 0 ? MAX_SHOWCASE - shown.length : 0;
  const empty = album === 'ready' && views !== null && views.length === 0;

  let body: ReactNode;
  if (album === 'error') {
    body = (
      <EmptyState
        variant="page"
        tone="error"
        title={mine ? 'Твой альбом не загрузился' : 'Альбом не загрузился'}
        action={onRetry ? <Button onClick={onRetry}>Обновить</Button> : undefined}
      >
        {albumError}
      </EmptyState>
    );
  } else if (empty) {
    body = mine ? (
      <EmptyState
        variant="page"
        art="album"
        title="Сначала добавь карты в альбом"
        action={
          <Button start={<PlusIcon size={16} stroke={2.2} />} onClick={() => navigate('/scan')}>
            Добавить карточки
          </Button>
        }
      >
        Сфотографируй свои карточки: Binder узнает их и сложит в альбом. Потом выбери до шести для витрины — их друзья увидят первыми.
      </EmptyState>
    ) : (
      <EmptyState variant="page" art="friends" title="Альбом пока пуст">
        {`Когда ${name} добавит карты, они появятся здесь и в ленте друзей.`}
      </EmptyState>
    );
  } else {
    body = (
      <>
        <nav aria-label="Разделы профиля" className={styles.tabs}>
          <button type="button" aria-pressed={tab === 'show'} className={styles.tab} onClick={() => setTab('show')}>
            Витрина
          </button>
          <button type="button" aria-pressed={tab === 'all'} className={styles.tab} onClick={() => setTab('all')}>
            Коллекция
            {totals && <span className={styles.tabCount}>{formatInteger(totals.copies)}</span>}
          </button>
        </nav>

        <div className={page.split}>
          {tab === 'show' ? (
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
                  <SkeletonArea label="Загружаю альбом…" className={styles.grid}>
                    {Array.from({ length: MAX_SHOWCASE }, (_, index) => (
                      <Skeleton key={index} shape="card" />
                    ))}
                  </SkeletonArea>
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
          ) : (
            <div className={styles.column}>
              {!views && (
                <SkeletonArea label="Загружаю альбом…" className={styles.panel}>
                  <Skeleton shape="text" width="9em" />
                  <div className={styles.albumGrid}>
                    {Array.from({ length: 8 }, (_, index) => (
                      <Skeleton key={index} shape="card" />
                    ))}
                  </div>
                </SkeletonArea>
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
          {feed && <aside className={page.side}>{feed}</aside>}
        </div>
      </>
    );
  }

  return (
    <>
      <section className={styles.top}>
        <Avatar src={photoURL} name={name} size={88} />
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
        {mine && onEditShowcase && album !== 'error' && !empty && (
          <div className={styles.actions}>
            <Button className={styles.action} start={<PencilIcon size={16} stroke={2} />} onClick={onEditShowcase}>
              Изменить витрину
            </Button>
          </div>
        )}
      </section>
      {body}
    </>
  );
}

/** Профиль друга, пока читается документ участника: шапка и витрина заглушками. */
function ProfileSkeleton() {
  return (
    <SkeletonArea label="Загружаю профиль…" className={styles.skeleton}>
      <div className={styles.top}>
        <Skeleton shape="circle" width={88} height={88} />
        <div className={styles.identity}>
          <Skeleton shape="text" width="6em" className={styles.name} />
          <Skeleton shape="text" width="9em" className={styles.meta} />
        </div>
      </div>
      <div className={styles.tabs}>
        <Skeleton shape="text" width="12em" className={styles.skeletonTabs} />
      </div>
      <div className={styles.grid}>
        {Array.from({ length: MAX_SHOWCASE }, (_, index) => (
          <Skeleton key={index} shape="card" />
        ))}
      </div>
    </SkeletonArea>
  );
}
