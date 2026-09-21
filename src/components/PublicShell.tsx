import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import CustomerBrandHeader from './CustomerBrandHeader';
import { useI18n } from '../i18n';
import '../pages/public-entry.css';

export default function PublicShell({ children, auth = false, discovery = false }: { children: ReactNode; auth?: boolean; discovery?: boolean }) {
  const { language, t } = useI18n();
  const th = language === 'th';
  return <div className={`public-entry${discovery ? ' discovery-landing' : ''}`}>
    <CustomerBrandHeader>{discovery && <Link className="public-nav-link discovery-creator-nav" to="/creator/register">{t('discoveryForCreators')}</Link>}<Link className="public-nav-link" to={auth ? '/creator/register' : '/manage-login'}>{auth ? (th ? 'สมัครบัญชี' : 'Sign up') : (th ? 'เข้าสู่ระบบ' : 'Log in')}</Link></CustomerBrandHeader>
    {children}
    <footer className="public-footer"><span>NireQ · {th ? 'พื้นที่เล็ก ๆ ของครีเอเตอร์และคนที่รักผลงาน' : 'A place for creators and the people who love their work.'}</span><nav aria-label={th ? 'ข้อมูลเว็บไซต์' : 'Legal'}><Link to="/help">{th ? 'ช่วยเหลือ' : 'Help'}</Link><Link to="/privacy">{th ? 'ความเป็นส่วนตัว' : 'Privacy'}</Link><Link to="/terms">{th ? 'ข้อกำหนด' : 'Terms'}</Link><Link to="/cookies">{th ? 'คุกกี้' : 'Cookies'}</Link></nav></footer>
  </div>;
}
