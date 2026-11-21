import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { InviteCard } from '@/app/InviteCard';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { useOwned } from '@/lib/collection-state';
import { binderDb } from '@/lib/db';
import { CARD_FORMS, formatInteger, pluralWord, type WordForms } from '@/lib/format';
import { clubMembers, friendsErrorMessage, joinedLabel, type ClubMember } from '@/lib/friends';
import { displayNames } from '@/lib/names';
import { pickShowcase } from '@/lib/showcase';
import { collectionTotals, useCardViews, type CardView } from '@/lib/useCardViews';
import { useFriendAlbum } from '@/lib/useFriendAlbum';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { CardImage } from '@/ui/CardImage';
import { EmptyState } from '@/ui/EmptyState';
import { ForwardIcon } from '@/ui/Icons';
import { Skeleton, SkeletonArea } from '@/ui/Skeleton';
import { FeedPanel, type FeedOwner } from './FeedPanel';
import { FriendCardViewer } from './FriendCardViewer';
import { numberLabel, valueParts } from './ProfileParts';
import styles from './Page.module.css';
import friends from './Friends.module.css';

const MEMBER_FORMS: WordForms = ['участник', 'участника', 'участников'];

type MembersState = { status: 'loading' } | { status: 'ready'; members: ClubMember[] } | { status: 'error'; message: string };

/** Карты альбома друга для ленты: null — ещё грузятся, 'error' — не загрузились. */
type AlbumViews = CardView[] | 'error' | null;

/**
 * Друзья: слева лента «кто что добавил» с галереей карт, справа участники клуба
 * (число карт, стоимость альбома, витрина) и «Пригласить в клуб».
 * Список участников — одно чтение на участника, альбом каждого — из кэша браузера
 * с дочитыванием изменений (src/lib/friends.ts), цены — из общего кэша клуба.
 * Лента собирается из тех же альбомов: строки участников отдают ей свои карты,
 * своих чтений у ленты нет.
 */
