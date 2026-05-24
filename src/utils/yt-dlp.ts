import {execa} from 'execa';
import {constants as fsConstants, promises as fs} from 'fs';
import {Readable} from 'stream';
import path from 'path';

const YT_DLP_VERSION_TIMEOUT_MS = 15_000;
const YT_DLP_UPDATE_TIMEOUT_MS = 120_000;
const YT_DLP_EXTRACT_TIMEOUT_MS = 45_000;

interface YtDlpMediaDownload {
  readonly url?: string;
  readonly protocol?: string;
  readonly ext?: string;
  readonly acodec?: string;
  readonly vcodec?: string;
  readonly http_headers?: Record<string, string | null | undefined>;
}

interface YtDlpResponse extends YtDlpMediaDownload {
  readonly is_live?: boolean;
  readonly live_status?: string;
  readonly requested_downloads?: readonly YtDlpMediaDownload[];
}

export interface YtDlpMediaSource {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly isLive: boolean;
}

export interface YtDlpUpdateResult {
  readonly beforeVersion: string | null;
  readonly afterVersion: string | null;
  readonly updated: boolean;
  readonly skipped: boolean;
  readonly updateSucceeded: boolean;
  readonly error?: string;
}

const firstNonEmpty = (...values: Array<string | undefined>) => values
  .map(value => value?.trim())
  .find((value): value is string => Boolean(value));

export const getExecutable = () => {
  const configuredPath = firstNonEmpty(process.env.YT_DLP_PATH, process.env.MUSE_BUNDLED_YT_DLP_PATH);

  return configuredPath ?? 'yt-dlp';
};

const getExecaErrorMessage = (error: unknown) => {
  if (isExecaError(error)) {
    const stderr = error.stderr?.trim();

    return stderr ? stderr : (error.shortMessage ?? 'Unknown yt-dlp error');
  }

  return error instanceof Error ? error.message : 'Unknown yt-dlp error';
};

const normalizeHeaders = (headers?: Record<string, string | null | undefined>) => {
  const normalizedEntries = Object.entries(headers ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '');

  return Object.fromEntries(normalizedEntries);
};

const isExecaError = (error: unknown): error is {stderr?: string; shortMessage?: string} => (
  typeof error === 'object'
  && error !== null
  && ('stderr' in error || 'shortMessage' in error)
);

const toYouTubeWatchUrl = (videoIdOrUrl: string) => videoIdOrUrl.length === 11
  ? `https://www.youtube.com/watch?v=${videoIdOrUrl}`
  : videoIdOrUrl;

export const getYtDlpVersion = async (): Promise<string> => {
  const {stdout} = await execa(getExecutable(), ['--version'], {
    timeout: YT_DLP_VERSION_TIMEOUT_MS,
  });

  return stdout.trim();
};

const pathExists = async (candidatePath: string, mode = fsConstants.F_OK) => {
  try {
    await fs.access(candidatePath, mode);
    return true;
  } catch {
    return false;
  }
};

const hasPathSeparator = (candidatePath: string) => candidatePath.includes('/') || candidatePath.includes('\\');

const getCommandCandidates = (command: string) => {
  if (process.platform !== 'win32' || path.extname(command)) {
    return [command];
  }

  const executableExtensions = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .filter(Boolean)
    .map(extension => `${command}${extension.toLowerCase()}`);

  return [command, ...executableExtensions];
};

const findExecutableOnPath = async (command: string) => {
  const directories = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean);

  for (const directory of directories) {
    for (const candidate of getCommandCandidates(command)) {
      const candidatePath = path.join(directory, candidate);
      // eslint-disable-next-line no-await-in-loop
      if (await pathExists(candidatePath, fsConstants.X_OK)) {
        return candidatePath;
      }
    }
  }

  return null;
};

const resolveExecutablePath = async () => {
  const executable = getExecutable();

  if (path.isAbsolute(executable)) {
    return executable;
  }

  if (hasPathSeparator(executable)) {
    return path.resolve(executable);
  }

  return findExecutableOnPath(executable);
};

const getPythonExecutableForYtDlp = async () => {
  const executable = await resolveExecutablePath();
  if (!executable) {
    return null;
  }

  const realExecutable = await fs.realpath(executable);
  const binDirectory = path.dirname(realExecutable);
  const pythonExecutable = path.join(binDirectory, process.platform === 'win32' ? 'python.exe' : 'python');

  return (await pathExists(pythonExecutable)) ? pythonExecutable : null;
};

const updateWithPip = async () => {
  const pythonExecutable = await getPythonExecutableForYtDlp();
  if (!pythonExecutable) {
    return false;
  }

  await execa(pythonExecutable, [
    '-m',
    'pip',
    'install',
    '--disable-pip-version-check',
    '--no-input',
    '--upgrade',
    'yt-dlp',
  ], {
    env: {
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      PIP_NO_INPUT: '1',
    },
    timeout: YT_DLP_UPDATE_TIMEOUT_MS,
  });
  return true;
};

const updateWithYtDlpSelfUpdate = async () => {
  await execa(getExecutable(), ['-U'], {
    timeout: YT_DLP_UPDATE_TIMEOUT_MS,
  });
  return true;
};

const joinErrors = (errors: string[]) => errors.length > 0 ? errors.join('; ') : undefined;

