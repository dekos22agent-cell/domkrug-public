/**
 * Типы ответов API.
 *
 * Источник правды — код backend, а не docs/API-CONTRACT.md: там в описании
 * `/auth/me` привязки показаны вложенными (`bindings[].apartment`), а сервер
 * отдаёт плоские поля (`apartmentId`, `apartmentNumber`, `addressText`).
 * Расхождение отмечено в PROGRESS.md; клиент написан по реальному ответу.
 */

export interface CurrentUser {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  birthDate: string | null;
  /** СНИЛС, 11 цифр без разделителей. Необязательное поле профиля. */
  snils: string | null;
}

/** Привязка жителя к квартире (плоская структура — как отдаёт сервер). */
export interface Binding {
  id: string;
  status: 'pending' | 'confirmed' | 'rejected';
  /** Значения — из CHECK в миграции 003: owner | renter | representative. */
  roleInApartment: 'owner' | 'renter' | 'representative';
  apartmentId: string;
  apartmentNumber: string;
  buildingId: string;
  addressText: string;
  tenantId: string;
  tenantName: string;
  /** Заполнено только у отклонённой: житель должен знать причину. */
  rejectReason: string | null;
  /** Площадь, м²; на сервере numeric, поэтому строка. */
  areaTotal: string | null;
  rooms: number | null;
  kind: 'apartment' | 'nonresidential';
  entranceNumber: number | null;
  floorNumber: number | null;
  city: string;
  street: string;
  houseNumber: string;
  buildingFloors: number | null;
  buildingEntrances: number | null;
  buildingYear: number | null;
}

/** УК, к которой относится сотрудник. */
export interface StaffTenant {
  id: string;
  name: string;
  slug?: string;
  position?: string | null;
}

/** Ответ `/auth/me`. */
export interface MeResponse {
  user: CurrentUser;
  roles: string[];
  permissions: string[];
  tenant: StaffTenant | null;
  bindings: Binding[];
}

