import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { InviteCard } from '@/app/InviteCard';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { binderDb } from '@/lib/db';
import { CARD_FORMS, formatInteger, pluralWord, type WordForms } from '@/lib/format';
import { clubMembers, friendsErrorMessage, joinedLabel, type ClubMember } from '@/lib/friends';
import { displayNames } from '@/lib/names';
import { pickShowcase } from '@/lib/showcase';
import { collectionTotals, useCardViews } from '@/lib/useCardViews';
import { useFriendAlbum } from '@/lib/useFriendAlbum';
import { Avatar } from '@/ui/Avatar';
import { CardImage } from '@/ui/CardImage';
import { EmptyState } from '@/ui/EmptyState';
import { ForwardIcon } from '@/ui/Icons';
import { Stat, numberLabel, valueParts } from './ProfileParts';
import styles from './Page.module.css';
import friends from './Friends.module.css';

const MEMBER_FORMS: WordForms = ['участник', 'участника', 'участников'];

type MembersState = { status: 'loading' } | { status: 'ready'; members: ClubMember[] } | { status: 'error'; message: string };

/**
 * Друзья: все участники клуба, у каждого число карт, стоимость альбома и витрина.
 * Список участников — одно чтение на участника, альбом каждого — из кэша браузера
 * с дочитыванием изменений (src/lib/friends.ts), цены — из общего кэша клуба.
 */
export function Friends() {
  usePageTitle('Друзья');
  const auth = useAuth();
  const myUid = auth.status === 'signed-in' ? auth.user.uid : null;
  const [state, setState] = useState<MembersState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    clubMembers(binderDb()).then(
      (members) => active && setState({ status: 'ready', members }),
      (error: unknown) => active && setState({ status: 'error', message: friendsErrorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, []);

  const others = state.status === 'ready' ? state.members.filter((member) => member.uid !== myUid) : [];

  return (
    <>
      <div className={friends.head}>
        <div className={friends.headText}>
          <h1 className={styles.title}>Друзья</h1>
          {state.status === 'ready' && (
            <span className={styles.heroMeta}>
              В клубе {formatInteger(state.members.length)} {pluralWord(state.members.length, MEMBER_FORMS)}
            </span>
          )}
        </div>
        <Link href="/u/me" className={styles.textLink}>
          Мой профиль и витрина
        </Link>
      </div>

      <div className={styles.split}>
        <div className={friends.main}>
          {state.status === 'loading' && <p className={friends.muted}>Загружаем участников клуба…</p>}
          {state.status === 'error' && <EmptyState title="Не получилось загрузить участников">{state.message}</EmptyState>}
          {state.status === 'ready' && others.length === 0 && (
            <EmptyState title="Друзей пока нет">
              Когда друзья вступят в клуб по твоему коду приглашения, здесь появятся их альбомы и витрины.
            </EmptyState>
          )}
          {others.length > 0 && (
            <ul className={friends.list} aria-label="Участники клуба">
              {others.map((member) => (
                <FriendCard key={member.uid} member={member} />
              ))}
            </ul>
          )}
        </div>
        <aside className={styles.side}>
          <InviteCard />
        </aside>
      </div>
    </>
  );
}

/** Карточка друга: имя, с какого времени в клубе, число карт, стоимость и витрина. Ведёт в профиль. */
function FriendCard({ member }: { member: ClubMember }) {
  const album = useFriendAlbum(member.uid);
  const cards = album.status === 'ready' ? album.value : [];
  const views = useCardViews(cards, album.status === 'ready');
  const totals = views ? collectionTotals(views) : null;
  const value = totals ? valueParts(totals) : null;
  const showcase = pickShowcase(member.showcase, views ?? []);
  const since = joinedLabel(member.joinedAt);
  const pending = album.status === 'loading' ? '…' : '—';

  return (
    <li>
      <Link href={`/u/${member.uid}`} className={friends.card}>
        <div className={friends.who}>
          <Avatar src={member.photoURL} size={48} />
          <div className={friends.whoText}>
            <span className={friends.name}>{member.displayName}</span>
            {since && <span className={friends.muted}>{since}</span>}
          </div>
          <span className={friends.chevron}>
            <ForwardIcon size={18} stroke={2} />
          </span>
        </div>

        <div className={friends.stats}>
          <Stat
            small
            value={totals ? formatInteger(totals.copies) : pending}
            label={totals ? pluralWord(totals.copies, CARD_FORMS) : 'карточек'}
          />
          <Stat small value={value?.main ?? pending} label="стоимость" note={value?.note} />
        </div>

        {album.status === 'error' ? (
          <span className={friends.muted}>Альбом не загрузился</span>
        ) : showcase.length > 0 ? (
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
        ) : (
          <span className={friends.muted}>{totals && totals.copies === 0 ? 'Альбом пока пуст' : 'Витрина пока пуста'}</span>
        )}
      </Link>
    </li>
  );
}
