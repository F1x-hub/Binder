import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { useOwned } from '@/lib/collection-state';
import type { Deck } from '@/lib/decks';
import { DECK_SIZE } from '@/lib/deck-rules';
import { CARD_FORMS, DECK_FORMS, SET_FORMS, countLabel, formatCardPrice, formatInteger, formatUsd } from '@/lib/format';
import type { ClubMember } from '@/lib/friends';
import { displayNames } from '@/lib/names';
import { useClubMembers } from '@/lib/useClubMembers';
import { collectionTotals, newestFirst, useCardViews, type CardView } from '@/lib/useCardViews';
import { useDecks, type DecksState } from '@/lib/useDecks';
import { useFriendAlbum } from '@/lib/useFriendAlbum';
import { Button } from '@/ui/Button';
import { CardImage } from '@/ui/CardImage';
import { EmptyState } from '@/ui/EmptyState';
import { ForwardIcon, PlusIcon, ScanIcon } from '@/ui/Icons';
import { Skeleton, SkeletonArea } from '@/ui/Skeleton';
import { FeedPanel, type FeedOwner } from './FeedPanel';
import { FriendCardViewer } from './FriendCardViewer';
import { numberLabel } from './ProfileParts';
import page from './Page.module.css';
import styles from './Home.module.css';

/** Сколько своих карт показывать в «Недавно добавлены» и сколько колод в списке. */
const RECENT = 6;
const DECKS_SHOWN = 4;

/** Карты альбома друга для ленты: null — ещё грузятся, 'error' — не загрузились. */
type AlbumViews = CardView[] | 'error' | null;

/**
 * Главная вкладки (#/home): сюда ведут логотип, пустой адрес и вход. Слева — что нового у друзей,
 * справа — своя коллекция, быстрый скан, недавние карты и колоды.
 *
 * Своих чтений Firestore у главной нет сверх тех, что делают альбом, «Друзья» и колоды: свой альбом
 * и колоды — те же подписки, участники — из памяти вкладки (useClubMembers, раз в 10 минут),
 * альбомы друзей — из кэша браузера с дочитыванием изменений (useFriendAlbum), цены — из общего кэша.
 */
export function Home() {
  usePageTitle('Главная');
  const auth = useAuth();
  const uid = auth.status === 'signed-in' ? auth.user.uid : null;
  const { cards, ready, error, retry } = useOwned();
  const views = useCardViews(cards, ready);
  const decks = useDecks(uid);

  if (error) {
    return (
      <EmptyState variant="page" tone="error" title="Альбом не загрузился" action={<Button onClick={retry}>Обновить</Button>}>
        {error}
      </EmptyState>
    );
  }

  return (
    <>
      <h1 className={styles.srOnly}>Главная</h1>
      <div className={styles.layout}>
        <div className={styles.feed}>
          <FriendsFeed myUid={uid} />
        </div>
        <aside className={styles.side} aria-label="Моя коллекция">
          <CollectionPanel views={views} ready={ready} empty={ready && cards.length === 0} decks={decks} />
          <ScanPanel />
          {!(ready && cards.length === 0) && <RecentPanel views={views} />}
          <DecksPanel decks={decks} />
        </aside>
      </div>
    </>
  );
}

/* ---------- Лента друзей ---------- */

/** «Обновить» после ошибки списка участников: новый экземпляр ленты читает список заново. */
function FriendsFeed({ myUid }: { myUid: string | null }) {
  const [attempt, setAttempt] = useState(0);
  return <MembersFeed key={attempt} myUid={myUid} onRetry={() => setAttempt((value) => value + 1)} />;
}

