'use client';

import type { McpStatus, TripWorkspace as TripWorkspaceType } from './types';

type ToolTone = 'ready' | 'loading' | 'queued' | 'failed' | 'idle';

type ToolCard = {
  id: 'weather' | 'spots' | 'map';
  title: string;
  provider: string;
  icon: JSX.Element;
  tone: ToolTone;
};

export function TripWorkspace({
  workspace,
  suggestion,
  status,
  mcpStatus,
  isExtracting,
  onExtract,
  onApplySuggestion,
}: {
  workspace: TripWorkspaceType;
  suggestion?: TripWorkspaceType;
  status: string;
  mcpStatus: McpStatus[];
  isExtracting: boolean;
  onExtract: () => void;
  onApplySuggestion: () => void;
  onExport: () => void;
}): JSX.Element {
  const isError = status === 'Error' || status.endsWith(' failed');
  const isGenerating = status === 'Thinking' || status.startsWith('Using ');
  const tools = buildToolCards(mcpStatus, isGenerating, isError);
  const stats = buildStats(workspace);

  return (
    <aside className="flex min-h-0 flex-col gap-[15px] overflow-hidden border-t border-[#ECECEC] bg-white px-[18px] py-5 lg:h-screen lg:border-l lg:border-t-0">
      <div className="shrink-0">
        <h2 className="font-['Sora'] text-sm font-bold leading-5 text-[#171717]">行程助手</h2>
        <p className="mt-0.5 text-[11.5px] leading-4 text-[#9A9A9A]">MCP 工具与实时状态</p>
      </div>

      <div className="shrink-0 text-[11px] font-bold tracking-[0.7px] text-[#A3A3A3]">已连接工具</div>

      <div className="shrink-0 space-y-[9px]">
        {tools.map((tool) => (
          <ToolStatusCard key={tool.id} tool={tool} isError={isError} />
        ))}
      </div>

      {suggestion ? (
        <section className="shrink-0 rounded-[13px] border border-[#E0E0E0] bg-[#F3F3F3] p-3">
          <div className="text-[12px] font-bold text-[#111111]">发现新的行程结构</div>
          <p className="mt-1 text-[11px] leading-4 text-[#737373]">
            AI 已抽取 {suggestion.itinerary.days.length} 天行程，可同步到行程概览。
          </p>
          <button type="button" onClick={onApplySuggestion} className="mt-2 h-8 w-full rounded-[10px] bg-[#111111] text-[12px] font-bold text-white">
            应用建议
          </button>
        </section>
      ) : null}

      <div className="relative h-[126px] shrink-0 overflow-hidden rounded-[14px] border border-[#EDEDED] bg-[repeating-linear-gradient(45deg,#F0F0F0,#F0F0F0_9px,#F5F5F5_9px,#F5F5F5_18px)]">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          <span className="text-[#111111]">
            <MapPinIcon />
          </span>
          <span className="font-['Sora'] text-[10.5px] tracking-[0.4px] text-[#8A8A8A]">地图预览 · 5 站路线</span>
        </div>
      </div>

      <div className="mt-0.5 flex shrink-0 items-center justify-between">
        <div className="text-[11px] font-bold tracking-[0.7px] text-[#A3A3A3]">行程概览</div>
        <button type="button" onClick={onExtract} disabled={isExtracting} className="rounded-full border border-[#DEDEDE] bg-white px-2.5 py-1 text-[11px] font-bold text-[#111111] disabled:text-[#A8A8A8]">
          {isExtracting ? '抽取中' : '同步'}
        </button>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-[9px]">
        {stats.map((item) => (
          <StatCard key={item.label} value={item.value} unit={item.unit} label={item.label} accent={item.accent} />
        ))}
      </div>
    </aside>
  );
}

