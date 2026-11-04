export type NotificationEvent = 'created' | 'confirmed' | 'ready_for_pickup' | 'shipped' | 'payment_rejected' | 'refund_required';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
const one = (value: unknown): Record<string, unknown> | null => {
  const item = Array.isArray(value) ? value[0] : value;
  return item && typeof item === 'object' ? item as Record<string, unknown> : null;
};

export function buildCampaignEmail(order: Record<string, unknown>, campaign: Record<string, unknown>, artist: Record<string, unknown>, payment: Record<string, unknown>, items: Array<Record<string, unknown>>, event: NotificationEvent, publicSiteUrl: string) {
  const code = String(order.pickup_code || '');
  const name = String(artist.display_name || 'Paimon creator');
  const campaignName = String(campaign.name || 'Online campaign');
  const base = publicSiteUrl.replace(/\/$/, '');
  const orderUrl = base && artist.slug ? `${base}/${encodeURIComponent(String(artist.slug))}/order/${encodeURIComponent(code)}` : '';
  const lines = items.map(item => `${Number(item.quantity || 0)}x ${String(item.product_name_snapshot || one(item.products)?.name || 'Item')}`);
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: String(payment.currency || order.currency || 'THB') }).format(Number(payment.amount_expected ?? order.total_price ?? 0));
  const content: Record<NotificationEvent, { subject: string; heading: string; intro: string }> = {
    created: { subject: 'Order received', heading: 'Your order is reserved', intro: `${name} received your order. Complete payment before the countdown ends.` },
    confirmed: { subject: 'Payment confirmed', heading: 'Your payment is confirmed', intro: `${name} confirmed your payment. Check your order status for the next steps.` },
    ready_for_pickup: { subject: 'Ready for pickup', heading: 'Your order is ready for pickup', intro: `${name} confirmed your payment. Follow the pickup details on your order status page.` },
    shipped: { subject: 'Order shipped', heading: 'Your order has shipped', intro: `${name} shipped your order.` },
    payment_rejected: { subject: 'Payment needs attention', heading: 'Payment was not accepted', intro: `This order has been cancelled. ${String(payment.review_note || 'Open your order status page for details or contact the seller.')}` },
    refund_required: { subject: 'Refund required', heading: 'The seller will arrange a refund', intro: String(payment.review_note || 'Open your order status page for details.') },
  };
  const selected = content[event];
  const thai: Record<NotificationEvent, { heading: string; intro: string }> = {
    created: { heading: 'รับคำสั่งซื้อแล้ว รอชำระเงิน', intro: `${name} รับคำสั่งซื้อของคุณแล้ว กรุณาชำระเงินก่อนหมดเวลาที่แสดงในหน้าคำสั่งซื้อ` },
    confirmed: { heading: 'ยืนยันการชำระเงินแล้ว', intro: `${name} ยืนยันการชำระเงินแล้ว ดูขั้นตอนถัดไปได้ที่หน้าคำสั่งซื้อ` },
    ready_for_pickup: { heading: 'สินค้าพร้อมรับแล้ว', intro: 'ตรวจสอบรายละเอียดการรับสินค้าได้ที่หน้าคำสั่งซื้อ' },
    shipped: { heading: 'จัดส่งสินค้าแล้ว', intro: 'ตรวจสอบรายละเอียดการจัดส่งได้ที่หน้าคำสั่งซื้อ' },
    payment_rejected: { heading: 'หลักฐานการชำระเงินไม่ผ่านการตรวจสอบ', intro: 'คำสั่งซื้อนี้ถูกยกเลิกแล้ว กรุณาเปิดหน้าคำสั่งซื้อเพื่อตรวจสอบรายละเอียดหรือติดต่อร้านค้า' },
    refund_required: { heading: 'ร้านจะดำเนินการคืนเงิน', intro: 'ตรวจสอบรายละเอียดได้ที่หน้าคำสั่งซื้อ' },
  };
  const tracking = event === 'shipped' ? [`Carrier: ${String(order.shipping_carrier || '-')}`, `Tracking number: ${String(order.tracking_number || '')}`] : [];
  const text = [thai[event].heading, thai[event].intro, '', selected.heading, selected.intro, '', `แคมเปญ / Campaign: ${campaignName}`, `คำสั่งซื้อ / Order: ${code}`, `ยอดรวม / Total: ${amount}`, '', 'รายการสินค้า / Items:', ...lines.map(line => `- ${line}`), ...tracking, ...(orderUrl ? ['', `ตรวจสอบคำสั่งซื้อ / Check order status: ${orderUrl}`] : [])].join('\n');
  const html = `<div style="font-family:Arial,Tahoma,sans-serif;line-height:1.6;color:#202641;max-width:560px;padding:24px;border:1px solid #e2eaf1;border-radius:16px">
    <p style="margin:0 0 24px;font-size:22px;font-weight:bold;color:#202641"><span style="color:#dca970">✦</span> Paimon</p>
    <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(thai[event].heading)}</h1><p>${escapeHtml(thai[event].intro)}</p><h2 style="font-size:18px;margin:20px 0 8px">${escapeHtml(selected.heading)}</h2><p>${escapeHtml(selected.intro)}</p>
    <div style="border:1px solid #dcb07c;border-top:4px solid #3a7ebc;background:#f7f4ee;border-radius:14px;padding:14px;margin:16px 0">
      <p style="margin:0 0 8px"><strong>แคมเปญ / Campaign:</strong> ${escapeHtml(campaignName)}</p><p style="margin:0 0 8px"><strong>คำสั่งซื้อ / Order:</strong> ${escapeHtml(code)}</p><p style="margin:0"><strong>ยอดรวม / Total:</strong> ${escapeHtml(amount)}</p>
    </div>
    <h2 style="font-size:14px;margin:18px 0 8px">รายการสินค้า / Items</h2><ul>${lines.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
    ${tracking.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
    ${orderUrl ? `<p style="margin:16px 0"><a href="${escapeHtml(orderUrl)}" style="display:inline-block;background:#245780;color:#fff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:12px">ตรวจสอบคำสั่งซื้อ / Check order status</a></p>` : ''}
    <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e6edf3;color:#68778a;font-size:12px">Paimon · <a href="https://paimonq.com/help" style="color:#326b9a">Help</a></p>
  </div>`;
  return { subject: `${thai[event].heading} / ${selected.subject}: ${code}`, text, html };
}
