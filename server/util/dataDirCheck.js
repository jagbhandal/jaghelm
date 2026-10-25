// @ts-check
/**
 * The boot check for the folders JagHelm writes to (#697): the data folder
 * (JAGHELM_DATA_DIR, `/app/data` in the image) and the uploads folder. With a
 * bind mount the host folder is often missing or owned by root, as Docker makes
 * a missing one, and the container runs as an unprivileged user (uid 1000), so
 * the first write failed with a raw EACCES stack. This checks each folder before
 * anything writes: it exists (made if it can be), is a folder, and the running
 * user can write to it. If not, ONE message says which folder, who JagHelm runs
 * as and the commands that fix it, and the start stops. It checks only that;
 * every other boot error still reaches the log as before.
 */
import { accessSync, constants, mkdirSync, statSync } from 'fs';

/**
 * Why a folder can't be used, or null when it can. A missing folder is made
 * (what the server did before), so only a failed make is a problem.
 * @param {string} dir
 * @returns {string | null}
 */
export function dirProblem(dir) {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err).code;
    if (code === 'EEXIST' || code === 'ENOTDIR') return 'is not a folder (something else is in its place)';
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return "doesn't exist and can't be created here";
    return `can't be created (${code ?? 'error'})`;
  }
  try {
    if (!statSync(dir).isDirectory()) return 'is not a folder (something else is in its place)';
  } catch {
    return "can't be read";
  }
  try {
    accessSync(dir, constants.W_OK | constants.X_OK);
  } catch {
    return 'is not writable by the user JagHelm runs as';
  }
  return null;
}

/**
 * The message for the folders that failed.
 * @param {{ label: string, dir: string, problem: string }[]} failures
 * @param {{ uid: number | string, gid: number | string, inDocker: boolean }} who
 */
export function dataDirMessage(failures, { uid, gid, inDocker }) {
  const lines = ['JagHelm cannot start: a folder it needs to write to is not usable.', ''];
  for (const { label, dir, problem } of failures) lines.push(`  ${label} folder ${dir} ${problem}.`);
  lines.push('', `JagHelm runs as uid ${uid}, gid ${gid}.`, '');
  const names = failures.map((f) => f.label);
  if (inDocker) {
    const hostDirs = names.map((n) => `./${n}`).join(' ');
    lines.push(
      'If you mount a folder from the host (a bind mount), run this on the host, next to compose.yaml:',
      `  mkdir -p ${hostDirs} && sudo chown 1000:1000 ${hostDirs}`,
      'then: docker compose up -d',
      '',
      'Or let Docker manage the folder with a named volume (no chown needed):',
      ...names.map((n) => `  volumes: - jaghelm-${n}:/app/${n}   (and declare jaghelm-${n} under a top-level "volumes:")`),
      'See docs/DATA-DIR.md.',
    );
  } else {
    lines.push(`Make the folder yours: mkdir -p <folder> && chown ${uid}:${gid} <folder>, or point JAGHELM_DATA_DIR at one you can write to.`);
  }
  return lines.join('\n');
}

/**
 * Check the folders; on a problem write the message and return false.
 * @param {{ label: string, dir: string }[]} folders
 * @param {{ write?: (text: string) => void, uid?: number | string, gid?: number | string, inDocker?: boolean }} [opts]
 * @returns {boolean} true when every folder is usable
 */
export function checkDataDirs(folders, opts = {}) {
  const failures = [];
  for (const { label, dir } of folders) {
    const problem = dirProblem(dir);
    if (problem) failures.push({ label, dir, problem });
  }
  if (failures.length === 0) return true;
  const write = opts.write ?? ((text) => process.stderr.write(text));
  write(
    dataDirMessage(failures, {
      uid: opts.uid ?? process.getuid?.() ?? '?',
      gid: opts.gid ?? process.getgid?.() ?? '?',
      inDocker: opts.inDocker ?? existsDockerEnv(),
    }) + '\n',
  );
  return false;
}

function existsDockerEnv() {
  try {
    statSync('/.dockerenv');
    return true;
  } catch {
    return false;
  }
}
