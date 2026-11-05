import { Link } from 'react-router-dom';
import PublicShell from '../components/PublicShell';
import { useI18n } from '../i18n';

export default function SellerLanding() {
  const { language } = useI18n();
  const th = language === 'th';
  return <PublicShell><main className="public-width py-12"><h1 className="text-3xl font-black">{th ? 'จัดการร้านและอีเวนต์ของคุณใน Paimon' : 'Manage your shop and events with Paimon'}</h1><p className="mt-4 max-w-2xl">{th ? 'Paimon ช่วยครีเอเตอร์ คอสเพลเยอร์ และร้านค้าจัดการสินค้า สต็อก คิว และออเดอร์สำหรับงานอีเวนต์และการขายออนไลน์' : 'Paimon helps creators, cosplayers and shops manage products, stock, queues and orders for events and online sales.'}</p><p className="mt-4 max-w-2xl">{th ? 'สร้างบัญชี แนะนำร้าน และเลือกเผยแพร่เมื่อคุณพร้อม' : 'Create an account, introduce your shop, and publish when you are ready.'}</p><Link className="public-button public-primary mt-6 inline-flex" to="/creator/register">{th ? 'สมัครร้านค้า' : 'Register your shop'}</Link><section className="mt-10 max-w-2xl"><h2 className="text-xl font-black">{th ? 'ใช้ Paimon ทำอะไรได้บ้าง' : 'What can you do with Paimon?'}</h2><ul className="mt-3 list-disc space-y-2 pl-5"><li>{th ? 'เตรียมสินค้าและสต็อกสำหรับช่องทางขาย' : 'Prepare products and stock for sales channels.'}</li><li>{th ? 'จัดการคิวและการขายหน้าบูธในอีเวนต์' : 'Manage queues and booth sales at events.'}</li><li>{th ? 'เปิดแคมเปญขายออนไลน์และติดตามออเดอร์' : 'Run online sales campaigns and follow orders.'}</li></ul></section></main></PublicShell>;
}
