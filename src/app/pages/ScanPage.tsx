import { useLocation } from 'wouter';
import { usePageTitle } from '@/app/usePageTitle';
import { useAuth } from '@/lib/auth-state';
import { useOwned } from '@/lib/collection-state';
import { ScanFlow } from '@/scan/ScanFlow';

/** Сканер во вкладке: тот же, что в поп-апе, но с большим окном выбора файлов. */
export function ScanPage() {
  usePageTitle('Сканирование');
  const auth = useAuth();
  const { byId } = useOwned();
  const [, navigate] = useLocation();
  if (auth.status !== 'signed-in') return null;
  return <ScanFlow uid={auth.user.uid} owned={byId} onOpenAlbum={() => navigate('/library')} />;
}
