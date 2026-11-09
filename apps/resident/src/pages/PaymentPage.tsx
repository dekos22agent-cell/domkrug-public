import { useNavigate } from 'react-router-dom';
import { Button } from '@ui/Button';
import { EmptyState } from '@ui/EmptyState';
import { useApartment } from '@shared/apartmentContext';
import pageStyles from './pages.module.css';

/**
 * Оплата ЖКУ пока не подключена.
 *
 * Liviti сознательно не показывает демонстрационные суммы: житель не должен
 * принимать их за реальные начисления. Когда появится биллинг и договор с
 * платёжным провайдером, здесь появятся начисления, квитанции и оплата.
 */
export function PaymentPage() {
  const { active } = useApartment();
  const navigate = useNavigate();

  return (
    <>
      <div className={pageStyles.pageHeader}>
        <div>
          <h1 className={pageStyles.pageTitle}>Оплата</h1>
          <p className={pageStyles.pageSubtitle}>
            {active
              ? `${active.addressText}, кв. ${active.apartmentNumber}`
              : 'Начисления и оплата ЖКУ'}
          </p>
        </div>
      </div>

      <EmptyState
        title="Оплата пока не подключена"
        description="Liviti ещё не принимает платежи и не показывает начисления. Когда управляющая компания подключит биллинг, здесь появятся реальные квитанции и способы оплаты."
        action={
          <Button variant="secondary" onClick={() => navigate('/')}>
            На главную
          </Button>
        }
      />
    </>
  );
}