function MembersFeed({ myUid, onRetry }: { myUid: string | null; onRetry: () => void }) {
  const [, navigate] = useLocation();
  const members = useClubMembers(true);
  const others = useMemo(
    () => (members.status === 'ready' ? members.members.filter((member) => member.uid !== myUid) : []),
    [members, myUid],
  );
  const [albums, setAlbums] = useState<Readonly<Record<string, AlbumViews>>>({});
  const report = useCallback(
    (uid: string, views: AlbumViews) => setAlbums((previous) => (previous[uid] === views ? previous : { ...previous, [uid]: views })),
    [],
  );
  const [open, setOpen] = useState<{ owner: FeedOwner; view: CardView } | null>(null);
  const mine = useOwned();

  // Лента ждёт все альбомы, иначе события прыгали бы по мере загрузки (как на «Друзьях»)
  const loaded = others.every((member) => albums[member.uid] != null);
  const sources = useMemo(
    () =>
      members.status === 'ready' && loaded
        ? others.flatMap((member) => {
            const views = albums[member.uid];
            return Array.isArray(views) ? [{ owner: member, cards: views }] : [];
          })
        : null,
    [members.status, loaded, others, albums],
  );
  const failed = others.filter((member) => albums[member.uid] === 'error').length;

  if (members.status === 'error') {
    return (
      <EmptyState
        variant="page"
        tone="error"
        art="friends"
        title="Лента не загрузилась"
        action={<Button onClick={onRetry}>Обновить</Button>}
      >
        Не получилось загрузить участников клуба. Проверь интернет и обнови ленту.
      </EmptyState>
    );
  }

  if (members.status === 'ready' && others.length === 0) {
    return (
      <EmptyState
        variant="page"
        art="friends"
        title="Друзей пока нет"
        action={
          <Button start={<PlusIcon size={16} stroke={2.2} />} onClick={() => navigate('/friends')}>
            Пригласить друга
          </Button>
        }
      >
        Здесь будет видно, какие карты добавляют друзья. Позови их в клуб по коду приглашения.
      </EmptyState>
    );
  }

  return (
    <>
      {others.map((member) => (
        <AlbumSource key={member.uid} member={member} onViews={report} />
      ))}
      {sources === null ? (
        <FeedSkeleton />
      ) : (
        <FeedPanel
          title="Что нового у друзей"
          sources={sources}
          showOwner
          onOpen={(owner, view) => setOpen({ owner, view })}
          empty="Когда друзья добавят карты в альбомы, они появятся здесь."
          warning={failed > 0 ? 'Не все альбомы друзей загрузились, поэтому лента неполная.' : null}
        />
      )}
      <FriendCardViewer
        view={open?.view ?? null}
        owner={open?.owner.displayName ?? ''}
        mine={open ? mine.byId.has(open.view.docId) : false}
        onClose={() => setOpen(null)}
      />
    </>
  );
}

/** Альбом друга для ленты: ничего не рисует, отдаёт карты наверх. */
function AlbumSource({ member, onViews }: { member: ClubMember; onViews: (uid: string, views: AlbumViews) => void }) {
  const album = useFriendAlbum(member.uid);
  const views = useCardViews(album.status === 'ready' ? album.value : NO_CARDS, album.status === 'ready');
  useEffect(() => {
    onViews(member.uid, album.status === 'error' ? 'error' : views);
  }, [onViews, member.uid, album.status, views]);
  return null;
}

const NO_CARDS: never[] = [];

