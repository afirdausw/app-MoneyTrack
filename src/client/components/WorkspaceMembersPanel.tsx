import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Copy, Link2, LogOut, Mail, UserMinus, UserPlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormField, Select, getInputClassName } from '@client/components/FormField';
import { ROLE_LABEL } from '@client/lib/labels';
import { ApiRequestError, apiFetch } from '@client/lib/api';
import type {
  CreatedWorkspaceInvite,
  InvitableRole,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceSummary,
} from '@shared/types/domain';
import { canInviteWithRole, canManageMember, canManageWorkspace } from '@shared/utils/permissions';
import {
  type CreateInviteData,
  type CreateInviteInput,
  INVITE_EXPIRY_OPTIONS,
  createInviteSchema,
} from '@shared/validation/invite';

const ROLE_HINT: Record<InvitableRole, string> = {
  admin: 'Kelola anggota, budget & semua transaksi',
  member: 'Catat transaksi & split bill',
  viewer: 'Hanya melihat laporan',
};

const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

interface WorkspaceMembersPanelProps {
  workspace: WorkspaceSummary;
  currentUserId: number;
  /** Dipanggil setelah user aktif keluar dari Workspace. */
  onLeft: (workspaceId: number) => void;
}

export function WorkspaceMembersPanel({ workspace, currentUserId, onLeft }: WorkspaceMembersPanelProps) {
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedWorkspaceInvite | null>(null);
  const [copied, setCopied] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [busyMember, setBusyMember] = useState<number | null>(null);
  const isAdmin = canManageWorkspace(workspace.role);

  const roleOptions = (['member', 'viewer', 'admin'] as const).filter((role) =>
    canInviteWithRole(workspace.role, role)
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateInviteInput, unknown, CreateInviteData>({
    resolver: zodResolver(createInviteSchema),
    defaultValues: { role: 'member', email: '', expiresInDays: 7 },
  });

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<WorkspaceMember[]>(`/api/workspaces/${workspace.id}/members`),
      // Daftar undangan hanya untuk admin/owner.
      isAdmin ? apiFetch<WorkspaceInvite[]>(`/api/workspaces/${workspace.id}/invites`) : Promise.resolve([]),
    ])
      .then(([memberList, inviteList]) => {
        if (!active) return;
        setMembers(memberList);
        setInvites(inviteList);
      })
      .catch((err: unknown) => {
        if (active) setLoadError(err instanceof Error ? err.message : 'Gagal memuat anggota.');
      });
    return () => {
      active = false;
    };
  }, [workspace.id, isAdmin]);

  async function onCreateInvite(values: CreateInviteData) {
    setServerError(null);
    setCopied(false);
    try {
      const invite = await apiFetch<CreatedWorkspaceInvite>(`/api/workspaces/${workspace.id}/invites`, {
        method: 'POST',
        body: JSON.stringify(values),
      });
      setCreated(invite);
      setInvites((prev) => [invite, ...prev]);
      reset({ role: values.role, email: '', expiresInDays: values.expiresInDays });
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : 'Gagal membuat undangan.');
    }
  }

  async function revoke(inviteId: number) {
    setServerError(null);
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/invites/${inviteId}`, { method: 'DELETE' });
      setInvites((prev) => prev.filter((item) => item.id !== inviteId));
      if (created?.id === inviteId) setCreated(null);
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : 'Gagal membatalkan undangan.');
    }
  }

  async function changeRole(member: WorkspaceMember, role: InvitableRole) {
    setServerError(null);
    setBusyMember(member.userId);
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/members/${member.userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setMembers((prev) => prev?.map((m) => (m.userId === member.userId ? { ...m, role } : m)) ?? prev);
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : 'Gagal mengubah role.');
    } finally {
      setBusyMember(null);
    }
  }

  async function removeMember(member: WorkspaceMember) {
    setServerError(null);
    setBusyMember(member.userId);
    try {
      await apiFetch(`/api/workspaces/${workspace.id}/members/${member.userId}`, { method: 'DELETE' });
      if (member.userId === currentUserId) {
        onLeft(workspace.id);
        return;
      }
      setMembers((prev) => prev?.filter((m) => m.userId !== member.userId) ?? prev);
      setConfirmRemove(null);
    } catch (err) {
      setServerError(err instanceof ApiRequestError ? err.message : 'Gagal mengeluarkan anggota.');
    } finally {
      setBusyMember(null);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="space-y-6">
      {loadError ? (
        <p role="alert" className="text-xs font-medium text-rose-600">
          {loadError}
        </p>
      ) : null}

      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Anggota{members ? ` (${members.length})` : ''}
        </p>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {members === null && !loadError ? (
            <li className="px-3 py-2.5 text-xs text-slate-500">Memuat anggota...</li>
          ) : null}
          {members?.map((member) => {
            const isSelf = member.userId === currentUserId;
            const manageable = !isSelf && canManageMember(workspace.role, member.role);
            const roleChoices = (['admin', 'member', 'viewer'] as const).filter(
              (role) => role === member.role || canManageMember(workspace.role, member.role, role)
            );
            return (
              <li key={member.userId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {member.name}
                    {isSelf ? <span className="font-normal text-slate-400"> (kamu)</span> : null}
                  </span>
                  <span className="block truncate text-xs text-slate-500">{member.email}</span>
                </span>
                {manageable && member.role !== 'owner' ? (
                  <span className="flex items-center gap-1.5">
                    <div className="w-28">
                      <Select
                        aria-label={`Role ${member.name}`}
                        value={member.role}
                        disabled={busyMember === member.userId}
                        onChange={(e) => void changeRole(member, e.target.value as InvitableRole)}
                        className="py-1.5 text-xs"
                      >
                        {roleChoices.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABEL[role]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    {confirmRemove === member.userId ? (
                      <button
                        type="button"
                        onClick={() => void removeMember(member)}
                        disabled={busyMember === member.userId}
                        className="rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                      >
                        Keluarkan
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemove(member.userId)}
                        aria-label={`Keluarkan ${member.name}`}
                        title="Keluarkan dari Workspace"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <UserMinus className="h-4 w-4" />
                      </button>
                    )}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                    {ROLE_LABEL[member.role]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {isAdmin ? (
      <form
        noValidate
        onSubmit={handleSubmit(onCreateInvite)}
        className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4"
      >
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <UserPlus className="h-4 w-4 text-teal-700" />
            Undang Anggota Baru
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Bagikan link lewat WhatsApp/chat. Link sekali pakai dan otomatis kedaluwarsa.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormField id="invite-role" label="Role" required error={errors.role?.message}>
            <Select id="invite-role" hasError={Boolean(errors.role)} {...register('role')}>
              {roleOptions.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField id="invite-expiry" label="Berlaku" required error={errors.expiresInDays?.message}>
            <Select
              id="invite-expiry"
              hasError={Boolean(errors.expiresInDays)}
              {...register('expiresInDays')}
            >
              {INVITE_EXPIRY_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days} hari
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <FormField
          id="invite-email"
          label="Email (opsional)"
          error={errors.email?.message}
          hint="Bila diisi, hanya akun Google dengan email ini yang bisa bergabung."
        >
          <input
            id="invite-email"
            type="email"
            placeholder="teman@gmail.com"
            className={getInputClassName(Boolean(errors.email), 'bg-white')}
            {...register('email')}
          />
        </FormField>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:bg-teal-800 disabled:opacity-50"
        >
          <Link2 className="h-4 w-4" />
          {isSubmitting ? 'Membuat link...' : 'Buat Link Undangan'}
        </button>

        {created ? (
          <div className="space-y-1.5 rounded-lg border border-teal-200 bg-white p-2.5">
            <p className="text-[11px] font-medium text-teal-800">
              Salin sekarang — link ini hanya ditampilkan sekali.
            </p>
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                aria-label="Link undangan"
                value={created.inviteUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700"
              />
              <button
                type="button"
                onClick={() => copyLink(created.inviteUrl)}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-teal-700" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Tersalin' : 'Salin'}
              </button>
            </div>
          </div>
        ) : null}

        {serverError ? (
          <p role="alert" className="text-xs font-medium text-rose-600">
            {serverError}
          </p>
        ) : null}
      </form>
      ) : null}

      {invites.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Undangan Menunggu ({invites.length})
          </p>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 text-xs">
                  <span className="flex items-center gap-1 font-medium text-slate-800">
                    {invite.email ? <Mail className="h-3.5 w-3.5 shrink-0" /> : <Link2 className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{invite.email ?? 'Link bebas'}</span>
                  </span>
                  <span className="block text-slate-500">
                    {ROLE_LABEL[invite.role]} · {ROLE_HINT[invite.role]} · s.d.{' '}
                    {dateFormatter.format(new Date(invite.expiresAt))}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => revoke(invite.id)}
                  aria-label="Batalkan undangan"
                  title="Batalkan undangan"
                  className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {workspace.role !== 'owner' ? (
        <div className="space-y-2 rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-medium text-slate-900">Keluar dari Workspace</p>
          <p className="text-xs leading-relaxed text-slate-500">
            Transaksi yang sudah kamu catat tetap ada. Dompetmu yang belum dipakai di sini dilepas, dan dompet yang
            sudah dipakai diubah ke mode “Saldo saja”.
          </p>
          {confirmRemove === currentUserId ? (
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const self = members?.find((m) => m.userId === currentUserId);
                  if (self) void removeMember(self);
                }}
                disabled={busyMember === currentUserId}
                className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700"
              >
                Ya, keluar
              </button>
              <button type="button" onClick={() => setConfirmRemove(null)} className="text-xs text-slate-500">
                Batal
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(currentUserId)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" /> Keluar dari Workspace
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
