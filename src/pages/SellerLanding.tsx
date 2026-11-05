import { Link } from 'react-router-dom';
import PublicShell from '../components/PublicShell';
import { useI18n } from '../i18n';

export default function SellerLanding() {
  const { language } = useI18n();
  const th = language === 'th';
  return <PublicShell><main className="public-width py-12"><h1 className="text-3xl font-black">{th ? 'จัดการร้านและอีเวนต์ของคุณใน Paimon' : 'Manage your shop and events with Paimon'}</h1><p className="mt-4 max-w-2xl">{th ? 'เตรียมสินค้าและสต็อก จัดการคิว ออเดอร์ และการขายออนไลน์ในพื้นที่เดียว' : 'Prepare products and stock, and manage queues, orders and online sales in one workspace.'}</p><p className="mt-4 max-w-2xl">{th ? 'สร้างบัญชี แนะนำร้าน และเลือกเผยแพร่เมื่อคุณพร้อม' : 'Create an account, introduce your shop, and publish when you are ready.'}</p><Link className="public-button public-primary mt-6 inline-flex" to="/creator/register">{th ? 'สมัครร้านค้า' : 'Register your shop'}</Link></main></PublicShell>;
}