function FeedSkeleton() {
  return (
    <SkeletonArea label="Загружаю ленту друзей…" className={styles.panel}>
      <h2 className={styles.panelTitle}>Что нового у друзей</h2>
      <div className={styles.feedRows}>
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className={styles.feedRow}>
            <Skeleton shape="circle" width={40} height={40} />
            <div className={styles.feedRowText}>
              <Skeleton shape="text" width={row % 2 ? '14em' : '18em'} />
              <div className={styles.feedThumbs}>
                {[0, 1, 2].map((card) => (
                  <Skeleton key={card} shape="card" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </SkeletonArea>
  );
}

/* ---------- Правая колонка ---------- */

function CollectionPanel({ views, ready, empty, decks }: { views: CardView[] | null; ready: boolean; empty: boolean; decks: DecksState }) {
  const totals = views ? collectionTotals(views) : null;
  const meta = totals
    ? [
        countLabel(totals.copies, CARD_FORMS),
        countLabel(totals.sets, SET_FORMS),
        // Пока колоды не пришли, их число не показываем, чтобы не мелькал «0 колод»
        decks.status === 'ready' ? countLabel(decks.decks.length, DECK_FORMS) : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ')
    : null;

  return (
    <section className={styles.panel} aria-labelledby="home-collection">
      <div className={styles.panelHead}>
        <h2 id="home-collection" className={styles.panelLabel}>
          Моя коллекция
        </h2>
        {!empty && (
          <Link href="/library" className={page.textLink}>
            Открыть альбом
          </Link>
        )}
      </div>
      {empty ? (
        <p className={styles.muted}>Альбом пока пуст. Отсканируй первые карточки, и здесь появится их стоимость.</p>
      ) : (
        <>
          {/* Стоимость известна, когда карты разложены и цены подтянулись */}
          <div className={styles.value}>{totals ? formatUsd(totals.value, true) : <Skeleton shape="text" width="4.4em" />}</div>
          {totals && totals.euro > 0 && (
            <div className={styles.muted}>и {formatCardPrice({ u: null, e: totals.euro })} по ценам Cardmarket</div>
          )}
          <div className={styles.muted}>{ready && meta ? meta : <Skeleton shape="text" width="14em" />}</div>
        </>
      )}
    </section>
  );
}

function ScanPanel() {
  const [, navigate] = useLocation();
  return (
    <section className={styles.panel} aria-labelledby="home-scan">
      <h2 id="home-scan" className={styles.panelTitle}>
        Добавить карточки
      </h2>
      <p className={styles.muted}>Сфотографируй карты: Binder узнает их, положит в альбом и покажет цены.</p>
      <Button className={styles.wide} start={<ScanIcon stroke={1.9} />} onClick={() => navigate('/scan')}>
        Сканировать карточки
      </Button>
    </section>
  );
}

function RecentPanel({ views }: { views: CardView[] | null }) {
  const recent = views ? newestFirst(views).slice(0, RECENT) : null;
  return (
    <section className={styles.panel} aria-labelledby="home-recent">
      <h2 id="home-recent" className={styles.panelTitle}>
        Недавно добавлены
      </h2>
      {recent === null ? (
        <SkeletonArea label="Загружаю недавние карточки…" className={styles.recentGrid}>
          {Array.from({ length: RECENT }, (_, index) => (
            <div key={index} className={styles.recentCard}>
              <Skeleton shape="card" />
              <Skeleton shape="text" width="4em" />
            </div>
          ))}
        </SkeletonArea>
      ) : (
        <ul className={styles.recentGrid}>
          {recent.map((view) => {
            const name = displayNames(view.name, view.englishName).primary;
            return (
              <li key={view.docId}>
                <Link href={`/card/${encodeURIComponent(view.docId)}`} className={styles.recentCard} aria-label={`${name}: открыть карточку`}>
                  <CardImage
                    image={view.image}
                    limitless={view.limitless}
                    thumb={view.thumb}
                    name={name}
                    number={numberLabel(view)}
                    lang={view.lang}
                  />
                  <span className={styles.price}>{formatCardPrice(view.price)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Сколько карт в колоде: сумма копий по записям. */
function deckSize(deck: Deck): number {
  return Object.values(deck.cards).reduce((sum, count) => sum + count, 0);
}

function DecksPanel({ decks }: { decks: DecksState }) {
  const shown =
    decks.status === 'ready'
      ? [...decks.decks].sort((a, b) => (b.updatedAt?.toMillis() ?? 0) - (a.updatedAt?.toMillis() ?? 0)).slice(0, DECKS_SHOWN)
      : [];
  return (
    <section className={styles.panel} aria-labelledby="home-decks">
      <div className={styles.panelHead}>
        <h2 id="home-decks" className={styles.panelTitle}>
          Колоды
        </h2>
        {decks.status === 'ready' && decks.decks.length > 0 && (
          <Link href="/decks" className={page.textLink}>
            Все колоды
          </Link>
        )}
      </div>
      {decks.status === 'loading' && (
        <SkeletonArea label="Загружаю колоды…" className={styles.deckList}>
          <Skeleton height={48} />
          <Skeleton height={48} />
        </SkeletonArea>
      )}
      {decks.status === 'error' && <p className={styles.muted}>Колоды не загрузились. Они есть на странице «Колоды».</p>}
      {decks.status === 'ready' && decks.decks.length === 0 && (
        <p className={styles.muted}>
          Колод пока нет.{' '}
          <Link href="/decks" className={page.textLink}>
            Собрать колоду
          </Link>
        </p>
      )}
      {shown.length > 0 && (
        <ul className={styles.deckList}>
          {shown.map((deck) => {
            const size = deckSize(deck);
            return (
              <li key={deck.id}>
                <Link href={`/decks/${deck.id}`} className={styles.deck}>
                  <span className={styles.deckName}>{deck.name}</span>
                  <span className={styles.deckSize}>
                    {formatInteger(size)} из {DECK_SIZE}
                  </span>
                  <ForwardIcon size={16} stroke={2} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
