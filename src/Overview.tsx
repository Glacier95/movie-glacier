import { createPortal } from 'react-dom';
import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import PosterWall from './PosterWall';
import OverviewChart, { type ChartKind } from './OverviewChart';
import type { Work, PosterWallSettings } from './shared';
import { useLanguage, t } from './i18n';
import { summarizeLibrary, relationships, type Bucket, type RatingStep } from './overview-data';
import './overview.css';

const imageUrl = (name: string) => `library://image/${name}`;

function useReducedMotion() {
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const query = matchMedia('(prefers-reduced-motion: reduce)'); const change = () => setReduced(query.matches); query.addEventListener('change', change); return () => query.removeEventListener('change', change); }, []);
  return reduced;
}

export default function Overview({ works, wallSettings }: { works: Work[]; wallSettings: PosterWallSettings }) {
  const language = useLanguage(), en = language === 'en';
  const text = (zh: string, english: string) => en ? english : zh;
  const [scope, setScope] = useState<'all' | 'movie' | 'tv'>('all');
  const [ratingStep, setRatingStep] = useState<RatingStep>(0.5);
  const [ratingFocus, setRatingFocus] = useState(true);
  const [hidden, setHidden] = useState(document.hidden);
  const reduced = useReducedMotion();
  const [selection, setSelection] = useState<Bucket | null>(null);
  useEffect(() => { const change = () => setHidden(document.hidden); document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change); }, []);
  const filtered = useMemo(() => scope === 'all' ? works : works.filter(w => w.mediaType === scope), [scope, works]);
  const stats = useMemo(() => summarizeLibrary(filtered, en, ratingStep), [filtered, en, ratingStep]);
  useEffect(() => setSelection(null), [scope, language, works]);
  const ratingBuckets = useMemo(() => [...stats.ratings.imdb.map(b => ({ ...b, name: 'IMDb · ' + b.name })), ...stats.ratings.douban.map(b => ({ ...b, name: (en ? 'Douban' : '豆瓣') + ' · ' + b.name }))], [stats.ratings, en]);
  const chordGenres = useMemo(() => stats.genres.slice(0, 8), [stats.genres]);
  const genreLinks = useMemo(() => relationships(chordGenres), [chordGenres]);
  const countryLinks = useMemo(() => relationships(stats.countries), [stats.countries]);
  const sections: { key: string; kind: ChartKind; title: string; sub: string; data: Bucket[] }[] = [
    { key: 'genres', kind: 'pie', title: text('类型光谱', 'Genre spectrum'), sub: text('按作品类型分布', 'Titles by genre'), data: stats.genres },
    { key: 'chord', kind: 'chord', title: text('类型交织', 'Genre connections'), sub: text('前八类的共同作品 · 弦宽表示共同作品数', 'Top eight genres · ribbon width shows shared titles'), data: chordGenres },
    { key: 'years', kind: 'years', title: text('银幕年代', 'Through the years'), sub: text('按上映年份统计', 'Titles by release year'), data: stats.years },
    { key: 'countries', kind: 'bubbles', title: text('世界取景', 'Around the world'), sub: text('点面积表示作品数 · 连线表示合拍作品', 'Bubble area shows titles · links show co-productions'), data: stats.countries },
    { key: 'ratings', kind: 'ratings', title: text('IMDb 与豆瓣评分', 'IMDb & Douban ratings'), sub: text('细看收藏的评分分布 · 点击折线节点查看对应作品', 'Explore score distributions · click a point to see its titles'), data: ratingBuckets },
    { key: 'directors', kind: 'people', title: text('导演 · Top 10', 'Directors · Top 10'), sub: text('库中作品数量最多的导演', 'The filmmakers you collect most'), data: stats.directors },
    { key: 'actors', kind: 'people', title: text('演员 · Top 10', 'Cast · Top 10'), sub: text('库中作品数量最多的演员', 'The faces that keep returning'), data: stats.actors }
  ];
  const selectedWorks = selection ? filtered.filter(w => selection.ids.includes(w.id)) : [];
  return <div className="overview-page">
    <PosterWall works={works} paused={reduced || hidden} settings={wallSettings}/>
    <div className="overview-heading"><div><div className="overview-eyebrow">THE COLLECTION, IN PERSPECTIVE</div><h1>Overview<span className="overview-dot">.</span></h1></div></div>
    <div className="overview-controls"><div className="overview-scopes" aria-label={text('统计范围', 'Collection scope')}>{(['all', 'movie', 'tv'] as const).map(value => <button key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>{value === 'all' ? text('全部收藏', 'All titles') : value === 'movie' ? 'Movies' : 'Series'}</button>)}</div></div>
    <div className="overview-metrics">{[
      [text('作品总数', 'TOTAL TITLES'), stats.total, text('按作品统计 · 不重复计算文件版本', 'Titles, not duplicate file versions')],
      ['MOVIES / SERIES', `${stats.movies} / ${stats.series}`, text('电影 / 剧集', 'Movies / series')],
      ['DOUBAN TOP 250', stats.top250, text('库内上榜作品', 'Ranked titles in your library')],
      ['IMDb TOP 250', stats.imdbTop250, text('库内上榜作品', 'Ranked titles in your library')]
    ].map(([label, value, hint]) => <div className="overview-metric" key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>)}</div>
    {!stats.total && <div className="overview-empty"><h2>{text('你的收藏故事，从第一部开始', 'Your collection begins with one title')}</h2><p>{text('在设置中添加影视目录并更新库，统计将随资料自动出现。', 'Add a media folder and update your library in Settings to see its story here.')}</p></div>}
    <div className="overview-panels">{sections.map((section, i) => <section className={`overview-panel panel-${section.key}`} key={section.key}>
      <div className="overview-panel-heading"><div><span className="panel-index">0{i + 1}</span><h2>{section.title}</h2><p>{section.sub}</p></div></div>
      {section.kind === 'ratings' && <>
        <div className="rating-summaries">{(['imdb', 'douban'] as const).map(source => {
          const summary = stats.ratingSummary[source];
          return <div className={`rating-source rating-${source}`} key={source}>
            <div className="rating-source-heading"><strong>{source === 'imdb' ? 'IMDb' : text('豆瓣', 'Douban')}</strong><span>{summary.count} / {stats.total} {text('已评分', 'rated')}</span></div>
            <div className="rating-average"><strong>{summary.mean?.toFixed(2) ?? '—'}</strong><span>{text('平均分', 'Average')}</span></div>
            <div className="rating-details"><span>{text('中位数', 'Median')} <b>{summary.median?.toFixed(1) ?? '—'}</b></span><span>≥ 8.0 <b>{summary.count ? `${Math.round(summary.highShare * 100)}%` : '—'}</b></span></div>
            <div className="rating-coverage" title={`${text('评分覆盖率', 'Rating coverage')}: ${Math.round(summary.coverage * 100)}%`}><span style={{ width: `${summary.coverage * 100}%` }}/></div>
          </div>;
        })}</div>
        <div className="rating-controls">
          <div className="rating-segments" role="group" aria-label={text('评分分档', 'Score intervals')}>{([0.1, 0.5, 1] as const).map(step => <button key={step} aria-pressed={ratingStep === step} onClick={() => setRatingStep(step)}>{step} {text('分', 'pt')}</button>)}</div>
          <div className="rating-segments rating-range" role="group" aria-label={text('评分显示范围', 'Score range')}><button aria-pressed={ratingFocus} onClick={() => setRatingFocus(true)}>{text('聚焦评分', 'Focus')}</button><button aria-pressed={!ratingFocus} onClick={() => setRatingFocus(false)}>0–10</button></div>
        </div>
      </>}
      <OverviewChart kind={section.kind} data={section.data} links={section.kind === 'chord' ? genreLinks : section.kind === 'bubbles' ? countryLinks : undefined} ratings={section.kind === 'ratings' ? stats.ratings : undefined} ratingFocus={ratingFocus} label={section.title} onPick={setSelection} reduced={reduced} english={en}/>
      {section.kind === 'ratings' && <div className="rating-notes"><p>{stats.ratingSummary.paired.count
        ? text(`双站均有评分 ${stats.ratingSummary.paired.count} 部 · 同一批作品，豆瓣 − IMDb 平均差 ${(stats.ratingSummary.paired.difference ?? 0) >= 0 ? '+' : ''}${stats.ratingSummary.paired.difference?.toFixed(2)} 分`,
          `${stats.ratingSummary.paired.count} titles rated on both · mean Douban − IMDb gap ${(stats.ratingSummary.paired.difference ?? 0) >= 0 ? '+' : ''}${stats.ratingSummary.paired.difference?.toFixed(2)} pt`)
        : text('暂无双站均有评分的作品', 'No titles rated on both sources yet')}</p><small>{text('区间含下限、不含上限，最后一档含 10 分；未评分不计入均分和分布。', 'Intervals include the lower bound; the last includes 10. Unrated titles are excluded from averages and distributions.')}</small></div>}
      <details className="chart-data"><summary>{text('查看数据与作品', 'View data and titles')} · {section.data.length + (section.kind === 'chord' ? genreLinks.length : 0)}</summary><div>{(section.kind === 'chord' ? [...section.data, ...genreLinks] : section.data).map((bucket, index) => <button key={`${bucket.name}-${index}`} onClick={() => setSelection(bucket)}><span>{bucket.name}</span><strong>{bucket.value}</strong></button>)}</div></details>
    </section>)}</div>
    {selection && createPortal(<div className="modal-backdrop" onMouseDown={() => setSelection(null)}><div className="modal overview-selection" role="dialog" aria-modal="true" aria-label={selection.name} onKeyDown={event => { if (event.key === 'Escape') setSelection(null); }} onMouseDown={event => event.stopPropagation()}><div className="modal-header"><div><div className="eyebrow">EXPLORE THE COLLECTION</div><h2>{selection.name} · {selectedWorks.length}</h2></div><button autoFocus className="icon-button" aria-label={t('关闭')} onClick={() => setSelection(null)}><X size={20}/></button></div><div className="modal-scroll overview-titles">{selectedWorks.map(w => <div key={w.id}>{w.poster && <img src={imageUrl(w.poster)} alt="" loading="lazy"/>}<div><strong>{en ? [w.titleEn, w.originalTitle].find(s => s && !/[\u3400-\u9fff]/.test(s)) || 'Title unavailable' : w.titleZh || w.titleEn || w.originalTitle}</strong><small>{w.year ?? t('未知年份')} · {w.mediaType === 'movie' ? 'Movie' : 'Series'}</small></div></div>)}</div></div></div>, document.querySelector('.app-shell')!)}
  </div>;
}
