import { t, message, isEnglish, locale, setLanguage, useLanguage } from './i18n';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Check, ChevronDown, ExternalLink, Film, Folder, FolderOpen, HardDrive, KeyRound, ListChecks, LogIn, LogOut,
  Maximize2, Minimize2, Pencil, Play, Plus, RefreshCcw, Search, Settings2, SlidersHorizontal, Star, Tags, UserRound, X } from 'lucide-react';
import type { ConnectionChecks, JobState, MatchCandidate, MediaAsset, MetadataSource, Person, PublicSettings, ScrapeLog, Work, WorkEdit } from './shared';
import { posterWallDefaults, posterWallControls, appearanceDefaults, appearanceControls, type AppearanceSettings, type PosterWallSettings } from './shared';
import { matchesSearch } from './search';
import './styles.css';

const Overview = lazy(() => import('./Overview'));
type Tab = 'movie' | 'tv' | 'overview';
type Sort = 'added' | 'name' | 'year' | 'douban' | 'imdb';
const getSortOptions = (): { value: Sort; label: string }[] => [
  { value: 'added', label: t("最近加入") }, { value: 'name', label: t("片名") }, { value: 'year', label: t("年份") },
  { value: 'douban', label: t("豆瓣评分") }, { value: 'imdb', label: t("IMDb 评分") }
];

const emptyJob: JobState = { running: false, kind: null, phase: '', done: 0, total: 0, addedWorks: 0,
  addedAssets: 0, addedEpisodes: 0, failures: 0, message: '' };
const emptySettings: PublicSettings = { ...posterWallDefaults, ...appearanceDefaults, language: 'zh', roots: [], playerPath: '', proxyUrl: '', backgroundBlur: 10, hasTmdbKey: false, hasOmdbKey: false,
  doubanStatus: '', top250UpdatedAt: null, needsSetup: false };

function poster(work: Work): string | undefined { return work.poster ? `library://image/${work.poster}` : undefined; }
function displayTitle(work: Work): string { return isEnglish() ? englishTitle(work) : work.titleZh || work.titleEn || work.originalTitle || t("未命名影片"); }
function englishTitle(work: Work): string {
  if (isEnglish()) return [work.titleEn, work.originalTitle].find(value => value && !/[\u3400-\u9fff]/.test(value)) || 'Title unavailable';
  return work.titleEn || work.originalTitle || displayTitle(work);
}
function chineseTitle(work: Work): string { return isEnglish() ? '' : work.titleZh || work.doubanTitleZh; }
function posterTitle(work: Work): string { return englishTitle(work); }
function posterSubtitle(work: Work): string {
  const candidate = chineseTitle(work);
  const chinese = /[\u3400-\u9fff]/.test(candidate) && candidate !== posterTitle(work) ? candidate : '';
  return [chinese, work.year ? String(work.year) : ''].filter(Boolean).join(' · ') || t("未知年份");
}
function hasChineseText(value: string): boolean { return (value.match(/[\u3400-\u9fff]/g) ?? []).length >= 6; }
function humanDate(time: number | null): string { return time ? new Date(time).toLocaleDateString(locale()) : t("尚未更新"); }
function personName(person: Person): string {
  if (!isEnglish()) return person.name;
  return [person.originalName, person.name, ...(person.aliases ?? [])].find(value => value && !/[\u3400-\u9fff]/.test(value)) || 'Name unavailable';
}
function libraryMessage(text: string, works: Work[]): string {
  if (!isEnglish()) return text;
  // Titles inside persisted progress/log messages follow the current display language.
  for (const work of works) for (const title of new Set([work.titleZh, work.doubanTitleZh])) {
    if (title && /[\u3400-\u9fff]/.test(title)) text = text.replaceAll(title, englishTitle(work));
  }
  return message(text);
}
function sourceName(asset: MediaAsset): string { return asset.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || asset.path; }
function gigabytes(size: number): string { return size < 10_000_000 ? '<0.01 GB' : `${(size / 1_000_000_000).toFixed(2)} GB`; }

function AmbientBackdrop({ source, inDetail }: { source?: string; inDetail: boolean }) {
  const current = useRef(source);
  const fadeTimer = useRef<number | null>(null);
  const [displayed, setDisplayed] = useState(source);
  const [outgoing, setOutgoing] = useState<string | undefined>();

  useEffect(() => {
    if (source === current.current) return;
    setOutgoing(current.current);
    current.current = source;
    setDisplayed(source);
    if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => { setOutgoing(undefined); fadeTimer.current = null; }, 520);
  }, [source]);
  useEffect(() => () => { if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current); }, []);

  const layer = (image: string, className: string) => <div className={`ambient-layer ${className}`} key={image}>
    <div className="ambient-image" style={{ backgroundImage: `url("${image}")` }}/>
  </div>;
  return <div className={`ambient-backdrop ${inDetail ? 'in-detail' : ''}`} aria-hidden="true">
    {outgoing && outgoing !== displayed && layer(outgoing, 'ambient-layer-outgoing')}
    {displayed && layer(displayed, 'ambient-layer-incoming')}
    <div className="ambient-vignette"/>
  </div>;
}

