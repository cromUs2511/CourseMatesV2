/**
 * Pull image files out of a paste event's clipboard data. Text on the
 * clipboard is left alone so ordinary text pasting keeps working; callers
 * decide what to do with the returned files. Files appearing in both
 * `files` and `items` (as Chrome provides) are returned only once.
 */
interface ClipboardFileItem {
  kind: string;
  type: string;
  getAsFile: () => File | null;
}
interface ClipboardDataLike {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<ClipboardFileItem> | null;
}

const isImageFile = (file: File) =>
  typeof file.type === 'string' && file.type.toLowerCase().startsWith('image/');

export function pastedImageFiles(data: ClipboardDataLike | null | undefined): File[] {
  if (!data) return [];
  const found: File[] = [];
  const seen = new Set<string>();
  const add = (file: File | null | undefined) => {
    if (!file || !isImageFile(file)) return;
    const key = `${file.name}|${file.size}|${file.type}|${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(file);
  };
  try {
    if (data.files) for (const file of Array.from(data.files)) add(file);
    if (data.items)
      for (const item of Array.from(data.items)) {
        if (item && item.kind === 'file') {
          let file: File | null = null;
          try {
            file = item.getAsFile();
          } catch {
            file = null;
          }
          add(file);
        }
      }
  } catch {
    /* A hostile clipboard implementation must not break typing. */
  }
  return found;
}
