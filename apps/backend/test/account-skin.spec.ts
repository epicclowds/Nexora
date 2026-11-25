import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AccountSkinController } from '../src/players/account-skin.controller';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { SkinService } from '../src/players/skin.service';
import type { AuthenticatedUser } from '../src/common/auth-context';

const UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const png = Buffer.from('png');

function setup(link: { minecraftUuid: string } | null, skin: { png: Buffer; model: 'classic' | 'slim' } | null = { png, model: 'slim' }) {
  const findUnique = vi.fn(async () => link);
  const getSkin = vi.fn(async () => skin);
  const controller = new AccountSkinController({ linkedMinecraftAccount: { findUnique } } as unknown as PrismaService, { getSkin } as unknown as SkinService);
  const headers: Record<string, string> = {};
  const res = { setHeader: (k: string, v: string) => (headers[k] = v), send: vi.fn() } as unknown as Response & { send: ReturnType<typeof vi.fn> };
  return { controller, findUnique, getSkin, headers, res };
}

describe('linked account avatars', () => {
  it("serves the signed-in user's head from the linked UUID", async () => {
    const { controller, findUnique, getSkin, headers, res } = setup({ minecraftUuid: UUID });
    await controller.own({ id: 'u1' } as AuthenticatedUser, res);
    expect(findUnique).toHaveBeenCalledWith({ where: { dashboardUserId: 'u1' }, select: { minecraftUuid: true } });
    expect(getSkin).toHaveBeenCalledWith(UUID);
    expect(res.send).toHaveBeenCalledWith(png);
    expect(headers).toMatchObject({ 'Content-Type': 'image/png', 'X-Skin-Model': 'slim', 'Cache-Control': 'private, max-age=3600' });
  });

  it('serves the head of a managed account by user id', async () => {
    const { controller, findUnique, res } = setup({ minecraftUuid: UUID });
    await controller.ofUser('u2', res);
    expect(findUnique).toHaveBeenCalledWith({ where: { dashboardUserId: 'u2' }, select: { minecraftUuid: true } });
    expect(res.send).toHaveBeenCalled();
  });

  it('answers 404 for unlinked accounts without resolving any skin', async () => {
    const { controller, getSkin, res } = setup(null);
    await expect(controller.own({ id: 'u1' } as AuthenticatedUser, res)).rejects.toBeInstanceOf(NotFoundException);
    expect(getSkin).not.toHaveBeenCalled();
  });

  it('answers 404 when the skin is unavailable or invalid', async () => {
    const { controller, res } = setup({ minecraftUuid: UUID }, null);
    await expect(controller.ofUser('u2', res)).rejects.toBeInstanceOf(NotFoundException);
    expect(res.send).not.toHaveBeenCalled();
  });

  it('ignores implausible user ids', async () => {
    const { controller, findUnique, res } = setup({ minecraftUuid: UUID });
    await expect(controller.ofUser('x'.repeat(65), res)).rejects.toBeInstanceOf(NotFoundException);
    expect(findUnique).not.toHaveBeenCalled();
  });
});