function App() {
  const language = useLanguage();
  const sortOptions = getSortOptions();
  const [works, setWorks] = useState<Work[]>([]);
  const [settings, setSettings] = useState<PublicSettings>(emptySettings);
  const [job, setJob] = useState<JobState>(emptyJob);
  const [tab, setTab] = useState<Tab>('movie');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const libraryScroll = useRef<Record<Tab, number>>({ movie: 0, tv: 0, overview: 0 });
  const pendingScroll = useRef<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [scrapeLogs, setScrapeLogs] = useState<ScrapeLog[]>([]);
  const [editing, setEditing] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [directors, setDirectors] = useState<string[]>([]);
  const [cardMenu, setCardMenu] = useState<{ workId: number; x: number; y: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [doubanMin, setDoubanMin] = useState(0);
  const [doubanMax, setDoubanMax] = useState(10);
  const [imdbMin, setImdbMin] = useState(0);
  const [imdbMax, setImdbMax] = useState(10);
  const [top250Only, setTop250Only] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favoritePending, setFavoritePending] = useState<number[]>([]);
  const [sort, setSort] = useState<Sort>('added');
  const [sortOpen, setSortOpen] = useState(false);
  const sortControl = useRef<HTMLDivElement>(null);
  const sortTrigger = useRef<HTMLButtonElement>(null);
  const sortMenu = useRef<HTMLDivElement>(null);
  const [jobDismissed, setJobDismissed] = useState(false);
  const [blurPreview, setBlurPreview] = useState<number | null>(null);
  const [appearancePreview, setAppearancePreview] = useState<AppearanceSettings | null>(null);
  const [wallPreview, setWallPreview] = useState<PosterWallSettings | null>(null);
  const [error, setError] = useState('');

  async function reload() {
    try {
      const [nextWorks, nextSettings, nextJob] = await Promise.all([
        window.library.listWorks(), window.library.getSettings(), window.library.getJob()
      ]);
      setLanguage(nextSettings.language); setWorks(nextWorks); setSettings(nextSettings); setJob(nextJob);
    } catch (cause) { setError(String(cause)); }
  }
  useEffect(() => {
    void reload();
    const offChanged = window.library.onChanged(() => void reload());
    const offJob = window.library.onJob(setJob);
    const offFullscreen = window.library.onFullscreen(setFullscreen);
    void window.library.isFullscreen().then(setFullscreen);
    return () => { offChanged(); offJob(); offFullscreen(); };
  }, []);
  useEffect(() => {
    if (!logsOpen) return;
    const refresh = () => { void window.library.listScrapeLogs().then(setScrapeLogs).catch(cause => setError(String(cause))); };
    refresh();
    return window.library.onChanged(refresh);
  }, [logsOpen]);
  useEffect(() => { if (job.running) setJobDismissed(false); }, [job.running]);
  useEffect(() => {
    if (!sortOpen) return;
    sortMenu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!sortControl.current?.contains(event.target as Node)) setSortOpen(false);
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSortOpen(false); sortTrigger.current?.focus(); }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => { document.removeEventListener('pointerdown', closeOutside); document.removeEventListener('keydown', closeEscape); };
  }, [sortOpen]);
  useLayoutEffect(() => {
    // Restore after React has mounted the full list, before the next paint.
    const top = selectedId !== null ? 0 : pendingScroll.current ?? libraryScroll.current[tab];
    window.scrollTo({ top, behavior: 'instant' });
    pendingScroll.current = null;
  }, [selectedId, tab]);
  useEffect(() => {
    if (!cardMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element && event.target.closest('.card-context-menu'))) setCardMenu(null);
    };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setCardMenu(null); };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeEscape);
    };
  }, [cardMenu]);

  const selected = works.find(work => work.id === selectedId) ?? null;
  const ambientWork = selected ?? works.find(work => work.id === hoveredId) ?? (settingsOpen ? works.find(work => work.poster) : null) ?? null;
  const ambientSource = ambientWork ? poster(ambientWork) : undefined;
  const typeWorks = works.filter(work => work.mediaType === tab);
  const allGenres = useMemo(() => [...new Set(typeWorks.flatMap(work => [...work.genres, ...(language === 'en' ? [] : work.doubanTags)]))].filter(genre => language !== 'en' || !/[\u3400-\u9fff]/.test(genre)).sort(), [works, tab, language]);
  const allDirectors = useMemo(() => {
    const people = new Map<string, Person>();
    for (const work of typeWorks) for (const person of work.directors) people.set(person.id, person);
    return [...people.values()].sort((a, b) => personName(a).localeCompare(personName(b), locale()));
  }, [works, tab, language]);
  const filtered = useMemo(() => {
    const result = typeWorks.filter(work => {
      if (!matchesSearch(work, search)) return false;
      if (genres.length && !genres.some(genre => work.genres.includes(genre) || work.doubanTags.includes(genre))) return false;
      if (directors.length && !directors.some(id => work.directors.some(person => person.id === id))) return false;
      if ((doubanMin > 0 || doubanMax < 10) && (work.ratingDouban === null || work.ratingDouban < doubanMin || work.ratingDouban > doubanMax)) return false;
      if ((imdbMin > 0 || imdbMax < 10) && (work.ratingImdb === null || work.ratingImdb < imdbMin || work.ratingImdb > imdbMax)) return false;
      if (top250Only && work.topRank === null) return false;
      if (favoritesOnly && !work.favorite) return false;
      return true;
    });
    result.sort((a, b) => {
      if (sort === 'name') return posterTitle(a).localeCompare(posterTitle(b), 'en');
      if (sort === 'year') return (b.year ?? -1) - (a.year ?? -1);
      if (sort === 'douban') return (b.ratingDouban ?? -1) - (a.ratingDouban ?? -1);
      if (sort === 'imdb') return (b.ratingImdb ?? -1) - (a.ratingImdb ?? -1);
      return b.addedAt - a.addedAt;
    });
    return result;
  }, [works, tab, search, genres, directors, doubanMin, doubanMax, imdbMin, imdbMax, top250Only, favoritesOnly, sort, language]);
  const activeFilters = genres.length + directors.length + Number(doubanMin > 0 || doubanMax < 10) + Number(imdbMin > 0 || imdbMax < 10) + Number(top250Only) + Number(favoritesOnly);

  async function run(action: () => Promise<unknown>) {
    setError('');
    try { await action(); await reload(); } catch (cause) { setError(String(cause)); }
  }
  async function runJobAction(action: () => Promise<unknown>) {
    setJobDismissed(false);
    await run(action);
  }
  function resetFilters() { setGenres([]); setDirectors([]); setDoubanMin(0); setDoubanMax(10); setImdbMin(0); setImdbMax(10); setTop250Only(false); setFavoritesOnly(false); }
  async function toggleFavorite(work: Work) {
    if (favoritePending.includes(work.id)) return;
    setFavoritePending(current => [...current, work.id]);
    setWorks(current => current.map(item => item.id === work.id ? { ...item, favorite: !work.favorite } : item));
    try { await window.library.setFavorite(work.id, !work.favorite); }
    catch (cause) { setError(String(cause)); await reload(); }
    finally { setFavoritePending(current => current.filter(id => id !== work.id)); }
  }
  function personClick(person: Person) {
    pendingScroll.current = 0;
    setTab(selected?.mediaType ?? 'movie');
    resetFilters(); setSearch(personName(person)); setSelectedId(null);
  }
  function openDetail(workId: number) {
    libraryScroll.current[tab] = window.scrollY;
    setHoveredId(null);
    setSelectedId(workId);
  }
  function navigate(next: Tab) {
    setHoveredId(null); setSortOpen(false); setCardMenu(null);
    if (next === tab && selectedId === null) {
      libraryScroll.current[tab] = 0;
      window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      return;
    }
    pendingScroll.current = 0;
    libraryScroll.current[next] = 0;
    if (next !== tab) resetFilters();
    setTab(next); setSelectedId(null);
  }
  function openCardMenu(event: React.MouseEvent, workId: number) {
    event.preventDefault();
    setCardMenu({ workId, x: Math.max(12, Math.min(event.clientX, window.innerWidth - 274)),
      y: Math.max(12, Math.min(event.clientY, window.innerHeight - 304)) });
  }
  function refreshCard(workId: number, source: MetadataSource) {
    setCardMenu(null);
    void runJobAction(() => window.library.refreshWorkMetadata(workId, source));
  }

  const appearance = appearancePreview ?? settings;
  return <div className="app-shell" style={{ '--ambient-blur': `${blurPreview ?? settings.backgroundBlur}px`, '--panel-blur': `${appearance.panelBlur}px`, '--panel-opacity': appearance.panelOpacity / 100, '--ambient-opacity': appearance.backgroundOpacity / 100, '--ambient-saturation': appearance.backgroundSaturation / 100, '--ambient-brightness': appearance.backgroundBrightness / 100 } as React.CSSProperties}>
    {tab !== 'overview' && <AmbientBackdrop source={ambientSource} inDetail={Boolean(selected)}/>}
    <header className="topbar">
      <div className="brand" onClick={() => setSelectedId(null)}><div className="brand-mark"><Film size={21} strokeWidth={1.8}/></div><div className="brand-copy"><span>Movie Glacier</span><small className="app-version">v{__APP_VERSION__}</small></div></div>
      <nav className="main-tabs" aria-label={t("影视类型")}>
        <button className={tab === 'movie' ? 'active' : ''} onClick={() => navigate('movie')}>Movies <span>{works.filter(work => work.mediaType === 'movie').length}</span></button>
        <button className={tab === 'tv' ? 'active' : ''} onClick={() => navigate('tv')}>Series <span>{works.filter(work => work.mediaType === 'tv').length}</span></button>
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => navigate('overview')}>Overview</button>
      </nav>
      <div className="top-actions">

        <button className="icon-button" title={t("设置")} onClick={() => setSettingsOpen(true)}><Settings2 size={21}/></button>
        <button className="icon-button" title={fullscreen ? t("退出全屏（F11）") : t("全屏（F11）")} onClick={() => void window.library.toggleFullscreen()}>{fullscreen ? <Minimize2 size={19}/> : <Maximize2 size={19}/>}</button>

      </div>
    </header>

    <main className="main-content">
      {selected ? <Detail work={selected} topDate={settings.top250UpdatedAt} onBack={() => setSelectedId(null)} onPerson={personClick} onEdit={() => setEditing(true)}
        onTop250={() => { pendingScroll.current = 0; setSelectedId(null); setTop250Only(true); setFiltersOpen(true); }} onPlay={asset => void run(() => window.library.play(asset.id))}/>
      : tab === 'overview' ? <Suspense fallback={<div className="empty-state">{t("加载中…")}</div>}><Overview works={works} wallSettings={wallPreview ?? settings}/></Suspense> : <>
        <div className="page-intro"><h1>{tab === 'movie' ? 'Movies' : 'Series'}<span className="heading-count">{typeWorks.length}</span></h1></div>
        <div className="toolbar">
          <label className="search-box"><Search size={18}/><input ref={searchInput} value={search} onChange={event => setSearch(event.target.value)} placeholder={t("搜索电影、导演或演员（中英文）")}/>{search && <button className="search-clear" type="button" aria-label={t("清空搜索")} title={t("清空搜索")} onClick={() => { setSearch(''); searchInput.current?.focus(); }}><X size={16}/></button>}</label>
          <button className={`toolbar-button favorites-filter ${favoritesOnly ? 'selected' : ''}`} aria-pressed={favoritesOnly} onClick={() => setFavoritesOnly(value => !value)}><Star size={17} fill={favoritesOnly ? 'currentColor' : 'none'}/> {t(" 收藏")}</button>
          <button className={`toolbar-button ${filtersOpen || activeFilters ? 'selected' : ''}`} onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={17}/> {t(" 筛选 ")}{activeFilters > 0 && <b>{activeFilters}</b>}</button>
          <div className="sort-control" ref={sortControl}>
            <button ref={sortTrigger} className={`sort-trigger ${sortOpen ? 'open' : ''}`} type="button" aria-label={t("排序：{0}", sortOptions.find(option => option.value === sort)?.label)} aria-haspopup="listbox" aria-expanded={sortOpen} onClick={() => setSortOpen(value => !value)}><span className="sort-caption">{t("排序")}</span><span className="sort-value">{sortOptions.find(option => option.value === sort)?.label}</span><ChevronDown size={15}/></button>
            {sortOpen && <div className="sort-menu" ref={sortMenu} role="listbox" aria-label={t("排序方式")} onKeyDown={event => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const options = [...(sortMenu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
                (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
              options[next]?.focus();
            }}>{sortOptions.map(option => <button key={option.value} type="button" role="option" aria-selected={sort === option.value} onClick={() => { setSort(option.value); setSortOpen(false); sortTrigger.current?.focus(); }}><span>{option.label}</span><span className="sort-option-mark">{sort === option.value && <Check size={15}/>}</span></button>)}</div>}
          </div>
        </div>
        {filtersOpen && <div className="filter-panel">
          <div className="filter-group"><div className="filter-heading"><Tags size={16}/> {t(" 类型")}</div><div className="chip-list">{allGenres.length ? allGenres.map(genre => <button key={genre} className={`chip ${genres.includes(genre) ? 'on' : ''}`} onClick={() => setGenres(current => current.includes(genre) ? current.filter(item => item !== genre) : [...current, genre])}>{genre}</button>) : <span className="muted">{t("资料刮削后显示")}</span>}</div></div>
          <div className="filter-group"><div className="filter-heading"><UserRound size={16}/> {t(" 导演")}</div><div className="chip-list scroll-chips">{allDirectors.map(person => <button key={person.id} className={`chip ${directors.includes(person.id) ? 'on' : ''}`} onClick={() => setDirectors(current => current.includes(person.id) ? current.filter(id => id !== person.id) : [...current, person.id])}>{personName(person)}{!isEnglish() && person.originalName && <small> · {person.originalName}</small>}</button>)}</div></div>
          <div className="filter-row"><div className="score-range"><span>{t("豆瓣评分")}</span><input aria-label={t("豆瓣最低分")} type="number" min="0" max="10" step="0.5" value={doubanMin} onChange={event => setDoubanMin(Math.min(doubanMax, Math.max(0, Number(event.target.value))))}/><span>{t("至")}</span><input aria-label={t("豆瓣最高分")} type="number" min="0" max="10" step="0.5" value={doubanMax} onChange={event => setDoubanMax(Math.max(doubanMin, Math.min(10, Number(event.target.value))))}/></div><div className="score-range"><span>{t("IMDb 评分")}</span><input aria-label={t("IMDb 最低分")} type="number" min="0" max="10" step="0.5" value={imdbMin} onChange={event => setImdbMin(Math.min(imdbMax, Math.max(0, Number(event.target.value))))}/><span>{t("至")}</span><input aria-label={t("IMDb 最高分")} type="number" min="0" max="10" step="0.5" value={imdbMax} onChange={event => setImdbMax(Math.max(imdbMin, Math.min(10, Number(event.target.value))))}/></div><button className={`chip ${top250Only ? 'on' : ''}`} onClick={() => setTop250Only(value => !value)}><Star size={14}/> {t(" 豆瓣 Top250")}</button><button className="text-button" onClick={resetFilters}>{t("清除筛选")}</button></div>
          {tab === 'tv' && <p className="filter-note">{t("剧集没有整剧评分时，使用本地最新季的评分。")}</p>}
        </div>}
        {!jobDismissed && job.running && <div className="job-strip"><RefreshCcw size={15} className="spin"/><span>{libraryMessage(job.phase, works) || t("正在更新")}</span><em>{job.done}{job.total ? ` / ${job.total}` : ''}</em><button className="job-dismiss" type="button" aria-label={t("关闭更新提示")} title={t("关闭提示")} onClick={() => setJobDismissed(true)}><X size={16}/></button></div>}
        {!jobDismissed && !job.running && job.message && <div className={`job-strip ${job.failures ? 'warning' : ''}`}><Check size={15}/><span>{libraryMessage(job.message, works)}</span><em>{t("新增资源 ")}{job.addedAssets} {t(" · 本次失败 ")}{job.failures}</em><button className="job-dismiss" type="button" aria-label={t("关闭更新提示")} title={t("关闭提示")} onClick={() => setJobDismissed(true)}><X size={16}/></button></div>}
        <div className="result-head"><span>{isEnglish() ? `${filtered.length} ${tab === 'tv' ? 'series' : 'movies'}` : <>{filtered.length} 部{tab === 'tv' ? '剧集' : '电影'}</>}</span>{favoritesOnly && <button className="tiny-link" onClick={() => setFavoritesOnly(false)}>{t("已收藏 ×")}</button>}{top250Only && <button className="tiny-link" onClick={() => setTop250Only(false)}>{t("豆瓣 Top250 ×")}</button>}</div>
        {filtered.length ? <div className="poster-grid">{filtered.map((work, index) => <article className="poster-card" key={work.id} style={{ '--card-index': Math.min(index, 12) } as React.CSSProperties} onPointerEnter={() => setHoveredId(work.id)} onPointerLeave={() => setHoveredId(null)} onContextMenu={event => openCardMenu(event, work.id)}>
          <button className="poster-open" aria-label={t("查看《{0}》详情", displayTitle(work))} onClick={() => openDetail(work.id)}><div className="poster-frame">{poster(work) ? <img src={poster(work)} alt={t("{0}海报", displayTitle(work))}/> : <div className="poster-placeholder"><Film size={34}/><span>{displayTitle(work)}</span></div>}{work.assets.every(asset => !asset.available) && <div className="poster-offline">{t("资源离线")}</div>}<div className="poster-play"><Play fill="currentColor" size={20}/></div></div><div className="poster-title">{posterTitle(work)}</div><div className="poster-subtitle">{posterSubtitle(work)}</div></button>
          <button className={`poster-favorite ${work.favorite ? 'on' : ''}`} disabled={favoritePending.includes(work.id)} aria-label={work.favorite ? t("取消收藏《{0}》", displayTitle(work)) : t("收藏《{0}》", displayTitle(work))} aria-pressed={work.favorite} title={work.favorite ? t("取消收藏") : t("加入收藏")} onClick={() => void toggleFavorite(work)}><Star size={19} strokeWidth={2.1} fill={work.favorite ? 'currentColor' : 'none'}/></button>
        </article>)}</div>
        : <div className="empty-state"><div className="empty-icon"><Film size={34}/></div><h2>{!settings.roots.length ? t("从你的影视目录开始") : typeWorks.length ? t("没有找到符合条件的作品") : t("这里还没有内容")}</h2><p>{!settings.roots.length ? t("选择一个存放电影或剧集的文件夹，建立属于自己的片库。") : typeWorks.length ? t("试试调整搜索或筛选条件。") : t("把影片放入已设置的目录，然后点击更新库。")}</p><button className="secondary-button" onClick={() => setSettingsOpen(true)}>{!settings.roots.length ? t("选择影视目录") : t("设置")}</button></div>}
      </>}
    </main>
    {cardMenu && <div className="card-context-menu" role="menu" aria-label={t("电影快捷菜单")} style={{ left: cardMenu.x, top: cardMenu.y }}>
      <button role="menuitem" onClick={() => { const id = cardMenu.workId; setCardMenu(null); void run(() => window.library.openWorkLocation(id)); }}><FolderOpen size={16}/> {t(" 在资源管理器中打开原位置")}</button>
      <button role="menuitem" onClick={() => { const id = cardMenu.workId; setCardMenu(null); void run(() => window.library.openShooterSubtitles(id)); }}><ExternalLink size={16}/> {t(" Shooter字幕")}</button>
      <div className="context-menu-divider"/><div className="context-menu-heading">{t("重新抓取元数据")}</div>
      <button role="menuitem" disabled={job.running} onClick={() => refreshCard(cardMenu.workId, 'omdb')}><RefreshCcw size={15}/> OMDb</button>
      <button role="menuitem" disabled={job.running} onClick={() => refreshCard(cardMenu.workId, 'tmdb')}><RefreshCcw size={15}/> TMDB</button>
      <button role="menuitem" disabled={job.running} onClick={() => refreshCard(cardMenu.workId, 'douban')}><RefreshCcw size={15}/> {t(" 豆瓣")}</button>
    </div>}
    {error && <div className="toast" role="alert"><span>{message(error)}</span><button onClick={() => setError('')}><X size={16}/></button></div>}
    {(settingsOpen || settings.needsSetup) && <SettingsModal job={job} onLogs={() => setLogsOpen(true)} settings={settings} onboarding={settings.needsSetup} onClose={() => { setSettingsOpen(false); setBlurPreview(null); setWallPreview(null); setAppearancePreview(null); }} onSave={async patch => { const retry = settings.needsSetup || patch.roots?.some(root => !settings.roots.includes(root)) || patch.proxyUrl !== settings.proxyUrl || Boolean(patch.tmdbKey || patch.omdbKey); await window.library.setSettings(patch); await reload(); if (retry) void runJobAction(window.library.updateLibrary); }} onAppearancePreview={setAppearancePreview} onWallPreview={setWallPreview} onBlurPreview={setBlurPreview} onRun={runJobAction} onError={setError}/>}
    {logsOpen && <LogsModal works={works} logs={scrapeLogs} job={job} onClose={() => setLogsOpen(false)} onRetry={() => void runJobAction(window.library.retryFailed)}/>}
    {editing && selected && <EditModal work={selected} onClose={() => setEditing(false)} onSaved={async id => { setSelectedId(id); setEditing(false); await reload(); }} onIgnored={async () => { setEditing(false); setSelectedId(null); await reload(); }} onError={setError}/>}
  </div>;
}

function Detail({ work, topDate, onBack, onPerson, onEdit, onTop250, onPlay }: { work: Work; topDate: number | null; onBack: () => void; onPerson: (person: Person) => void; onEdit: () => void; onTop250: () => void; onPlay: (asset: MediaAsset) => void }) {
  const [chosenAsset, setChosenAsset] = useState<number | null>(() => Number(localStorage.getItem(`asset:${work.id}`)) || null);
  useEffect(() => { setChosenAsset(Number(localStorage.getItem(`asset:${work.id}`)) || null); }, [work.id]);
  const movies = work.assets.filter(asset => asset.episode === null);
  const episodes = work.assets.filter(asset => asset.episode !== null).sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0));
  const movieAsset = movies.find(asset => asset.id === chosenAsset) ?? movies.find(asset => asset.available) ?? movies[0];
  const seasons = [...new Set(episodes.map(asset => asset.season ?? 0))].sort((a, b) => a - b);
  const titleZh = chineseTitle(work);
  const overviewEn = hasChineseText(work.overview) ? '' : work.overview;
  const overviewZh = isEnglish() ? '' : work.doubanOverviewZh || (hasChineseText(work.overview) ? work.overview : '');
  const englishTags = work.genres.filter(genre => !/[\u3400-\u9fff]/.test(genre));
  const chineseTags = isEnglish() ? [] : work.doubanTags.length ? work.doubanTags : work.genres.filter(genre => /[\u3400-\u9fff]/.test(genre));
  return <div className="detail-view">
    <div className="detail-actions"><button className="back-button" onClick={onBack}><ArrowLeft size={19}/> {t(" 返回片库")}</button><button className="secondary-button small" onClick={onEdit}><Pencil size={15}/> {t(" 编辑资料")}</button></div>
    <div className="hero">
      <div className="hero-inner"><div className="hero-eyebrow">{work.mediaType === 'movie' ? 'FILM' : 'SERIES'} {work.year && `· ${work.year}`}</div><h1>{englishTitle(work)}</h1>{titleZh && titleZh !== englishTitle(work) && <div className="hero-original">{titleZh}</div>}<div className="hero-facts">{work.year && <span>{work.year}</span>}{work.runtime && <span>{work.runtime} {t(" 分钟")}</span>}{(isEnglish() ? englishTags : work.genres).slice(0, 3).map(genre => <span key={genre}>{genre}</span>)}</div><div className="hero-ratings"><span><Star size={16} fill="currentColor"/> {t(" 豆瓣")}{work.ratingSeason !== null ? t("·第{0}季", work.ratingSeason) : ''} {work.ratingDouban ?? '—'}</span><span><Star size={16} fill="currentColor"/> IMDb {work.ratingImdb ?? '—'}</span>{work.topRank && <button className="top-badge" title={`${t("榜单更新于 ")}${humanDate(topDate)}`} onClick={onTop250}>{t("豆瓣 Top250 · 第 ")}{work.topRank} {t(" 名")}</button>}</div>{work.mediaType === 'movie' && movieAsset && <><button className="play-button" disabled={!movieAsset.available} onClick={() => onPlay(movieAsset)}><Play size={19} fill="currentColor"/> {movieAsset.available ? t("播放电影") : t("资源离线")}</button><div className="hero-source" title={movieAsset.path}><span className="hero-source-name">{movieAsset.kind === 'bdmv' ? t("源文件夹") : t("源文件")}：{sourceName(movieAsset)}</span><span className="hero-source-size">{gigabytes(movieAsset.size)}</span></div></>}</div>
      <div className="hero-poster">{poster(work) ? <img src={poster(work)} alt={t("{0}海报", displayTitle(work))}/> : <div className="hero-poster-placeholder"><Film size={42}/><span>{displayTitle(work)}</span></div>}</div>
    </div>
    <div className="detail-layout"><div className="detail-primary">
      {(overviewEn || overviewZh) && <section><h2>{t("剧情简介")}</h2><div className="overview-stack">{overviewEn && <div><h3>English</h3><p className="overview">{overviewEn}</p></div>}{overviewZh && <div><h3>{t("中文")}</h3><p className="overview">{overviewZh}</p></div>}</div></section>}
      {work.mediaType === 'tv' && <section><h2>{t("本地剧集 ")}<span className="section-muted">{episodes.length} {t(" 集")}</span></h2>{seasons.map(season => <div className="season" key={season}><h3>{isEnglish() ? `Season ${season}` : `第 ${season} 季`}</h3><div className="episodes">{episodes.filter(asset => asset.season === season).map(asset => <button key={asset.id} disabled={!asset.available} onClick={() => onPlay(asset)}><span>{isEnglish() ? `Episode ${asset.episode}` : `第 ${asset.episode} 集`}</span><small>{asset.available ? asset.path.split(/[\\/]/).pop() : t("资源离线")}</small><Play size={16}/></button>)}</div></div>)}</section>}
      {work.mediaType === 'movie' && movies.length > 1 && <section><h2>{t("播放版本")}</h2><div className="versions">{movies.map(asset => <button className={movieAsset?.id === asset.id ? 'chosen' : ''} key={asset.id} onClick={() => { setChosenAsset(asset.id); localStorage.setItem(`asset:${work.id}`, String(asset.id)); }}><HardDrive size={18}/><span>{sourceName(asset)} · {gigabytes(asset.size)}{!asset.available && t(" · 离线")}</span>{movieAsset?.id === asset.id && <Check size={17}/>}</button>)}</div></section>}
      <section><h2>{t("标签")}</h2><div className="tag-languages">{englishTags.length > 0 && <div className="tag-row"><span className="tag-language">EN</span><div className="detail-tags">{englishTags.map(genre => <span key={`en${genre}`}>{genre}</span>)}</div></div>}{chineseTags.length > 0 && <div className="tag-row"><span className="tag-language">{t("中文")}</span><div className="detail-tags">{chineseTags.map(genre => <span key={`zh${genre}`}>{genre}</span>)}</div></div>}</div><div className="detail-tags auxiliary-tags">{work.countries.map(country => <span key={`c${country}`}>{t(country)}</span>)}{work.year && <span>{Math.floor(work.year / 10) * 10} {t(" 年代")}</span>}</div></section>
    </div><aside className="detail-sidebar"><section><h2>{t("导演")}</h2><div className="person-list">{work.directors.length ? work.directors.map(person => <button key={person.id} onClick={() => onPerson(person)}>{personName(person)}{!isEnglish() && person.originalName && <small>{person.originalName}</small>}</button>) : <span className="muted">{t("暂无资料")}</span>}</div></section>{work.creators.length > 0 && <section><h2>{t("创作者")}</h2><p>{work.creators.map(person => personName(person)).join(' · ')}</p></section>}<section><h2>{t("编剧")}</h2><p>{work.writers.length ? work.writers.map(person => personName(person)).join(' · ') : t("暂无资料")}</p></section><section><h2>{t("演员")}</h2><div className="person-list">{work.actors.length ? work.actors.map(person => <button key={person.id} onClick={() => onPerson(person)}>{personName(person)}{!isEnglish() && person.originalName && <small>{person.originalName}</small>}</button>) : <span className="muted">{t("暂无资料")}</span>}</div></section></aside></div>
  </div>;
}

