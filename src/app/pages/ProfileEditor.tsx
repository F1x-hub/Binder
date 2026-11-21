import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { binderDb } from '@/lib/db';
import { MAX_NAME, ProfilePhotoError, isOwnPhoto, makeProfilePhoto, nameProblem, normalizeName, saveProfile } from '@/lib/profile-edit';
import { Avatar } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { CloseIcon } from '@/ui/Icons';
import { TextField } from '@/ui/TextField';
import styles from './ProfileEditor.module.css';

type Props = {
  open: boolean;
  uid: string;
  /** Имя и фото из документа участника */
  displayName: string;
  photoURL: string | null;
  /** Фото аккаунта Google: его можно вернуть, если ставил своё или убирал */
  googlePhoto: string | null;
  onClose: () => void;
};

/**
 * Правка своего профиля: имя и фото (своё из файла, из Google или без фото), предпросмотр
 * и одна запись в members/{uid}. Нативный модальный dialog, как у выбора витрины.
 */
export function ProfileEditor({ open, uid, displayName, photoURL, googlePhoto, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [name, setName] = useState(displayName);
  const [photo, setPhoto] = useState<string | null>(photoURL);
  const [touched, setTouched] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      // Черновик берётся на момент открытия
      setName(displayName);
      setPhoto(photoURL);
      setTouched(false);
      setError(null);
      dialog.showModal();
      // Сразу в поле имени, а не на «Закрыть» (атрибут autofocus React в DOM не пишет)
      dialog.querySelector<HTMLInputElement>('input:not([type="file"])')?.focus();
    }
    if (!open && dialog.open) dialog.close();
    // displayName и photoURL нужны только в момент открытия
  }, [open]);

  const problem = nameProblem(name);
  const changed = normalizeName(name) !== displayName || photo !== photoURL;
  const canRestore = Boolean(googlePhoto) && photo !== googlePhoto;
  const previewName = normalizeName(name) ?? displayName;

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setProcessing(true);
    setError(null);
    try {
      setPhoto(await makeProfilePhoto(file));
    } catch (failure) {
      setError(failure instanceof ProfilePhotoError ? failure.message : 'Не получилось открыть фото.');
    } finally {
      setProcessing(false);
    }
  };

  const save = async () => {
    setTouched(true);
    if (problem) return;
    setBusy(true);
    setError(null);
    try {
      await saveProfile(binderDb(), uid, { displayName: name, photoURL: photo });
      onClose();
    } catch (failure) {
      console.warn('[binder] профиль не сохранён', failure);
      setError(
        failure instanceof ProfilePhotoError ? failure.message : 'Не получилось сохранить профиль. Проверь интернет и попробуй ещё раз.',
      );
    } finally {
      setBusy(false);
    }
  };

  const photoNote = !photo ? 'Без фото: вместо него первая буква имени.' : isOwnPhoto(photo) ? 'Своё фото' : 'Фото из аккаунта Google';

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.head}>
        <h2 id={titleId} className={styles.title}>
          Профиль
        </h2>
        <button type="button" className={styles.close} aria-label="Закрыть" onClick={onClose}>
          <CloseIcon size={20} stroke={2} />
        </button>
      </div>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {/* Предпросмотр: так профиль увидят друзья */}
        <div className={styles.preview}>
          <Avatar src={photo} name={previewName} size={88} />
          <div className={styles.previewText}>
            <span className={styles.previewName}>{previewName}</span>
            <span className={styles.muted}>{photoNote}</span>
          </div>
        </div>

        <fieldset className={styles.photo}>
          <legend className={styles.legend}>Фото</legend>
          <div className={styles.photoButtons}>
            <Button className={styles.secondary} disabled={processing || busy} onClick={() => fileRef.current?.click()}>
              {processing ? 'Готовлю фото…' : photo ? 'Выбрать другое фото' : 'Выбрать фото'}
            </Button>
            {canRestore && (
              <Button className={styles.secondary} disabled={processing || busy} onClick={() => setPhoto(googlePhoto)}>
                Фото из Google
              </Button>
            )}
            {photo && (
              <Button variant="link" disabled={processing || busy} onClick={() => setPhoto(null)}>
                Убрать фото
              </Button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className={styles.file} tabIndex={-1} aria-hidden="true" onChange={pick} />
          <p className={styles.muted}>Фото уменьшается до квадрата 192 px и хранится в Binder. Его видят только участники клуба.</p>
        </fieldset>

        <TextField
          label="Имя"
          value={name}
          maxLength={MAX_NAME + 20}
          autoComplete="nickname"
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={touched && problem ? true : undefined}
          hint={touched && problem ? <span className={styles.problem}>{problem}</span> : 'Так тебя видят друзья в клубе.'}
        />

        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}

        <div className={styles.footer}>
          <Button variant="link" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" className={styles.save} disabled={busy || processing || !changed}>
            {busy ? 'Сохраняю…' : 'Сохранить'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
