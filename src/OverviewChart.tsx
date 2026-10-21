import { useEffect, useRef, useState } from 'react';
import { init, use, type EChartsCoreOption } from 'echarts/core';
import { BarChart, PieChart, LineChart, GraphChart, ChordChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, AriaComponent, DataZoomComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { Bucket, Relationship } from './overview-data';
import { packBubbles } from './overview-layout';
import { t } from './i18n';

use([BarChart, PieChart, LineChart, GraphChart, ChordChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, DataZoomComponent, SVGRenderer]);
const colors = ['#9dc9ff', '#9ee2cd', '#c7b5f5', '#f0c68d', '#ed9ead', '#7dbed0', '#babde4', '#c9d692'];
export type ChartKind = 'pie' | 'years' | 'bubbles' | 'ratings' | 'people' | 'chord';
export interface ChartSpec { kind: ChartKind; data: Bucket[]; links?: Relationship[]; ratings?: { imdb: Bucket[]; douban: Bucket[] }; ratingFocus?: boolean }

export default function OverviewChart({ kind, data, links, ratings, ratingFocus = true, label, onPick, reduced, english }: ChartSpec & {
  label: string; onPick: (bucket: Bucket) => void; reduced: boolean; english: boolean;
}) {
  const node = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const chart = useRef<ReturnType<typeof init> | null>(null);
  const pick = useRef(onPick); pick.current = onPick;
  const hasData = kind === 'chord' ? Boolean(links?.length) : kind === 'ratings' ? Boolean(ratings && [...ratings.imdb, ...ratings.douban].some(b => b.value > 0)) : data.length > 0;
  useEffect(() => {
    if (!node.current || !hasData) return;
    const instance = init(node.current, null, { renderer: 'svg' }); chart.current = instance;
    const observer = new ResizeObserver(() => { instance.resize(); setWidth(node.current?.clientWidth ?? 0); }); observer.observe(node.current);
    return () => { observer.disconnect(); instance.dispose(); chart.current = null; };
  }, [hasData]);
  useEffect(() => {
    if (!chart.current) return;
    const axis = { axisLabel: { color: '#afc2db' }, axisLine: { lineStyle: { color: '#b7d4ff25' } }, axisTick: { show: false }, splitLine: { lineStyle: { color: '#d3e4ff0e' } } };
    const legend = { textStyle: { color: '#c8d8ec' }, pageTextStyle: { color: '#c8d8ec' }, pageIconColor: '#9dc9ff', itemWidth: 10, itemHeight: 10 };
    const tooltip = { trigger: 'item', renderMode: 'richText', backgroundColor: '#172338ed', borderColor: '#7186a766', textStyle: { color: '#edf4ff' }, confine: true };
    const option: EChartsCoreOption = {
      color: colors, backgroundColor: 'transparent', textStyle: { fontFamily: 'DM Sans, Microsoft YaHei, sans-serif' },
      animation: !reduced, animationDuration: 700, animationDurationUpdate: 350, aria: { enabled: true }, tooltip
    };
    if (kind === 'pie') Object.assign(option, {
      tooltip: { ...tooltip, formatter: '{b}: {c} ({d}%)' },
      legend: { ...legend, type: 'scroll', bottom: 0 },
      series: [{ type: 'pie', radius: ['0%', '72%'], center: ['50%', '44%'],
        itemStyle: { borderWidth: 2, borderColor: '#15203488', borderRadius: 4 }, label: { show: false },
        emphasis: { scaleSize: 7, label: { show: true, color: '#fff', fontSize: 13, formatter: '{b}\n{d}%' } },
        data: data.map(b => ({ name: b.name, value: b.value })) }]
    });
    if (kind === 'years') Object.assign(option, {
      grid: { left: 8, right: 12, top: 22, bottom: data.length > 20 ? 68 : 28, containLabel: true },
      tooltip: { ...tooltip, trigger: 'axis' },
      xAxis: { ...axis, type: 'category', data: data.map(b => b.name), axisLabel: { color: '#afc2db', rotate: 35, hideOverlap: true } },
      yAxis: { ...axis, type: 'value', minInterval: 1 },
      dataZoom: data.length > 20 ? [{ type: 'slider', bottom: 2, height: 18, start: 0, end: 100, borderColor: '#a7c6ed22', textStyle: { color: '#b4c6de' }, fillerColor: '#9dc9ff25' }] : [],
      series: [{ type: 'bar', barMaxWidth: 28, itemStyle: { color: colors[1], borderRadius: [4, 4, 0, 0] }, data: data.map(b => b.value), emphasis: { itemStyle: { color: '#d4fff0' } } }]
    });
    if (kind === 'bubbles' || kind === 'chord') {
      const relatedTooltip = { ...tooltip, formatter: (params: { dataType?: string; dataIndex: number }) => {
        const bucket = params.dataType === 'edge' ? links?.[params.dataIndex] : data[params.dataIndex];
        return bucket ? `${bucket.name}: ${bucket.value} ${english ? 'titles' : '部作品'}` : '';
      } };
      const nodes = data.map((bucket, i) => ({ name: bucket.name, value: bucket.value,
        itemStyle: { color: colors[i % colors.length] } }));
      if (kind === 'chord') Object.assign(option, {
        tooltip: relatedTooltip, legend: { ...legend, type: 'scroll', bottom: 0 },
        series: [{ type: 'chord', center: ['50%', '44%'], radius: ['63%', '70%'], padAngle: 3,
          data: nodes, links, label: { show: false },
          itemStyle: { borderRadius: 4 }, lineStyle: { color: 'source', opacity: .28 },
          emphasis: { focus: 'adjacency', lineStyle: { opacity: .7 } } }]
      });
      else {
        const positions = packBubbles(data.map(b => b.value), width || node.current!.clientWidth, 310);
        const xs = positions.map(p => p.x), ys = positions.map(p => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        Object.assign(option, {
          tooltip: relatedTooltip,
          series: [{ type: 'graph', layout: 'none', roam: true, draggable: true,
            left: minX === maxX ? minX - 1 : minX, top: minY === maxY ? minY - 1 : minY,
            width: maxX - minX || 2, height: maxY - minY || 2,
            scaleLimit: { min: .6, max: 3 },
            data: nodes.map((node, i) => ({ ...node, x: positions[i].x, y: positions[i].y,
              symbolSize: positions[i].radius * 2,
              label: { show: i < 8, position: 'bottom', color: '#dbe9fc', fontSize: 11, width: 86, overflow: 'truncate' },
              itemStyle: { ...node.itemStyle, borderColor: '#ffffff55', borderWidth: 1, opacity: .9 } })),
            labelLayout: { hideOverlap: true }, links, lineStyle: { color: '#bfd8f0', opacity: .24, curveness: .15 },
            emphasis: { focus: 'adjacency', label: { show: true }, lineStyle: { opacity: .7 } } }]
        });
      }
    }
    if (kind === 'ratings' && ratings) {
      const sources = [ratings.imdb, ratings.douban];
      const totals = sources.map(bins => bins.reduce((sum, bin) => sum + bin.value, 0));
      const occupied = ratings.imdb.map((bin, i) => bin.value + ratings.douban[i].value > 0 ? i : -1).filter(i => i >= 0);
      const start = ratingFocus && occupied.length ? Math.max(0, occupied[0] - 1) : 0;
      const end = ratingFocus && occupied.length ? Math.min(ratings.imdb.length - 1, occupied.at(-1)! + 1) : ratings.imdb.length - 1;
      Object.assign(option, {
        legend: { ...legend, top: 0 },
        tooltip: { ...tooltip, trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: '#c8d8ec66', type: 'dashed' } },
          formatter: (params: { dataIndex: number; seriesIndex: number; seriesName: string; value: number }[]) => {
            if (!params.length) return '';
            const index = params[0].dataIndex;
            const bin = ratings.imdb[index];
            const [lower, upper] = bin.name.split('–');
            return [`${lower} ≤ ${english ? 'score' : '评分'} ${index === ratings.imdb.length - 1 ? '≤' : '<'} ${upper}`,
              ...params.map(item => `${item.seriesName}   ${item.value} ${english ? 'titles' : '部'} · ${totals[item.seriesIndex] ? (item.value / totals[item.seriesIndex] * 100).toFixed(1) : '0.0'}%`)].join('\n');
          } },
        grid: { left: 8, right: 16, top: 48, bottom: 64, containLabel: true },
        xAxis: { ...axis, type: 'category', boundaryGap: false, data: ratings.imdb.map(b => b.name),
          axisLabel: { color: '#afc2db', hideOverlap: true, formatter: (name: string) => name.split('–')[0] } },
        yAxis: { ...axis, type: 'value', minInterval: 1, name: english ? 'Titles' : '作品数', nameTextStyle: { color: '#a8bcd6', fontSize: 10 }, splitNumber: 4 },
        dataZoom: [{ type: 'inside', xAxisIndex: 0, startValue: start, endValue: end, zoomOnMouseWheel: false, moveOnMouseWheel: false },
          { type: 'slider', xAxisIndex: 0, startValue: start, endValue: end, bottom: 8, height: 16,
            labelFormatter: (_value: number, name: string) => name.split('–')[0],
            borderColor: '#a7c6ed22', textStyle: { color: '#b4c6de', fontSize: 10 }, fillerColor: '#9dc9ff25',
            handleStyle: { color: '#9ebcde', borderColor: '#c2d9f7' }, brushSelect: false }],
        series: sources.map((bins, i) => ({ name: i ? (english ? 'Douban' : '豆瓣') : 'IMDb', type: 'line', data: bins.map(b => b.value),
          symbol: 'circle', symbolSize: bins.length > 20 ? 5 : 6, showSymbol: true, smooth: false,
          lineStyle: { width: 2.5, type: i ? 'dashed' : 'solid' }, itemStyle: { color: colors[i] },
          areaStyle: { opacity: .045 }, emphasis: { focus: 'series', scale: 1.5 } }))
      });
    }
    if (kind === 'people') Object.assign(option, {
      grid: { left: 8, right: 30, top: 24, bottom: 26, containLabel: false },
      xAxis: { ...axis, type: 'value', minInterval: 1, show: false },
      yAxis: { ...axis, type: 'category', inverse: true, data: data.map(b => b.name), axisLabel: { inside: true, verticalAlign: 'bottom', padding: [0, 0, 12, 0], color: '#d2deed', width: Math.max(80, (node.current?.clientWidth ?? 220) - 44), overflow: 'truncate' }, axisLine: { show: false }, splitLine: { show: false } },
      series: [{ type: 'bar', barMaxWidth: 17, data: data.map(b => b.value), itemStyle: { color: colors[3], borderRadius: [0, 5, 5, 0] }, label: { show: true, position: 'right', color: '#edf4ff' } }]
    });
    chart.current.setOption(option, true);
    chart.current.off('click');
    chart.current.on('click', event => {
      const bucket = event.dataType === 'edge' ? links?.[event.dataIndex] : kind === 'ratings' && ratings
        ? { ...(event.seriesIndex === 0 ? ratings.imdb : ratings.douban)[event.dataIndex], name: `${event.seriesName} · ${(event.seriesIndex === 0 ? ratings.imdb : ratings.douban)[event.dataIndex]?.name ?? ''}` }
        : data[event.dataIndex];
      if (bucket?.ids?.length) pick.current(bucket);
    });
  }, [kind, data, links, ratings, ratingFocus, reduced, english, hasData, width]);
  return hasData ? <div ref={node} className={`overview-chart chart-${kind}`} data-chart-kind={kind} role="img" aria-label={label} style={{ height: kind === 'people' ? Math.max(310, data.length * 44 + 50) : 310 }}/>
    : <div className="chart-empty">{kind === 'chord' ? (english ? 'No shared genres yet' : '暂无同时属于多个类型的作品') : t('暂无资料')}</div>;
}
