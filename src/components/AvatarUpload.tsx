import { useI18n } from '../i18n';
import { uploadImage } from '../lib/imageUploads';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { Camera, Loader2, User, AlertCircle } from 'lucide-react';
import { resolveAvatarUrl } from '../utils/avatarUrl';

interface AvatarUploadProps {
  currentImageUrl?: string;
  artistId: string;
  onUploadComplete: (url: string) => void;
}

const AvatarUpload = ({ currentImageUrl, artistId, onUploadComplete }: AvatarUploadProps) => {
  const { language } = useI18n();
  const th = language === 'th';
  const [previewUrl, setPreviewUrl] = useState<string | null>(resolveAvatarUrl(currentImageUrl) || null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPreviewUrl(resolveAvatarUrl(currentImageUrl) || null);
  }, [currentImageUrl]);


  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploading(true);
      const filePath = await uploadImage(file, 'avatar', { artistId });

      // Use Supabase public URL directly to avoid broken external transforms.
      const { data: { publicUrl } } = supabase.storage
        .from('Avatar')
        .getPublicUrl(filePath);

      const finalUrl = resolveAvatarUrl(publicUrl);

      setPreviewUrl(finalUrl);
      onUploadComplete(publicUrl);

    } catch (err) {
      console.error('Upload failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to upload image');
      // Revert preview if needed, or just keep the old one
    } finally {
      setIsCompressing(false);
      setIsUploading(false);
      // Reset input so same file can be selected again if needed
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClick = () => {
    if (isUploading || isCompressing) return;
    fileInputRef.current?.click();
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <button type="button" aria-label={th ? 'เปลี่ยนรูปโปรไฟล์' : 'Change profile photo'} disabled={isUploading || isCompressing}
        onClick={handleClick}
        className={`
          relative w-32 h-32 rounded-full cursor-pointer overflow-hidden border-4 border-white shadow-lg group
          ${(isCompressing || isUploading) ? 'pointer-events-none opacity-80' : 'hover:border-pink-100 transition-all'}
        `}
      >
        {/* Image Preview */}
        {previewUrl ? (
          <img 
            src={previewUrl} 
            alt="Profile Avatar" 
            className="w-full h-full object-cover bg-gray-100"
          />
        ) : (
          <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-300">
            <User size={48} />
          </div>
        )}

        {/* Overlay (Hover or Processing) */}
        <div className={`
          absolute inset-0 bg-black/30 flex flex-col items-center justify-center text-white transition-opacity duration-200
          ${(isCompressing || isUploading) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
        `}>
          {isCompressing ? (
            <>
              <Loader2 className="animate-spin mb-1" size={24} />
              <span className="text-[10px] font-bold uppercase tracking-wide">{th ? 'กำลังย่อรูป' : 'Optimizing'}</span>
            </>
          ) : isUploading ? (
            <>
              <Loader2 className="animate-spin mb-1" size={24} />
              <span className="text-[10px] font-bold uppercase tracking-wide">{th ? 'กำลังอัปโหลด' : 'Uploading'}</span>
            </>
          ) : (
            <Camera size={32} />
          )}
        </div>
      </button>
      <span className="text-sm font-semibold text-pink-800">{th ? 'แตะรูปเพื่อเปลี่ยน' : 'Select photo to change'}</span>

      {/* Hidden Input */}
      <input 
        type="file" 
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/png, image/jpeg, image/webp"
        className="hidden"
      />

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-1 text-red-500 text-xs animate-pulse">
           <AlertCircle size={12} />
           <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export default AvatarUpload;