function SettingsModal({ onAppearancePreview, onWallPreview, job, onLogs, settings, onboarding, onClose, onSave, onBlurPreview, onRun, onError }: { onAppearancePreview: (value: AppearanceSettings) => void; onWallPreview: (value: PosterWallSettings) => void; job: JobState; onLogs: () => void; settings: PublicSettings; onboarding: boolean; onClose: () => void; onSave: (patch: AppearanceSettings & PosterWallSettings & { language: 'zh' | 'en'; roots: string[]; playerPath: string; proxyUrl: string; backgroundBlur: number; tmdbKey?: string; omdbKey?: string }) => Promise<void>; onBlurPreview: (value: number) => void; onRun: (action: () => Promise<unknown>) => Promise<void>; onError: (error: string) => void }) {
  const [language, chooseLanguage] = useState(settings.language);
  const [roots, setRoots] = useState(settings.roots);
  const [playerPath, setPlayerPath] = useState(settings.playerPath);
  const [proxyUrl, setProxyUrl] = useState(settings.proxyUrl);
  const [backgroundBlur, setBackgroundBlur] = useState(settings.backgroundBlur);
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>(() => ({ panelBlur: settings.panelBlur, panelOpacity: settings.panelOpacity, backgroundOpacity: settings.backgroundOpacity, backgroundSaturation: settings.backgroundSaturation, backgroundBrightness: settings.backgroundBrightness }));
  function previewAppearance(value: AppearanceSettings) { setAppearanceSettings(value); onAppearancePreview(value); }
  function resetAppearance(group: 'panel' | 'background') {
    const next = { ...appearanceSettings };
    for (const control of appearanceControls.filter(c => c.group === group)) next[control.key] = appearanceDefaults[control.key];
    previewAppearance(next);
    if (group === 'background') { setBackgroundBlur(10); onBlurPreview(10); }
  }
  function appearanceSliders(group: 'panel' | 'background') { return appearanceControls.filter(c => c.group === group).map(control => <label className="blur-control" key={control.key}><div className="wall-control-heading"><span>{t(control.label)}</span><output className="blur-value">{appearanceSettings[control.key]} {control.unit}</output></div><input type="range" min={control.min} max={control.max} step="1" aria-label={t(control.label)} value={appearanceSettings[control.key]} style={{ '--blur-progress': `${appearanceSettings[control.key] / control.max * 100}%` } as React.CSSProperties} onChange={event => previewAppearance({ ...appearanceSettings, [control.key]: Number(event.target.value) })}/><span><small>{control.min} {control.unit}</small><small>{control.max} {control.unit}</small></span></label>); }
  const [wallSettings, setWallSettings] = useState<PosterWallSettings>(() => ({ overviewBlur: settings.overviewBlur, overviewOpacity: settings.overviewOpacity, overviewSpeed: settings.overviewSpeed, overviewSaturation: settings.overviewSaturation }));
  function previewWall(value: PosterWallSettings) { setWallSettings(value); onWallPreview(value); }
  const [tmdbKey, setTmdbKey] = useState('');
  const [omdbKey, setOmdbKey] = useState('');
  const [checks, setChecks] = useState<ConnectionChecks | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ignored, setIgnored] = useState<{ id: number; title: string; path: string }[]>([]);
  useEffect(() => { if (!onboarding) void window.library.listIgnored().then(setIgnored); }, [onboarding]);
  async function save() {
    if (onboarding && (!roots.length || (!settings.hasTmdbKey && !tmdbKey.trim() && !settings.hasOmdbKey && !omdbKey.trim()))) {
      onError(t("首次使用请先选择影视目录，并填写至少一种资料源凭据；无代理时建议填写 OMDb API Key"));
      return;
    }
    setSaving(true);
    try { await onSave({ ...appearanceSettings, ...wallSettings, language, roots, playerPath, proxyUrl, backgroundBlur, ...(tmdbKey.trim() ? { tmdbKey: tmdbKey.trim() } : {}), ...(omdbKey.trim() ? { omdbKey: omdbKey.trim() } : {}) }); onClose(); }
    catch (error) { onError(String(error)); }
    finally { setSaving(false); }
  }
  async function testConnection() {
    setChecking(true);
    setChecks(null);
    try { setChecks(await window.library.testSources({ proxyUrl, tmdbKey, omdbKey })); }
    catch (cause) { onError(String(cause)); }
    finally { setChecking(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onboarding ? undefined : onClose}><div className="modal settings-modal" role="dialog" aria-label={onboarding ? t("首次配置") : t("设置")} onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow">{onboarding ? 'WELCOME TO MOVIE GLACIER' : 'PREFERENCES'}</div><h2>{onboarding ? t("首次配置") : t("设置")}</h2></div>{!onboarding && <button className="icon-button" onClick={onClose}><X size={22}/></button>}</div><div className="modal-scroll">
    {!onboarding && <section className="settings-quick-actions"><button className="secondary-button" onClick={onLogs}><ListChecks size={17}/>{t("抓取日志")}</button><button className="primary-button" disabled={job.running || !settings.roots.length} onClick={() => void onRun(window.library.updateLibrary)}><RefreshCcw size={17} className={job.running ? 'spin' : ''}/>{job.running ? t("正在更新") : t("更新库")}</button></section>}
    <section><div className="modal-section-head"><h3>{t('界面语言')}</h3></div><div className="language-options" role="group" aria-label={t('界面语言')}><button type="button" aria-pressed={language === 'zh'} onClick={() => chooseLanguage('zh')}>{isEnglish() ? 'Chinese' : '中文'}</button><button type="button" aria-pressed={language === 'en'} onClick={() => chooseLanguage('en')}>English</button></div><p className="helper">{t('保存后切换界面语言。英文模式隐藏中文片名、中文简介与中文标签。')}</p></section>
    {onboarding && <p className="setup-intro">{t("设置好目录和至少一种资料来源后，软件会自动识别文件名。TMDB 无法连接时会自动使用 OMDb 抓取海报、演职员和 IMDb 评分；OMDb 无需 IMDb 账号。")}</p>}
    <section><div className="modal-section-head"><h3><Folder size={18}/>{t("影视目录 ")}<span className="root-count">{roots.length} {t(" 个")}</span></h3><button className="tiny-link" onClick={async () => { const folders = await window.library.chooseFolders(); setRoots(current => [...new Set([...current, ...folders])]); }}><Plus size={16}/>{t("添加文件夹")}</button></div><p className="helper">{t("可以添加多个本地文件夹；以后随时回来继续添加。扫描时会检查全部目录，包括新放入的影片。包含关系的目录会自动合并，移除目录不会删除文件。")}</p>{roots.length ? <div className="root-list">{roots.map(root => <div key={root}><Folder size={18}/><span title={root}>{root}</span><button title={t("移除目录")} aria-label={t("移除目录 {0}", root)} onClick={() => setRoots(current => current.filter(item => item !== root))}><X size={16}/></button></div>)}</div> : <div className="empty-row">{t("尚未选择目录")}</div>}</section>
    <section><div className="modal-section-head"><h3><Play size={18}/>PotPlayer</h3><button className="tiny-link" onClick={async () => { const player = await window.library.choosePlayer(); if (player) setPlayerPath(player); }}>{t("选择程序")}</button></div><div className="path-display">{playerPath || t("尚未找到 PotPlayer")}</div></section>
    <section className="ambient-settings"><div className="modal-section-head"><h3>{t("主页与详情 · 海报背景")}</h3><button className="tiny-link" onClick={() => resetAppearance('background')}>{t("恢复默认效果")}</button></div><p className="helper">{t("调节海报色彩背景的模糊程度。拖动时可实时预览，保存后在主页和详情页生效。")}</p><label className="blur-control"><div className="wall-control-heading"><span>{t("背景模糊程度")}</span><output className="blur-value">{backgroundBlur} px</output></div><input type="range" min="0" max="50" step="1" aria-label={t("背景模糊程度")} value={backgroundBlur} style={{ '--blur-progress': `${backgroundBlur / 50 * 100}%` } as React.CSSProperties} onChange={event => { const value = Number(event.target.value); setBackgroundBlur(value); onBlurPreview(value); }}/><span><small>{t("清晰")}</small><small>{t("柔和")}</small></span></label>{appearanceSliders('background')}</section>
    <section className="panel-settings"><div className="modal-section-head"><h3>{t("界面面板 · 毛玻璃")}</h3><button className="tiny-link" onClick={() => resetAppearance('panel')}>{t("恢复默认效果")}</button></div><p className="helper">{t("控制 Overview 图表卡片、设置和其他面板的毛玻璃。降低模糊和不透明度可看清背景；拖动预览，保存保留，取消恢复。")}</p>{appearanceSliders('panel')}</section>
    <section className="wall-settings"><div className="modal-section-head"><h3>{t("Overview · 海报墙")}</h3><button className="tiny-link" onClick={() => previewWall({ ...posterWallDefaults })}>{t("恢复默认效果")}</button></div><p className="helper">{t("调整 Overview 错位滚动海报墙，拖动时实时预览，保存后保留；取消将恢复原值。滚动速度 100% 为默认速度，0% 为静止。")}</p>
      {posterWallControls.map(control => <label className="blur-control" key={control.key}><div className="wall-control-heading"><span>{t(control.label)}</span><output className="blur-value">{wallSettings[control.key]} {control.unit}</output></div><input type="range" min={control.min} max={control.max} step="1" aria-label={t(control.label)} value={wallSettings[control.key]} style={{ '--blur-progress': `${(wallSettings[control.key] - control.min) / (control.max - control.min) * 100}%` } as React.CSSProperties} onChange={event => previewWall({ ...wallSettings, [control.key]: Number(event.target.value) })}/><span><small>{control.min} {control.unit}</small><small>{control.max} {control.unit}</small></span></label>)}
    </section>
    <section><div className="modal-section-head"><h3><KeyRound size={18}/>{t("网络连接")}</h3></div><p className="helper">{t("代理地址留空时按 Windows 网络设置连接；没有系统代理时会直连。仅在当前电脑直连失败时填写本地 HTTP 或 SOCKS5 代理地址。此设置只用于 TMDB 和 OMDb 请求。")}</p><label className="setting-label">{t("代理地址（可选）")}<input value={proxyUrl} onChange={event => setProxyUrl(event.target.value)} placeholder={t("留空直连；或填写 http://127.0.0.1:7890")} autoComplete="off"/></label></section>
    <section><div className="modal-section-head"><h3><KeyRound size={18}/>{t("TMDB · 海报与英文资料（可选）")}</h3><button className="tiny-link" onClick={() => void window.library.openHelp('tmdb')}><ExternalLink size={14}/>{t("打开申请页面")}</button></div><p className="helper">{t("1. 注册或登录 TMDB。2. 进入账户设置 → API，申请访问凭据。3. 复制 ")}<strong>API Read Access Token</strong>{t("（较长的一串字符），粘贴到下方。TMDB 在当前网络不可达时，软件会改用 OMDb。")}</p><label className="setting-label">{t("TMDB 读取令牌 ")}<span>{settings.hasTmdbKey ? t("✓ 已加密保存") : t("未配置")}</span><input type="password" value={tmdbKey} onChange={event => setTmdbKey(event.target.value)} placeholder={settings.hasTmdbKey ? t("已保存；留空保持原值，输入新令牌可更换") : t("粘贴 TMDB API Read Access Token")} autoComplete="off"/></label></section>
    <section><div className="modal-section-head"><h3><KeyRound size={18}/>{t("OMDb · 备用资料源")}</h3><button className="tiny-link" onClick={() => void window.library.openHelp('omdb')}><ExternalLink size={14}/>{t("打开申请页面")}</button></div><p className="helper">{t("1. 打开 OMDb 的 Key 申请页，选择免费方案并填写邮箱。2. 在收到的邮件中激活 Key。3. 把 Key 粘贴到下方。可获取英文片名、海报、简介、演职员和 IMDb 评分；无需 IMDb 账号。无代理电脑请先点击下方“测试连接与凭据”。")}</p><label className="setting-label">OMDb API Key <span>{settings.hasOmdbKey ? t("✓ 已加密保存") : t("未配置")}</span><input type="password" value={omdbKey} onChange={event => setOmdbKey(event.target.value)} placeholder={settings.hasOmdbKey ? t("已保存；留空保持原值，输入新 Key 可更换") : t("粘贴 OMDb API Key")} autoComplete="off"/></label></section>
    <section><div className="modal-section-head"><h3><ListChecks size={18}/>{t("检测资料源连接")}</h3><button className="secondary-button small" disabled={checking} onClick={() => void testConnection()}>{checking ? t("检测中…") : t("测试连接与凭据")}</button></div><p className="helper">{t("会使用上方当前输入的令牌和代理地址；留空的令牌沿用已保存值。检测不会修改设置。")}</p>{checks && <><div className="connection-results"><div className={checks.tmdb.ok ? 'ok' : 'fail'}><strong>TMDB {checks.tmdb.ok ? t("成功") : t("失败")}</strong><span>{message(checks.tmdb.message)}</span></div><div className={checks.omdb.ok ? 'ok' : 'fail'}><strong>OMDb {checks.omdb.ok ? t("成功") : t("失败")}</strong><span>{message(checks.omdb.message)}</span></div></div>{!checks.tmdb.ok && checks.omdb.ok && <p className="helper">{t("OMDb 已可用；TMDB 失败不会阻止电影入库与基础资料抓取。")}</p>}</>}</section>
    <section><div className="modal-section-head"><h3><Star size={18}/>{t("豆瓣 · 中文资料、评分与 Top250")}</h3></div><p className="helper">{t("电影会从豆瓣补全中文片名、简介和类型标签。公开搜索和榜单一般无需登录；遇到访问频繁或验证时会暂停并保留待处理任务。若出现验证提示，点击“登录 / 验证”，在打开的豆瓣官方网页完成登录，然后重试失败任务。软件仅保存网页会话，不保存密码。")}</p><div className="douban-row"><div><strong>{t("豆瓣网页会话")}</strong><small>{message(settings.doubanStatus)}</small></div><button className="secondary-button small" onClick={() => void onRun(window.library.doubanLogin)}><LogIn size={15}/>{t("登录 / 验证")}</button><button className="text-button" onClick={() => void onRun(window.library.doubanLogout)}><LogOut size={15}/>{t("退出")}</button></div></section>
    {!onboarding && <section><div className="modal-section-head"><h3><RefreshCcw size={18}/>{t("维护资料库")}</h3></div><div className="maintenance"><button onClick={() => void onRun(window.library.rescanLibrary)}>{t("重新扫描整个库")}<small>{t("核对所有本地文件，复用已刮削资料")}</small></button><button onClick={() => void onRun(window.library.refreshMetadata)}>{t("刷新全部资料")}<small>{t("重新获取海报、演职员、评分和 Top250")}</small></button><button onClick={() => void onRun(window.library.retryFailed)}>{t("重试失败任务")}<small>{t("继续上次未完成的刮削")}</small></button></div></section>}
    {!onboarding && ignored.length > 0 && <section><div className="modal-section-head"><h3>{t("已忽略的资源")}</h3></div><div className="ignored-list">{ignored.map(item => <div key={item.id}><span>{isEnglish() && /[\u3400-\u9fff]/.test(item.title) ? `Ignored title #${item.id}` : item.title}<small>{item.path}</small></span><button className="tiny-link" onClick={async () => { await window.library.restoreWork(item.id); setIgnored(current => current.filter(work => work.id !== item.id)); }}>{t("恢复")}</button></div>)}</div></section>}
  </div><div className="modal-footer">{!onboarding && <button className="text-button" onClick={onClose}>{t("取消")}</button>}<button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? t("保存中") : onboarding ? t("完成设置并开始扫描") : t("保存设置")}</button></div></div></div>;
}

