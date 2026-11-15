import type { WorkspaceRole } from '@shared/types/domain';

/** Urutan hak akses: makin besar makin tinggi. Lihat matriks di docs/03-product-and-ux-design.md. */
const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/** true bila `role` setara atau lebih tinggi dari `minimumRole`. */
export function hasMinimumRole(role: WorkspaceRole, minimumRole: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimumRole];
}

/** Ubah nama / mata uang utama Workspace, kelola anggota & tautan dompet. */
export function canManageWorkspace(role: WorkspaceRole): boolean {
  return hasMinimumRole(role, 'admin');
}

/**
 * Siapa boleh mengundang dengan role tertentu: admin hanya bisa memberi `member`/`viewer`,
 * role `admin` hanya bisa diberikan oleh owner (mencegah admin menggandakan dirinya).
 */
export function canInviteWithRole(inviterRole: WorkspaceRole, invitedRole: WorkspaceRole): boolean {
  if (invitedRole === 'owner') return false;
  if (invitedRole === 'admin') return inviterRole === 'owner';
  return canManageWorkspace(inviterRole);
}

/** Catat transaksi / upload struk: semua kecuali viewer. */
export function canRecordTransactions(role: WorkspaceRole): boolean {
  return hasMinimumRole(role, 'member');
}

/** Edit/hapus transaksi: owner & admin semua transaksi, member hanya miliknya sendiri. */
export function canEditTransaction(role: WorkspaceRole, isOwnTransaction: boolean): boolean {
  if (hasMinimumRole(role, 'admin')) return true;
  return role === 'member' && isOwnTransaction;
}

/** Kelola kategori, budget, target tabungan, dan tagihan rutin (member hanya membaca). */
export function canManagePlanning(role: WorkspaceRole): boolean {
  return hasMinimumRole(role, 'admin');
}

/**
 * Ubah role / keluarkan anggota: owner atas siapa pun (kecuali owner), admin hanya atas member & viewer.
 * Role tujuan `admin` hanya boleh diberikan owner (sama seperti aturan undangan).
 */
export function canManageMember(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  newRole?: WorkspaceRole
): boolean {
  if (targetRole === 'owner' || newRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  if (actorRole !== 'admin') return false;
  if (targetRole === 'admin') return false;
  return newRole === undefined || newRole === 'member' || newRole === 'viewer';
}

/** Hapus Workspace hanya untuk owner. */
export function canDeleteWorkspace(role: WorkspaceRole): boolean {
  return role === 'owner';
}
