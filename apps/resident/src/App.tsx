import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Layout } from '@ui/Layout';
import { CenteredSpinner } from '@ui/Spinner';
import { ApartmentProvider } from '@shared/apartment';
import { AuthProvider } from '@shared/auth';
import { useAuth } from '@shared/authContext';
import { UpdatesProvider } from '@shared/updates';
import { GuestPage } from './pages/GuestPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ProfilePage } from './pages/ProfilePage';
import { NotFound } from '@ui/NotFound';
import { WrongAppNotice } from '@ui/WrongAppNotice';
import { HomePage } from './pages/resident/HomePage';
import { BindingPage } from './pages/BindingPage';
import { AccessPage } from './pages/AccessPage';
import { CamerasPage } from './pages/CamerasPage';
import { EmergencyPage } from './pages/EmergencyPage';
import { LiftsPage } from './pages/LiftsPage';
import { MembersPage } from './pages/MembersPage';
import { MetersPage } from './pages/MetersPage';
import { PaymentPage } from './pages/PaymentPage';
import { NewsPage } from './pages/NewsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { TicketCreatePage } from './pages/resident/TicketCreatePage';
import { TicketsPage } from './pages/resident/TicketsPage';
import { ResidentTicketPage } from './pages/tickets/ResidentTicketPage';

/**
 * Приложение жителя.
 *
 * Экранов УК здесь нет: у сотрудников отдельный кабинет (uk.liviti.ru).
 * Если сотрудник УК сам живёт в доме, он заходит сюда как житель — это
 * разные учётные записи и разные задачи.
 */

/**
 * Живые обновления живут ровно столько, сколько длится сессия.
 *
 * `key={status}` намеренно: при выходе провайдер размонтируется и его состояние
 * (уведомления, счётчики) исчезает само. Иначе после смены пользователя на
 * экране остались бы уведомления предыдущего.
 */
function LiveUpdates({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  return <UpdatesProvider key={status}>{children}</UpdatesProvider>;
}

/** 404 внутри приложения: нужен доступ к навигации, поэтому отдельный компонент. */
function NotFoundRoute() {
  const navigate = useNavigate();
  return (
    <NotFound
      onHome={() => navigate('/', { replace: true })}
      onBack={() => navigate(-1)}
    />
  );
}

/** Экран загрузки, пока восстанавливается сессия после перезагрузки. */
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

/** Пропускает только вошедших жителей. */
function RequireAuth() {
  const { status, roles, logout } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'anonymous') return <Navigate to="/login" replace />;

  // Сотрудник УК без роли жителя попал в приложение жителя по прямой ссылке
  const staffOnly =
    !roles.includes('resident') &&
    (roles.includes('uk_admin') ||
      roles.includes('dispatcher') ||
      roles.includes('uk_manager') ||
      roles.includes('executor'));

  if (staffOnly) {
    return (
      <WrongAppNotice
        title="Это приложение жителя"
        description="Вы вошли как сотрудник управляющей компании. Заявки, привязки и квартиры — в кабинете УК."
        actionLabel="Открыть кабинет УК"
        actionHref={(import.meta.env.VITE_STAFF_URL as string | undefined) ?? '/uk/'}
        onLogout={() => void logout()}
      />
    );
  }

  return <Layout />;
}

/** Форма входа недоступна тем, кто уже вошёл. */
function RequireGuest({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === 'loading') return <FullPageLoader />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        {/* Живые обновления — выше страниц: колокольчик и автообновление
            списков должны работать на любом экране */}
        <LiveUpdates>
          <ApartmentProvider>
            <Routes>
              <Route
                path="/login"
                element={
                  <RequireGuest>
                    <LoginPage />
                  </RequireGuest>
                }
              />

              {/*
                Регистрация НЕ обёрнута в RequireGuest: после успеха человек уже
                авторизован, и RequireGuest увёл бы его на главную вместо привязки
                квартиры. Сама страница решает, куда идти (см. RegisterPage).
              */}
              <Route path="/register" element={<RegisterPage />} />

              {/* Гостевой вход по коду: без регистрации и персональных данных */}
              <Route path="/guest" element={<GuestPage />} />

              <Route element={<RequireAuth />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/my-requests" element={<TicketsPage />} />
                <Route path="/my-requests/new" element={<TicketCreatePage />} />
                <Route path="/my-requests/:id" element={<ResidentTicketPage />} />
                <Route path="/access" element={<AccessPage />} />
                <Route path="/cameras" element={<CamerasPage />} />
                <Route path="/members" element={<MembersPage />} />
                <Route path="/meters" element={<MetersPage />} />
                <Route path="/lifts" element={<LiftsPage />} />
                <Route path="/emergency" element={<EmergencyPage />} />
                <Route path="/payment" element={<PaymentPage />} />
              <Route path="/news" element={<NewsPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/documents" element={<DocumentsPage />} />
                <Route path="/binding" element={<BindingPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="*" element={<NotFoundRoute />} />
              </Route>
            </Routes>
          </ApartmentProvider>
        </LiveUpdates>
      </AuthProvider>
    </BrowserRouter>
  );
}
