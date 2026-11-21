import type { User } from 'firebase/auth/web-extension';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { HeaderSearch } from '@/app/HeaderSearch';
import { isAdminRole } from '@/lib/admin';
import { useAuth } from '@/lib/auth-state';
import type { Member } from '@/lib/membership';
import { MembershipProvider, useMembership } from '@/lib/membership-state';
import { leaveBinder } from '@/settings/leave';
import { Avatar } from '@/ui/Avatar';
import { Brand } from '@/ui/Brand';
import { cx } from '@/ui/cx';
import { ChevronDownIcon, ShieldIcon, SignOutIcon, SlidersIcon, UserIcon } from '@/ui/Icons';
import { menuFocusTarget } from '@/ui/menu-keys';
import { SECTIONS, sectionActive } from '@/ui/sections';
import styles from './PageHeader.module.css';

/**
 * Шапка вкладки. Навигация и поиск видны только участнику клуба: до входа и до вступления
 * они вели бы на тот же экран входа. Меню аккаунта видно сразу после входа: из него выходят.
 * Внутренность шапки — по ширине содержимого страницы (1360 px), фон — во всю ширину.
 */
export function PageHeader() {
  const [location] = useLocation();
  const auth = useAuth();
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/home" className={styles.brand} aria-label="Binder: главная">
          <Brand size="page" />
        </Link>
        {auth.status === 'signed-in' ? (
          // Членство — та же подписка на свой документ, что у AuthGate и поиска: Firestore слушает её один раз
          <MembershipProvider key={auth.user.uid} uid={auth.user.uid}>
            <MemberHeader user={auth.user} location={location} />
          </MembershipProvider>
        ) : (
          auth.status === 'loading' && (
            <div className={styles.end}>
              {/* Пока сессия восстанавливается, место под меню занято: шапка не прыгает */}
              <span className={styles.menuPlaceholder} aria-hidden="true" />
            </div>
          )
        )}
      </div>
    </header>
  );
}

