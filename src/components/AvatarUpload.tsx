import { useEffect, useState, useRef } from 'react';
import { supabase } from '../supabaseClient';
import { Camera, Loader2, User, AlertCircle } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { resolveAvatarUrl } from '../utils/avatarUrl';

interface AvatarUploadProps {
  currentImageUrl?: string;
  artistId: string;
  onUploadComplete: (url: string) => void;
}

const AvatarUpload = ({ currentImageUrl, artistId, onUploadComplete }: AvatarUploadProps) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(resolveAvatarUrl(currentImageUrl) || null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPreviewUrl(resolveAvatarUrl(currentImageUrl) || null);
  }, [currentImageUrl]);

  const handleImageCompression = async (imageFile: File): Promise<File> => {
    // 1. Validation: Allow large raw files (e.g., up to 10MB) to support camera uploads
    if (imageFile.size > 10 * 1024 * 1024) {
       throw new Error("File too large. Maximum size is 10MB.");
    }

    // 2. Skip Condition: If the original file is already smaller than 0.2MB, skip compression
    if (imageFile.size / 1024 / 1024 < 0.2) {
       return imageFile;
    }

    // 3. Optimization Target
    const options = {
       maxSizeMB: 0.2,           // Aim for ~200KB
       maxWidthOrHeight: 800,    // 800px is sufficient for profile pics
       useWebWorker: true,
       fileType: 'image/webp',   // Convert to WebP
       initialQuality: 0.8
    };

    try {
       const compressedFile = await imageCompression(imageFile, options);
       
       // Ensure we return a file with the correct extension if it was converted
       const newName = imageFile.name.replace(/\.[^/.]+$/, "") + '.webp';
       return new File([compressedFile], newName, { type: 'image/webp' });
    } catch (err) {
       console.warn('Compression failed, falling back to original file', err);
       return imageFile;
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Start Compression
      setIsCompressing(true);
      const processedFile = await handleImageCompression(file);
      setIsCompressing(false);

      // Start Upload
      setIsUploading(true);
      
      const timestamp = Date.now();
      const mimeToExtension: Record<string, string> = {
        'image/webp': 'webp',
        'image/jpeg': 'jpg',
        'image/png': 'png',
      };

      const normalizedMimeType = processedFile.type || 'image/webp';
      const extension = mimeToExtension[normalizedMimeType] || 'webp';
      const filePath = `${artistId}/${timestamp}.${extension}`;

      // Upload to 'Avatar' bucket
      const { error: uploadError } = await supabase.storage
        .from('Avatar')
        .upload(filePath, processedFile, {
          contentType: normalizedMimeType,
          upsert: true
        });

      if (uploadError) throw uploadError;

      // Use Supabase public URL directly to avoid broken external transforms.
      const { data: { publicUrl } } = supabase.storage
        .from('Avatar')
        .getPublicUrl(filePath);

      const finalUrl = resolveAvatarUrl(publicUrl);

      setPreviewUrl(finalUrl);
      onUploadComplete(publicUrl);

    } catch (err: any) {
      console.error('Upload failed:', err);
      setError(err.message || 'Failed to upload image');
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
      <div 
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
              <span className="text-[10px] font-bold uppercase tracking-wide">Optimizing</span>
            </>
          ) : isUploading ? (
            <>
              <Loader2 className="animate-spin mb-1" size={24} />
              <span className="text-[10px] font-bold uppercase tracking-wide">Uploading</span>
            </>
          ) : (
            <Camera size={32} />
          )}
        </div>
      </div>

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
