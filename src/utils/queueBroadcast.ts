import type { Language } from '../i18n';

// Translate only built-in presets; merchant-written announcements stay verbatim.
export function getQueueBroadcast(message: string | null | undefined, language: Language) {
  const value = message?.trim();
  if (!value) return null;
  const th = language === 'th';
  switch (value.toLowerCase()) {
    case 'queue closed temporarily':
      return { kind: 'paused' as const, title: th ? 'หยุดรับคิวชั่วคราว' : 'Queue temporarily closed', detail: th ? 'ขณะนี้ร้านหยุดออกบัตรคิวใหม่ หากมีบัตรคิวแล้ว โปรดติดตามสถานะบนหน้านี้' : 'New queue tickets are temporarily unavailable. If you already have a ticket, keep checking your status here.' };
    case 'break time':
      return { kind: 'break' as const, title: th ? 'ร้านกำลังพัก' : 'The shop is taking a break', detail: th ? 'การให้บริการอาจใช้เวลานานขึ้น โปรดติดตามประกาศและสถานะคิวบนหน้านี้' : 'Service may take longer during the break. Keep checking announcements and your queue status here.' };
    case 'urgent matter, sorry for the inconvenience':
      return { kind: 'urgent' as const, title: th ? 'ล่าช้าจากเหตุเร่งด่วน' : 'Service delayed by an urgent matter', detail: th ? 'การให้บริการล่าช้าชั่วคราว ขออภัยในความไม่สะดวก โปรดติดตามสถานะคิวบนหน้านี้' : 'Service is temporarily delayed. We’re sorry for the inconvenience. Keep checking your queue status here.' };
    default:
      return { kind: 'notice' as const, title: th ? 'ประกาศจากร้าน' : 'Shop announcement', detail: value };
  }
}
