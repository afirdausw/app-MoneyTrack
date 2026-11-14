import { Briefcase, User, Users } from 'lucide-react';
import type { WorkspaceRole, WorkspaceSummary, WorkspaceType } from '@shared/types/domain';

interface WorkspaceSwitcherProps {
  workspaces: WorkspaceSummary[];
  activeId: number;
  onSelect: (id: number) => void;
}

const MODE_ICON: Record<WorkspaceType, typeof User> = {
  personal: User,
  shared: Users,
  business: Briefcase,
};

const MODE_BADGE: Record<WorkspaceType, string> = {
  personal: 'Pribadi',
  shared: 'Shared',
  business: 'Bisnis',
};

const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export function WorkspaceSwitcher({ workspaces, activeId, onSelect }: WorkspaceSwitcherProps) {
  return (
    <div className="space-y-1.5">
      <p className="px-2 text-xs font-semibold tracking-wider text-slate-400 uppercase">
        Ruang Keuangan
      </p>
      <div className="grid gap-1.5 sm:grid-cols-3 md:grid-cols-1">
        {workspaces.map((ws) => {
          const Icon = MODE_ICON[ws.type];
          const isActive = ws.id === activeId;

          return (
            <button
              key={ws.id}
              type="button"
              onClick={() => onSelect(ws.id)}
              className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                isActive
                  ? 'border-teal-600 bg-teal-50 text-teal-900 shadow-xs'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    isActive ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{ws.name}</span>
                  <span className="block text-xs text-slate-500">
                    {MODE_BADGE[ws.type]} · {ROLE_LABEL[ws.role]}
                  </span>
                </span>
              </span>
              <span className="ml-2 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                {ws.primaryCurrency}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
