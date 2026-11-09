/**
 * Маршруты структуры домов (для сотрудников УК).
 *
 * Все данные — в рамках УК из токена. Ни один параметр запроса не может
 * подменить tenant_id.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '../../lib/http.js';
import { writeAudit } from '../auth/service.js';
import { query } from '../../db/pool.js';
import { clampLimit } from '../../lib/pagination.js';
import {
  createStaffMeter,
  deactivateStaffMeter,
  listMetersForBuilding,
  updateStaffMeter,
  type MeterKind,
} from '../meters/service.js';
import {
  autofillIntercomRooms,
  createOwnership,
  deleteOwnership,
  getBuilding,
  getBuildingPassport,
  importApartments,
  listApartments,
  listBuildings,
  listOwners,
  saveBuildingPassport,
  setApartmentIntercomRoom,
  updateApartment,
  updateOwnership,
  type BuildingObjectKind,
} from './service.js';

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  complexId: z.string().uuid().optional(),
});

const apartmentsQuerySchema = z.object({
  q: z.string().trim().max(20).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

const objectKindSchema = z.enum([
  'apartment_building',
  'cottage_settlement',
  'mixed_use',
  'commercial_building',
]);

const passportNumber = z.number().finite().min(0).max(1_000_000_000).nullable().optional();
const passportYear = z.number().int().min(1700).max(2100).nullable().optional();
const passportDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД')
  .nullable()
  .optional();

const passportSchema = z.object({
  objectKind: objectKindSchema,
  yearBuilt: passportYear,
  totalFloors: z.number().int().min(0).max(200).nullable().optional(),
  totalEntrances: z.number().int().min(0).max(200).nullable().optional(),
  cadastralNumber: z.string().trim().max(40).nullable().optional(),
  yearCommissioned: passportYear,
  totalArea: passportNumber,
  livingArea: passportNumber,
  commercialArea: passportNumber,
  landArea: passportNumber,
  parkingSpots: z.number().int().min(0).max(100_000).nullable().optional(),
  elevatorsCount: z.number().int().min(0).max(200).nullable().optional(),
  energyClass: z.enum(['A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G']).nullable().optional(),
  managementStart: passportDate,
  warrantyUntil: passportDate,
  notes: z.string().trim().max(4000).nullable().optional(),
});

const ownerDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата в формате ГГГГ-ММ-ДД');

const apartmentKindSchema = z.enum([
  'apartment',
  'nonresidential',
  'house',
  'office',
  'retail',
  'parking',
  'storage',
]);

const apartmentUpdateSchema = z.object({
  kind: apartmentKindSchema,
  rooms: z.number().int().min(0).max(20).nullable(),
  areaTotal: z.number().finite().min(0.01).max(1_000_000).nullable(),
  status: z.enum(['active', 'archived']),
});

const meterKindSchema = z.enum(['cold_water', 'hot_water', 'electricity', 'heat', 'gas']);

const meterFieldsSchema = z.object({
  kind: meterKindSchema,
  serial: z.string().trim().max(80).nullable().optional(),
  unit: z.string().trim().min(1).max(20),
  verificationDue: passportDate,
  isActive: z.boolean().default(true),
});

const meterCreateSchema = meterFieldsSchema.extend({
  initialValue: z.number().finite().min(0).max(1_000_000_000).nullable().optional(),
});

const importRowSchema = z.object({
  number: z.string().trim().min(1).max(20),
  kind: apartmentKindSchema,
  rooms: z.number().int().min(0).max(20).nullable(),
  areaTotal: z.number().finite().min(0.01).max(1_000_000).nullable(),
});

const importSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(1000),
});

const ownerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Укажите ФИО').max(200),
    phone: z.string().trim().max(30).nullable().optional(),
    email: z.string().trim().email('Некорректный e-mail').nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    role: z.enum(['owner', 'representative']),
    sharePercent: z.number().finite().min(0.01).max(100),
    validFrom: ownerDate,
    validTo: ownerDate.nullable().optional(),
  })
  .refine((data) => !data.validTo || data.validTo >= data.validFrom, {
    message: 'Дата окончания не может быть раньше даты начала',
    path: ['validTo'],
  });

export async function propertiesRoutes(app: FastifyInstance): Promise<void> {
  // Категории заявок: системные + собственные категории УК.
  // Нужны и жителю (выбор категории), и диспетчеру.
  app.get(
    '/ticket-categories',
    { preHandler: [app.authenticate, app.requirePermission('category.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth) return fail(request, reply, 401, 'UNAUTHORIZED', 'Требуется авторизация');

      const res = await query<{
        id: string;
        code: string;
        name: string;
        is_emergency: boolean;
        default_sla_hours: number;
        sort_order: number;
      }>(
        `SELECT id, code, name, is_emergency, default_sla_hours, sort_order
           FROM ticket_categories
          WHERE is_active = true
            AND (tenant_id IS NULL OR tenant_id = $1::uuid)
          ORDER BY sort_order, name`,
        [auth.tenantId],
      );

      return reply.send({
        items: res.rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          isEmergency: r.is_emergency,
          slaHours: r.default_sla_hours,
        })),
      });
    },
  );

  app.get(
    '/buildings',
    { preHandler: [app.authenticate, app.requirePermission('building.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const query = listQuerySchema.parse(request.query);
      const items = await listBuildings(auth.tenantId, query);
      return reply.send({ items });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/buildings/:id',
    { preHandler: [app.authenticate, app.requirePermission('building.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) {
        // Невалидный UUID — это «не найдено», а не 400: клиенту полезнее 404
        return fail(request, reply, 404, 'NOT_FOUND', 'Дом не найден');
      }

      const building = await getBuilding(auth.tenantId, idParsed.data);
      if (!building) {
        // Дом другой УК тоже даёт 404: не подтверждаем его существование
        return fail(request, reply, 404, 'NOT_FOUND', 'Дом не найден');
      }
      return reply.send(building);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/buildings/:id/passport',
    { preHandler: [app.authenticate, app.requirePermission('building.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Объект не найден');
      }

      const passport = await getBuildingPassport(auth.tenantId, idParsed.data);
      if (!passport) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Объект не найден');
      }
      return reply.send(passport);
    },
  );

  app.put<{ Params: { id: string } }>(
    '/buildings/:id/passport',
    { preHandler: [app.authenticate, app.requirePermission('building.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Объект не найден');
      }

      const parsed = passportSchema.safeParse(request.body);
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message ?? 'Проверьте поля паспорта';
        return fail(request, reply, 400, 'VALIDATION_ERROR', message);
      }

      const result = await saveBuildingPassport({
        tenantId: auth.tenantId,
        buildingId: idParsed.data,
        objectKind: parsed.data.objectKind as BuildingObjectKind,
        yearBuilt: parsed.data.yearBuilt ?? null,
        totalFloors: parsed.data.totalFloors ?? null,
        totalEntrances: parsed.data.totalEntrances ?? null,
        cadastralNumber: parsed.data.cadastralNumber?.trim() || null,
        yearCommissioned: parsed.data.yearCommissioned ?? null,
        totalArea: parsed.data.totalArea ?? null,
        livingArea: parsed.data.livingArea ?? null,
        commercialArea: parsed.data.commercialArea ?? null,
        landArea: parsed.data.landArea ?? null,
        parkingSpots: parsed.data.parkingSpots ?? null,
        elevatorsCount: parsed.data.elevatorsCount ?? null,
        energyClass: parsed.data.energyClass ?? null,
        managementStart: parsed.data.managementStart ?? null,
        warrantyUntil: parsed.data.warrantyUntil ?? null,
        notes: parsed.data.notes?.trim() || null,
      });

      if (!result) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Объект не найден');
      }

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'building.passport_update',
        entityType: 'building',
        entityId: idParsed.data,
        after: parsed.data,
      });

      return reply.send(result);
    },
  );

  app.get<{ Params: { id: string } }>(
    '/buildings/:id/owners',
    { preHandler: [app.authenticate, app.requirePermission('apartment.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Объект не найден');
      }

      const building = await getBuilding(auth.tenantId, idParsed.data);
      if (!building) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Объект не найден');
      }

      const items = await listOwners(auth.tenantId, idParsed.data);
      return reply.send({ items });
    },
  );

  app.post<{ Params: { id: string; apartmentId: string } }>(
    '/buildings/:id/apartments/:apartmentId/owners',
    { preHandler: [app.authenticate, app.requirePermission('apartment.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const buildingParsed = z.string().uuid().safeParse(request.params.id);
      const apartmentParsed = z.string().uuid().safeParse(request.params.apartmentId);
      if (!buildingParsed.success || !apartmentParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Помещение не найдено');
      }

      const parsed = ownerSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'Проверьте данные собственника',
        );
      }

      const result = await createOwnership({
        tenantId: auth.tenantId,
        buildingId: buildingParsed.data,
        apartmentId: apartmentParsed.data,
        fullName: parsed.data.fullName,
        phone: parsed.data.phone || null,
        email: parsed.data.email || null,
        notes: parsed.data.notes || null,
        role: parsed.data.role,
        sharePercent: parsed.data.sharePercent,
        validFrom: parsed.data.validFrom,
        validTo: parsed.data.validTo ?? null,
        createdBy: auth.userId,
      });

      if (result === 'not_found') {
        return fail(request, reply, 404, 'NOT_FOUND', 'Помещение не найдено');
      }
      if (result === 'conflict') {
        return fail(
          request,
          reply,
          409,
          'OWNER_ALREADY_LINKED',
          'Этот собственник уже привязан к помещению',
        );
      }

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'owner.create',
        entityType: 'ownership',
        entityId: result.ownershipId,
        after: parsed.data,
      });

      return reply.status(201).send(result);
    },
  );

  app.patch<{ Params: { id: string; ownershipId: string } }>(
    '/buildings/:id/owners/:ownershipId',
    { preHandler: [app.authenticate, app.requirePermission('apartment.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const buildingParsed = z.string().uuid().safeParse(request.params.id);
      const ownershipParsed = z.string().uuid().safeParse(request.params.ownershipId);
      if (!buildingParsed.success || !ownershipParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Собственник не найден');
      }

      const parsed = ownerSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'Проверьте данные собственника',
        );
      }

      const result = await updateOwnership({
        tenantId: auth.tenantId,
        buildingId: buildingParsed.data,
        ownershipId: ownershipParsed.data,
        fullName: parsed.data.fullName,
        phone: parsed.data.phone || null,
        email: parsed.data.email || null,
        notes: parsed.data.notes || null,
        role: parsed.data.role,
        sharePercent: parsed.data.sharePercent,
        validFrom: parsed.data.validFrom,
        validTo: parsed.data.validTo ?? null,
      });

      if (!result) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Собственник не найден');
      }

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'owner.update',
        entityType: 'ownership',
        entityId: ownershipParsed.data,
        after: parsed.data,
      });

      return reply.send(result);
    },
  );

  app.delete<{ Params: { id: string; ownershipId: string } }>(
    '/buildings/:id/owners/:ownershipId',
    { preHandler: [app.authenticate, app.requirePermission('apartment.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const buildingParsed = z.string().uuid().safeParse(request.params.id);
      const ownershipParsed = z.string().uuid().safeParse(request.params.ownershipId);
      if (!buildingParsed.success || !ownershipParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Собственник не найден');
      }

      const removed = await deleteOwnership(
        auth.tenantId,
        buildingParsed.data,
        ownershipParsed.data,
      );
      if (!removed) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Собственник не найден');
      }

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'owner.delete',
        entityType: 'ownership',
        entityId: ownershipParsed.data,
        after: null,
      });

      return reply.status(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(
    '/buildings/:id/apartments',
    { preHandler: [app.authenticate, app.requirePermission('apartment.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Дом не найден');
      }

      // Сначала убеждаемся, что дом принадлежит этой УК
      const building = await getBuilding(auth.tenantId, idParsed.data);
      if (!building) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Дом не найден');
      }

      const query = apartmentsQuerySchema.parse(request.query);
      const items = await listApartments(auth.tenantId, idParsed.data, {
        q: query.q,
        limit: clampLimit(query.limit, 50, 100),
      });
      return reply.send({ items });
    },
  );
  /**
   * Импорт помещений из CSV, разобранного в браузере.
   */
  app.post<{ Params: { id: string } }>(
    '/buildings/:id/apartments/import',
    { preHandler: [app.authenticate, app.requirePermission('apartment.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Объект не найден');

      const parsed = importSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'Проверьте строки импорта',
        );
      }

      try {
        const result = await importApartments(auth.tenantId, idParsed.data, parsed.data.rows);
        await writeAudit({
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          actorIp: request.ip,
          action: 'apartment.import',
          entityType: 'building',
          entityId: idParsed.data,
          after: result,
        });
        return reply.status(201).send(result);
      } catch (err) {
        if ((err as Error).message === 'OBJECT_NOT_FOUND') {
          return fail(request, reply, 404, 'NOT_FOUND', 'Объект не найден');
        }
        throw err;
      }
    },
  );

  /**
   * Тип, комнатность, площадь и статус помещения.
   */
  app.patch<{ Params: { id: string; apartmentId: string } }>(
    '/buildings/:id/apartments/:apartmentId',
    { preHandler: [app.authenticate, app.requirePermission('apartment.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const buildingParsed = z.string().uuid().safeParse(request.params.id);
      const apartmentParsed = z.string().uuid().safeParse(request.params.apartmentId);
      if (!buildingParsed.success || !apartmentParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Помещение не найдено');
      }

      const parsed = apartmentUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'Проверьте данные помещения',
        );
      }

      const updated = await updateApartment({
        tenantId: auth.tenantId,
        buildingId: buildingParsed.data,
        apartmentId: apartmentParsed.data,
        kind: parsed.data.kind,
        rooms: parsed.data.rooms,
        areaTotal: parsed.data.areaTotal,
        status: parsed.data.status,
      });
      if (!updated) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Помещение не найдено');
      }

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'apartment.update',
        entityType: 'apartment',
        entityId: apartmentParsed.data,
        after: parsed.data,
      });

      return reply.send({ ok: true });
    },
  );

  /**
   * Счётчики дома: список, создание, изменение, отключение.
   */
  app.get<{ Params: { id: string } }>(
    '/buildings/:id/meters',
    { preHandler: [app.authenticate, app.requirePermission('apartment.view')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const idParsed = z.string().uuid().safeParse(request.params.id);
      if (!idParsed.success) return fail(request, reply, 404, 'NOT_FOUND', 'Объект не найден');

      const building = await getBuilding(auth.tenantId, idParsed.data);
      if (!building) return fail(request, reply, 404, 'NOT_FOUND', 'Объект не найден');

      const items = await listMetersForBuilding(auth.tenantId, idParsed.data);
      return reply.send({ items });
    },
  );

  app.post<{ Params: { id: string; apartmentId: string } }>(
    '/buildings/:id/apartments/:apartmentId/meters',
    { preHandler: [app.authenticate, app.requirePermission('apartment.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const buildingParsed = z.string().uuid().safeParse(request.params.id);
      const apartmentParsed = z.string().uuid().safeParse(request.params.apartmentId);
      if (!buildingParsed.success || !apartmentParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Помещение не найдено');
      }
      const parsed = meterCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'Проверьте данные счётчика',
        );
      }

      const result = await createStaffMeter({
        tenantId: auth.tenantId,
        buildingId: buildingParsed.data,
        apartmentId: apartmentParsed.data,
        kind: parsed.data.kind as MeterKind,
        serial: parsed.data.serial || null,
        unit: parsed.data.unit,
        verificationDue: parsed.data.verificationDue ?? null,
        isActive: parsed.data.isActive,
        initialValue: parsed.data.initialValue ?? null,
        createdBy: auth.userId,
      });
      if (result === 'not_found') {
        return fail(request, reply, 404, 'NOT_FOUND', 'Помещение не найдено');
      }

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'meter.create',
        entityType: 'meter',
        entityId: result.id,
        after: parsed.data,
      });
      return reply.status(201).send(result);
    },
  );

  app.patch<{ Params: { id: string; meterId: string } }>(
    '/buildings/:id/meters/:meterId',
    { preHandler: [app.authenticate, app.requirePermission('apartment.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const buildingParsed = z.string().uuid().safeParse(request.params.id);
      const meterParsed = z.string().uuid().safeParse(request.params.meterId);
      if (!buildingParsed.success || !meterParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Счётчик не найден');
      }
      const parsed = meterFieldsSchema.safeParse(request.body);
      if (!parsed.success) {
        return fail(
          request,
          reply,
          400,
          'VALIDATION_ERROR',
          parsed.error.issues[0]?.message ?? 'Проверьте данные счётчика',
        );
      }

      const result = await updateStaffMeter({
        tenantId: auth.tenantId,
        buildingId: buildingParsed.data,
        meterId: meterParsed.data,
        kind: parsed.data.kind as MeterKind,
        serial: parsed.data.serial || null,
        unit: parsed.data.unit,
        verificationDue: parsed.data.verificationDue ?? null,
        isActive: parsed.data.isActive,
      });
      if (!result) return fail(request, reply, 404, 'NOT_FOUND', 'Счётчик не найден');

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'meter.update',
        entityType: 'meter',
        entityId: meterParsed.data,
        after: parsed.data,
      });
      return reply.send(result);
    },
  );

  app.delete<{ Params: { id: string; meterId: string } }>(
    '/buildings/:id/meters/:meterId',
    { preHandler: [app.authenticate, app.requirePermission('apartment.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }
      const buildingParsed = z.string().uuid().safeParse(request.params.id);
      const meterParsed = z.string().uuid().safeParse(request.params.meterId);
      if (!buildingParsed.success || !meterParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Счётчик не найден');
      }

      const removed = await deactivateStaffMeter(
        auth.tenantId,
        buildingParsed.data,
        meterParsed.data,
      );
      if (!removed) return fail(request, reply, 404, 'NOT_FOUND', 'Счётчик не найден');

      await writeAudit({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'meter.deactivate',
        entityType: 'meter',
        entityId: meterParsed.data,
        after: null,
      });
      return reply.status(204).send();
    },
  );

  /**
   * Номер комнаты на вызывной панели для квартиры.
   *
   * Панель набирает комнату, а не квартиру: без этого номера звонок не находит
   * квартиру и житель ничего не получает. Пустая строка или null — снять номер.
   */
  app.patch<{ Params: { id: string; apartmentId: string } }>(
    '/buildings/:id/apartments/:apartmentId/room',
    { preHandler: [app.authenticate, app.requirePermission('apartment.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const buildingParsed = z.string().uuid().safeParse(request.params.id);
      const apartmentParsed = z.string().uuid().safeParse(request.params.apartmentId);
      if (!buildingParsed.success || !apartmentParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Квартира не найдена');
      }

      const parsed = z
        .object({
          // Комната — короткий номер, который набирают с панели: «100», «12»
          room: z
            .string()
            .trim()
            .max(10)
            .regex(/^[0-9]*$/, 'Только цифры')
            .nullable(),
        })
        .safeParse(request.body);

      if (!parsed.success) {
        return fail(request, reply, 400, 'VALIDATION_ERROR', 'Номер комнаты — только цифры');
      }

      // Пустая строка значит «снять номер», а не «номер из пробелов»
      const room = parsed.data.room && parsed.data.room.length > 0 ? parsed.data.room : null;

      const result = await setApartmentIntercomRoom(
        auth.tenantId,
        buildingParsed.data,
        apartmentParsed.data,
        room,
      );

      if (result === 'not_found') {
        return fail(request, reply, 404, 'NOT_FOUND', 'Квартира не найдена');
      }
      if (result === 'conflict') {
        return fail(
          request,
          reply,
          409,
          'ROOM_TAKEN',
          'Этот номер комнаты уже занят другой квартирой в доме',
        );
      }

      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'apartment.intercom_room',
        entityType: 'apartment',
        entityId: apartmentParsed.data,
        after: { room },
      });

      return reply.send({ ok: true, intercomRoom: room });
    },
  );
  /**
   * Подставить номера на панели по номерам квартир.
   *
   * Заполняет только пустые — заданные вручную не трогает. Отвечает, сколько
   * заполнено и сколько осталось: строки вроде «12А» панель набрать не может,
   * их надо поправить руками.
   */
  app.post<{ Params: { id: string } }>(
    '/buildings/:id/apartments/rooms/autofill',
    { preHandler: [app.authenticate, app.requirePermission('apartment.manage')] },
    async (request, reply) => {
      const auth = request.auth;
      if (!auth?.tenantId) {
        return fail(request, reply, 403, 'FORBIDDEN', 'Нет привязки к управляющей компании');
      }

      const buildingParsed = z.string().uuid().safeParse(request.params.id);
      if (!buildingParsed.success) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Дом не найден');
      }

      const building = await getBuilding(auth.tenantId, buildingParsed.data);
      if (!building) {
        return fail(request, reply, 404, 'NOT_FOUND', 'Дом не найден');
      }

      const result = await autofillIntercomRooms(auth.tenantId, buildingParsed.data);

      await writeAudit({
        actorUserId: auth.userId,
        actorIp: request.ip,
        action: 'apartment.intercom_rooms_autofill',
        entityType: 'building',
        entityId: buildingParsed.data,
        after: result,
      });

      return reply.send(result);
    },
  );
}