function LogsModal({ works, logs, job, onClose, onRetry }: { works: Work[]; logs: ScrapeLog[]; job: JobState; onClose: () => void; onRetry: () => void }) {
  const [filter, setFilter] = useState<'all' | ScrapeLog['status']>('all');
  const shown = filter === 'all' ? logs : logs.filter(item => item.status === filter);
  const label: Record<ScrapeLog['status'], string> = { pending: t("待处理"), running: t("抓取中"), done: t("成功"), failed: t("失败"), skipped: t("跳过") };
  const source: Record<ScrapeLog['source'], string> = { tmdb: 'TMDB', omdb: 'OMDb', douban: t("豆瓣") };
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal logs-modal" role="dialog" aria-label={t("抓取日志")} onMouseDown={event => event.stopPropagation()}>
    <div className="modal-header"><div><div className="eyebrow">METADATA ACTIVITY</div><h2>{t("抓取日志")}</h2></div><button className="icon-button" aria-label={t("关闭日志")} onClick={onClose}><X size={22}/></button></div>
    <div className="log-summary"><span>{t("成功影片 ")}{logs.filter(item => item.status === 'done').length}</span><span>{t("失败影片 ")}{logs.filter(item => item.status === 'failed').length}</span><span>{t("当前待处理 ")}{logs.filter(item => item.status === 'pending' || item.status === 'running').length}</span></div>
    <div className="log-filters">{(['all', 'failed', 'done', 'pending', 'skipped'] as const).map(status => <button key={status} className={filter === status ? 'active' : ''} onClick={() => setFilter(status)}>{status === 'all' ? t("全部") : label[status]}</button>)}</div>
    <div className="modal-scroll log-list">{shown.length ? shown.map(item => <div className="log-entry" key={item.id}><div className="log-entry-top"><strong>{isEnglish() ? englishTitle(works.find(work => work.id === item.workId) ?? { titleEn: '', originalTitle: item.title } as Work) : item.title}</strong><span className={`log-status ${item.status}`}>{label[item.status]}</span></div><div className="log-entry-meta">{source[item.source]} · {new Date(item.updatedAt).toLocaleString(locale())}</div>{item.message && <p>{item.message === 'TypeError: fetch failed' ? t("网络连接失败（旧版记录）；请在设置中测试资料源连接") : libraryMessage(item.message, works)}</p>}</div>) : <div className="empty-row">{logs.length ? t("没有符合条件的记录") : t("暂无抓取记录。扫描入库后会显示每部影片的抓取结果。")}</div>}</div>
    <div className="modal-footer"><span className="log-footer-note">{t("每部影片仅显示最新一次抓取 · 共 ")}{logs.length} {t(" 部")}</span><button className="secondary-button small" disabled={job.running} onClick={onRetry}><RefreshCcw size={15}/>{t("重试失败与待处理")}</button><button className="primary-button" onClick={onClose}>{t("关闭")}</button></div>
  </div></div>;
}

