import { BadRequestException, ForbiddenException, type HttpException } from '@nestjs/common';
import type { ReasonErrorCode } from './presets';

const MESSAGES: Record<ReasonErrorCode, string> = {
  PRESETS_DISABLED: 'Reason IDs are disabled: the command mode only allows typed reasons',
  PRESET_REQUIRED: 'The command mode only allows reason IDs',
  UNKNOWN_PRESET: 'Unknown punishment reason ID',
  PRESET_DISABLED: 'This punishment reason is disabled',
  PRESET_FORBIDDEN: 'You do not have permission to use this reason',
  CUSTOM_REASON_FORBIDDEN: 'You do not have permission to use custom reasons',
  DURATION_OVERRIDE_FORBIDDEN: 'You do not have permission to change the duration of a reason',
  PERMANENT_FORBIDDEN: 'You do not have permission to make this reason permanent',
  REASON_REQUIRED: 'A reason is required',
};

export function reasonError(code: ReasonErrorCode, numericId?: number): HttpException {
  const body = { code, message: MESSAGES[code], ...(numericId !== undefined ? { reasonId: numericId } : {}) };
  return code.endsWith('_FORBIDDEN') ? new ForbiddenException(body) : new BadRequestException(body);
}
