import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { CenteredSpinner } from '@ui/Spinner';
import { EmptyState } from '@ui/EmptyState';
import { NotFound } from '@ui/NotFound';
import { WrongAppNotice } from '@ui/WrongAppNotice';
import { AuthProvider } from '@shared/auth';
import { useAuth } from '@shared/authContext';
import { UpdatesProvider } from '@shared/updates';
import { StaffLayout } from './StaffLayout';
import { LoginPage } from './pages/LoginPage';
import { InboxPage } from './pages/InboxPage';
import { NewTicketPage } from './pages/NewTicketPage';
import { StaffTicketPage } from './pages/StaffTicketPage';
import { MyTicketsPage } from './pages/MyTicketsPage';
import { ApartmentsPage } from './pages/ApartmentsPage';
import { ObjectsPage } from './pages/ObjectsPage';
import { ObjectPassportPage } from './pages/ObjectPassportPage';
import { ObjectOwnersPage } from './pages/ObjectOwnersPage';
import { ObjectUnitsPage } from './pages/ObjectUnitsPage';
import { ObjectMetersPage } from './pages/ObjectMetersPage';
import { ObjectImportPage } from './pages/ObjectImportPage';
import { NewsPage } from './pages/NewsPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { BindingsPage } from './pages/BindingsPage';
import { StaffPage } from './pages/StaffPage';
import { ContactsPage } from './pages/ContactsPage';
import { AuditPage } from './pages/AuditPage';
import { ReportsPage } from './pages/ReportsPage';
import { ProfilePage } from './pages/ProfilePage';

/**
 * Кабинет УК.
 *
 * Это отдельный клиент: здесь нет ни одного экрана жителя. Если сотрудник УК
 * сам живёт в доме, он открывает приложение жителя отдельно — так задачи
 * не смешиваются, а права проверяются на сервере в любом случае.
 */

function FullPageLoader() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--bg)',
      }}
    >
      <CenteredSpinner label="Проверяем сессию" />
    </div>
  );
}

/** 404 внутри кабинета: навигация нужна, поэтому отдельный компонент. */
function NotFoundRoute() {
  const navigate = useNavigate();
  return (
    <NotFound
      onHome={() => navigate('/inbox', { replace: true })}
      homeLabel="К инбоксу"
      onBack={() => navigate(-1)}
    />
  );
}

/** Пропускает только вошедших сотрудников. */
function RequireStaff() {
  const { status, hasPermission, logout } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;

  // Житель без рабочих прав попал сюда по ошибке — отправляем в его приложение
  const canWork =
    hasPermission('ticket.view.all') ||
    hasPermission('ticket.view.assigned') ||
    hasPermission('building.view') ||
    hasPermission('news.view') ||
    hasPermission('apartment.manage') ||
    hasPermission('resident_binding.view') ||
    hasPermission('staff.view');

  if (!canWork) {
    return (
      <WrongAppNotice
        title="Это кабинет управляющей компании"
        description="Ваша учётная запись не относится к сотрудникам УК. Заявки, домофон и камеры — в приложении жителя."
        actionLabel="Открыть приложение жителя"
        actionHref={(import.meta.env.VITE_RESIDENT_URL as string | undefined) ?? '/app/'}
        onLogout={() => void logout()}
      />
    );
  }

  return <StaffLayout />;
}

/** Маршрут, требующий права: нет права — явный отказ, не пустота. */
function RequirePermission({ code, children }: { code: string; children: ReactNode }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(code)) {
    return (
      <EmptyState
        title="Недостаточно прав"
        description="Ваша роль не даёт доступа к этому разделу."
      />
    );
  }
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        {/* Живые обновления: колокольчик и автообновление списков заявок */}
        <UpdatesProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route element={<RequireStaff />}>
              <Route path="/" element={<Navigate to="/inbox" replace />} />
              <Route
                path="/inbox"
                element={
                  <RequirePermission code="ticket.view.all">
                    <InboxPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/my"
                element={
                  <RequirePermission code="ticket.view.assigned">
                    <MyTicketsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/tickets/new"
                element={
                  <RequirePermission code="ticket.create">
                    <NewTicketPage />
                  </RequirePermission>
                }
              />
              <Route path="/tickets/:id" element={<StaffTicketPage />} />
              <Route
                path="/news"
                element={
                  <RequirePermission code="news.view">
                    <NewsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/documents"
                element={
                  <RequirePermission code="news.view">
                    <DocumentsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/objects"
                element={
                  <RequirePermission code="building.view">
                    <ObjectsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/objects/:id/import"
                element={
                  <RequirePermission code="apartment.manage">
                    <ObjectImportPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/objects/:id/units"
                element={
                  <RequirePermission code="apartment.view">
                    <ObjectUnitsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/objects/:id/meters"
                element={
                  <RequirePermission code="apartment.view">
                    <ObjectMetersPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/objects/:id/owners"
                element={
                  <RequirePermission code="apartment.view">
                    <ObjectOwnersPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/objects/:id"
                element={
                  <RequirePermission code="building.view">
                    <ObjectPassportPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/apartments"
                element={
                  <RequirePermission code="apartment.manage">
                    <ApartmentsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/bindings"
                element={
                  <RequirePermission code="resident_binding.view">
                    <BindingsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/staff"
                element={
                  <RequirePermission code="staff.view">
                    <StaffPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/contacts"
                element={
                  <RequirePermission code="building.view">
                    <ContactsPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/audit"
                element={
                  <RequirePermission code="audit.view">
                    <AuditPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/reports"
                element={
                  <RequirePermission code="report.view">
                    <ReportsPage />
                  </RequirePermission>
                }
              />
              {/* Профиль доступен любому сотруднику: это его данные и его пароль */}
              <Route path="/profile" element={<ProfilePage />} />
              <Route
                path="*"
                element={
                  <NotFoundRoute />
                }
              />
            </Route>
          </Routes>
        </UpdatesProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
