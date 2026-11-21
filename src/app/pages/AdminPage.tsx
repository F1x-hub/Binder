import { Timestamp, collection, doc, getCountFromServer, onSnapshot } from 'firebase/firestore';
import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { MAX_INVITES, removeMember, setInvitesLeft, setRole, useIsAdmin } from '@/lib/admin';
import { useAuth } from '@/lib/auth-state';
import { MAX_CLUB_KEYS, MAX_LABEL, clubKeysFrom, maskKey, saveClubKeys, validKeyText, type ClubKey } from '@/lib/club-keys';
import { binderDb } from '@/lib/db';
import { CARD_FORMS, INVITE_FORMS, countLabel } from '@/lib/format';
import { clubMemberFrom } from '@/lib/friends';
import { checkJusttcgKey, type KeyCheck } from '@/lib/justtcg';
import type { Role } from '@/lib/membership';
import { forgetLegacyKey, loadKeyStates, loadLegacyKey, onKeyStatesChanged, type KeyState, type KeyStates } from '@/lib/justtcg-keys';
import { utcDay } from '@/lib/prices';
import { memberSinceLabel } from '@/settings/account';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { cx } from '@/ui/cx';
import { EmptyState } from '@/ui/EmptyState';
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, MinusIcon, PlusIcon } from '@/ui/Icons';
import fieldStyles from '@/ui/TextField.module.css';
import pageStyles from './Page.module.css';
import styles from './AdminPage.module.css';

/**
 * Страница админа, #/admin: ключи JustTCG клуба и участники. Видна в меню аккаунта только
 * админу (role: 'admin' в members/{uid}); правила всё равно проверяют каждую запись.
 */
export function AdminPage() {
  usePageTitle('Админ');
  const auth = useAuth();
  const uid = auth.status === 'signed-in' ? auth.user.uid : null;
  const admin = useIsAdmin(uid);

  if (admin === null || !uid) return <p className={styles.muted}>Проверяем доступ…</p>;
  if (!admin) {
    return (
      <EmptyState
        title="Эта страница только для админа"
        action={
          <Link href="/library" className={styles.textLink}>
            Вернуться в альбом
          </Link>
        }
      >
        Первого админа назначают в консоли Firebase: поле role со значением admin в твоём документе members. Дальше роли меняет админ на этой странице.
      </EmptyState>
    );
  }

  return (
    <>
      <h1 className={pageStyles.title}>Админ</h1>
      <div className={styles.stack}>
        <KeysPanel uid={uid} />
        <MembersPanel uid={uid} />
      </div>
    </>
  );
}

/* ---------- Ключи JustTCG ---------- */

type Check = { status: 'checking' } | KeyCheck;

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

