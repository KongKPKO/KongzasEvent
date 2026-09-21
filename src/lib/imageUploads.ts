import { supabase } from '../supabaseClient';
import { prepareUploadImage, type UploadImagePurpose } from '../utils/uploadImage';

export async function uploadImage(file: File, purpose: UploadImagePurpose, target: { artistId?: string; orderId?: string; code?: string }) {
  const image = await prepareUploadImage(file, purpose);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await image.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
  const key = `nireq-image-upload:${purpose}:${target.artistId || target.orderId}:${hash}`;
  const requestId = localStorage.getItem(key) || crypto.randomUUID();
  localStorage.setItem(key, requestId);
  const body = new FormData();
  body.set('file', image);
  body.set('purpose', purpose);
  body.set('requestId', requestId);
  for (const [name, value] of Object.entries(target)) if (value) body.set(name, value);
  const { data, error } = await supabase.functions.invoke('upload-image', { body });
  if (error || typeof data?.path !== 'string') {
    throw new Error('Could not upload the image. Check your connection and access, then retry. / อัปโหลดรูปไม่ได้ กรุณาตรวจการเชื่อมต่อและสิทธิ์ แล้วลองอีกครั้ง');
  }
  localStorage.removeItem(key);
  return data.path as string;
}
