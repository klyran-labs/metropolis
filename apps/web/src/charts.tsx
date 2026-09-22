import * as echarts from "echarts/core";
import { BarChart, GaugeChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ECharts, EChartsOption } from "echarts";
import { TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { chartPalette, resolveTheme, type ResolvedTheme } from "./theme";
import { EmptyState } from "./design-system";

echarts.use([BarChart, GaugeChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(() =>
    resolveTheme((document.documentElement.dataset.theme as "light" | "dark") || "system"),
  );
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const recompute = () =>
      setTheme(
        resolveTheme((document.documentElement.dataset.theme as "light" | "dark") || "system"),
      );
    media.addEventListener("change", recompute);
    const observer = new MutationObserver(recompute);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    window.addEventListener("agentguard:theme-change", recompute);
    return () => {
      media.removeEventListener("change", recompute);
      observer.disconnect();
      window.removeEventListener("agentguard:theme-change", recompute);
    };
  }, []);
  return theme;
}

function useChart(
  option: EChartsOption | null,
  deps: unknown[],
): (node: HTMLDivElement | null) => void {
  const instance = useRef<ECharts | null>(null);
  // A conditionally-rendered chart div (EmptyState <-> chart) mounts on a
  // later commit than the component itself, so a plain useRef + `[]`-effect
  // would miss it. A callback ref re-fires whenever the node actually
  // attaches, so re-init tracks that instead of the component's mount.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const setRef = useCallback((element: HTMLDivElement | null) => setNode(element), []);

  useEffect(() => {
    if (!node) return;
    instance.current = echarts.init(node, undefined, { renderer: "canvas" });
    const observer = new ResizeObserver(() => instance.current?.resize());
    observer.observe(node);
    return () => {
      observer.disconnect();
      instance.current?.dispose();
      instance.current = null;
    };
  }, [node]);
  useEffect(() => {
    if (!instance.current || !option) return;
    instance.current.setOption(option, { notMerge: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, ...deps]);
  return setRef;
}

const compact = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export function Sparkline({
  data,
  height = 32,
}: {
  data: number[];
  height?: number;
}) {
  const theme = useResolvedTheme();
  const palette = chartPalette[theme];
  const option: EChartsOption | null = data.length
    ? {
        animation: false,
        grid: { top: 2, right: 2, bottom: 2, left: 2 },
        xAxis: { type: "category", show: false, data: data.map((_, index) => index) },
        yAxis: { type: "value", show: false, min: "dataMin" },
        series: [
          {
            type: "line",
            data,
            showSymbol: false,
            lineStyle: { width: 2, color: palette.inkMuted, cap: "round", join: "round" },
            areaStyle: undefined,
          },
          {
            type: "scatter",
            data: [[data.length - 1, data[data.length - 1]]],
            symbolSize: 6,
            itemStyle: { color: palette.categorical[0] },
          },
        ],
      }
    : null;
  const ref = useChart(option, [data.join(","), theme]);
  return <div ref={ref} style={{ height, width: "100%" }} aria-hidden="true" />;
}

export function TrendArea({
  data,
  seriesName,
  emptyTitle,
  emptyDetail,
  valueFormatter = compact,
  height = 220,
}: {
  data: Array<{ label: string; value: number }>;
  seriesName: string;
  emptyTitle: string;
  emptyDetail: string;
  valueFormatter?: (value: number) => string;
  height?: number;
}) {
  const theme = useResolvedTheme();
  const palette = chartPalette[theme];
  const accent = palette.categorical[0];
  const option: EChartsOption | null = data.length
    ? {
        animation: false,
        textStyle: { fontFamily: "inherit", color: palette.inkSecondary },
        grid: { top: 16, right: 16, bottom: 28, left: 48 },
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "line", lineStyle: { color: palette.baseline } },
          backgroundColor: palette.surface,
          borderColor: palette.grid,
          textStyle: { color: palette.ink },
          valueFormatter: (value) => valueFormatter(Number(value)),
        },
        xAxis: {
          type: "category",
          data: data.map((point) => point.label),
          axisLine: { lineStyle: { color: palette.baseline } },
          axisTick: { show: false },
          axisLabel: { color: palette.inkMuted, fontSize: 11 },
        },
        yAxis: {
          type: "value",
          splitLine: { lineStyle: { color: palette.grid, type: "solid" } },
          axisLabel: { color: palette.inkMuted, fontSize: 11, formatter: (v: number) => valueFormatter(v) },
        },
        series: [
          {
            name: seriesName,
            type: "line",
            data: data.map((point) => point.value),
            smooth: false,
            symbol: "circle",
            symbolSize: 8,
            showSymbol: false,
            lineStyle: { width: 2, color: accent, cap: "round", join: "round" },
            itemStyle: { color: accent, borderColor: palette.surface, borderWidth: 2 },
            areaStyle: { color: accent, opacity: 0.12 },
          },
        ],
      }
    : null;
  const ref = useChart(option, [JSON.stringify(data), theme]);
  if (!data.length) return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  return <div ref={ref} style={{ height, width: "100%" }} />;
}

