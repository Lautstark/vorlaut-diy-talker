/* The write half of the File System Access API.
 *
 * lib.dom carries FileSystemDirectoryHandle and its file handles, because the
 * origin-private file system uses the same types. What it does not carry is
 * the part that reaches a folder somebody chose: the picker itself, and the
 * async iteration over a directory's entries. Those live in
 * @types/wicg-file-system-access, and this is the handful of members
 * backend/folder.ts actually asks for - the same bargain src/types/serial.d.ts
 * strikes, and for the same reason.
 *
 * Both of the other folder features in this app - the METACOM collection and
 * the standing backup - reach the file system through a package that carries
 * its own types, so this is the first place in src/ that touches the API
 * directly.
 */

interface FileSystemDirectoryHandle {
  /** Everything in the directory. Absent from lib.dom, present everywhere the
   *  picker is. */
  values(): AsyncIterableIterator<FileSystemHandle>;
}

interface Window {
  /** The picker. Needs a user gesture, and is absent from Safari, from Firefox
   *  and from every browser on Android - including Chrome, which is why the
   *  panel that offers this hides itself rather than explaining. */
  showDirectoryPicker(options?: {
    mode?: "read" | "readwrite";
    /** Chromium remembers the last folder per id, so the picker opens where it
     *  opened last time without this page storing a handle. */
    id?: string;
    startIn?: "desktop" | "documents" | "downloads";
  }): Promise<FileSystemDirectoryHandle>;
}