function KeysPanel({ uid }: { uid: string }) {
  const titleId = useId();
  const [items, setItems] = useState<ClubKey[] | null>(null);
  const [states, setStates] = useState<KeyStates>({});
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [legacy, setLegacy] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Список живой: правка в другой вкладке или у другого админа видна сразу
  useEffect(
    () =>
      onSnapshot(
        doc(binderDb(), 'config', 'justtcg'),
        (snapshot) => setItems(clubKeysFrom(snapshot.data())),
        () => setError('Не удалось прочитать ключи. Проверь интернет.'),
      ),
    [],
  );

  useEffect(() => {
    const refresh = () => void loadKeyStates().then(setStates).catch(() => undefined);
    refresh();
    void loadLegacyKey().then(setLegacy).catch(() => undefined);
    return onKeyStatesChanged(refresh);
  }, []);

  const save = async (next: ClubKey[]) => {
    const before = items;
    setItems(next);
    setSaving(true);
    setError(null);
    try {
      await saveClubKeys(binderDb(), uid, next);
      return true;
    } catch {
      setItems(before);
      setError('Не получилось сохранить. Проверь интернет и попробуй ещё раз.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const check = async (key: string) => {
    setChecks((current) => ({ ...current, [key]: { status: 'checking' } }));
    const result = await checkJusttcgKey(key);
    setChecks((current) => ({ ...current, [key]: result }));
  };

  const add = async (key: string, label: string) => {
    if (!items) return false;
    const saved = await save([...items, { key, label, enabled: true, addedAt: Timestamp.now() }]);
    if (saved) void check(key);
    return saved;
  };

  const update = (index: number, patch: Partial<ClubKey>) =>
    items && save(items.map((item, at) => (at === index ? { ...item, ...patch } : item)));

  const move = (index: number, shift: -1 | 1) => {
    if (!items) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(index + shift, 0, item!);
    void save(next);
  };

  const remove = (index: number) => items && save(items.filter((_, at) => at !== index));

  const enabled = items?.filter((item) => item.enabled) ?? [];
  const today = utcDay();
  const known = enabled.map((item) => states[item.key]?.usage).filter((usage) => usage && usage.dayLimit !== null);
  const dayLeft = known.reduce((sum, usage) => sum + (usage!.day === today ? (usage!.dayLeft ?? 0) : usage!.dayLimit!), 0);
  const dayLimit = known.reduce((sum, usage) => sum + usage!.dayLimit!, 0);
  const showLegacy = Boolean(legacy) && items !== null && !items.some((item) => item.key === legacy) && items.length < MAX_CLUB_KEYS;

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <div className={styles.panelHead}>
        <h2 id={titleId} className={styles.panelTitle}>
          Ключи JustTCG
        </h2>
        <p className={styles.panelText}>
          Общие для клуба: участникам ничего вводить не нужно. Запросы идут с первого включённого ключа, а когда у него кончается
          лимит, — со следующего. Ключи видят все участники клуба.
        </p>
      </div>

      {items !== null && (
        <dl className={styles.summary}>
          <div>
            <dt>Включено</dt>
            <dd>
              {enabled.length} из {items.length}
            </dd>
          </div>
          <div>
            <dt>Сегодня осталось</dt>
            <dd>{known.length > 0 ? `${dayLeft} из ${dayLimit}` : 'пока неизвестно'}</dd>
          </div>
        </dl>
      )}
      {known.length < enabled.length && (
        <p className={styles.muted}>
          {known.length > 0
            ? 'Остаток считается по ключам, которые уже отвечали в этом браузере. Нажми «Проверить» у остальных.'
            : 'Остаток станет известен, когда ключи ответят в этом браузере. «Проверить» у ключа потратит один запрос.'}
        </p>
      )}

      {showLegacy && (
        <div className={styles.legacy}>
          <p>В этом браузере остался ключ {maskKey(legacy)} из старых настроек. Перенести его в общий список?</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.ghost}
              disabled={saving}
              onClick={() =>
                void add(legacy, 'Из настроек').then((saved) => {
                  if (!saved) return;
                  void forgetLegacyKey();
                  setLegacy('');
                })
              }
            >
              Перенести
            </button>
            <button
              type="button"
              className={styles.ghost}
              onClick={() => {
                void forgetLegacyKey();
                setLegacy('');
              }}
            >
              Забыть
            </button>
          </div>
        </div>
      )}

      {items === null ? (
        <p className={styles.muted}>Загружаем ключи…</p>
      ) : items.length === 0 ? (
        <p className={styles.muted}>Ключей пока нет. Пока их нет, у японских карт нет цены в долларах, а у карт — истории за год и цен в грейде.</p>
      ) : (
        <ol className={styles.keys}>
          {items.map((item, index) => (
            <KeyRow
              key={item.key}
              item={item}
              index={index}
              count={items.length}
              state={states[item.key]}
              check={checks[item.key]}
              busy={saving}
              onCheck={() => void check(item.key)}
              onUpdate={(patch) => void update(index, patch)}
              onMove={(shift) => move(index, shift)}
              onRemove={() => void remove(index)}
            />
          ))}
        </ol>
      )}

      {items !== null && items.length < MAX_CLUB_KEYS && <AddKeyForm existing={items} busy={saving} onAdd={add} />}
      {items !== null && items.length >= MAX_CLUB_KEYS && <p className={styles.muted}>В списке уже {MAX_CLUB_KEYS} ключей, больше не поместится.</p>}

      <p role="status" className={error ? styles.error : styles.muted}>
        {error ?? (saving ? 'Сохраняем…' : '')}
      </p>
    </section>
  );
}

type KeyRowProps = {
  item: ClubKey;
  index: number;
  count: number;
  state?: KeyState;
  check?: Check;
  busy: boolean;
  onCheck: () => void;
  onUpdate: (patch: Partial<ClubKey>) => void;
  onMove: (shift: -1 | 1) => void;
  onRemove: () => void;
};

