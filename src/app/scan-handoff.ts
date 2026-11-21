/**
 * Фото, которые бросили на главную вкладки, ждут сканер здесь: переход на #/scan идёт внутри той же
 * страницы (wouter), поэтому File можно передать через память, без chrome.storage и без копий.
 * Сканер забирает их один раз; при перезагрузке вкладки они пропадают, как и выбранные файлы.
 */
let pending: File[] | null = null;

/** Главная: положить фото для сканера и сразу перейти на #/scan. */
export function handOffToScanner(files: File[]): void {
  pending = files.length > 0 ? files : null;
}

/** Сканер: какие фото ждут (не забирая — так initializer useState можно звать дважды). */
export function peekHandedOff(): File[] | undefined {
  return pending ?? undefined;
}

/** Сканер принял фото: следующий заход на #/scan начнётся с пустого сканера. */
export function clearHandedOff(): void {
  pending = null;
}