function MemberHeader({ user, location }: { user: User; location: string }) {
  const membership = useMembership();
  const member = membership.status === 'member';
  return (
    <>
      {member && (
        <nav aria-label="Разделы" className={styles.nav}>
          {SECTIONS.map(({ path, label, match }) => {
            const active = sectionActive(match, location, user.uid);
            return (
              <Link
                key={path}
                href={path}
                className={cx(styles.navLink, active && styles.active)}
                aria-current={active ? 'page' : undefined}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      )}
      <div className={styles.end}>
        {member && <HeaderSearch />}
        <AccountMenu user={user} member={member ? membership.member : null} location={location} />
      </div>
    </>
  );
}

/** В Chrome 150+ стрелки внутри меню ведёт атрибут focusgroup, в Chrome 135–149 — свой код. */
const nativeFocusgroup = typeof HTMLElement !== 'undefined' && 'focusGroup' in HTMLElement.prototype;

function menuItems(group: HTMLElement | null): HTMLElement[] {
  return group ? [...group.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')] : [];
}

/**
 * Меню аккаунта: аватар в шапке открывает «Мой профиль», «Настройки», у админа — «Админ», и «Выйти».
 * Открывает его сам браузер: кнопка-вызыватель (commandfor + toggle-popover) и popover="auto",
 * поэтому Esc, клик мимо меню и возврат фокуса на кнопку работают без своего кода.
 * Свой код: вход в меню с клавиатуры, Home/End, закрытие при уходе фокуса и после выбора пункта.
 */
function AccountMenu({ user, member, location }: { user: User; member: Member | null; location: string }) {
  const triggerId = useId();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  // Открыли с клавиатуры (Enter, пробел, стрелка вниз): фокус сразу на первый пункт
  const enterOnOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const admin = isAdminRole(member?.role);
  // Имя и фото — из своего документа участника (их можно сменить в профиле), пока он не пришёл — из Google.
  // У участника photoURL null значит «без фото»: тогда первая буква имени, а не фото из Google.
  const name = member?.displayName || user.displayName || user.email || 'Участник';
  const photo = member ? member.photoURL : user.photoURL;

  useEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!menu || !trigger) return;

    const onToggle = (event: Event) => {
      const opened = (event as ToggleEvent).newState === 'open';
      setOpen(opened);
      if (opened) {
        // Фокус переводится здесь, а не в обработчике клика: меню к тому моменту ещё закрыто
        if (enterOnOpen.current) menuItems(groupRef.current)[0]?.focus();
        else trigger.focus({ focusVisible: false });
      }
      enterOnOpen.current = false;
    };

    // Tab увёл фокус из меню: закрываем, как системные меню, иначе оно висело бы над страницей
    const onFocusIn = (event: FocusEvent) => {
      if (!menu.matches(':popover-open')) return;
      const target = event.target;
      if (target instanceof Node && !menu.contains(target) && !trigger.contains(target)) menu.hidePopover();
    };

    menu.addEventListener('toggle', onToggle);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      menu.removeEventListener('toggle', onToggle);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, []);

  // Выбранный пункт: фокус на кнопку меню (без кольца, если нажали мышью), потом закрыть
  const close = (fromPointer: boolean) => {
    triggerRef.current?.focus({ focusVisible: !fromPointer });
    if (menuRef.current?.matches(':popover-open')) menuRef.current.hidePopover();
  };

  const onTriggerClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Enter и пробел дают click с detail 0, мышь — с 1 и больше
    enterOnOpen.current = event.detail === 0;
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    if (menuRef.current?.matches(':popover-open')) {
      menuItems(groupRef.current)[0]?.focus();
    } else {
      enterOnOpen.current = true;
      // Открытие одно — через вызыватель, как у мыши и Enter
      triggerRef.current?.click();
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(groupRef.current);
    const current = items.indexOf(document.activeElement as HTMLElement);
    const next = menuFocusTarget(event.key, current, items.length, !nativeFocusgroup);
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  // Мышь над пунктом переводит на него фокус без кольца: наведение и фокус — один и тот же пункт
  const onItemPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (document.activeElement !== event.currentTarget) event.currentTarget.focus({ focusVisible: false });
  };

  const itemProps = {
    className: styles.item,
    role: nativeFocusgroup ? undefined : 'menuitem',
    tabIndex: nativeFocusgroup ? undefined : -1,
    onPointerMove: onItemPointerMove,
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={styles.trigger}
        aria-label="Меню аккаунта"
        aria-haspopup="menu"
        aria-expanded={open}
        commandfor={menuId}
        command="toggle-popover"
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
      >
        <Avatar src={photo} name={name} size={36} />
        <ChevronDownIcon size={16} stroke={2} />
      </button>
      {/* Сразу за кнопкой: так браузер не добавляет кнопке лишний aria-details */}
      <div ref={menuRef} id={menuId} popover="auto" className={styles.menu}>
        <div className={styles.identity}>
          <Avatar src={photo} name={name} size={40} />
          <div className={styles.identityText}>
            <span className={styles.identityName}>{name}</span>
            {user.email && user.email !== name && <span className={styles.identityEmail}>{user.email}</span>}
          </div>
        </div>
        <div
          ref={groupRef}
          focusgroup="menu nomemory"
          role={nativeFocusgroup ? undefined : 'menu'}
          aria-labelledby={triggerId}
          className={styles.items}
          onKeyDown={onMenuKeyDown}
        >
          <Link
            href="/u/me"
            {...itemProps}
            aria-current={location === '/u/me' ? 'page' : undefined}
            onClick={(event: MouseEvent) => close(event.detail > 0)}
          >
            <UserIcon size={18} />
            Мой профиль
          </Link>
          <Link
            href="/settings"
            {...itemProps}
            aria-current={location === '/settings' ? 'page' : undefined}
            onClick={(event: MouseEvent) => close(event.detail > 0)}
          >
            <SlidersIcon size={18} />
            Настройки
          </Link>
          {admin && (
            <Link
              href="/admin"
              {...itemProps}
              aria-current={location === '/admin' ? 'page' : undefined}
              onClick={(event: MouseEvent) => close(event.detail > 0)}
            >
              <ShieldIcon size={18} />
              Админ
            </Link>
          )}
          <hr className={styles.separator} />
          <button
            type="button"
            {...itemProps}
            onClick={(event) => {
              close(event.detail > 0);
              leaveBinder();
            }}
          >
            <SignOutIcon size={18} />
            Выйти
          </button>
        </div>
      </div>
    </>
  );
}