/** Ответ `/auth/login`. */
export interface LoginResponse {
  user: CurrentUser;
  roles: string[];
  tenant: { id: string; name: string } | null;
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

/** Ответ `/auth/refresh` — только токен, профиль запрашивается отдельно. */
export interface RefreshResponse {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export type TicketStatus =
  | 'new'
  | 'accepted'
  | 'assigned'
  | 'in_progress'
  | 'waiting'
  | 'done'
  | 'closed'
  | 'rejected';

export interface StatusInfo {
  code: TicketStatus;
  name: string;
}

export type TicketPriority = 'low' | 'normal' | 'high' | 'emergency';

/** Карточка заявки в списке (`TicketSummary` на сервере). */
export interface TicketSummary {
  id: string;
  number: number;
  status: StatusInfo;
  priority: TicketPriority;
  source: 'resident_app' | 'dispatcher_phone' | 'dispatcher_walkin';
  category: { id: string; name: string };
  building: { id: string; addressText: string };
  apartment: { id: string; number: string } | null;
  title: string | null;
  assignedTo: { id: string; fullName: string } | null;
  slaDueAt: string | null;
  isOverdue: boolean;
  createdAt: string;
}

/** Курсорная страница списка (docs/API-CONTRACT.md п. 2.4). */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Комментарий к заявке. */
export interface TicketComment {
  id: string;
  author: { id: string; fullName: string };
  body: string;
  /** Служебный комментарий: жителю не показывается (RBAC.md п. 4.5). */
  isInternal: boolean;
  createdAt: string;
}

/**
 * Полная заявка (`GET /tickets/:id` и `GET /resident/tickets/:id`).
 *
 * Телефон и контактное лицо сервер скрывает от исполнителя после закрытия —
 * это не баг клиента, поэтому поля nullable.
 */
export interface TicketDetail extends TicketSummary {
  tenantId: string;
  description: string;
  locationNote: string | null;
  contactPhone: string | null;
  contactName: string | null;
  createdBy: { id: string; fullName: string };
  parentTicket: { id: string; number: number } | null;
  acceptedAt: string | null;
  startedAt: string | null;
  closedAt: string | null;
  resolutionNote: string | null;
  /** Норматив по категории в часах — то, что житель понимает как «срок». */
  slaHours: number;
  comments: TicketComment[];
}

/** Сотрудник УК (`GET /staff`) — для выбора исполнителя. */
export interface StaffMember {
  id: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  position: string | null;
  isActive: boolean;
  roles: string[];
}

/**
 * Результат поиска квартиры (`GET /resident/search-apartment`).
 *
 * Сервер отдаёт только адрес, номер и название УК — ни ФИО, ни телефонов.
 * Это осознанное ограничение, а не недоделка: иначе поиск стал бы способом
 * разведки (backend/src/modules/bindings/service.ts).
 */
export interface ApartmentSearchItem {
  apartmentId: string;
  number: string;
  addressText: string;
  tenantId: string;
  tenantName: string;
  /** У пользователя уже есть привязка к этой квартире (в любом статусе). */
  alreadyBound: boolean;
}

/** Заявка на привязку в очереди УК (`GET /resident-bindings`). */
export interface TenantBindingItem {
  id: string;
  status: 'pending' | 'confirmed' | 'rejected';
  roleInApartment: 'owner' | 'renter' | 'representative';
  requestedAt: string;
  residentName: string;
  residentPhone: string | null;
  apartmentNumber: string;
  addressText: string;
  rejectReason: string | null;
}

/** Запись истории статусов заявки (`GET /tickets/:id/history`). */
export interface TicketHistoryItem {
  /** Предыдущий статус; null у самой первой записи. */
  from: StatusInfo | null;
  to: StatusInfo;
  /** Кто сменил статус. */
  by: string;
  /** Обязателен для «ожидает материалов» и «выполнена». */
  comment: string | null;
  at: string;
}

/** Дом в списке УК (`GET /buildings`). */
export type BuildingObjectKind =
  | 'apartment_building'
  | 'cottage_settlement'
  | 'mixed_use'
  | 'commercial_building';

export interface BuildingListItem {
  id: string;
  addressText: string;
  city: string;
  street: string;
  houseNumber: string;
  buildingNumber: string | null;
  complexId: string | null;
  complexName: string | null;
  objectKind: BuildingObjectKind;
  apartmentsCount: number;
  openTickets: number;
}

/** Объект с полями паспорта (`GET /buildings/:id/passport`). */
export interface BuildingPassportBuilding extends BuildingListItem {
  totalEntrances: number | null;
  totalFloors: number | null;
  yearBuilt: number | null;
  residentsConfirmed: number;
  overdueTickets: number;
  entrances: { id: string; number: number }[];
}

export interface BuildingPassportFields {
  cadastralNumber: string | null;
  yearCommissioned: number | null;
  totalArea: string | null;
  livingArea: string | null;
  commercialArea: string | null;
  landArea: string | null;
  parkingSpots: number | null;
  elevatorsCount: number | null;
  energyClass: string | null;
  managementStart: string | null;
  warrantyUntil: string | null;
  notes: string | null;
}

export interface BuildingPassport {
  building: BuildingPassportBuilding;
  passport: BuildingPassportFields | null;
  stats: {
    unitsTotal: number;
    apartments: number;
    nonresidential: number;
    residentsConfirmed: number;
    openTickets: number;
    overdueTickets: number;
    entrances: number;
    unitsByKind: { kind: string; count: number }[];
  };
  updatedAt: string | null;
}

export type OwnerRole = 'owner' | 'representative';

export interface OwnerListItem {
  ownershipId: string;
  ownerId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  role: OwnerRole;
  sharePercent: string;
  validFrom: string;
  validTo: string | null;
  apartmentId: string;
  apartmentNumber: string;
}

export interface SaveOwnerInput {
  fullName: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  role: OwnerRole;
  sharePercent: number;
  validFrom: string;
  validTo: string | null;
}

export type MeterKind = 'cold_water' | 'hot_water' | 'electricity' | 'heat' | 'gas';

export interface StaffMeterItem {
  id: string;
  apartmentId: string;
  apartmentNumber: string;
  kind: MeterKind;
  serial: string | null;
  unit: string;
  verificationDue: string | null;
  isActive: boolean;
  lastValue: number | null;
  lastPeriod: string | null;
}

export interface SaveStaffMeterInput {
  kind: MeterKind;
  serial: string | null;
  unit: string;
  verificationDue: string | null;
  isActive: boolean;
  initialValue?: number | null;
}

export interface NewsItem {
  id: string;
  title: string;
  body: string;
  isEmergency: boolean;
  publishedAt: string | null;
  createdAt: string;
}

export type DocumentCategory = 'house' | 'apartment' | 'receipt' | 'other';

export interface DocumentItem {
  id: string;
  title: string;
  description: string | null;
  category: DocumentCategory;
  url: string;
  buildingId: string | null;
  buildingAddress: string | null;
  publishedAt: string | null;
  createdAt: string;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  isEmergency: boolean;
  source: 'news' | 'emergency';
}

export interface StaffContact {
  id: string;
  kind: 'uk' | 'district' | 'provider' | 'clinic' | 'emergency' | 'other';
  name: string;
  phone: string;
  note: string | null;
  buildingId: string | null;
  buildingAddress: string | null;
  sortOrder: number;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  actorName: string | null;
  actorIp: string | null;
  createdAt: string;
  after: unknown;
}

export interface ReportSummary {
  totals: {
    total: number;
    open: number;
    overdue: number;
    emergencyOpen: number;
    thisMonth: number;
    closedThisMonth: number;
    avgCloseHours: number | null;
  };
  categories: { name: string; total: number; open: number; overdue: number }[];
  staff: { name: string; open: number; overdue: number; closedThisMonth: number }[];
  overdue: {
    id: string;
    number: number;
    title: string;
    priority: string;
    address: string;
    dueAt: string;
  }[];
}

/** Квартира в доме (`GET /buildings/:id/apartments`). */
export interface ApartmentListItem {
  id: string;
  number: string;
  kind: string;
  rooms: number | null;
  areaTotal: string | null;
  status: 'active' | 'archived';
  entranceNumber: number | null;
  floorNumber: number | null;
  residentsConfirmed: number;
  /** Номер, который набирает вызывная панель (в панели это «комната») */
  intercomRoom: string | null;
}

/**
 * Категория заявки (`GET /ticket-categories`).
 *
 * Поле SLA сервер отдаёт как `slaHours` (см. backend/src/modules/properties/routes.ts),
 * а не `defaultSlaHours` — ориентируемся на реальный ответ, как и в привязках.
 */
export interface TicketCategory {
  id: string;
  code: string;
  name: string;
  slaHours: number;
  isEmergency: boolean;
}

/** Известные роли (docs/RBAC.md п. 1). `uk_manager` — v2. */
export type Role = 'platform_admin' | 'uk_admin' | 'dispatcher' | 'executor' | 'resident' | 'uk_manager';

/** Точка доступа: подъездная дверь, калитка, шлагбаум. */
export interface AccessPoint {
  id: string;
  kind: 'entrance_door' | 'wicket' | 'barrier' | 'gate' | 'parking';
  name: string;
  instruction: string | null;
  buildingId: string;
  buildingAddress: string;
  apartmentId: string;
  apartmentNumber: string;
  isActive: boolean;
}

/** Запись журнала открытий. */
export interface AccessEvent {
  id: string;
  /** Кто открывал: имя жителя или метка гостевого доступа */
  actor: string | null;
  pointName: string;
  pointKind: AccessPoint['kind'];
  result: 'ok' | 'denied' | 'error';
  source: string;
  createdAt: string;
}
/** Камера, доступная жителю. */
export interface ResidentCamera {
  id: string;
  kind: 'overview' | 'call_panel' | 'barrier' | 'parking';
  name: string;
  buildingAddress: string;
  apartmentNumber: string;
  isActive: boolean;
  hasLiveStream: boolean;
}

/** Ссылка на поток камеры. В демо-режиме url = null. */
export interface CameraStream {
  type: 'demo' | 'hls' | 'webrtc' | 'sip';
  url: string | null;
  expiresAt: string;
  demo: boolean;
}

/** Входящий звонок в домофон. */
export interface ActiveCall {
  id: string;
  pointId: string;
  pointName: string;
  cameraId: string | null;
  cameraName: string | null;
  stream: CameraStream | null;
  startedAt: string;
  apartmentNumber: string;
}
/** Счётчик квартиры. */
export interface Meter {
  id: string;
  kind: 'cold_water' | 'hot_water' | 'electricity' | 'heat' | 'gas';
  serial: string | null;
  unit: string;
  verificationDue: string | null;
  lastValue: number | null;
  lastPeriod: string | null;
  currentSubmitted: boolean;
  currentValue: number | null;
  apartmentId: string;
  apartmentNumber: string;
  buildingAddress: string;
}

/** Лифт дома. */
export interface Lift {
  id: string;
  number: string;
  status: 'ok' | 'maintenance' | 'fault';
  serviceOrg: string | null;
  lastServiceAt: string | null;
  buildingAddress: string;
  entranceNumber: string | null;
}

/** Экстренное сообщение УК. */
export interface EmergencyMessage {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  publishedAt: string;
  expiresAt: string | null;
  buildingAddress: string | null;
}

/** Экстренный вызов. */
export interface EmergencyCall {
  id: string;
  kind: 'uk_duty' | 'police' | 'ambulance' | 'fire' | 'gas';
  status: 'requested' | 'accepted' | 'cancelled';
  locationNote: string | null;
  createdAt: string;
  acceptedAt: string | null;
}

/** Запись журнала показаний. */
export interface MeterReading {
  period: string;
  value: number;
}
/**
 * Квартира, куда человека пригласили: член семьи не собственник,
 * привязки у него нет, но адрес и набор прав есть.
 */
export interface Membership {
  apartmentId: string;
  apartmentNumber: string;
  addressText: string;
  buildingId: string;
  tenantId: string;
  tenantName: string;
  preset: 'family' | 'child' | 'tenant' | 'worker' | 'guest';
  scopes: string[];
  expiresAt: string | null;
  /** Кто пригласил — показываем «доступ от …» */
  invitedByName: string | null;
}

/** Состояние второго фактора (TOTP) из `/auth/me`. */
export interface TwoFactorState {
  /** Включён и требуется при входе. */
  enabled: boolean;
  /** Политика говорит, что роли нужен второй фактор. */
  required: boolean;
  /** Сколько одноразовых резервных кодов осталось. */
  backupCodesLeft: number;
}

/** Ответ /auth/me */
export interface MeResponse {
  user: CurrentUser;
  roles: string[];
  permissions: string[];
  tenant: StaffTenant | null;
  bindings: Binding[];
  memberships: Membership[];
  twoFactor: TwoFactorState;
}

/** Уведомление для колокольчика (`GET /notifications`). */
export interface NotificationItem {
  id: string;
  type:
    | 'ticket_created'
    | 'ticket_status_changed'
    | 'ticket_assigned'
    | 'ticket_comment'
    | 'resident_binding_confirmed'
    | 'resident_binding_rejected'
    | 'news_published';
  title: string;
  body: string | null;
  entityType: 'ticket' | 'news' | 'resident_binding' | null;
  entityId: string | null;
  /** Номер заявки — чтобы не делать второй запрос ради «№12». */
  entityLabel: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Отпечаток состояния для опроса (`GET /updates`). */
export interface UpdatesSnapshot {
  serverTime: string;
  tickets: { count: number; maxUpdatedAt: string | null };
  access: { lastEventAt: string | null };
  notifications: { unread: number; lastAt: string | null };
}
/** Звонок в домофон (`GET /resident/video/intercom/history`). */
export interface IntercomCallRecord {
  id: string;
  status: 'ringing' | 'opened' | 'declined' | 'missed' | 'ended';
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  apartmentNumber: string;
  pointName: string;
  cameraName: string | null;
}
/** Фото или документ заявки (`GET /resident/tickets/:id/attachments`). */
export interface TicketAttachment {
  id: string;
  kind: 'request_photo' | 'result_photo' | 'comment_file' | 'document';
  /** Комментарий, к которому приложен файл */
  commentId: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
}