export function Bars({
  data,
  emptyTitle,
  emptyDetail,
  valueFormatter = compact,
  height = 220,
}: {
  data: Array<{ label: string; value: number }>;
  emptyTitle: string;
  emptyDetail: string;
  valueFormatter?: (value: number) => string;
  height?: number;
}) {
  const theme = useResolvedTheme();
  const palette = chartPalette[theme];
  const option: EChartsOption | null = data.length
    ? {
        animation: false,
        textStyle: { fontFamily: "inherit", color: palette.inkSecondary },
        grid: { top: 8, right: 48, bottom: 8, left: 96 },
        tooltip: {
          trigger: "item",
          backgroundColor: palette.surface,
          borderColor: palette.grid,
          textStyle: { color: palette.ink },
          valueFormatter: (value) => valueFormatter(Number(value)),
        },
        xAxis: { type: "value", show: false },
        yAxis: {
          type: "category",
          data: data.map((row) => row.label),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: palette.inkSecondary, fontSize: 12 },
        },
        series: [
          {
            type: "bar",
            data: data.map((row, index) => ({
              value: row.value,
              itemStyle: {
                color: palette.categorical[index % palette.categorical.length],
                borderRadius: [0, 4, 4, 0],
              },
            })),
            barMaxWidth: 24,
            label: {
              show: true,
              position: "right",
              color: palette.inkSecondary,
              fontSize: 12,
              formatter: (params: { value?: unknown }) => valueFormatter(Number(params.value)),
            },
          },
        ],
      }
    : null;
  const ref = useChart(option, [JSON.stringify(data), theme]);
  if (!data.length) return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  return <div ref={ref} style={{ height, width: "100%" }} />;
}

const accentClass = ["accent-blue", "accent-orange", "accent-aqua", "accent-yellow", "accent-magenta", "accent-violet"];

export function StatTile({
  label,
  value,
  delta,
  deltaGood = true,
  trend,
  icon,
  accent = 0,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaGood?: boolean;
  trend?: number[];
  icon?: ReactNode;
  accent?: number;
}) {
  return (
    <div className="stat-tile">
      <div className="stat-tile-top">
        {icon && <span className={`stat-tile-icon ${accentClass[accent % accentClass.length]}`}>{icon}</span>}
        {delta && (
          <span className={deltaGood ? "stat-tile-delta stat-tile-delta-good" : "stat-tile-delta stat-tile-delta-bad"}>
            {deltaGood ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {delta}
          </span>
        )}
      </div>
      <strong className="stat-tile-value">{value}</strong>
      <span className="stat-tile-label">{label}</span>
      {trend && trend.length > 1 && (
        <div className="stat-tile-trend">
          <Sparkline data={trend} height={28} />
        </div>
      )}
    </div>
  );
}

export function Gauge({
  label,
  value,
  detail,
  height = 200,
}: {
  label: string;
  value: number;
  detail: string;
  height?: number;
}) {
  const theme = useResolvedTheme();
  const palette = chartPalette[theme];
  const option: EChartsOption = {
    animation: false,
    series: [
      {
        type: "gauge",
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        radius: "100%",
        center: ["50%", "62%"],
        progress: { show: true, width: 14, itemStyle: { color: palette.categorical[0] } },
        axisLine: { lineStyle: { width: 14, color: [[1, palette.grid]] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          valueAnimation: false,
          formatter: `${Math.round(value)}%`,
          fontSize: 26,
          fontWeight: 700,
          color: palette.ink,
          offsetCenter: [0, "-8%"],
        },
        title: { show: true, offsetCenter: [0, "18%"], fontSize: 12, color: palette.inkMuted },
        data: [{ value, name: label }],
      },
    ],
  };
  const ref = useChart(option, [value, theme]);
  return (
    <div className="gauge">
      <div ref={ref} style={{ height, width: "100%" }} />
      <p className="gauge-detail">{detail}</p>
    </div>
  );
}

export function Breakdown({
  data,
  emptyTitle,
  emptyDetail,
}: {
  data: Array<{ label: string; value: number }>;
  emptyTitle: string;
  emptyDetail: string;
}) {
  const theme = useResolvedTheme();
  const palette = chartPalette[theme];
  const total = data.reduce((sum, row) => sum + row.value, 0);
  if (!data.length || total === 0) return <EmptyState title={emptyTitle} detail={emptyDetail} />;
  return (
    <div className="breakdown">
      <div className="breakdown-track" role="img" aria-label={`Distribution across ${data.length} categories`}>
        {data.map((row, index) => (
          <span
            key={row.label}
            className="breakdown-segment"
            style={{
              width: `${(row.value / total) * 100}%`,
              background: palette.categorical[index % palette.categorical.length],
            }}
          />
        ))}
      </div>
      <div className="breakdown-legend">
        {data.map((row, index) => (
          <div className="breakdown-legend-item" key={row.label}>
            <span
              className="legend-swatch"
              style={{ background: palette.categorical[index % palette.categorical.length] }}
            />
            <span>{row.label}</span>
            <strong>{row.value.toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
