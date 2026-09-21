export type UploadImagePurpose = 'avatar' | 'product' | 'evidence' | 'qr' | 'problem';

const settings = {
  avatar: { edge: 800, quality: 0.85, bytes: 512 * 1024 },
  product: { edge: 1024, quality: 0.86, bytes: 1024 * 1024 },
  evidence: { edge: 2560, quality: 0.95, bytes: 4 * 1024 * 1024 },
  problem: { edge: 2048, quality: 0.9, bytes: 2 * 1024 * 1024 },
  qr: { edge: 2048, quality: 1, bytes: 2 * 1024 * 1024 },
};

export async function prepareUploadImage(file: File, purpose: UploadImagePurpose): Promise<File> {
  if (!file.size || file.size > 10 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 10 MB. / กรุณาเลือกรูปขนาดไม่เกิน 10 MB');
  }
  let source: Blob = file;
  if (/image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name)) {
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob: file, toType: 'image/png' });
    if (Array.isArray(converted)) {
      if (converted.length !== 1) throw new Error('Choose a single photo. / กรุณาเลือกภาพเดี่ยว');
      source = converted[0];
    } else source = converted;
  }
  const url = URL.createObjectURL(source);
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width * height > 48_000_000) {
      throw new Error('Image dimensions are too large. / ความละเอียดรูปสูงเกินไป');
    }
    const options = settings[purpose];
    const scale = Math.min(1, options.edge / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image conversion is unavailable. / ไม่สามารถแปลงภาพได้');
    // Evidence and payment QR backgrounds must remain legible in every viewer.
    if (purpose === 'evidence' || purpose === 'qr') {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    let blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error('Image conversion failed. / แปลงภาพไม่สำเร็จ')), 'image/webp', options.quality);
    });
    if (blob.type !== 'image/webp' || purpose === 'qr') {
      const { encodeWebP } = await import('./webpEncoder');
      blob = await encodeWebP(context.getImageData(0, 0, canvas.width, canvas.height), options.quality, purpose === 'qr');
    }
    const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    const ascii = (start: number, end: number) => String.fromCharCode(...header.slice(start, end));
    if (blob.type !== 'image/webp' || ascii(0, 4) !== 'RIFF' || ascii(8, 12) !== 'WEBP') {
      throw new Error('This browser cannot create WebP. Please update your browser. / กรุณาอัปเดตเบราว์เซอร์เพื่อแปลงเป็น WebP');
    }
    // Do not repeatedly lower evidence quality to meet a byte target.
    if (blob.size > options.bytes) {
      throw new Error('The converted image is too large. Please choose a smaller, clear photo. / รูปหลังแปลงยังใหญ่เกินไป กรุณาเลือกรูปที่เล็กลงและอ่านชัด');
    }
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.webp`, { type: 'image/webp' });
  } catch (error) {
    if (error instanceof DOMException) {
      throw new Error('Could not read this image. Choose a valid JPG, PNG, WebP or HEIC photo. / อ่านรูปไม่ได้ กรุณาเลือกรูปที่ถูกต้อง');
    }
    throw error;
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
  }
}
