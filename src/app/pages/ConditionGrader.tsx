import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { CONDITION_LABELS, type Condition } from '@/lib/collection';
import { loadDeepseekKey, recognizeErrorMessage } from '@/lib/deepseek';
import { PHOTO_KINDS, PHOTO_SLOTS, gradeCondition, type Grade, type PhotoKind } from '@/lib/grading';
import { PhotoError, imageFiles, preparePhoto } from '@/lib/photo';
import { Button } from '@/ui/Button';
import { cx } from '@/ui/cx';
import { CheckIcon, CloseIcon, PlusIcon } from '@/ui/Icons';
import styles from './ConditionGrader.module.css';

type Props = {
  open: boolean;
  /** Имя карты для модели и заголовка */
  name: string;
  current: Condition;
  onClose: () => void;
  onSave: (condition: Condition) => Promise<unknown>;
};

const ASPECTS: Array<[keyof Grade['aspects'], string]> = [
  ['corners', 'Углы'],
  ['edges', 'Края'],
  ['surface', 'Поверхность'],
  ['centering', 'Центровка'],
];

/**
 * Оценка состояния ИИ: участник снимает карту с нескольких ракурсов (лицо, рубашка, лицо
 * под углом к свету, по желанию — углы крупно), модель DeepSeek ставит состояние по шкале
 * TCGplayer и объясняет почему. Сохраняет человек. Фото уходят только в DeepSeek и после
 * закрытия окна забываются.
 */
export function ConditionGrader({ open, name, current, onClose, onSave }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [photos, setPhotos] = useState<Partial<Record<PhotoKind, string>>>({});
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      void loadDeepseekKey().then(setKey);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const reset = () => {
    setPhotos({});
    setGrade(null);
    setError(null);
    setBusy(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const pick = async (kind: PhotoKind, file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const prepared = await preparePhoto(file);
      setPhotos((list) => ({ ...list, [kind]: prepared.dataUrl }));
    } catch (failure) {
      setError(failure instanceof PhotoError ? failure.message : 'Не получилось открыть фото.');
    }
  };

  const ready = PHOTO_KINDS.every((kind) => !PHOTO_SLOTS[kind].required || photos[kind]);

  const run = async () => {
    if (!key) return;
    setBusy(true);
    setError(null);
    try {
      const shots = PHOTO_KINDS.flatMap((kind) => (photos[kind] ? [{ kind, dataUrl: photos[kind]! }] : []));
      const result = await gradeCondition(key, name, shots);
      if (!result) setError('ИИ не смог оценить карту по этим фото. Сними её ярче и крупнее, без рукава.');
      setGrade(result);
    } catch (failure) {
      setError(recognizeErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!grade) return;
    setSaving(true);
    try {
      await onSave(grade.condition);
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={close}>
      <div className={styles.head}>
        <div>
          <h2 id={titleId} className={styles.title}>
            Оценка состояния
          </h2>
          <p className={styles.muted}>{name}</p>
        </div>
        <button type="button" className={styles.close} aria-label="Закрыть" onClick={close}>
          <CloseIcon size={20} stroke={2} />
        </button>
      </div>

      <p className={styles.intro}>
        Сними карту без рукава при хорошем свете. ИИ посмотрит углы, края, поверхность и центровку и поставит состояние
        по шкале TCGplayer. Фото уходят в DeepSeek только для оценки и нигде не сохраняются.
      </p>

      <div className={styles.slots}>
        {PHOTO_KINDS.map((kind) => (
          <PhotoSlot
            key={kind}
            kind={kind}
            photo={photos[kind] ?? null}
            wanted={Boolean(grade?.missing.includes(kind))}
            onPick={(file) => void pick(kind, file)}
          />
        ))}
      </div>

      {key === '' && <p className={styles.problem}>Нужен ключ DeepSeek: введи его в настройках расширения.</p>}
      {error && (
        <p role="alert" className={styles.problem}>
          {error}
        </p>
      )}

      {grade && <GradeResult grade={grade} current={current} />}

      <div className={styles.actions}>
        {grade ? (
          <>
            <Button className={styles.inline} disabled={saving || !grade.sameCard} onClick={() => void save()}>
              {saving ? 'Сохраняем…' : `Сохранить: ${CONDITION_LABELS[grade.condition]}`}
            </Button>
            <Button variant="link" disabled={busy || !ready} onClick={() => void run()}>
              {busy ? 'Оцениваем…' : 'Оценить заново'}
            </Button>
          </>
        ) : (
          <Button className={styles.inline} disabled={busy || !ready || !key} onClick={() => void run()}>
            {busy ? 'Оцениваем…' : 'Оценить'}
          </Button>
        )}
        {!ready && !grade && <span className={styles.muted}>Нужны три обязательных фото</span>}
      </div>
    </dialog>
  );
}

function PhotoSlot({
  kind,
  photo,
  wanted,
  onPick,
}: {
  kind: PhotoKind;
  photo: string | null;
  wanted: boolean;
  onPick: (file: File | undefined) => void;
}) {
  const slot = PHOTO_SLOTS[kind];
  const [dragging, setDragging] = useState(false);
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    onPick(imageFiles(event.dataTransfer.files)[0]);
  };
  return (
    <label
      className={cx(styles.slot, photo && styles.filled, wanted && styles.wanted, dragging && styles.dragging)}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        type="file"
        accept="image/*"
        className={styles.input}
        onChange={(event) => {
          onPick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      {photo ? <img src={photo} alt="" className={styles.preview} /> : <PlusIcon size={22} stroke={2} />}
      <span className={styles.caption}>
        <span className={styles.slotTitle}>
          {photo && <CheckIcon size={14} stroke={2.4} />}
          {slot.title}
        </span>
        <span className={styles.slotHint}>{wanted ? 'ИИ просит это фото' : photo ? 'нажми, чтобы заменить' : slot.hint}</span>
      </span>
    </label>
  );
}

function GradeResult({ grade, current }: { grade: Grade; current: Condition }) {
  return (
    <section className={styles.result} aria-live="polite">
      <div className={styles.resultHead}>
        <span className={styles.grade}>{CONDITION_LABELS[grade.condition]}</span>
        <span className={styles.muted}>уверенность {Math.round(grade.confidence * 100)}%</span>
        {grade.condition !== current && <span className={styles.muted}>сейчас в альбоме: {CONDITION_LABELS[current]}</span>}
      </div>
      {!grade.sameCard && <p className={styles.problem}>На фото, похоже, разные карты. Сними одну и ту же карту.</p>}
      <dl className={styles.aspects}>
        {ASPECTS.map(([aspect, label]) =>
          grade.aspects[aspect] ? (
            <div key={aspect} className={styles.aspect}>
              <dt>{label}</dt>
              <dd>{grade.aspects[aspect]}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {grade.summary && <p className={styles.summary}>{grade.summary}</p>}
      {grade.missing.length > 0 && (
        <p className={styles.problem}>
          Для уверенной оценки ИИ просит ещё: {grade.missing.map((kind) => PHOTO_SLOTS[kind].title.toLowerCase()).join(', ')}.
        </p>
      )}
    </section>
  );
}