function KeyRow({ item, index, count, state, check, busy, onCheck, onUpdate, onMove, onRemove }: KeyRowProps) {
  const [label, setLabel] = useState(item.label);
  const [reveal, setReveal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const labelId = useId();
  const number = index + 1;

  useEffect(() => setLabel(item.label), [item.label]);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const commitLabel = () => {
    const next = label.trim().slice(0, MAX_LABEL);
    if (next !== item.label) onUpdate({ label: next });
  };

  const onLabelKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  return (
    <li className={cx(styles.key, !item.enabled && styles.off)}>
      <span className={styles.order} aria-hidden="true">
        {number}
      </span>
      <div className={styles.keyMain}>
        <label htmlFor={labelId} className={styles.visuallyHidden}>
          Название ключа {number}
        </label>
        <input
          id={labelId}
          className={cx(fieldStyles.input, styles.labelInput)}
          placeholder={`Ключ ${number}`}
          maxLength={MAX_LABEL}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          onBlur={commitLabel}
          onKeyDown={onLabelKeyDown}
        />
        <div className={styles.keyLine}>
          <span className={styles.secret}>{reveal ? item.key : maskKey(item.key)}</span>
          <button type="button" className={styles.inlineButton} onClick={() => setReveal((value) => !value)}>
            {reveal ? 'Скрыть' : 'Показать'}
          </button>
        </div>
        <p className={styles.hint}>
          <KeyStatus enabled={item.enabled} state={state} check={check} />
        </p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.ghost} disabled={check?.status === 'checking'} onClick={onCheck}>
          Проверить
        </button>
        <label className={styles.switch}>
          <input
            type="checkbox"
            role="switch"
            checked={item.enabled}
            disabled={busy}
            onChange={(event) => onUpdate({ enabled: event.target.checked })}
          />
          Включён
        </label>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Поднять ключ ${number} выше`}
          disabled={busy || index === 0}
          onClick={() => onMove(-1)}
        >
          <ChevronUpIcon size={18} stroke={2} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={`Опустить ключ ${number} ниже`}
          disabled={busy || index === count - 1}
          onClick={() => onMove(1)}
        >
          <ChevronDownIcon size={18} stroke={2} />
        </button>
        <button
          type="button"
          className={cx(styles.ghost, confirming && styles.danger)}
          disabled={busy}
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            setConfirming(false);
            onRemove();
          }}
        >
          {confirming ? 'Точно удалить?' : 'Удалить'}
        </button>
      </div>
    </li>
  );
}

/** Что известно о ключе: итог проверки, отметка о лимите или остаток по последнему ответу. */
function KeyStatus({ enabled, state, check }: { enabled: boolean; state?: KeyState; check?: Check }) {
  if (check?.status === 'checking') return <span>Проверяем ключ…</span>;
  if (check?.status === 'invalid') return <span className={styles.problem}>Ключ не подошёл</span>;
  if (check?.status === 'offline') return <span className={styles.problem}>Не удалось проверить: нет связи</span>;
  if (check?.status === 'no-game') return <span className={styles.problem}>Ключ работает, но японских карт в JustTCG не нашлось</span>;

  const block = state?.block && state.block.until > Date.now() ? state.block : null;
  if (block?.reason === 'invalid') return <span className={styles.problem}>Ключ не подошёл, запросы с него не идут</span>;
  if (block?.reason === 'day') return <span className={styles.problem}>Лимит на сегодня кончился, снова с {timeFormat.format(block.until)}</span>;
  if (block?.reason === 'month') return <span className={styles.problem}>Лимит на месяц кончился, ключ пробуется раз в сутки</span>;
  if (block?.reason === 'minute') return <span className={styles.problem}>Слишком много запросов подряд, ключ отдыхает минуту</span>;
  if (check?.status === 'rate-limit') return <span className={styles.problem}>Запросы на сегодня кончились</span>;

  const usage = state?.usage;
  const prefix = enabled ? '' : 'Выключен. ';
  if (usage) {
    const dayLeft = usage.day === utcDay() ? usage.dayLeft : usage.dayLimit;
    const parts = [
      dayLeft === null ? null : usage.dayLimit === null ? `сегодня осталось ${dayLeft}` : `сегодня осталось ${dayLeft} из ${usage.dayLimit}`,
      usage.monthLeft === null ? null : usage.monthLimit === null ? `в месяце — ${usage.monthLeft}` : `в месяце — ${usage.monthLeft} из ${usage.monthLimit}`,
      usage.plan ? `тариф ${usage.plan}` : null,
    ].filter(Boolean);
    return (
      <span className={enabled ? styles.ok : undefined}>
        {enabled && <CheckIcon size={14} stroke={2.4} />}
        {prefix}
        {parts.length > 0 ? `Работает, ${parts.join(', ')}` : 'Работает'}
      </span>
    );
  }
  if (check?.status === 'ok') {
    return (
      <span className={styles.ok}>
        <CheckIcon size={14} stroke={2.4} />
        {check.left === null ? 'Ключ работает' : `Ключ работает, сегодня осталось ${check.left}`}
      </span>
    );
  }
  return <span>{prefix}Этот браузер с ключом ещё не работал. «Проверить» потратит один запрос.</span>;
}

function AddKeyForm({ existing, busy, onAdd }: { existing: ClubKey[]; busy: boolean; onAdd: (key: string, label: string) => Promise<boolean> }) {
  const keyId = useId();
  const labelId = useId();
  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = key.trim();
    if (!validKeyText(value)) {
      setProblem('Это не похоже на ключ JustTCG: нужны латинские буквы, цифры, «_» или «-», от 8 символов.');
      return;
    }
    if (existing.some((item) => item.key === value)) {
      setProblem('Такой ключ уже есть в списке.');
      return;
    }
    setProblem(null);
    if (await onAdd(value, label.trim())) {
      setKey('');
      setLabel('');
    }
  };

  return (
    <form className={styles.addForm} onSubmit={(event) => void submit(event)}>
      <div className={fieldStyles.field}>
        <label htmlFor={keyId} className={fieldStyles.label}>
          Новый ключ
        </label>
        <input
          id={keyId}
          className={fieldStyles.input}
          type="password"
          placeholder="tcg_…"
          autoComplete="off"
          spellCheck={false}
          value={key}
          aria-describedby={problem ? `${keyId}-problem` : undefined}
          onChange={(event) => setKey(event.target.value)}
        />
      </div>
      <div className={fieldStyles.field}>
        <label htmlFor={labelId} className={fieldStyles.label}>
          Название, по желанию
        </label>
        <input
          id={labelId}
          className={fieldStyles.input}
          placeholder="Например, «Основной»"
          maxLength={MAX_LABEL}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </div>
      <Button type="submit" className={styles.addButton} disabled={busy || !key.trim()} start={<PlusIcon size={18} stroke={2.2} />}>
        Добавить ключ
      </Button>
      {problem && (
        <p id={`${keyId}-problem`} role="alert" className={styles.error}>
          {problem}
        </p>
      )}
    </form>
  );
}

/* ---------- Участники ---------- */

type Person = {
  uid: string;
  name: string;
  photoURL: string | null;
  joinedAt: Date | null;
  invitedBy: string | null;
  invitesLeft: number;
  role: Role;
};

function MembersPanel({ uid }: { uid: string }) {
  const titleId = useId();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [cards, setCards] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onSnapshot(
        collection(binderDb(), 'members'),
        (snapshot) =>
          setPeople(
            snapshot.docs
              .map((item) => {
                const data = item.data();
                const member = clubMemberFrom(item.id, data);
                return {
                  uid: item.id,
                  name: member.displayName,
                  photoURL: member.photoURL,
                  joinedAt: member.joinedAt?.toDate() ?? null,
                  invitedBy: typeof data.invitedBy === 'string' ? data.invitedBy : null,
                  invitesLeft: typeof data.invitesLeft === 'number' ? data.invitesLeft : 0,
                  role: data.role === 'admin' ? ('admin' as const) : ('user' as const),
                };
              })
              .sort((a, b) => (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0)),
          ),
        () => setError('Не удалось прочитать список участников.'),
      ),
    [],
  );

  // Сколько карт в альбомах: одно чтение счётчика на участника, один раз за заход на страницу
  const uids = people?.map((person) => person.uid).join(',') ?? '';
  useEffect(() => {
    if (!uids) return;
    let active = true;
    void Promise.all(
      uids.split(',').map(async (id) => {
        const snapshot = await getCountFromServer(collection(binderDb(), 'members', id, 'cards')).catch(() => null);
        return [id, snapshot?.data().count ?? null] as const;
      }),
    ).then((entries) => {
      if (!active) return;
      setCards(Object.fromEntries(entries.filter((entry): entry is readonly [string, number] => entry[1] !== null)));
    });
    return () => {
      active = false;
    };
  }, [uids]);

  const names = new Map(people?.map((person) => [person.uid, person.name]));

  const run = async (task: () => Promise<void>) => {
    setError(null);
    try {
      await task();
    } catch {
      setError('Не получилось сохранить. Проверь интернет и попробуй ещё раз.');
    }
  };

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <div className={styles.panelHead}>
        <h2 id={titleId} className={styles.panelTitle}>
          Участники{people ? `: ${people.length}` : ''}
        </h2>
        <p className={styles.panelText}>Админ меняет ключи, роли и приглашения. Свою роль поменять нельзя: так клуб не останется без админа случайно. Убранный участник теряет доступ к клубу. Его альбом и колоды остаются в базе, но в клубе их больше не видно.</p>
      </div>
      {people === null ? (
        <p className={styles.muted}>Загружаем участников…</p>
      ) : (
        <ul className={styles.people}>
          {people.map((person) => (
            <PersonRow
              key={person.uid}
              person={person}
              self={person.uid === uid}
              cards={cards[person.uid] ?? null}
              inviter={person.invitedBy ? (names.get(person.invitedBy) ?? 'участник, которого уже нет') : null}
              onInvites={(count) => void run(() => setInvitesLeft(binderDb(), person.uid, count))}
              onRole={(role) => void run(() => setRole(binderDb(), person.uid, role))}
              onRemove={() => void run(() => removeMember(binderDb(), person.uid))}
            />
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </section>
  );
}

type PersonRowProps = {
  person: Person;
  self: boolean;
  cards: number | null;
  inviter: string | null;
  onInvites: (count: number) => void;
  onRole: (role: Role) => void;
  onRemove: () => void;
};

function PersonRow({ person, self, cards, inviter, onInvites, onRole, onRemove }: PersonRowProps) {
  // Опасные действия — со второго нажатия: смена роли и «Убрать из клуба»
  const [confirming, setConfirming] = useState<'role' | 'remove' | null>(null);
  const admin = person.role === 'admin';

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(null), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const facts = [
    memberSinceLabel(person.joinedAt),
    inviter ? `по приглашению: ${inviter}` : 'первый участник',
    cards === null ? null : countLabel(cards, CARD_FORMS),
  ].filter(Boolean);

  return (
    <li className={styles.person}>
      <Link href={`/u/${person.uid}`} className={styles.personLink}>
        <Avatar src={person.photoURL} size={40} />
        <span className={styles.personText}>
          <span className={styles.personName}>
            {person.name}
            {admin && <span className={styles.badge}>админ</span>}
            {self && <span className={styles.muted}> · это ты</span>}
          </span>
          <span className={styles.personFacts}>{facts.join(' · ')}</span>
        </span>
      </Link>
      <div className={styles.actions}>
        <div className={styles.stepper} role="group" aria-label={`Приглашения у ${person.name}`}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="На одно приглашение меньше"
            disabled={person.invitesLeft <= 0}
            onClick={() => onInvites(person.invitesLeft - 1)}
          >
            <MinusIcon size={16} stroke={2.2} />
          </button>
          <span className={styles.stepperValue} aria-live="polite">
            {countLabel(person.invitesLeft, INVITE_FORMS)}
          </span>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="На одно приглашение больше"
            disabled={person.invitesLeft >= MAX_INVITES}
            onClick={() => onInvites(person.invitesLeft + 1)}
          >
            <PlusIcon size={16} stroke={2.2} />
          </button>
        </div>
        {!self && (
          <button
            type="button"
            className={cx(styles.ghost, confirming === 'role' && styles.danger)}
            onClick={() => {
              if (confirming !== 'role') {
                setConfirming('role');
                return;
              }
              setConfirming(null);
              onRole(admin ? 'user' : 'admin');
            }}
          >
            {confirming === 'role' ? (admin ? 'Точно снять?' : 'Точно сделать админом?') : admin ? 'Снять админа' : 'Сделать админом'}
          </button>
        )}
        {!self && (
          <button
            type="button"
            className={cx(styles.ghost, confirming === 'remove' && styles.danger)}
            onClick={() => {
              if (confirming !== 'remove') {
                setConfirming('remove');
                return;
              }
              setConfirming(null);
              onRemove();
            }}
          >
            {confirming === 'remove' ? 'Точно убрать?' : 'Убрать из клуба'}
          </button>
        )}
      </div>
    </li>
  );
}
