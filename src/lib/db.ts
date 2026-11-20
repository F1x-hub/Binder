import { getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseApp } from '@/lib/firebase';

/**
 * База Firestore `(default)`. Что кому можно, решают firestore.rules.
 * Отдельный модуль: Firestore регистрирует себя при импорте и не вырезается из сборки,
 * а service worker базу не использует и тянуть её не должен.
 */
export function binderDb(): Firestore {
  return getFirestore(firebaseApp());
}
