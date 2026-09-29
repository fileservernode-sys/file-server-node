import { z } from 'zod';
import {
  SupportCaseStatus,
  SupportCasePriority,
  SupportCaseCategory,
  UserStatus
} from '@prisma/client';

export const SupportCaseListQuerySchema = z.object({
  status: z.nativeEnum(SupportCaseStatus).optional(),
  priority: z.nativeEnum(SupportCasePriority).optional(),
  category: z.nativeEnum(SupportCaseCategory).optional(),
  assignedAdminId: z.string().uuid().optional(),
  userId: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export type SupportCaseListQuery = z.infer<typeof SupportCaseListQuerySchema>;

export const CreateSupportCaseSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  subject: z.string().min(3, 'Subject must be at least 3 characters').max(255),
  description: z.string().min(5, 'Description must be at least 5 characters').max(10000),
  category: z.nativeEnum(SupportCaseCategory).default(SupportCaseCategory.GENERAL),
  priority: z.nativeEnum(SupportCasePriority).default(SupportCasePriority.NORMAL),
  assignedAdminId: z.string().uuid().optional()
});

export type CreateSupportCaseInput = z.infer<typeof CreateSupportCaseSchema>;

export const UpdateSupportCaseSchema = z.object({
  status: z.nativeEnum(SupportCaseStatus).optional(),
  priority: z.nativeEnum(SupportCasePriority).optional(),
  category: z.nativeEnum(SupportCaseCategory).optional(),
  resolutionNotes: z.string().max(5000).optional()
});

export type UpdateSupportCaseInput = z.infer<typeof UpdateSupportCaseSchema>;

export const AssignSupportCaseSchema = z.object({
  assignedAdminId: z.string().uuid().nullable()
});

export type AssignSupportCaseInput = z.infer<typeof AssignSupportCaseSchema>;

export const AddSupportCaseNoteSchema = z.object({
  note: z.string().min(1, 'Note content cannot be empty').max(5000),
  isInternal: z.boolean().default(true)
});

export type AddSupportCaseNoteInput = z.infer<typeof AddSupportCaseNoteSchema>;

export const SupportCustomerListQuerySchema = z.object({
  search: z.string().optional(),
  status: z.nativeEnum(UserStatus).optional(),
  emailVerified: z.preprocess((val) => {
    if (val === 'true' || val === true) return true;
    if (val === 'false' || val === false) return false;
    return undefined;
  }, z.boolean().optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export type SupportCustomerListQuery = z.infer<typeof SupportCustomerListQuerySchema>;

export const SupportCustomerParamSchema = z.object({
  userId: z.string().min(1, 'User ID is required')
});

export type SupportCustomerParam = z.infer<typeof SupportCustomerParamSchema>;
