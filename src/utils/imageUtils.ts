export const getOptimizedImage = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  
  // Handle Google Drive links
  if (url.includes('drive.google.com')) {
    try {
      // Extract ID from various formats:
      // /file/d/ID/view
      // id=ID
      let id = '';
      
      const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
      if (fileIdMatch && fileIdMatch[1]) {
        id = fileIdMatch[1];
      } else {
        const idParamMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
        if (idParamMatch && idParamMatch[1]) {
          id = idParamMatch[1];
        }
      }
      
      if (id) {
        // Use the lh3.googleusercontent.com domain which is more reliable for hotlinking
        return `https://lh3.googleusercontent.com/d/${id}`;
      }
    } catch (e) {
      console.warn('Failed to parse Google Drive URL:', url);
    }
  }
  
  return url;
};
