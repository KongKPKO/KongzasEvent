/**
 * Transforms a Supabase Storage URL into an ImageKit URL for optimization.
 * 
 * @param url - The original Supabase Storage URL
 * @param width - The desired width for resizing (default: 600)
 * @returns The optimized ImageKit URL or the original URL if not from Supabase
 */
const IMAGEKIT_ENDPOINT = 'https://ik.imagekit.io/kongzas';

export const getOptimizedImageUrl = (url: string, width: number = 600): string => {
   if (!url) return '';

   // Check if it's a Supabase Storage URL
   if (url.includes('supabase.co/storage/v1/object/public/')) {
      try {
         // Split specifically at the public folder path to get the relative file path
         const splitKey = '/storage/v1/object/public/';
         const parts = url.split(splitKey);
         
         // If split was successful, we take the second part (the file path)
         if (parts.length > 1) {
            const filePath = parts[1];
            
            // Construct ImageKit URL: Endpoint + / + Clean File Path
            // Append transformation parameters: tr=w-[width],q-80
            return `${IMAGEKIT_ENDPOINT}/${filePath}?tr=w-${width},q-80`;
         }
      } catch (error) {
         console.error('Error transforming ImageKit URL:', error);
      }
   }

   // Fallback: If not a Supabase URL or error occurs, return original
   return url;
};