export function Friends() {
  usePageTitle('Друзья');
  const auth = useAuth();
  const myUid = auth.status === 'signed-in' ? auth.user.uid : null;
  const [state, setState] = useState<MembersState>({ status: 'loading' });
  // «Обновить» после ошибки читает список заново: чтение только по нажатию
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    clubMembers(binderDb()).then(
      (members) => active && setState({ status: 'ready', members }),
      (error: unknown) => active && setState({ status: 'error', message: friendsErrorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const others = useMemo(
    () => (state.status === 'ready' ? state.members.filter((member) => member.uid !== myUid) : []),
    [state, myUid],
  );
  const [albums, setAlbums] = useState<Readonly<Record<string, AlbumViews>>>({});
  const report = useCallback(
    (uid: string, views: AlbumViews) => setAlbums((previous) => (previous[uid] === views ? previous : { ...previous, [uid]: views })),
    [],
  );
  // Альбомы, которые не загрузились, перечитываются по «Обновить»: строка участника монтируется заново
  const [albumAttempt, setAlbumAttempt] = useState<Readonly<Record<string, number>>>({});
  const [open, setOpen] = useState<{ owner: FeedOwner; view: CardView } | null>(null);
  const mine = useOwned();

  // Лента ждёт все альбомы, иначе события прыгали бы по мере загрузки
  const loaded = others.every((member) => albums[member.uid] != null);
  const sources = useMemo(
    () =>
      state.status === 'ready' && loaded
        ? others.flatMap((member) => {
            const views = albums[member.uid];
            return Array.isArray(views) ? [{ owner: member, cards: views }] : [];
          })
        : null,
    [state.status, loaded, others, albums],
  );
  const failed = others.filter((member) => albums[member.uid] === 'error');
  const retryAlbums = () =>
    setAlbumAttempt((previous) => {
      const next = { ...previous };
      for (const member of failed) next[member.uid] = (next[member.uid] ?? 0) + 1;
      return next;
    });

  const head = (
    <div className={friends.head}>
      <h1 className={styles.title}>Друзья</h1>
      {state.status === 'ready' && (
        <span className={styles.heroMeta}>
          В клубе {formatInteger(state.members.length)} {pluralWord(state.members.length, MEMBER_FORMS)}
        </span>
      )}
    </div>
  );

  if (state.status === 'error') {
    return (
      <>
        {head}
        <EmptyState
          variant="page"
          tone="error"
          title="Не получилось загрузить участников"
          action={<Button onClick={() => setAttempt((value) => value + 1)}>Обновить</Button>}
        >
          {state.message}
        </EmptyState>
      </>
    );
  }

  if (state.status === 'ready' && others.length === 0) {
    return (
      <>
        {head}
        <EmptyState
          variant="page"
          art="friends"
          title="В клубе пока только ты"
          action={
            <div className={friends.emptyInvite}>
              <InviteCard />
            </div>
          }
        >
          Дай другу код приглашения: когда он вступит, здесь появятся его новые карты, альбом и витрина.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {head}
      <div className={friends.layout}>
        <FeedPanel
          layout="wide"
          title="Что нового у друзей"
          sources={sources}
          showOwner
          onOpen={(owner, view) => setOpen({ owner, view })}
          empty="Когда друзья добавят карты в альбомы, они появятся здесь."
          warning={
            failed.length > 0 ? (
              <>
                <span>
                  {failed.length === 1 ? 'Не загрузился альбом: ' : 'Не загрузились альбомы: '}
                  {failed.map((member) => member.displayName).join(', ')}. Лента неполная.
                </span>
                <Button variant="link" className={friends.retry} onClick={retryAlbums}>
                  Обновить
                </Button>
              </>
            ) : null
          }
        />
        <aside className={friends.side}>
          <MembersPanel loading={state.status === 'loading'}>
            {others.map((member) => (
              <FriendRow key={`${member.uid}:${albumAttempt[member.uid] ?? 0}`} member={member} onViews={report} />
            ))}
          </MembersPanel>
          <InviteCard />
        </aside>
      </div>
      <FriendCardViewer
        view={open?.view ?? null}
        owner={open?.owner.displayName ?? ''}
        mine={open ? mine.byId.has(open.view.docId) : false}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

/** Панель «Участники»: пока список грузится — заглушки строк. */
function MembersPanel({ loading, children }: { loading: boolean; children: ReactNode }) {
  const titleId = useId();
  return (
    <section className={friends.panel} aria-labelledby={titleId}>
      <h2 id={titleId} className={friends.panelTitle}>
        Участники
      </h2>
      {loading ? (
        <SkeletonArea label="Загружаю участников клуба…" className={friends.list}>
          {[0, 1, 2].map((index) => (
            <div key={index} className={friends.skeletonRow}>
              <div className={friends.who}>
                <Skeleton shape="circle" width={44} height={44} />
                <div className={friends.whoText}>
                  <Skeleton shape="text" width="6em" />
                  <Skeleton shape="text" width="9em" className={friends.muted} />
                </div>
              </div>
              <div className={friends.strip}>
                {Array.from({ length: 6 }, (_, card) => (
                  <Skeleton key={card} shape="card" />
                ))}
              </div>
            </div>
          ))}
        </SkeletonArea>
      ) : (
        <ul className={friends.list} aria-label="Участники клуба">
          {children}
        </ul>
      )}
    </section>
  );
}

/**
 * Строка участника: аватар, имя, с какого времени в клубе, число карт, стоимость и витрина.
 * Вся строка ведёт в профиль. Карты альбома отдаёт странице для ленты (onViews).
 */
function FriendRow({ member, onViews }: { member: ClubMember; onViews: (uid: string, views: AlbumViews) => void }) {
  const album = useFriendAlbum(member.uid);
  const cards = album.status === 'ready' ? album.value : [];
  const views = useCardViews(cards, album.status === 'ready');
  useEffect(() => {
    onViews(member.uid, album.status === 'error' ? 'error' : views);
  }, [onViews, member.uid, album.status, views]);
  const totals = views ? collectionTotals(views) : null;
  const value = totals ? valueParts(totals) : null;
  const showcase = pickShowcase(member.showcase, views ?? []);
  const since = joinedLabel(member.joinedAt);

  return (
    <li>
      <Link href={`/u/${member.uid}`} className={friends.row}>
        <div className={friends.who}>
          <Avatar src={member.photoURL} name={member.displayName} size={44} />
          <div className={friends.whoText}>
            <span className={friends.name}>{member.displayName}</span>
            {album.status === 'error' ? (
              <span className={friends.muted}>Альбом не загрузился</span>
            ) : totals && value ? (
              <span className={friends.stats}>
                <span className={friends.statsMain}>
                  {formatInteger(totals.copies)} {pluralWord(totals.copies, CARD_FORMS)} · {value.main}
                </span>
                {value.note && <span className={friends.muted}> {value.note}</span>}
              </span>
            ) : (
              <Skeleton shape="text" width="9em" className={friends.muted} />
            )}
            {since && <span className={friends.muted}>{since}</span>}
          </div>
          <span className={friends.chevron}>
            <ForwardIcon size={18} stroke={2} />
          </span>
        </div>

        {showcase.length > 0 && (
          // Превью витрины: подробности — в профиле, поэтому для чтения с экрана она скрыта
          <div className={friends.strip} aria-hidden="true">
            {showcase.map((view) => {
              const names = displayNames(view.name, view.englishName);
              return (
                <CardImage
                  key={view.docId}
                  image={view.image}
                  limitless={view.limitless}
                  thumb={view.thumb}
                  name={names.primary}
                  number={numberLabel(view)}
                />
              );
            })}
          </div>
        )}
      </Link>
    </li>
  );
}
