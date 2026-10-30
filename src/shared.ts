export type MediaType = 'movie' | 'tv';
export type MediaKind = 'file' | 'bdmv';
export type MetadataSource = 'omdb' | 'tmdb' | 'douban';

export interface Person {
  id: string;
  name: string;
  originalName?: string;
  aliases?: string[];
}

export interface MediaAsset {
  id: number;
  workId: number;
  root: string;
  path: string;
  kind: MediaKind;
  season: number | null;
  episode: number | null;
  size: number;
  mtimeMs: number;
  active: boolean;
  available: boolean;
  lastSeen: number;
}

export interface SeasonRating {
  season: number;
  source: 'douban' | 'imdb';
  score: number;
  votes: number | null;
  sourceId: string | null;
  fetchedAt: number;
}

export interface Work {
  id: number;
  mediaType: MediaType;
  tmdbId: number | null;
  imdbId: string | null;
  doubanId: string | null;
  doubanTitleZh: string;
  titleZh: string;
  titleEn: string;
  originalTitle: string;
  year: number | null;
  overview: string;
  doubanOverviewZh: string;
  runtime: number | null;
  poster: string | null;
  backdrop: string | null;
  genres: string[];
  doubanTags: string[];
  countries: string[];
  directors: Person[];
  creators: Person[];
  writers: Person[];
  actors: Person[];
  ratingDouban: number | null;
  ratingSeason: number | null;
  seasonRatings: SeasonRating[];
  ratingImdb: number | null;
  doubanVotes: number | null;
  topRank: number | null;
  imdbTopRank: number | null;
  favorite: boolean;
  addedAt: number;
  updatedAt: number | null;
  matchState: 'pending' | 'matched' | 'manual' | 'ignored';
  assets: MediaAsset[];
}

export interface PosterWallSettings {
  overviewBlur: number;
  overviewOpacity: number;
  overviewSpeed: number;
  overviewSaturation: number;
}

export const posterWallDefaults: PosterWallSettings = {
  overviewBlur: 1, overviewOpacity: 62, overviewSpeed: 140, overviewSaturation: 65
};

export const posterWallControls: { key: keyof PosterWallSettings; label: string; min: number; max: number; unit: string }[] = [
  { key: 'overviewBlur', label: '海报墙模糊程度', min: 0, max: 50, unit: 'px' },
  { key: 'overviewOpacity', label: '海报墙不透明度', min: 0, max: 100, unit: '%' },
  { key: 'overviewSpeed', label: '海报墙滚动速度', min: 0, max: 200, unit: '%' },
  { key: 'overviewSaturation', label: '海报墙色彩饱和度', min: 0, max: 200, unit: '%' }
];

export interface AppearanceSettings {
  panelBlur: number;
  panelOpacity: number;
  backgroundOpacity: number;
  backgroundSaturation: number;
  backgroundBrightness: number;
}
export const appearanceDefaults: AppearanceSettings = {
  panelBlur: 16, panelOpacity: 68, backgroundOpacity: 77, backgroundSaturation: 160, backgroundBrightness: 88
};
export const backgroundBlurDefault = 5;
export const appearanceControls: { key: keyof AppearanceSettings; group: 'panel' | 'background'; label: string; min: number; max: number; unit: string }[] = [
  { key: 'panelBlur', group: 'panel', label: '面板毛玻璃模糊程度', min: 0, max: 50, unit: 'px' },
  { key: 'panelOpacity', group: 'panel', label: '面板背景不透明度', min: 0, max: 100, unit: '%' },
  { key: 'backgroundOpacity', group: 'background', label: '悬停背景不透明度', min: 0, max: 100, unit: '%' },
  { key: 'backgroundSaturation', group: 'background', label: '悬停背景色彩饱和度', min: 0, max: 200, unit: '%' },
  { key: 'backgroundBrightness', group: 'background', label: '悬停背景亮度', min: 0, max: 100, unit: '%' }
];

export interface PublicSettings extends PosterWallSettings, AppearanceSettings {
  language: 'zh' | 'en';
  roots: string[];
  playerPath: string;
  proxyUrl: string;
  backgroundBlur: number;
  hasTmdbKey: boolean;
  hasOmdbKey: boolean;
  doubanStatus: string;
  top250UpdatedAt: number | null;
  imdbTop250UpdatedAt: number | null;
  needsSetup: boolean;
}

export interface SourceCheck { ok: boolean; message: string }
export interface ConnectionChecks { tmdb: SourceCheck; omdb: SourceCheck }
export interface ScrapeLog {
  id: number;
  workId: number;
  title: string;
  source: 'tmdb' | 'omdb' | 'douban';
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  message: string;
  updatedAt: number;
}

export interface WorkEdit {
  titleZh: string;
  titleEn: string;
  year: number | null;
  overview: string;
  tmdbId: number | null;
  imdbId: string | null;
  doubanId: string | null;
}

export interface JobState {
  running: boolean;
  kind: 'scan' | 'refresh' | null;
  phase: string;
  done: number;
  total: number;
  addedWorks: number;
  addedAssets: number;
  addedEpisodes: number;
  failures: number;
  message: string;
}

export interface MatchCandidate {
  id: number;
  title: string;
  originalTitle: string;
  year: number | null;
  posterPath: string | null;
}

export interface Bridge {
  readonly platform: string;
  onMenuAction(callback: (action: 'search' | 'settings' | 'movie' | 'tv' | 'overview' | 'back') => void): () => void;
  listWorks(): Promise<Work[]>;
  getSettings(): Promise<PublicSettings>;
  setSettings(patch: Partial<PosterWallSettings & AppearanceSettings> & { language?: 'zh' | 'en'; roots?: string[]; playerPath?: string; proxyUrl?: string; backgroundBlur?: number; tmdbKey?: string; omdbKey?: string }): Promise<PublicSettings>;
  testSources(patch?: { proxyUrl?: string; tmdbKey?: string; omdbKey?: string }): Promise<ConnectionChecks>;
  listScrapeLogs(): Promise<ScrapeLog[]>;
  chooseFolders(): Promise<string[]>;
  setFavorite(workId: number, favorite: boolean): Promise<void>;
  choosePlayer(): Promise<string | null>;
  updateLibrary(): Promise<JobState>;
  rescanLibrary(): Promise<JobState>;
  refreshMetadata(): Promise<JobState>;
  refreshWorkMetadata(workId: number, source: MetadataSource): Promise<JobState>;
  openWorkLocation(workId: number): Promise<void>;
  openShooterSubtitles(workId: number): Promise<void>;
  retryFailed(): Promise<JobState>;
  getJob(): Promise<JobState>;
  onChanged(callback: () => void): () => void;
  onJob(callback: (job: JobState) => void): () => void;
  play(assetId: number): Promise<void>;
  searchMatch(workId: number, query: string): Promise<MatchCandidate[]>;
  setMatch(workId: number, tmdbId: number): Promise<void>;
  saveWorkEdit(workId: number, edit: WorkEdit): Promise<number>;
  ignoreWork(workId: number): Promise<void>;
  listIgnored(): Promise<{ id: number; title: string; path: string }[]>;
  restoreWork(workId: number): Promise<void>;
  openHelp(source: 'tmdb' | 'omdb' | 'douban'): Promise<void>;
  toggleFullscreen(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  onFullscreen(callback: (full: boolean) => void): () => void;
  doubanLogin(): Promise<void>;
  doubanLogout(): Promise<void>;
  imdbVerify(): Promise<void>;
}
