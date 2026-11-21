import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { clearHandedOff, peekHandedOff } from '@/app/scan-handoff';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { useOwned } from '@/lib/collection-state';
import { ScanDesk } from '@/scan/ScanDesk';
import { Crumbs } from '@/ui/Crumbs';
import page from './Page.module.css';
import styles from './ScanPage.module.css';

/** Сканер во вкладке: та же логика, что в поп-апе, разложенная в две колонки (`ScanDesk`). */
export function ScanPage() {
  usePageTitle('Сканирование');
  const auth = useAuth();
  const { byId } = useOwned();
  const [, navigate] = useLocation();
  // Фото, брошенные на главную вкладки: сканер начинает с них, как поп-ап после перетаскивания
  const [initialFiles] = useState(peekHandedOff);
  useEffect(() => clearHandedOff(), []);
  if (auth.status !== 'signed-in') return null;
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <Crumbs items={[{ label: 'Альбом', href: '/library' }]} />
        <h1 className={page.title}>Сканирование</h1>
      </header>
      <ScanDesk uid={auth.user.uid} owned={byId} initialFiles={initialFiles} onOpenAlbum={() => navigate('/library')} />
    </div>
  );
}