function EditModal({ work, onClose, onSaved, onIgnored, onError }: { work: Work; onClose: () => void; onSaved: (id: number) => Promise<void>; onIgnored: () => Promise<void>; onError: (error: string) => void }) {
  const [edit, setEdit] = useState<WorkEdit>({ titleZh: work.titleZh, titleEn: work.titleEn, year: work.year,
    overview: work.overview, tmdbId: work.tmdbId, imdbId: work.imdbId, doubanId: work.doubanId });
  const [query, setQuery] = useState(displayTitle(work));
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  function patch(changes: Partial<WorkEdit>) { setEdit(current => ({ ...current, ...changes })); }
  async function searchSource() {
    setBusy(true);
    try { setCandidates(await window.library.searchMatch(work.id, query.trim() || displayTitle(work))); }
    catch (error) { onError(String(error)); }
    finally { setBusy(false); }
  }
  async function save() {
    setBusy(true);
    try { await onSaved(await window.library.saveWorkEdit(work.id, edit)); }
    catch (error) { onError(String(error)); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal edit-modal" role="dialog" aria-label={t("编辑资料")} onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow">EDIT MOVIE DETAILS</div><h2>{t("编辑资料")}</h2></div><button className="icon-button" onClick={onClose}><X size={22}/></button></div><div className="modal-scroll">
    <p className="helper">{t("文件名已自动识别。资料对应错了时，在这里搜索并选择正确的 TMDB 条目；自定义文字会保留到下次资料刷新。")}</p>
    <section><div className="modal-section-head"><h3>{t("匹配资料来源")}</h3></div><div className="match-search"><input value={query} onChange={event => setQuery(event.target.value)} placeholder={t("搜索电影或剧集名称")} onKeyDown={event => { if (event.key === 'Enter') void searchSource(); }}/><button disabled={busy} onClick={() => void searchSource()}><Search size={16}/>{t("搜索 TMDB")}</button></div>{candidates.map(candidate => <button className={`candidate ${edit.tmdbId === candidate.id ? 'chosen' : ''}`} key={candidate.id} onClick={() => patch({ tmdbId: candidate.id })}><span>{isEnglish() ? candidate.originalTitle : candidate.title}<small>{candidate.originalTitle} · {candidate.year ?? t("未知年份")} · TMDB #{candidate.id}</small></span>{edit.tmdbId === candidate.id && <Check size={17}/>}</button>)}<p className="helper">{t("当前 TMDB ID：")}{edit.tmdbId ?? t("未匹配")}{t("。选择新条目后，保存时自动更新海报和演职员；如还想自定义片名，可保存后再次编辑。")}</p></section>
    <section><div className="edit-fields">{!isEnglish() && <label className="setting-label">{t("中文片名")}<input value={edit.titleZh} onChange={event => patch({ titleZh: event.target.value })}/></label>}<label className="setting-label">{t("英文片名")}<input value={edit.titleEn} onChange={event => patch({ titleEn: event.target.value })}/></label><label className="setting-label">{t("年份")}<input type="number" min="1888" max="2100" value={edit.year ?? ''} onChange={event => patch({ year: event.target.value ? Number(event.target.value) : null })}/></label></div><label className="setting-label">{t("剧情简介")}<textarea value={isEnglish() && hasChineseText(edit.overview) ? '' : edit.overview} onChange={event => patch({ overview: event.target.value })} rows={4}/></label></section>
    <section><div className="edit-fields"><label className="setting-label">{t("IMDb 条目 ID")}<input value={edit.imdbId ?? ''} onChange={event => patch({ imdbId: event.target.value || null })} placeholder="tt1234567"/></label><label className="setting-label">{t("豆瓣条目 ID")}<input value={edit.doubanId ?? ''} onChange={event => patch({ doubanId: event.target.value || null })} placeholder={t("网址 /subject/ 后的数字")}/></label></div><p className="helper">{t("修改来源 ID 后将重新获取对应评分。豆瓣 Top250 标签按条目 ID 关联。")}</p></section>
    <button className="tiny-link ignore" onClick={async () => { if (!window.confirm(t("确定忽略这个资源？可以在设置中恢复。"))) return; await window.library.ignoreWork(work.id); await onIgnored(); }}>{t("忽略此资源")}</button>
  </div><div className="modal-footer"><button className="text-button" onClick={onClose}>{t("取消")}</button><button className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? t("处理中") : t("保存修改")}</button></div></div></div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