export const updateYtDlp = async (): Promise<YtDlpUpdateResult> => {
  let beforeVersion: string | null = null;
  try {
    beforeVersion = await getYtDlpVersion();
  } catch {
    // If version probing fails, still try the configured updater below.
  }

  const errors: string[] = [];
  let attemptedUpdate = false;
  let updateSucceeded = false;

  try {
    const didAttemptUpdate = await updateWithPip();
    if (didAttemptUpdate) {
      attemptedUpdate = true;
      updateSucceeded = true;
    }
  } catch (error: unknown) {
    attemptedUpdate = true;
    errors.push(getExecaErrorMessage(error));
  }

  if (!updateSucceeded) {
    try {
      await updateWithYtDlpSelfUpdate();
      attemptedUpdate = true;
      updateSucceeded = true;
    } catch (error: unknown) {
      attemptedUpdate = true;
      errors.push(getExecaErrorMessage(error));
    }
  }

  let afterVersion: string | null = null;
  try {
    afterVersion = await getYtDlpVersion();
  } catch (error: unknown) {
    const updateErrors = updateSucceeded ? [] : errors;

    return {
      beforeVersion,
      afterVersion,
      updated: false,
      skipped: !attemptedUpdate,
      updateSucceeded,
      error: joinErrors([...updateErrors, getExecaErrorMessage(error)]),
    };
  }

  const error = updateSucceeded ? undefined : joinErrors(errors);

  return {
    beforeVersion,
    afterVersion,
    updated: beforeVersion !== null && beforeVersion !== afterVersion,
    skipped: !attemptedUpdate,
    updateSucceeded,
    error,
  };
};

export const PLAYER_CLIENT_ATTEMPTS = [
  'tv_embedded,android_vr,web',
  'tv_embedded,web',
  'mweb,web',
  'web',
];

const extractWithClients = async (videoIdOrUrl: string, clients: string): Promise<YtDlpMediaSource> => {
  const {stdout} = await execa(getExecutable(), [
    '--dump-single-json',
    '--no-playlist',
    '--skip-download',
    '--no-warnings',
    '--no-cache-dir',
    '-f',
    'bestaudio/best',
    '-S',
    'proto:https',
    '--extractor-args',
    `youtube:player_client=${clients}`,
    toYouTubeWatchUrl(videoIdOrUrl),
  ], {
    timeout: YT_DLP_EXTRACT_TIMEOUT_MS,
  });

  const response = JSON.parse(stdout) as YtDlpResponse;
  const download = response.requested_downloads?.at(0) ?? response;

  if (!download.url) {
    throw new Error('yt-dlp did not return a playable media URL.');
  }

  return {
    url: download.url,
    headers: normalizeHeaders(download.http_headers ?? response.http_headers),
    isLive: Boolean(response.is_live ?? (response.live_status === 'is_live')),
  };
};

export const getYouTubeMediaSource = async (videoIdOrUrl: string): Promise<YtDlpMediaSource> => {
  let lastError: unknown;

  for (const clients of PLAYER_CLIENT_ATTEMPTS) {
    try {
      return await extractWithClients(videoIdOrUrl, clients); // eslint-disable-line no-await-in-loop
    } catch (error: unknown) {
      lastError = error;
    }
  }

  if (isExecaError(lastError)) {
    const detail = (lastError as {stderr?: string; shortMessage?: string}).stderr?.trim()
      ?? (lastError as {shortMessage?: string}).shortMessage
      ?? 'Unknown yt-dlp error';
    throw new Error(`yt-dlp failed to extract media: ${detail}`);
  }

  if (lastError instanceof SyntaxError) {
    throw new Error('yt-dlp returned an invalid response.');
  }

  throw lastError;
};

export interface YtDlpStream {
  readonly stream: Readable;
  readonly kill: () => void;
}

export const createYtDlpAudioStream = (videoIdOrUrl: string): YtDlpStream => {
  const proc = execa(getExecutable(), [
    '--format', 'bestaudio',
    '--output', '-',
    '--no-playlist',
    '--quiet',
    '--no-warnings',
    '--no-cache-dir',
    '--extractor-args', `youtube:player_client=${PLAYER_CLIENT_ATTEMPTS[0]}`,
    toYouTubeWatchUrl(videoIdOrUrl),
  ], {buffer: false});

  if (!proc.stdout) {
    throw new Error('yt-dlp process has no stdout stream');
  }

  return {
    stream: proc.stdout as unknown as Readable,
    kill: () => { proc.kill('SIGKILL'); },
  };
};

interface YtDlpSearchResult {
  readonly id: string;
  readonly title: string;
  readonly uploader: string;
  readonly duration: number;
  readonly thumbnail: string;
  readonly is_live: boolean;
}

export const searchWithYtDlp = async (query: string): Promise<YtDlpSearchResult | null> => {
  try {
    const {stdout} = await execa(getExecutable(), [
      '--dump-single-json',
      '--no-playlist',
      '--skip-download',
      '--no-warnings',
      '--no-cache-dir',
      `ytsearch1:${query}`,
    ], {
      timeout: YT_DLP_EXTRACT_TIMEOUT_MS,
    });

    return JSON.parse(stdout) as YtDlpSearchResult;
  } catch {
    return null;
  }
};
