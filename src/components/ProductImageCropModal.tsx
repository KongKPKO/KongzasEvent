import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Image as ImageIcon, Minus, Plus, X } from 'lucide-react';
import { Button } from './ui';

type Point = {
  x: number;
  y: number;
};

type FrameMode = 'fit' | 'crop';

interface ProductImageCropModalProps {
  file: File;
  onCancel: () => void;
  onConfirm: (file: File) => void;
  onError?: (message: string) => void;
}

const PREVIEW_SIZE = 320;
const OUTPUT_SIZE = 1024;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getBaseScale = (naturalWidth: number, naturalHeight: number, mode: FrameMode) => {
  const fitScale = Math.min(PREVIEW_SIZE / naturalWidth, PREVIEW_SIZE / naturalHeight);
  const cropScale = Math.max(PREVIEW_SIZE / naturalWidth, PREVIEW_SIZE / naturalHeight);
  return mode === 'fit' ? fitScale : cropScale;
};

const getAutoMode = (naturalWidth: number, naturalHeight: number): FrameMode => {
  const ratio = Math.max(naturalWidth, naturalHeight) / Math.min(naturalWidth, naturalHeight);
  return ratio > 1.18 ? 'fit' : 'crop';
};

const getMaxOffset = (naturalWidth: number, naturalHeight: number, zoom: number, mode: FrameMode) => {
  const scale = getBaseScale(naturalWidth, naturalHeight, mode) * zoom;
  return {
    x: Math.abs(naturalWidth * scale - PREVIEW_SIZE) / 2,
    y: Math.abs(naturalHeight * scale - PREVIEW_SIZE) / 2,
  };
};

const clampOffset = (offset: Point, naturalWidth: number, naturalHeight: number, zoom: number, mode: FrameMode) => {
  const maxOffset = getMaxOffset(naturalWidth, naturalHeight, zoom, mode);
  return {
    x: clamp(offset.x, -maxOffset.x, maxOffset.x),
    y: clamp(offset.y, -maxOffset.y, maxOffset.y),
  };
};

const ProductImageCropModal = ({ file, onCancel, onConfirm, onError }: ProductImageCropModalProps) => {
  const [imageUrl, setImageUrl] = useState('');
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [frameMode, setFrameMode] = useState<FrameMode>('fit');
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ pointer: Point; offset: Point } | null>(null);
  const [exporting, setExporting] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setImageUrl(objectUrl);
    setFrameMode('fit');
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setImageSize({ width: 0, height: 0 });

    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    if (!imageSize.width || !imageSize.height) return;
    setOffset((current) => clampOffset(current, imageSize.width, imageSize.height, zoom, frameMode));
  }, [frameMode, imageSize.height, imageSize.width, zoom]);

  const switchFrameMode = (nextMode: FrameMode) => {
    setFrameMode(nextMode);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const imageStyle = useMemo(() => {
    if (!imageSize.width || !imageSize.height) return {};

    const scale = getBaseScale(imageSize.width, imageSize.height, frameMode) * zoom;
    return {
      width: imageSize.width * scale,
      height: imageSize.height * scale,
      transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
    };
  }, [frameMode, imageSize.height, imageSize.width, offset.x, offset.y, zoom]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({
      pointer: { x: event.clientX, y: event.clientY },
      offset,
    });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart || !imageSize.width || !imageSize.height) return;

    const nextOffset = {
      x: dragStart.offset.x + event.clientX - dragStart.pointer.x,
      y: dragStart.offset.y + event.clientY - dragStart.pointer.y,
    };
    setOffset(clampOffset(nextOffset, imageSize.width, imageSize.height, zoom, frameMode));
  };

  const finishDragging = () => setDragStart(null);

  const exportImage = async () => {
    const image = imageRef.current;
    if (!image || !imageSize.width || !imageSize.height) return;

    setExporting(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is not available.');

      const scale = getBaseScale(imageSize.width, imageSize.height, frameMode) * zoom;
      const displayWidth = imageSize.width * scale;
      const displayHeight = imageSize.height * scale;
      const left = PREVIEW_SIZE / 2 + offset.x - displayWidth / 2;
      const top = PREVIEW_SIZE / 2 + offset.y - displayHeight / 2;
      const outputScale = OUTPUT_SIZE / PREVIEW_SIZE;

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      context.drawImage(
        image,
        left * outputScale,
        top * outputScale,
        displayWidth * outputScale,
        displayHeight * outputScale
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) resolve(nextBlob);
          else reject(new Error('Image export failed.'));
        }, 'image/webp', 0.86);
      });

      const baseName = file.name.replace(/\.[^/.]+$/, '') || 'product-image';
      onConfirm(new File([blob], `${baseName}.webp`, { type: 'image/webp' }));
    } catch (error) {
      console.error('[ProductImageCropModal] export failed:', error);
      onError?.('Could not prepare this image. Please try another file.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-950/60 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-[440px] rounded-2xl bg-white shadow-2xl ring-1 ring-gray-900/10">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-gray-900">
              <ImageIcon size={18} className="text-pink-500" />
              Position product image
            </div>
            <p className="mt-1 text-xs font-semibold text-gray-500">Fit keeps the full image. Crop fills the square.</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="grid h-9 w-9 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close crop editor"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
            <button
              type="button"
              onClick={() => switchFrameMode('fit')}
              className={`rounded-lg px-3 py-2 text-sm font-black transition-all ${
                frameMode === 'fit'
                  ? 'bg-white text-pink-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Fit full image
            </button>
            <button
              type="button"
              onClick={() => switchFrameMode('crop')}
              className={`rounded-lg px-3 py-2 text-sm font-black transition-all ${
                frameMode === 'crop'
                  ? 'bg-white text-pink-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Fill square
            </button>
          </div>

          <div
            className="relative mx-auto aspect-square w-full max-w-[320px] touch-none overflow-hidden rounded-xl bg-white ring-1 ring-gray-200"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDragging}
            onPointerCancel={finishDragging}
            role="application"
            aria-label="Image crop area"
          >
            {imageUrl && (
              <img
                ref={imageRef}
                src={imageUrl}
                alt=""
                className="absolute left-1/2 top-1/2 max-w-none select-none"
                draggable={false}
                style={imageStyle}
                onLoad={(event) => {
                  setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  });
                  switchFrameMode(getAutoMode(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight));
                }}
              />
            )}
            <div className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-white/80" />
            <div className="pointer-events-none absolute inset-6 rounded-lg border border-white/60" />
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
            <div className="mb-2 flex items-center justify-between text-xs font-black uppercase tracking-wide text-gray-500">
              <span>Zoom</span>
              <span>{Math.round(zoom * 100)}%</span>
            </div>
            <div className="flex items-center gap-3">
              <Minus size={16} className="text-gray-400" />
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="h-2 w-full accent-pink-500"
                aria-label="Image zoom"
              />
              <Plus size={16} className="text-gray-400" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 px-5 py-4">
          <Button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={exportImage}
            disabled={exporting || !imageSize.width}
            className="inline-flex items-center gap-2 rounded-lg bg-pink-500 px-5 py-2 text-sm font-black text-white shadow-md shadow-pink-200 hover:bg-pink-600 disabled:bg-pink-300"
          >
            {exporting ? 'Preparing...' : <Check size={16} />}
            {exporting ? '' : 'Use image'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProductImageCropModal;
