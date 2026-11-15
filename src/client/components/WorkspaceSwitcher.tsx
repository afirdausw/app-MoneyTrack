import { Plus, Settings2 } from 'lucide-react';
import { AppearanceBadge, workspaceAppearance } from '@client/lib/appearance';
import { Tooltip } from '@client/components/Tooltip';
import { MODE_LABEL, ROLE_LABEL } from '@client/lib/labels';
import type { WorkspaceSummary } from '@shared/types/domain';

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceSummary[];
  activeId: number;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onManage: (workspace: WorkspaceSummary) => void;
}

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  onSelect,
  onCreate,
  onManage,
}: WorkspaceSwitcherProps) {
  return (
    <div className="space-y-1.5">
      <p className="px-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
        Ruang Keuangan
      </p>
      <div className="grid gap-1.5 sm:grid-cols-3 md:grid-cols-1">
        {workspaces.map((ws) => {
          const isActive = ws.id === activeId;

          return (
            <div
              key={ws.id}
              className={`flex items-stretch overflow-hidden rounded-xl border transition ${
                isActive
                  ? 'border-teal-600 bg-teal-50 text-teal-900 shadow-xs'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(ws.id)}
                aria-current={isActive ? 'true' : undefined}
                className="flex min-w-0 flex-1 items-center justify-between px-3 py-2.5 text-left"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <AppearanceBadge appearance={workspaceAppearance(ws)} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{ws.name}</span>
                    <span className="block text-xs text-slate-500">
                      {MODE_LABEL[ws.type]} · {ROLE_LABEL[ws.role]}
                    </span>
                  </span>
                </span>
                <span className="ml-2 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                  {ws.primaryCurrency}
                </span>
              </button>
              <Tooltip label="Pengaturan, tampilan & anggota">
                <button
                  type="button"
                  onClick={() => onManage(ws)}
                  aria-label={`Pengaturan ${ws.name}`}
                  className="flex w-9 shrink-0 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <Settings2 className="h-4 w-4" />
                </button>
              </Tooltip>
            </div>
          );
        })}
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:border-teal-600 hover:text-teal-700"
        >
          <Plus className="h-4 w-4" />
          <span>Buat Workspace</span>
        </button>
      </div>
    </div>
  );
}