function ToolStatusCard({ tool, isError }: { tool: ToolCard; isError: boolean }): JSX.Element {
  const meta = toolToneMeta(tool.tone);

  return (
    <div>
      <div className="flex items-center gap-[11px] rounded-[13px] border border-[#EDEDED] bg-[#FAFAFA] px-[13px] py-[11px]">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] ${
          tool.id === 'weather' ? 'bg-[#F3F3F3] text-[#111111]' : 'bg-[#F5F5F5] text-[#5E5E5E]'
        }`}>
          {tool.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold leading-[18px] text-[#171717]">{tool.title}</div>
          <div className="truncate text-[11px] leading-4 text-[#9A9A9A]">{tool.provider}</div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color, animation: meta.pulse ? 'tm-pulse 1.2s infinite' : undefined }} />
          <span className="text-[11.5px] font-semibold text-[#6B6B6B]">{meta.label}</span>
        </div>
      </div>
      {isError && tool.tone === 'failed' ? (
        <button type="button" className="mx-0.5 mb-0.5 mt-[-4px] flex items-center gap-1.5 text-[11.5px] text-[#D65A4E]">
          <RefreshIcon />
          <span className="font-semibold">重新连接</span>
          <span>· 超时 30s</span>
        </button>
      ) : null}
    </div>
  );
}

function StatCard({
  value,
  unit,
  label,
  accent,
}: {
  value: string;
  unit?: string;
  label: string;
  accent?: boolean;
}): JSX.Element {
  return (
    <div className="rounded-[12px] border border-[#EDEDED] bg-[#FAFAFA] px-[13px] py-[11px]">
      <div className={`font-['Sora'] text-[17px] font-bold leading-5 ${accent ? 'text-[#111111]' : 'text-[#171717]'}`}>
        {value}
        {unit ? <span className="ml-1 text-[11px] font-semibold text-[#9A9A9A]">{unit}</span> : null}
      </div>
      <div className="mt-0.5 text-[11px] leading-4 text-[#9A9A9A]">{label}</div>
    </div>
  );
}

function buildToolCards(mcpStatus: McpStatus[], isGenerating: boolean, isError: boolean): ToolCard[] {
  const hasAnyConnected = mcpStatus.some((server) => server.ok);
  const readyTone: ToolTone = hasAnyConnected || !isGenerating ? 'ready' : 'idle';

  return [
    {
      id: 'weather',
      title: '天气服务',
      provider: 'OpenWeather · MCP',
      icon: <SunIcon />,
      tone: isError ? 'failed' : readyTone,
    },
    {
      id: 'spots',
      title: '景点推荐',
      provider: 'TripAdvisor · MCP',
      icon: <LandmarkIcon />,
      tone: isGenerating ? 'loading' : readyTone,
    },
    {
      id: 'map',
      title: '地图路线',
      provider: '高德地图 · MCP',
      icon: <MapIcon />,
      tone: isGenerating ? 'queued' : readyTone,
    },
  ];
}

function toolToneMeta(tone: ToolTone): { label: string; color: string; pulse?: boolean } {
  if (tone === 'ready') return { label: '已连接', color: '#2E9E6A' };
  if (tone === 'loading') return { label: '连接中', color: '#E39A3B', pulse: true };
  if (tone === 'queued') return { label: '排队中', color: '#E39A3B' };
  if (tone === 'failed') return { label: '失败', color: '#D65A4E' };
  return { label: '待命', color: '#C5C5C5' };
}

function buildStats(workspace: TripWorkspaceType): Array<{ value: string; unit?: string; label: string; accent?: boolean }> {
  const days = workspace.itinerary.days.length || 5;
  const spots = workspace.itinerary.days.reduce((sum, day) => sum + day.items.length, 0) || 12;
  const cities = new Set(workspace.itinerary.days.map((day) => day.city).filter(Boolean)).size || 1;
  const totalCost = workspace.itinerary.totalCost?.totalCNY;

  return [
    { value: String(days), unit: '天', label: '行程天数' },
    { value: totalCost ? formatBudget(totalCost) : '¥8.2k', label: '预计花费', accent: true },
    { value: String(spots), label: '景点数量' },
    { value: String(cities), label: '城市' },
  ];
}

function formatBudget(value: number): string {
  if (value >= 1000) return `¥${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  return `¥${value}`;
}

function SunIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function LandmarkIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M5 18h14M3 21h18M12 3l8 4H4l8-4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MapIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m8 5-5 2v12l5-2 8 2 5-2V5l-5 2-8-2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8 5v12M16 7v12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MapPinIcon(): JSX.Element {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 21s7-5.2 7-12a7 7 0 0 0-14 0c0 6.8 7 12 7 12Z" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="9" r="2.3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function RefreshIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M20 12a8 8 0 0 1-13.7 5.7M4 12A8 8 0 0 1 17.7 6.3M17 3v4h4M7 21v-4H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
