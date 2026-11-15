import { describe, expect, it } from 'vitest';
import { canDeleteWorkspace, canManageWorkspace, hasMinimumRole } from '@shared/utils/permissions';
import { createWorkspaceSchema, updateWorkspaceSchema } from '@shared/validation/workspace';

describe('workspace permissions', () => {
  it('ranks roles owner > admin > member > viewer', () => {
    expect(hasMinimumRole('owner', 'admin')).toBe(true);
    expect(hasMinimumRole('admin', 'admin')).toBe(true);
    expect(hasMinimumRole('member', 'admin')).toBe(false);
    expect(hasMinimumRole('viewer', 'member')).toBe(false);
    expect(hasMinimumRole('viewer', 'viewer')).toBe(true);
  });

  it('only owner/admin manage, only owner deletes', () => {
    expect(canManageWorkspace('admin')).toBe(true);
    expect(canManageWorkspace('member')).toBe(false);
    expect(canDeleteWorkspace('owner')).toBe(true);
    expect(canDeleteWorkspace('admin')).toBe(false);
  });
});

describe('workspace validation', () => {
  it('trims name and rejects unknown type/currency', () => {
    const ok = createWorkspaceSchema.safeParse({
      name: '  Kas Kos Melati  ',
      type: 'shared',
      primaryCurrency: 'IDR',
    });
    expect(ok.success && ok.data.name).toBe('Kas Kos Melati');

    expect(
      createWorkspaceSchema.safeParse({ name: 'X Y', type: 'family', primaryCurrency: 'IDR' }).success
    ).toBe(false);
    expect(
      createWorkspaceSchema.safeParse({ name: 'Usaha', type: 'business', primaryCurrency: 'JPY' })
        .success
    ).toBe(false);
    expect(
      createWorkspaceSchema.safeParse({ name: 'A', type: 'business', primaryCurrency: 'IDR' }).success
    ).toBe(false);
  });

  it('requires at least one field on update', () => {
    expect(updateWorkspaceSchema.safeParse({}).success).toBe(false);
    expect(updateWorkspaceSchema.safeParse({ primaryCurrency: 'USD' }).success).toBe(true);
  });
});
