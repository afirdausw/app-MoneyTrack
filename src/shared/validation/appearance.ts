import { z } from 'zod';
import { APPEARANCE_ICONS, HEX_COLOR_PATTERN } from '@shared/utils/appearance';

export const appearanceIconSchema = z.enum(APPEARANCE_ICONS, {
  errorMap: () => ({ message: 'Ikon tidak tersedia' }),
});

export const appearanceColorSchema = z.string().regex(HEX_COLOR_PATTERN, 'Warna harus format hex #RRGGBB');
